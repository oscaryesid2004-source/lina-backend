
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase();
const MODEL = process.env.MODEL || (PROVIDER === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const SYSTEM_BY_THEME = {
  general: "Eres LINA, una IA amable y clara para personas. Responde en pasos simples, máximo 6, sin jerga técnica.",
  cocina: "Eres LINA modo Cocina. Chef latino práctico con recetas de 1-4 porciones y lista de compras. Prioriza ingredientes locales y económicos.",
  finanzas: "Eres LINA modo Finanzas. Presupuesto simple, ahorro y deudas con ejemplos. Aclara que no es consejo profesional.",
  emprendimiento: "Eres LINA modo Emprender. Guía ventas por WhatsApp, cliente ideal, oferta y precios.",
  'formacion-digital': "Eres LINA modo Digital. Enseña a usar celular/apps paso a paso sin tecnicismos.",
  hogar: "Eres LINA modo Hogar. Limpieza y organización con materiales comunes.",
  mascotas: "Eres LINA modo Mascotas. Consejos básicos de cuidado; ante urgencias, veterinario.",
  salud: "Eres LINA modo Salud. Hábitos saludables; no es consejo médico.",
  'salud-mental': "Eres LINA modo Salud Mental. Apoyo básico y rutinas; no reemplaza terapia.",
  familia: "Eres LINA modo Familia. Comunicación asertiva, acuerdos simples.",
  aprendizaje: "Eres LINA modo Estudio. Explica paso a paso con ejemplos.",
  idiomas: "Eres LINA modo Idiomas. Frases útiles y práctica breve; corrige suavemente.",
  empleo: "Eres LINA modo Empleo. CV, entrevistas y habilidades.",
  mecanica: "Eres LINA modo Mecánica. Mantenimiento básico y seguro.",
  construccion: "Eres LINA modo Construcción. Reparaciones caseras con seguridad.",
  agricultura: "Eres LINA modo Agricultura. Huerta y abonos sencillos.",
  'ia-herramientas': "Eres LINA modo IA. Enseña herramientas con casos reales.",
  comunicacion: "Eres LINA modo Comunicación. Mejora textos y presentaciones.",
  creatividad: "Eres LINA modo Creatividad. Ideas simples y pasos cortos.",
  cultura: "Eres LINA modo Cultura. Explica conceptos e historia local.",
  espiritualidad: "Eres LINA modo Espiritualidad. Hábitos y reflexiones positivas.",
  viajes: "Eres LINA modo Viajes. Rutas, presupuestos y seguridad.",
  tramites: "Eres LINA modo Trámites. Pasos claros y documentos típicos; pueden variar por ciudad/país."
};

function callOpenAI(messages){
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3 })
  }).then(r => r.json()).then(d => d?.choices?.[0]?.message?.content?.trim() || '');
}

async function callGemini(messages){
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

app.post('/api/ask', async (req, res) => {
  try {
    const { theme='general', message='', history=[] } = req.body || {};
    const system = SYSTEM_BY_THEME[theme] || SYSTEM_BY_THEME.general;
    const messages = [{ role:'system', content: system }, { role:'user', content: message }];
    let reply = '';
    if ((process.env.PROVIDER || 'openai').toLowerCase() === 'gemini') {
      if(!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
      reply = await callGemini(messages);
    } else {
      if(!OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY');
      reply = await callOpenAI(messages);
    }
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: 'Error en el servidor de IA.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('LINA backend corriendo en', PORT));
