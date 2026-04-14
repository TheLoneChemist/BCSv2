# Card Scanner API

Backend for the QR/business card contact scanner app.

## Deploy to Railway

1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub repo
3. Add environment variable: `ANTHROPIC_API_KEY=sk-ant-...`
4. Copy your Railway public URL

## Local development

```bash
npm install
cp .env.example .env      # then add your real API key
npm run dev
```

## Endpoints

- `GET  /health`     — health check
- `POST /read-card`  — reads a business card image
  - Body: `{ "base64": "...", "mediaType": "image/jpeg" }`
  - Returns: `{ name, title, company, email, phone, website }`
