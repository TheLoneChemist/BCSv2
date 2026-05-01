// card-scanner-api v1.29.0
//
// CHANGELOG
// v1.29.0 - Named weekdays now resolve from today (not meeting date) in all date extractors
// v1.28.0 - Email prompt forbids relative date words; infers sensible meal time hints; confirmed dates use definitive language
// v1.27.0 - Date extractors now distinguish writing date (today) vs meeting date: relative terms resolve from today, named weekdays from meeting date
// v1.26.0 - Added /fetch-vcf endpoint; fetches and parses vCard from URL embedded in QR code
// v1.25.0 - SMS prefers one sentence but allows more if needed, hard limit is 160 characters
// v1.24.0 - SMS length rule changed from "2 sentences max" to "160 characters maximum"
// v1.23.0 - Email prompt treats passed followUpDate as authoritative; model forbidden from re-deriving date from notes
// v1.22.0 - Email draft now starts with "Hello [Name]," greeting (or "Hi" for casual tone)
// v1.21.0 - SMS framing restored to question format while keeping date and meeting type exact
// v1.20.0 - /generate-text uses exact meeting type from notes; date treated as immutable; framed as confirmation not question
// v1.19.0 - Added /extract-date endpoint for live calendar updates as user types notes
// v1.18.0 - /generate-email accepts meetingDate; date extractor resolves relative dates from meeting date, not today
// v1.17.0 - Date extractor now always resolves named weekdays to next upcoming occurrence, never past
// v1.16.0 - Hallucination check returns both descriptions and phrases; both shown in modal
// v1.15.0 - Hallucination check returns exact verbatim phrases for inline highlighting
// v1.14.0 - /generate-email runs hallucination check after draft; returns flags[] of suspect claims
// v1.13.0 - /generate-email accepts optional correction field; injected into prompt for regeneration
// v1.12.0 - SMS always includes the reminder date as a concrete proposed follow-up; framed as a question
// v1.11.0 - /generate-text always produces a message even with vague notes; never asks for clarification
// v1.10.0 - Em dashes banned from all generated text (email, SMS, polish)
// v1.9.0  - /generate-text accepts fallbackDate from reminder section when notes have no date
// v1.8.0  - Added /polish-notes endpoint
// v1.7.0  - /generate-text hidden date/time row unless follow-up detected; no emojis in SMS
// v1.6.0  - Added /generate-text endpoint for SMS suggestion
// v1.5.0  - /read-card and /read-card-qr now return phones[] array instead of single phone string
// v1.4.0  - /generate-email accepts followUpDate and followUpTime; includes them in email prompt
// v1.3.0  - Date extractor also infers follow-up time from context clues (coffee, dinner, etc.)
// v1.2.0  - /generate-email now accepts tone parameter; date/time extraction runs in parallel
// v1.1.0  - Added /generate-email endpoint
//
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

