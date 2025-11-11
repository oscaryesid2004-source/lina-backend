// server.js — LINA backend (Express + OpenAI) con auth de prueba y cuota
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';

const app = express();

const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4o-mini';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-please-change';
const ORIGIN = process.env.ORIGIN || '*';

if (!OPENAI_API_KEY) {
  console.error('Falta OPENAI_API_KEY');
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ======= CORS / Middlewares
app.use(cors({
  origin: ORIGIN === '*' ? true : ORIGIN,
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  maxAge: 86400
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 60 }));

// ======= Health
app.get('/health', (_req, res) => res.json({ ok: true, model: MODEL }));

// ======= “DB” en memoria (DEMO)
const users = new Map(); // email -> { email, paid, quota, used, updatedAt }

// Helpers
function now() { return new Date().toISOString(); }
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15d' });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function normalizeEmail(e){ return String(e||'').trim().toLowerCase(); }

// ======= Auth endpoints
// Registro de prueba (5 preguntas)
app.post('/api/auth/register-trial', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message:'Email inválido' });
  }

  let u = users.get(email);
  if (!u) {
    u = { email, paid:false, quota:5, used:0, updatedAt: now() };
    users.set(email, u);
  }
  // Si ya usó el trial por completo y no ha pagado, igual devolvemos token
  // para que el front pueda mostrar “trial agotado”
  const token = signToken({ email: u.email, paid: u.paid, quota: u.quota, used: u.used });

  return res.json({
    email: u.email,
    paid: u.paid,
    quota: u.quota,
    used: u.used,
    remaining: Math.max(0, u.quota - u.used),
    token
  });
});

// Login “simple”: reemite token y estado
app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message:'Email inválido' });
  }
  let u = users.get(email);
  if (!u) {
    // Si jamás se registró, crea registro trial sin consumir
    u = { email, paid:false, quota:5, used:0, updatedAt: now() };
    users.set(email, u);
  }
  const token = signToken({ email: u.email, paid: u.paid, quota: u.quota, used: u.used });
  return res.json({
    email: u.email,
    paid: u.paid,
    quota: u.quota,
    used: u.used,
    remaining: Math.max(0, u.quota - u.used),
    token
  });
});

// Middleware auth
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message:'Falta token' });
  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ message:'Token inválido' });
  }
}

// Estado actual
app.get('/api/me', requireAuth, (req,res)=>{
  const email = req.user.email;
  const u = users.get(email);
  if (!u) return res.status(404).json({ message:'No existe' });
  return res.json({
    email: u.email,
    paid: u.paid,
    quota: u.quota,
    used: u.used,
    remaining: Math.max(0, u.quota - u.used)
  });
});

// ======= Utilidad de prompt
function buildSystemPrompt(topic = 'general') {
  return "Eres LINA, una asistente útil, concreta y amable. Responde en español de forma práctica y fácil.";
}

// ======= /api/ask con consumo de cuota
app.post('/api/ask', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const u = users.get(email);
    if (!u) return res.status(401).json({ message:'Sesión inválida' });

    const message = String(req.body?.message || '').trim();
    const topic = String(req.body?.theme || 'general');
    if (!message) return res.status(400).json({ message:'Debes enviar "message"' });

    // Control de cuota (si no es pago)
    if (!u.paid && u.used >= u.quota) {
      return res.status(402).json({
        ok:false,
        code:'trial_exhausted',
        message:'Has usado tus 5 preguntas gratis. Suscríbete para continuar.'
      });
    }

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role:'system', content: buildSystemPrompt(topic) },
        { role:'system', content: 'Sé breve, clara y orientada a la acción.' },
        { role:'user', content: message },
      ]
    });

    const text = completion?.choices?.[0]?.message?.content?.trim()
      || 'No pude generar una respuesta en este momento.';

    // Consumir 1 uso si no es pago
    if (!u.paid) {
      u.used += 1;
      u.updatedAt = now();
    }
    // Re-emite token con estado actualizado
    const token = signToken({ email:u.email, paid:u.paid, quota:u.quota, used:u.used });

    return res.json({
      ok:true,
      reply:text,
      remaining: Math.max(0, u.quota - u.used),
      token
    });
  } catch (err) {
    const status = err?.status ?? 500;
    if (status === 429) {
      return res.status(429).json({ ok:false, message:'Límite de modelo o crédito agotado. Intenta luego.' });
    }
    console.error('Error /api/ask:', err?.response?.data || err?.message || err);
    return res.status(500).json({ ok:false, message:'Error generando respuesta.' });
  }
});

// ======= Arranque
app.listen(PORT, () => {
  console.log(`LINA backend corriendo en puerto ${PORT}`);
});

