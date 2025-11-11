// server.js — LINA backend (Express + OpenAI + Trials + Bold sandbox proxy)
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o-mini";
const TRIAL_SECRET = process.env.TRIAL_SECRET || "change_me";
const TRIAL_FREE_COUNT = parseInt(process.env.TRIAL_FREE_COUNT || "5", 10);

const BOLD_API_KEY = process.env.BOLD_API_KEY || "";
const BOLD_BASE_URL = process.env.BOLD_BASE_URL || "https://integrations.api.bold.co";

// Validaciones básicas
if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- Utils JWT ----------
function signTrialToken(payload) {
  // payload: { uid, email, remaining, plan }
  return jwt.sign(payload, TRIAL_SECRET, { expiresIn: "30d" });
}
function verifyToken(token) {
  try { return jwt.verify(token, TRIAL_SECRET); }
  catch { return null; }
}

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

// ---------- Registro (trial) ----------
app.post("/api/register", (req, res) => {
  const { email } = req.body || {};
  const clean = String(email || "").trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return res.status(400).json({ ok: false, error: "EMAIL_INVALID" });
  }
  const uid = "u_" + Buffer.from(clean).toString("hex").slice(0, 16);
  const token = signTrialToken({
    uid,
    email: clean,
    remaining: TRIAL_FREE_COUNT,
    plan: "trial",
  });
  return res.json({ ok: true, token, remaining: TRIAL_FREE_COUNT, plan: "trial" });
});

// ---------- Estado trial ----------
app.get("/api/trial-status", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ ok: false, error: "TOKEN_INVALID" });
  return res.json({ ok: true, remaining: data.remaining ?? 0, plan: data.plan || "trial" });
});

// ---------- Middleware trial para /api/ask ----------
function requireTrialOrPaid(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ ok: false, error: "TOKEN_INVALID" });
  req.user = data;
  next();
}

// ---------- Endpoint principal ----------
app.post("/api/ask", requireTrialOrPaid, async (req, res) => {
  try {
    let { message, topic } = req.body || {};
    const user = req.user; // {uid,email,remaining,plan}

    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, reply: "Escribe algo para empezar. 😊" });
    }

    // Control de trial
    if (user.plan === "trial") {
      if (!Number.isFinite(user.remaining) || user.remaining <= 0) {
        return res.status(402).json({
          ok: false,
          reply: "Se agotaron tus 5 preguntas gratis. Suscríbete para seguir usando LINA.",
        });
      }
      user.remaining -= 1;
    }

    // Prompt por tema (opcional: dejamos general)
    const systemPrompt =
      "Eres LINA, una asistente clara y amable. Responde en español, breve y orientada a la acción.";

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: "Sé breve, clara y concreta." },
        { role: "user", content: String(message).slice(0, 4000) },
      ],
    });

    const text =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una respuesta en este momento.";

    // Si es trial, devolvemos token actualizado con remaining
    let headers = {};
    if (user.plan === "trial") {
      const newToken = signTrialToken({
        uid: user.uid, email: user.email,
        remaining: user.remaining, plan: "trial",
      });
      headers["x-refresh-token"] = newToken;
    }

    return res.set(headers).json({ ok: true, reply: text });
  } catch (err) {
    const status = err?.status ?? 500;
    if (status === 429) {
      return res.status(429).json({
        ok: false,
        reply: "Estoy procesando muchas solicitudes o tu crédito se agotó. Intenta de nuevo.",
      });
    }
    if (status === 401 || status === 403) {
      return res.status(status).json({ ok: false, reply: "No tengo permiso para acceder al modelo." });
    }
    console.error("Error /api/ask:", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, reply: "Hubo un problema. Intenta más tarde." });
  }
});

// ---------- BOLD Sandbox Proxies ----------
function boldHeaders() {
  return { Authorization: `x-api-key ${BOLD_API_KEY}`, "Content-Type": "application/json" };
}

// Métodos de pago
app.get("/api/bold/payment-methods", async (_req, res) => {
  try {
    const r = await fetch(`${BOLD_BASE_URL}/payments/payment-methods`, {
      headers: boldHeaders(),
    });
    const j = await r.json();
    return res.status(r.status).json(j);
  } catch (e) {
    return res.status(500).json({ payload: null, errors: ["BOLD_PROXY_ERROR"] });
  }
});

// Terminales disponibles
app.get("/api/bold/binded-terminals", async (_req, res) => {
  try {
    const r = await fetch(`${BOLD_BASE_URL}/payments/binded-terminals`, {
      headers: boldHeaders(),
    });
    const j = await r.json();
    return res.status(r.status).json(j);
  } catch (e) {
    return res.status(500).json({ payload: null, errors: ["BOLD_PROXY_ERROR"] });
  }
});

// Crear pago (sandbox)
app.post("/api/bold/app-checkout", async (req, res) => {
  try {
    const r = await fetch(`${BOLD_BASE_URL}/payments/app-checkout`, {
      method: "POST",
      headers: boldHeaders(),
      body: JSON.stringify(req.body || {}),
    });
    const j = await r.json();
    return res.status(r.status).json(j);
  } catch (e) {
    return res.status(500).json({ payload: null, errors: ["BOLD_PROXY_ERROR"] });
  }
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log(`LINA backend corriendo en puerto ${PORT}`);
});
