// card-scanner-api v1.7.0
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

Required JSON keys: name, title, company, email, phones, website

Rules:
- "name" must ONLY be an individual human's personal name (e.g. "Gary Sturn" or "Gary M. Sturn MD") — NEVER a business, practice, or organization name
- Look for a personal name near a job title like "MD", "PhD", "CEO", "Director", etc. — that person's name goes in "name"
- "company" is for the business/organization name (e.g. "Altamonte Medical Associates P.A.")
- If the card has both a personal name AND a company name, both fields must be populated
- "phones" must be an array of objects with "type" and "number" keys
- Phone types: "office", "cell", "fax", "toll-free", "home", "other" — infer from labels or context
- If a number has no label, default type to "office"
- Example: [{"type":"office","number":"(407) 339-5600"},{"type":"fax","number":"(407) 339-5602"}]
- Use empty string "" for name/title/company/email/website if not found
- Use empty array [] for phones if none found
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

Required JSON keys: name, title, company, email, phones, website, qrData

Rules:
- "qrData" should contain the raw decoded QR code string (URL, vCard text, etc.)
- Populate the other fields if the QR data contains contact info (e.g. a vCard or hCard URL)
- "phones" must be an array of objects: [{"type":"office","number":"..."}]
- Phone types: "office", "cell", "fax", "toll-free", "home", "other"
- Use empty array [] for phones if none found
- Use empty string "" for other fields not found
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
  const { contact, notes, paragraphs, tone, followUpDate, followUpTime } = req.body;

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

  // Format date/time for inclusion in the prompt
  let dateTimeHint = '';
  if (followUpDate) {
    const dateObj = new Date(followUpDate + 'T12:00:00');
    const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (followUpTime) {
      const [h24, m] = followUpTime.split(':').map(Number);
      const ap = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 || 12;
      const timeStr = `${h12}:${String(m).padStart(2,'0')} ${ap}`;
      dateTimeHint = `\n- Propose the follow-up meeting for ${dateStr} at ${timeStr} — work this into the email naturally`;
    } else {
      dateTimeHint = `\n- Propose the follow-up meeting for ${dateStr} — work this into the email naturally`;
    }
  }

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
- End with a clear next step${paraCount === 1 ? ' (work it into the single paragraph)' : ''}${dateTimeHint}
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
          content: `Today is ${today}. Read the following conversation notes and extract two things:

1. Follow-up DATE: If a specific date or timeframe is mentioned (e.g. "next Tuesday", "in two weeks", "March 15th"), resolve it to a YYYY-MM-DD date relative to today. Otherwise null.

2. Follow-up TIME: Infer a sensible time based on context clues:
   - "coffee" or "breakfast" → "10:00"
   - "lunch" → "12:00"
   - "afternoon" → "14:00"
   - "drinks", "happy hour" → "18:00"
   - "dinner" → "19:00"
   - "morning meeting" or "call" → "09:00"
   - A specific time is mentioned (e.g. "3pm") → use that time in 24h format
   - No context clue → null (do not guess)

Reply ONLY with raw JSON: {"followUpDate": "YYYY-MM-DD" or null, "followUpTime": "HH:MM" or null}
No markdown, no explanation.

Conversation notes:
${notes}`
        }]
      })
    ]);

    const emailText = emailMsg.content.map(b => b.text || '').join('').trim();

    let followUpDate = null;
    let followUpTime = null;
    try {
      const dateRaw = dateMsg.content.map(b => b.text || '').join('').trim();
      const s = dateRaw.indexOf('{');
      const e = dateRaw.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(dateRaw.slice(s, e + 1));
        followUpDate = parsed.followUpDate || null;
        followUpTime = parsed.followUpTime || null;
      }
    } catch { /* date extraction failed silently — not critical */ }

    res.json({ email: emailText, followUpDate, followUpTime });
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

// Generate one-line follow-up text message suggestion
app.post('/generate-text', async (req, res) => {
  const { contact, notes } = req.body;
  if (!notes) return res.status(400).json({ error: 'Missing notes' });

  const d = contact || {};
  const firstName = (d.name || '').split(' ')[0] || 'there';

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Write a short follow-up text message (SMS) based on these conversation notes.

Contact first name: ${firstName}
Notes: ${notes}

Rules:
- 1 sentence if possible, 2 sentences maximum
- Casual, warm, natural — like a real text message
- Reference the conversation briefly
- If a specific follow-up date, time, or meeting is mentioned in the notes, include it naturally in the message
- No sign-off or name needed
- NO emojis — none at all
- No exclamation marks unless absolutely natural
- Output ONLY the message text, nothing else`
      }]
    });
    const text = msg.content.map(b => b.text || '').join('').trim();
    res.json({ message: text });
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Card scanner API running on port ${port}`);
});
