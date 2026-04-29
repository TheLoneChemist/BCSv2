// card-scanner-api v1.2.0
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

// Detect whether the card has a QR code
app.post('/detect-card', async (req, res) => {
  const { base64, mediaType } = req.body;

  if (!base64 || !mediaType) {
    return res.status(400).json({ error: 'Missing base64 or mediaType' });
  }

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          },
          {
            type: 'text',
            text: `Does this business card contain a QR code? Reply ONLY with raw JSON, no markdown.
JSON key: hasQRCode (boolean)`
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

    res.json({ hasQRCode: !!parsed.hasQRCode });
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

// Read card via printed text
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
- "name" must ONLY be an individual human's personal name (e.g. "Gary Sturn" or "Gary M. Sturn MD") — NEVER a business, practice, or organization name
- Look for a personal name near a job title like "MD", "PhD", "CEO", "Director", etc. — that person's name goes in "name"
- "company" is for the business/organization name (e.g. "Altamonte Medical Associates P.A.")
- If the card has both a personal name AND a company name, both fields must be populated
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

// Read card via QR code — extracts the URL/data embedded in the QR
app.post('/read-card-qr', async (req, res) => {
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
            text: `Decode the QR code in this image and extract any contact information from it.
Reply ONLY with raw JSON, no markdown, no explanation, no code blocks.

Required JSON keys: name, title, company, email, phone, website, qrData

Rules:
- "qrData" should contain the raw decoded QR code string (URL, vCard text, etc.)
- Populate the other fields if the QR data contains contact info (e.g. a vCard or hCard URL)
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

// Generate follow-up email draft from conversation notes
app.post('/generate-email', async (req, res) => {
  const { contact, notes, paragraphs, tone } = req.body;

  if (!notes) {
    return res.status(400).json({ error: 'Missing notes' });
  }

  const d = contact || {};
  const firstName = (d.name || '').split(' ')[0] || 'there';
  const paraCount = parseInt(paragraphs) || 3;
  const today = new Date().toISOString().split('T')[0];

  const toneMap = {
    professional: 'professional and polished',
    casual: 'warm and casual, like writing to someone you already know',
    investor: 'tailored for an investor — confident, focused on opportunity and traction, concise',
    donor: 'tailored for a donor — grateful, mission-driven, and relationship-focused',
  };
  const toneDesc = toneMap[tone] || (tone && tone !== 'other' ? tone : 'professional and polished');

  try {
    // Run email generation and date extraction in parallel
    const [emailMsg, dateMsg] = await Promise.all([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Write a follow-up email draft.

Contact info:
- Name: ${d.name || 'Unknown'}
- Title: ${d.title || ''}
- Company: ${d.company || ''}

My conversation notes:
${notes}

Instructions:
- Tone: ${toneDesc}
- Address them by first name (${firstName})
- Reference the conversation naturally
- Write EXACTLY ${paraCount} paragraph${paraCount > 1 ? 's' : ''} — no more, no fewer
- End with a clear next step${paraCount === 1 ? ' (work it into the single paragraph)' : ''}
- Don't use excessive pleasantries or filler
- Sign off as "Best," then leave a blank line for my name
- Output ONLY the email body, no subject line, no explanation`
        }]
      }),

      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Today is ${today}. Read the following conversation notes and determine if a specific follow-up date or timeframe is mentioned (e.g. "next Tuesday", "in two weeks", "March 15th", "end of month").

If a date or timeframe is found, return ONLY a JSON object with one key: "followUpDate" as an ISO 8601 date string (YYYY-MM-DD), calculated relative to today.
If no date or timeframe is mentioned, return: {"followUpDate": null}

Reply with raw JSON only. No markdown, no explanation.

Conversation notes:
${notes}`
        }]
      })
    ]);

    const emailText = emailMsg.content.map(b => b.text || '').join('').trim();

    let followUpDate = null;
    try {
      const dateRaw = dateMsg.content.map(b => b.text || '').join('').trim();
      const s = dateRaw.indexOf('{');
      const e = dateRaw.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(dateRaw.slice(s, e + 1));
        followUpDate = parsed.followUpDate || null;
      }
    } catch { /* date extraction failed silently — not critical */ }

    res.json({ email: emailText, followUpDate });
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Card scanner API running on port ${port}`);
});
