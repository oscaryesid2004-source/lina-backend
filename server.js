// server.js — LINA backend listo con cuotas + suscripción Bold (sandbox/mock)

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import jwt from "jsonwebtoken";

// ------- Config -------
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o-mini";
const JWT_SECRET = process.env.JWT_SECRET || "";
const BOLD_TEST_API_KEY = process.env.BOLD_TEST_API_KEY || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("Falta JWT_SECRET");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });
const app = express();

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, true); // relajado para empezar; puedes endurecerlo
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

// Rate limit base
app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ------- "BD" temporal (memoria) -------
// Nota: en Render se borra si se reinicia. Para producción, usa Redis/Postgres.
const users = new Map(); // email -> { used: number, subUntil: number (ms) }
const FREE_QUOTA = 5;
const SUBSCRIPTION_DAYS = 30;

// Helpers
const now = () => Date.now();
const addDays = (d) => now() + d * 24 * 60 * 60 * 1000;

function ensureUser(email) {
  if (!users.has(email)) users.set(email, { used: 0, subUntil: 0 });
  return users.get(email);
}
function isSubscribed(u) {
  return u.subUntil && u.subUntil > now();
}
function remainingFree(u) {
  return Math.max(0, FREE_QUOTA - (u.used || 0));
}
function signToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "90d" });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/i);
  const tok = m ? m[1] : null;
  if (!tok) return res.status(401).json({ ok: false, error: "NO_TOKEN" });
  try {
    const p = jwt.verify(tok, JWT_SECRET);
    req.email = p.email;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "BAD_TOKEN" });
  }
}

// ------- Health -------
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

// ------- Auth simple (email -> token) -------
app.post("/auth/register", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "EMAIL_INVALID" });
  }
  const u = ensureUser(email);
  const token = signToken(email);
  return res.json({
    ok: true,
    token,
    email,
    subscribed: isSubscribed(u),
    subUntil: u.subUntil || 0,
    remaining: remainingFree(u),
    quota: FREE_QUOTA
  });
});

// ------- Estado actual (contador + suscripción) -------
app.get("/me", auth, (req, res) => {
  const u = ensureUser(req.email);
  return res.json({
    ok: true,
    email: req.email,
    subscribed: isSubscribed(u),
    subUntil: u.subUntil || 0,
    used: u.used || 0,
    remaining: remainingFree(u),
    quota: FREE_QUOTA
  });
});

// ------- Chat con cuota -------
app.post("/api/ask", auth, async (req, res) => {
  try {
    const u = ensureUser(req.email);

    if (!isSubscribed(u)) {
      if (remainingFree(u) <= 0) {
        return res.status(402).json({
          ok: false,
          code: "PAYWALL",
          reply: "Has usado tus 5 preguntas gratis. Suscríbete para seguir usando LINA sin límites.",
          remaining: 0,
          subscribed: false
        });
      }
    }

    const message = String(req.body?.message || "").slice(0, 4000);
    if (!message) return res.status(400).json({ ok: false, error: "EMPTY_MESSAGE" });

    const systemPrompt = "Eres LINA. Responde en español, útil y concreta. Sé amable, evita contenido peligroso.";
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ]
    });

    const text = completion?.choices?.[0]?.message?.content?.trim() || "No pude generar respuesta.";

    // cuenta solo si NO está suscrito
    if (!isSubscribed(u)) {
      u.used = (u.used || 0) + 1;
    }
    users.set(req.email, u);

    return res.json({
      ok: true,
      reply: text,
      remaining: remainingFree(u),
      subscribed: isSubscribed(u)
    });

  } catch (err) {
    const status = err?.status ?? 500;
    if (status === 429) {
      return res.status(429).json({ ok: false, reply: "Muchas solicitudes o saldo insuficiente en la API." });
    }
    console.error("ASK ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, reply: "Error interno. Intenta de nuevo." });
  }
});

// ------- Suscripción (Bold sandbox o mock) -------
app.post("/payments/subscribe", auth, async (req, res) => {
  const email = req.email;
  const u = ensureUser(email);
  const COP = 20000; // precio mensual
  const reference = `sub_${email}_${Date.now()}`;

  // Si no hay API key, modo MOCK (activa al instante)
  if (!BOLD_TEST_API_KEY) {
    u.subUntil = addDays(SUBSCRIPTION_DAYS);
    users.set(email, u);
    return res.json({
      ok: true,
      mode: "MOCK",
      message: "Suscripción activada (mock) por 30 días.",
      subscribed: true,
      subUntil: u.subUntil
    });
  }

  // Con Bold Sandbox: iniciamos un checkout "PAY_BY_LINK"
  try {
    const r = await fetch("https://integrations.api.bold.co/payments/app-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `x-api-key ${BOLD_TEST_API_KEY}`
      },
      body: JSON.stringify({
        amount: {
          currency: "COP",
          taxes: [],         // si requieres IVA, agrega VAT
          tip_amount: 0,
          // Usa un monto "aprobador" del sandbox (entre 1.000 y 2.000.000)
          total_amount: COP
        },
        payment_method: "PAY_BY_LINK",
        terminal_model: "N86",
        terminal_serial: "N860W000000",
        reference,
        user_email: "vendedor@comercio.com",   // Bold exige un correo del vendedor
        description: "Suscripción LINA mensual",
        payer: {
          email,
          phone_number: "3000000000",
          document: { document_type: "CEDULA", document_number: "1000000000" }
        }
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Bold error:", data);
      return res.status(400).json({ ok: false, error: "BOLD_ERROR", detail: data });
    }

    // data.payload.integration_id — te sirve para conciliación
    return res.json({
      ok: true,
      mode: "BOLD",
      integration_id: data?.payload?.integration_id || null,
      message: "Checkout creado. Completa el pago en tu datáfono o link de pago.",
      // En sandbox, no tenemos una URL directa. Usa dashboard Bold para ver el flujo.
    });

  } catch (e) {
    console.error("Bold exception:", e);
    return res.status(500).json({ ok: false, error: "BOLD_EXCEPTION" });
  }
});

// ------- Webhook Bold (marcar pago aprobado) -------
// En sandbox, configura el webhook "sandbox" de Bold a esta URL pública
app.post("/webhooks/bold", express.json(), (req, res) => {
  // Bold enviará datos del pago con la reference
  // Asegúrate de validar la firma o una api-key del webhook si la ofrecen.
  const body = req.body || {};
  const ref = body?.reference || body?.payload?.reference || "";
  // Recupera el email que pusimos en la reference: sub_email_timestamp
  const m = ref.match(/^sub_(.+)_(\d+)$/);
  if (m) {
    const email = m[1];
    const u = ensureUser(email);
    // Si la pasarela indica "aprobado", activamos 30 días:
    const status = body?.status || body?.payload?.status || "APPROVED";
    if (String(status).toUpperCase() === "APPROVED") {
      u.subUntil = addDays(SUBSCRIPTION_DAYS);
      u.used = 0; // reseteamos libres si quieres
      users.set(email, u);
      console.log("Subscripción activada para", email);
    }
  }
  res.json({ ok: true });
});

// ------- Iniciar -------
app.listen(PORT, () => {
  console.log(`LINA backend en ${PORT}`);
});
