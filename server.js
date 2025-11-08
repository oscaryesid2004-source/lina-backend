// server.js — LINA backend (Express + OpenAI GPT-4o-mini)
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

if (!OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY en variables de entorno.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

app.set("trust proxy", 1);

// ---------- Middlewares (CORS + preflight + cabeceras útiles) ----------
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Rate limit (protege tu backend público)
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 60,             // 60 req/min por IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- Health / Root ----------
app.get("/", (_req, res) => res.send("LINA backend OK"));
app.get("/health", (_req, res) => res.json({ ok: true, model: MODEL }));

// ---------- Utilidades ----------
function buildSystemPrompt(topic = "general") {
  const m = (topic || "").toString().toLowerCase();
  const map = {
    cocina:
      "Eres LINA en modo cocina. Responde en español con recetas simples, pasos claros y tips prácticos. Sé amable y concreta.",
    finanzas:
      "Eres LINA en modo finanzas personales. Responde en español, simple y responsable. No reemplazas asesoría profesional.",
    estudio:
      "Eres LINA en modo estudio. Explica paso a paso, con ejemplos sencillos y resúmenes claros.",
    hogar:
      "Eres LINA en modo hogar. Da instrucciones sencillas para limpiar, organizar, cocinar y mantener la casa.",
    salud:
      "Eres LINA en modo salud general. Ofrece consejos de autocuidado y hábitos saludables. No das diagnóstico médico.",
    emprendimiento:
      "Eres LINA en modo emprender. Ayudas a definir oferta, público, precios, ventas por WhatsApp y contenidos.",
    default:
      "Eres LINA, una asistente útil, concreta y amable. Responde en español de forma práctica y orientada a la acción.",
  };
  return map[m] || map.default;
}

function normalizeUserText(txt) {
  return String(txt || "").slice(0, 4000);
}

// ---------- Endpoint principal ----------
app.post("/api/ask", async (req, res) => {
  try {
    const body = req.body || {};
    const message = normalizeUserText(body.message);
    // aceptamos 'topic' o 'theme'
    const topic = body.topic || body.theme || "general";

    if (!message) {
      return res
        .status(400)
        .json({ ok: false, reply: "Escribe algo para empezar. 😊" });
    }

    const systemPrompt = buildSystemPrompt(topic);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: "Sé breve, clara y orientada a la acción." },
        { role: "user", content: message },
      ],
    });

    const text =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una respuesta en este momento.";

    return res.json({ ok: true, reply: text });
  } catch (err) {
    const status = err?.status ?? 500;

    if (status === 429) {
      return res.status(429).json({
        ok: false,
        reply:
          "Estoy procesando muchas solicitudes o tu crédito se agotó. Intenta de nuevo. Si persiste, revisa el saldo de la API.",
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
