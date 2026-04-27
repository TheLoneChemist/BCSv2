import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => {
  res.sendFile('card-scanner.html', { root: '.' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/read-card', async (req, res) => {
  const { base64, mediaType } = req.body;

  if (!base64 || !mediaType) {
    return res.status(400).json({ error: 'Missing base64 or mediaType' });
  }

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          },
          {
            type: 'text',
            text: `Extract contact information from this business card image.
Reply ONLY with raw JSON, no markdown, no explanation, no code blocks.

Required JSON keys: name, title, company, email, phone, website

Rules:
- "name" must be the individual person's full name (e.g. "Jane Smith") — not the company name
- If you see a person's name prominently displayed, always populate "name"
- Use empty string "" for any field not found
- Do not wrap output in backticks or markdown`
          }
        ]
      }]
    });

    const text = msg.content.map(b => b.text || '').join('').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('No JSON found in response');
      parsed = JSON.parse(text.slice(s, e + 1));
    }

    res.json(parsed);
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Card scanner API running on port ${port}`);
});
