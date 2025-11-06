// server.js — LINA Backend (Express + CORS ABIERTO + OpenAI/Gemini)

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import fetch from 'node-fetch';

const app = express();

// ===== CORS ABIERTO (temporal para probar) =====
app.use(cors());              // permite cualquier origen
app.options('*', cors());     // responde a preflight OPTIONS

// ===== Body parser =====
app.use(express.json({ limit: '1mb' }));

// ===== Healthcheck =====
app.get('/health', (req, res) => res.json({ ok: true }));

// ===== Config =====
const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase(); // 'openai' | 'gemini'
const MODEL = process.env.MODEL || (PROVIDER === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const SYSTEM_BY_THEME = {
  general: "Eres LINA, una IA amable y clara para personas. Responde en pasos simples (máx 6), sin jerga técnica.",
  cocina: "LINA modo Cocina. Chef latino práctico: 1-4 porciones, pasos simples, tiempos y lista de compra.",
  finanzas: "LINA modo Finanzas. Presupuesto, ahorro y deudas con números simples (no consejo profesional).",
  emprendimiento: "LINA modo Emprender. Guía ventas por WhatsApp, cliente ideal y precios.",
  'formacion-digital': "LINA modo Digital. Enseña a usar celular/apps paso a paso (Paso 1, Paso 2…).",
  hogar: "LINA modo Hogar. Limpieza y organización casera. Evita mezclas peligrosas.",
  mascotas: "LINA modo Mascotas. Consejos básicos; ante urgencias, veterinario.",
  salud: "LINA modo Salud. Hábitos saludables; no es consejo médico.",
  'salud-mental': "LINA modo Salud Mental. Apoyo básico; no reemplaza terapia.",
  familia: "LINA modo Familia. Comunicación asertiva.",
  aprendizaje: "LINA modo Estudio. Explica con ejemplos.",
  idiomas: "LINA modo Idiomas. Frases útiles.",
  empleo: "LINA modo Empleo. CV e entrevistas.",
  mecanica: "LINA modo Mecánica. Mantenimiento básico seguro.",
  construccion: "LINA modo Construcción. Reparaciones caseras con seguridad.",
  agricultura: "LINA modo Agricultura. Huerta y abonos.",
  'ia-herramientas': "LINA modo IA. Enseña herramientas con casos reales.",
  comunicacion: "LINA modo Comunicación. Mejora textos y presentaciones.",
  creatividad: "LINA modo Creatividad. Ideas y pasos cortos.",
  cultura: "LINA modo Cultura. Historia amena.",
  espiritualidad: "LINA modo Espiritualidad. Hábitos y reflexiones positivas.",
  viajes: "LINA modo Viajes. Rutas y presupuestos.",
  tramites: "LINA modo Trámites. Pasos y documentos típicos."
};

// ===== Llamadas a modelos =====
async function callOpenAI(messages) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3 })
  });
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function callGemini(messages) {
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
  const prompt = `INSTRUCCIONES:\n${sys}\n\nMENSAJE DEL USUARIO:\n${user}`;
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await resp.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// ===== Endpoint principal =====
app.post('/api/ask', async (req, res) => {
  try {
    const { theme = 'general', message = '' } = req.body || {};
    const system = SYSTEM_BY_THEME[theme] || SYSTEM_BY_THEME.general;
    const messages = [{ role: 'system', content: system }, { role: 'user', content: message }];

    let reply = '';
    if (PROVIDER === 'gemini') {
      if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
      reply = await callGemini(messages);
    } else {
      if (!OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY');
      reply = await callOpenAI(messages);
    }

    res.json({ reply });
  } catch (e) {
    console.error('API error:', e);
    res.status(500).json({ reply: 'Error en el servidor de IA.' });
  }
});

// ===== Arranque =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('LINA backend corriendo en', PORT));

