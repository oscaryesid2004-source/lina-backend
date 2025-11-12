// server.js — LINA backend con AUTH + cuotas + OpenAI
// Node >=18. “type”: “module” en package.json

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bodyParser from "body-parser";
import OpenAI from "openai";

/* ============ CONFIG ============ */
const PORT = process.env.PORT || 10000;
const PROVIDER = process.env.PROVIDER || "openai";
const MODEL = process.env.MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL || ""; // tu dominio: https://lina.sinacol.com.co
const FREE_QUOTA = 5; // preguntas gratis

if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ============ “DB” EN MEMORIA (simple) ============ */
const users = new Map();
/*
 users.set(email, {
   token: "xxxxxxxx",
   quota: 5,                 // disponible
   subscribedUntil: 0,       // timestamp ms, 0 si no tiene
 });
*/
function randomToken(len = 32) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/* ============ APP ============ */
const app = express();

// CORS: permite tu frontend
const origins = [
  "http://localhost:5173",
  "http://localhost:8080",
  "https://lina.sinacol.com.co", // <-- cámbialo si usas otro dominio
];
if (APP_BASE_URL) origins.push(APP_BASE_URL);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      // permite subdominios si hiciera falta:
      try {
        const u = new URL(origin);
        if (u.hostname.endsWith("sinacol.com.co")) return cb(null, true);
      } catch {}
      return cb(null, true); // si quieres ser laxo, deja true
    },
    credentials: false,
  })
);

app.use(bodyParser.json({ limit: "1mb" }));

// rate limit general
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ============ HEALTH ============ */
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

/* ============ AUTH ============ */
// registro / login simple por email -> devuelve token y cuota
app.post("/auth/register", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "email_invalido" });
  }
  let u = users.get(email);
  if (!u) {
    u = { token: randomToken(), quota: FREE_QUOTA, subscribedUntil: 0 };
    users.set(email, u);
  }
  return res.json({
    ok: true,
    token: u.token,
    quota: u.quota,
    subscribedUntil: u.subscribedUntil,
  });
});

// estado actual por token
app.get("/auth/status", (req, res) => {
  const token = String(req.headers["x-lina-token"] || "");
  const u = [...users.values()].find((x) => x.token === token);
  if (!u) return res.status(401).json({ ok: false, error: "no_autorizado" });
  res.json({
    ok: true,
    quota: u.quota,
    subscribedUntil: u.subscribedUntil,
    now: Date.now(),
  });
});

/* ============ PAGO (BOLD SANDBOX FAKE) ============ 
   Este endpoint simula la activación del plan por 30 días:
   En producción, aquí llamarías a Bold y, cuando el pago se apruebe,
   marcarías subscribedUntil = Date.now()+30d. */
app.post("/billing/activate-sandbox", (req, res) => {
  const token = String(req.headers["x-lina-token"] || "");
  const u = [...users.values()].find((x) => x.token === token);
  if (!u) return res.status(401).json({ ok: false, error: "no_autorizado" });
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  u.subscribedUntil = Date.now() + THIRTY_DAYS;
  u.quota = Math.max(u.quota, FREE_QUOTA); // conserva si tuviera menos
  return res.json({ ok: true, subscribedUntil: u.subscribedUntil });
});

/* ============ CHAT ============ */
app.post("/api/ask", async (req, res) => {
  try {
    const token = String(req.headers["x-lina-token"] || "");
    const u = [...users.values()].find((x) => x.token === token);
    if (!u) {
      return res.status(401).json({ ok: false, reply: "No autorizado." });
    }

    // verificar suscripción o cuota
    const now = Date.now();
    const isSubscribed = u.subscribedUntil && u.subscribedUntil > now;
    if (!isSubscribed) {
      if (u.quota <= 0) {
        return res.status(402).json({
          ok: false,
          reply: "Has agotado tus 5 preguntas de prueba. Suscríbete para continuar.",
          quota: 0,
        });
      }
      u.quota -= 1;
    }

    const user = String(req.body?.message || "").slice(0, 4000);
    if (!user) return res.status(400).json({ ok: false, reply: "Escribe algo." });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: "Eres LINA, amable y clara. Responde en español, breve y útil." },
        { role: "user", content: user },
      ],
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una respuesta ahora.";
    return res.json({
      ok: true,
      reply,
      quota: u.quota,
      subscribedUntil: u.subscribedUntil,
    });
  } catch (e) {
    console.error("Error /api/ask:", e?.response?.data || e?.message || e);
    return res.status(500).json({ ok: false, reply: "Error al responder." });
  }
});

/* ============ ARRANQUE ============ */
app.listen(PORT, () => {
  console.log(`LINA backend con AUTH escuchando en :${PORT}`);
});