// Fetch and parse a vCard from a URL embedded in a QR code
app.post('/fetch-vcf', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'text/vcard, text/x-vcard, */*' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();

    // Must look like a vCard
    if (!text.includes('BEGIN:VCARD')) {
      return res.status(422).json({ error: 'URL did not return a vCard' });
    }

    // Parse vCard fields
    const result = { name: '', title: '', company: '', email: '', phones: [], website: '' };
    const typeMap = { cell: 'cell', mobile: 'cell', fax: 'fax', home: 'home', work: 'office', voice: 'office' };

    text.split(/\r?\n/).forEach(line => {
      if (line.startsWith('FN:')) result.name = line.slice(3).trim();
      else if (line.startsWith('ORG:')) result.company = line.slice(4).split(';')[0].trim();
      else if (line.startsWith('TITLE:')) result.title = line.slice(6).trim();
      else if (line.toUpperCase().startsWith('EMAIL')) result.email = line.split(':').slice(1).join(':').trim();
      else if (line.toUpperCase().startsWith('TEL')) {
        const number = line.split(':').slice(1).join(':').trim();
        const typePart = (line.match(/TYPE=([^:;]+)/i) || [])[1] || '';
        const tl = typePart.toLowerCase();
        let type = 'office';
        for (const [k, v] of Object.entries(typeMap)) { if (tl.includes(k)) { type = v; break; } }
        if (number) result.phones.push({ type, number });
      }
      else if (line.toUpperCase().startsWith('URL')) result.website = line.split(':').slice(1).join(':').trim();
    });

    res.json(result);
  } catch (err) {
    console.error('fetch-vcf error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Lightweight date/time extraction from notes (used to update calendar as user types)
app.post('/extract-date', async (req, res) => {
  const { notes, meetingDate } = req.body;
  if (!notes) return res.status(400).json({ followUpDate: null, followUpTime: null });

  const today = new Date().toISOString().split('T')[0];
  const refDate = meetingDate || today;
  const refDateLabel = new Date(refDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Today is ${today} (${new Date(today).toLocaleDateString('en-US', {weekday:'long'})}). The meeting with this contact took place on ${refDateLabel}. The user is writing these notes today. Read the notes and extract a follow-up date and time if mentioned.

1. Follow-up DATE — use these rules:
   - Relative terms ("tomorrow", "in 2 days", "next week", "in a few days") → resolve from TODAY (${today}), because the user is writing today, not on the meeting date
   - Named weekdays ("Wednesday", "next Tuesday") → resolve to the NEXT UPCOMING occurrence AFTER today (${today}), never a past date
   - Specific dates ("March 15th", "May 7") → resolve as written
   - Return null if no date is mentioned

2. Follow-up TIME: Infer from context ("coffee"→"10:00", "lunch"→"12:00", "afternoon"→"14:00", "drinks"/"happy hour"→"18:00", "dinner"→"19:00", "morning"→"09:00", specific time→that time). Return null if unclear.

Reply ONLY with raw JSON: {"followUpDate": "YYYY-MM-DD" or null, "followUpTime": "HH:MM" or null}

Notes: ${notes}`
      }]
    });
    const raw = msg.content.map(b => b.text || '').join('').trim();
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) return res.json({ followUpDate: null, followUpTime: null });
    const parsed = JSON.parse(raw.slice(s, e + 1));
    res.json({ followUpDate: parsed.followUpDate || null, followUpTime: parsed.followUpTime || null });
  } catch (err) {
    res.json({ followUpDate: null, followUpTime: null });
  }
});

// Generate follow-up email draft from conversation notes
app.post('/generate-email', async (req, res) => {
  const { contact, notes, paragraphs, tone, followUpDate, followUpTime, correction, meetingDate } = req.body;

  if (!notes) {
    return res.status(400).json({ error: 'Missing notes' });
  }

  const d = contact || {};
  const firstName = (d.name || '').split(' ')[0] || 'there';
  const paraCount = parseInt(paragraphs) || 3;
  const today = new Date().toISOString().split('T')[0];
  const refDate = meetingDate || today; // use meeting date for relative date resolution
  const refDateLabel = new Date(refDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const metRecently = meetingDate && meetingDate !== today;
  const metLabel = metRecently
    ? `\n- They met on ${refDateLabel}, so phrases like "great meeting you" should reference that, not today`
    : '';

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
      dateTimeHint = `\n- The follow-up is confirmed for ${dateStr} at ${timeStr} — use this exact date and time\n- Never use relative words like "tomorrow", "today", "next week" — always use the specific date\n- The date is confirmed, use definitive language (not "if this works" or "let me know if this time works")`;
    } else {
      // Infer a sensible time hint from the notes context
      const notesLower = notes.toLowerCase();
      let mealHint = '';
      if (notesLower.includes('dinner')) mealHint = ' (dinner is typically in the evening, around 6-8 PM)';
      else if (notesLower.includes('lunch')) mealHint = ' (lunch is typically around noon)';
      else if (notesLower.includes('coffee') || notesLower.includes('breakfast')) mealHint = ' (morning meetings are typically 9-11 AM)';
      dateTimeHint = `\n- The follow-up is confirmed for ${dateStr}${mealHint} — use this exact date\n- Never use relative words like "tomorrow", "today", "next week" — always use the specific date\n- The date is confirmed, use definitive language (not "if this works" or "let me know if this time works")`;
    }
  }

  const correctionHint = correction
    ? `\n- Important correction from the user: "${correction}" — adjust the email to reflect this accurately`
    : '';

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
- Start with a greeting on its own line: "Hello ${firstName}," (or "Hi ${firstName}," for casual tone)
- Address them by first name (${firstName})
- Reference the conversation naturally
- Write EXACTLY ${paraCount} paragraph${paraCount > 1 ? 's' : ''} — no more, no fewer
- End with a clear next step${paraCount === 1 ? ' (work it into the single paragraph)' : ''}${dateTimeHint}${correctionHint}
- Don't use excessive pleasantries or filler
- Never use em dashes (—) — use commas, periods, or reword instead${metLabel}
- Sign off as "Best," then leave a blank line for my name
- Output ONLY the email body, no subject line, no explanation`
        }]
      }),

      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Today is ${today} (${new Date(today).toLocaleDateString('en-US', {weekday:'long'})}). The meeting with this contact took place on ${refDateLabel}. The user is writing these notes today. Extract a follow-up date and time if mentioned.

1. Follow-up DATE — use these rules:
   - Relative terms ("tomorrow", "in 2 days", "next week", "in a few days") → resolve from TODAY (${today}), because the user is writing today, not on the meeting date
   - Named weekdays ("Wednesday", "next Tuesday") → resolve to the NEXT UPCOMING occurrence AFTER today (${today}), never a past date
   - "Next [weekday]" always means the following week's occurrence from today
   - Specific dates ("March 15th", "May 7") → resolve as written
   - If no date is mentioned, return null

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
    } catch { /* date extraction failed silently */ }

    // Run hallucination check against the actual email text
    let flags = [];
    let phrases = [];
    try {
      const flagMsg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Compare this email draft against the conversation notes. Find specific claims in the email that cannot be reasonably inferred from the notes.

Conversation notes:
${notes}

Email draft:
${emailText}

Do NOT flag:
- Generic pleasantries or sign-offs
- Reasonable social inferences ("looking forward to connecting")
- The contact's name, title, or company
- The follow-up date or time
- Anything that is a natural extension of what the notes say

For each issue found, return:
- "description": a short plain-English description (under 10 words)
- "phrase": the EXACT verbatim phrase from the email (2-8 words) to highlight

Reply ONLY with raw JSON: {"issues": [{"description": "...", "phrase": "..."}]}
If nothing suspicious, return: {"issues": []}
No markdown, no explanation.`
        }]
      });
      const flagRaw = flagMsg.content.map(b => b.text || '').join('').trim();
      const fs = flagRaw.indexOf('{');
      const fe = flagRaw.lastIndexOf('}');
      if (fs !== -1 && fe !== -1) {
        const parsed = JSON.parse(flagRaw.slice(fs, fe + 1));
        const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
        flags = issues.map(i => i.description).filter(Boolean);
        phrases = issues.map(i => i.phrase).filter(Boolean);
      }
    } catch { /* hallucination check failed silently */ }

    res.json({ email: emailText, followUpDate, followUpTime, flags, phrases });
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

// Polish raw conversation notes into a concise summary
app.post('/polish-notes', async (req, res) => {
  const { notes, contact } = req.body;
  if (!notes) return res.status(400).json({ error: 'Missing notes' });

  const d = contact || {};

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Polish the following raw conversation notes into a concise, professional summary.

Contact: ${d.name || 'Unknown'}${d.company ? ` at ${d.company}` : ''}

Raw notes:
${notes}

Instructions:
- Keep all key facts, commitments, dates, and action items — do not lose any information
- Write in first person ("We discussed…", "They mentioned…", "I agreed to…")
- Fix grammar and spelling
- Remove filler words and redundancy
- Keep it concise but complete — 2 to 4 sentences is ideal
- Preserve any specific dates, names, or numbers exactly as given
- Never use em dashes (—) — use commas, periods, or reword instead
- Output ONLY the polished notes, no preamble or explanation`
      }]
    });
    const polished = msg.content.map(b => b.text || '').join('').trim();
    res.json({ polished });
  } catch (err) {
    console.error('Error:', err.status, err.message, JSON.stringify(err.error));
    res.status(500).json({ error: err.message });
  }
});

// Generate one-line follow-up text message suggestion
app.post('/generate-text', async (req, res) => {
  const { contact, notes, fallbackDate } = req.body;
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
Follow-up date: ${fallbackDate || 'soon'}

Rules:
- 160 characters maximum — stay under this limit; one sentence is preferred if it fits
- Casual, warm, natural — like a real text message
- Reference the conversation as specifically as you can
- Always produce a message no matter how little detail is in the notes — never ask for clarification or refuse
- Always include the exact follow-up date provided above (${fallbackDate || 'soon'}) — do not change or approximate it
- If the notes mention a specific type of meeting (lunch, coffee, call, dinner, etc.) use that exact type — do not substitute a different one
- Frame it as a question confirming the plan (e.g. "Still on for lunch Wednesday, May 6?" or "Are we still on for lunch on Wednesday?")
- No sign-off or name needed
- NO emojis — none at all
- No exclamation marks unless absolutely natural
- Never use em dashes (—) — use commas, periods, or reword instead
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
