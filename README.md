
# LINA Backend
API /api/ask con modos por tema.

## Deploy en Render
1) Sube esta carpeta a un repo en GitHub.
2) En Render -> New Web Service -> conecta el repo.
3) Start: `node server.js` (sin build).
4) Variables: PROVIDER, MODEL, OPENAI_API_KEY (o GEMINI_API_KEY).
5) Copia la URL pública y pégala en `chat.js` como API_URL.

## Local
npm i
cp .env.example .env
# edita tu API key
npm start
