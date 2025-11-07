// server.js  — LINA backend (Express + OpenAI GPT-4o-mini)
// Requiere: "type": "module" en package.json y dependencia "openai" v4+

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o-mini";

// Validaciones básicas de entorno
if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rate limit (protege tu backend público)
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 60,             // 60 requests/min por IP
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
  // Ajusta el “modo” de LINA según el tema
  // Puedes crear textos más específicos por categoría
  const map = {
    cocina:
      "Eres LINA en modo cocina. Responde en español, con recetas simples, pasos cortos y tips prácticos. Sé clara y amable.",
    finanzas:
      "Eres LINA en modo finanzas personales. Responde en español, simple y responsable, sin reemplazar asesoría profesional.",
    estudio:
      "Eres LINA en modo estudio. Explica paso a paso, con ejemplos sencillos y resúmenes claros.",
    default:
      "Eres LINA, una asistente útil, concreta y amable. Responde en español de forma práctica y fácil.",
  };
  return map[topic?.toLowerCase()] || map.default;
}

function normalizeUserText(txt) {
  return String(txt || "").slice(0, 4000); // Evita textos gigantes
}

// ---------- Endpoint principal ----------
app.post("/api/ask", async (req, res) => {
  try {
    const { message, topic } = req.body || {};
    const user = normalizeUserText(message);
    if (!user) {
      return res.status(400).json({ ok: false, reply: "Escribe algo para empezar. 😊" });
    }

    const systemPrompt = buildSystemPrompt(topic);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600, // ajusta si quieres respuestas más largas/cortas
      messages: [
        { role: "system", content: systemPrompt },
        // *Opcional*: añade reglas de estilo globales:
        { role: "system", content: "Sé breve, clara y orientada a la acción." },
        { role: "user", content: user },
      ],
    });

    const text =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una respuesta en este momento.";

    // Devuelve SIEMPRE un objeto simple al front
    return res.json({ ok: true, reply: text });
  } catch (err) {
    // Manejo de errores amistoso
    const status = err?.status ?? 500;

    // Casos comunes
    if (status === 429) {
      // Límite o crédito insuficiente
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
      reply:
        "Hubo un problema al generar la respuesta. Intenta de nuevo en un momento.",
    });
  }
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log(`LINA backend corriendo en puerto ${PORT}`);
});
