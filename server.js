// server.js — LINA Backend (OpenAI/Gemini) con fallback y sin mostrar errores al usuario
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import fetch from 'node-fetch';

const app = express();

app.use(cors());
app.options('*', cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase();
const MODEL = process.env.MODEL || (PROVIDER === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const SYSTEM_BY_THEME = {
  general:
    'Eres LINA, una IA amable y clara para personas. Responde paso a paso (máx 6), sin jerga técnica.',
  cocina:
    'LINA modo Cocina. Chef latino práctico: 1-4 porciones, pasos simples, tiempos y lista de compra.',
  finanzas:
    'LINA modo Finanzas. Presupuesto, ahorro y deudas con números simples (no es consejo profesional).',
  emprendimiento:
    'LINA modo Emprender. Guía ventas por WhatsApp, cliente ideal y precios.'
};

function localFallback(theme, message) {
  if ((theme || '').toLowerCase() === 'cocina') {
    const ing = message?.trim() || 'ingredientes sencillos';
    return `Idea rápida con lo que tienes:
- ${ing}
- Sofríe 5 min, agrega sal y una pizca de pimienta.
- Sirve con arroz/pan.
TIP: añade huevo o atún para proteína.`;
  }
  return `Estoy listo para ayudarte. Escribe tu duda y te respondo paso a paso.`;
}

async function callOpenAI(messages) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3 })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${text}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`OpenAI parse error: ${text}`); }
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error(`OpenAI vacío: ${text}`);
  return reply;
}

async function callGemini(messages) {
  const sys = messages.find(m => m.role === 'system')?.content || '';
  const user = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
  const prompt = `INSTRUCCIONES:\n${sys}\n\nMENSAJE DEL USUARIO:\n${user}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${text}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Gemini parse error: ${text}`); }
  const reply = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  if (!reply) throw new Error(`Gemini vacío: ${text}`);
  return reply;
}

app.post('/api/ask', async (req, res) => {
  const { theme = 'general', message = '' } = req.body || {};
  const system = SYSTEM_BY_THEME[theme] || SYSTEM_BY_THEME.general;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: message }
  ];

  try {
    let reply = '';
    if (PROVIDER === 'gemini') {
      if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
      reply = await callGemini(messages);
    } else {
      if (!OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY');
      reply = await callOpenAI(messages);
    }
    return res.json({ reply });
  } catch (err) {
    console.error('API error:', err?.message || err);
    const reply = localFallback(theme, message);
    return res.status(200).json({ reply, meta: { fallback: true } });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('LINA backend corriendo en', PORT));
