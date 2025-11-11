// server.js — LINA backend (Express + OpenAI + Bold sandbox)
// Requiere: "type": "module" en package.json

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();

// ------------- Config -------------
const PORT = process.env.PORT || 10000;
const MODEL = process.env.MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BOLD_BASE = process.env.BOLD_BASE || "https://integrations.api.bold.co";
const BOLD_TEST_API_KEY = process.env.BOLD_TEST_API_KEY;

// CORS: permite solo orígenes configurados (si no hay, permite cualquier origen)
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // navegadores sin origin (curl, apps)
      if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin no permitido"), false);
    },
    credentials: false,
  })
);

// JSON body
app.use(express.json({ limit: "1mb" }));

// Rate limit (protege endpoints públicos)
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Validación de claves
if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}

// Cliente OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ------------- Health -------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

// ------------- Utilidades -------------
function systemPrompt() {
  return (
    "Eres LINA, una asistente amable, clara y útil. " +
    "Responde en español, con pasos concretos y tono cercano. " +
    "Sé breve y orientada a la acción. Si la pregunta es insegura o sensible, " +
    "responde responsablemente y redirige a ayuda profesional cuando aplique."
  );
}
const normalize = (s) => String(s || "").slice(0, 4000);

// ------------- OpenAI: /api/ask -------------
app.post("/api/ask", async (req, res) => {
  try {
    const { message } = req.body || {};
    const userMsg = normalize(message);
    if (!userMsg) {
      return res.status(400).json({ ok: false, reply: "Escribe algo para empezar. 😊" });
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userMsg },
      ],
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una respuesta en este momento.";

    return res.json({ ok: true, reply });
  } catch (err) {
    const status = err?.status ?? 500;

    if (status === 429) {
      return res.status(429).json({
        ok: false,
        reply:
          "Estoy procesando muchas solicitudes o tu crédito se agotó. Intenta de nuevo en un momento. Si persiste, revisa el saldo de la API.",
      });
    }
    if (status === 401 || status === 403) {
      return res.status(status).json({
        ok: false,
        reply:
          "No tengo permiso para acceder al modelo. Verifica tu API Key y permisos del proyecto.",
      });
    }

    console.error("Error /api/ask:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      ok: false,
      reply: "Hubo un problema al generar la respuesta. Intenta de nuevo en un momento.",
    });
  }
});

// ------------- Bold sandbox -------------
const boldHeaders = () => ({
  Authorization: `x-api-key ${BOLD_TEST_API_KEY}`,
  "Content-Type": "application/json",
});

// Métodos de pago disponibles
app.get("/api/bold/payment-methods", async (_req, res) => {
  try {
    if (!BOLD_TEST_API_KEY) {
      return res.status(400).json({ error: "missing BOLD_TEST_API_KEY" });
    }
    const r = await fetch(`${BOLD_BASE}/payments/payment-methods`, {
      headers: boldHeaders(),
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    console.error("bold/payment-methods", e);
    res.status(500).json({ error: "bold_methods_error", detail: String(e) });
  }
});

// Terminales vinculadas (SmartPro)
app.get("/api/bold/binded-terminals", async (_req, res) => {
  try {
    if (!BOLD_TEST_API_KEY) {
      return res.status(400).json({ error: "missing BOLD_TEST_API_KEY" });
    }
    const r = await fetch(`${BOLD_BASE}/payments/binded-terminals`, {
      headers: boldHeaders(),
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    console.error("bold/binded-terminals", e);
    res.status(500).json({ error: "bold_terminals_error", detail: String(e) });
  }
});

// Crear pago (app-checkout)
app.post("/api/bold/app-checkout", async (req, res) => {
  try {
    if (!BOLD_TEST_API_KEY) {
      return res.status(400).json({ error: "missing BOLD_TEST_API_KEY" });
    }
    // El body debe incluir los campos requeridos por Bold (ver doc).
    const body = req.body || {};
    const r = await fetch(`${BOLD_BASE}/payments/app-checkout`, {
      method: "POST",
      headers: boldHeaders(),
      body: JSON.stringify(body),
    });
    const j = await r.json();
    res.status(r.status).json(j);
  } catch (e) {
    console.error("bold/app-checkout", e);
    res.status(500).json({ error: "bold_checkout_error", detail: String(e) });
  }
});

// ------------- Arranque -------------
app.listen(PORT, () => {
  console.log(`LINA backend corriendo en puerto ${PORT}`);
});


