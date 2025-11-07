// server.js — LINA backend (Express + OpenAI)
// Requiere "openai" v4+, "express", "cors", "express-rate-limit"
// y Node 18+ (Render lo soporta). Usa variables de entorno.

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o-mini";

if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Límite suave para proteger el backend público
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 60,             // 60 req/min por IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: MODEL });
});

// ---------- Utilidades ----------
function buildSystemPrompt(topic = "general") {
  const map = {
    cocina:
      "Eres LINA en modo cocina. Responde en español, con recetas simples, pasos cortos y tips prácticos. Sé clara y amable.",
    finanzas:
      "Eres LINA en modo finanzas personales. Responde en español, simple y responsable. No es asesoría profesional.",
    estudio:
      "Eres LINA en modo estudio. Explica paso a paso, con ejemplos sencillos y resúmenes claros.",
    default:
      "Eres LINA, una asistente útil, concreta y amable. Responde en español de forma práctica y fácil.",
  };
  return map[(topic || "").toLowerCase()] || map.default;
}

function normalizeUserText(txt) {
  return String(txt || "").slice(0, 4000);
}

// ---------- Endpoint principal ----------
app.post("/api/ask", async (req, res) => {
  try {
    // Acepta 'topic' o 'tema' (por compatibilidad con tu front actual)
    const { message, topic, tema } = req.body || {};
    const userText = normalizeUserText(message);
    if (!userText) {
      return res.status(400).json({ reply: "Escribe algo para empezar. 😊" });
    }

    const theTopic = topic || tema || "general";
    const systemPrompt = buildSystemPrompt(theTopic);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: "Sé breve, clara y orientada a la acción." },
        { role: "user", content: userText },
      ],
    });

    const text =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una respuesta en este momento.";

    return res.json({ reply: text });
  } catch (err) {
    const status = err?.status ?? 500;

    if (status === 429) {
      return res.status(429).json({
        reply:
          "Hay muchas solicitudes o tu saldo de API se agotó. Intenta de nuevo o revisa tu crédito en OpenAI.",
      });
    }

    if (status === 401 || status === 403) {
      return res.status(status).json({
        reply:
          "Clave inválida o sin permiso. Verifica tu OPENAI_API_KEY y los permisos del proyecto.",
      });
    }

    console.error("Error /api/ask:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      reply: "Tuvimos un problema al responder. Intenta nuevamente en un momento.",
    });
  }
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log(`LINA backend corriendo en puerto ${PORT}`);
});
