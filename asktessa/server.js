// ═══════════════════════════════════════════
// AskTessa — Stage 2: Tessa AI Brain
// ═══════════════════════════════════════════

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Connect to Gemini (Tessa's brain)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

console.log('[AskTessa] Tessa AI brain connected via Gemini');

// ═══════════════════════════════════════════
// TESSA'S BRAIN — understands customer messages
// ═══════════════════════════════════════════

async function tessaUnderstand(customerMessage) {
  const prompt = `
You are Tessa — a smart AI assistant for AskTessa, a business directory in Bulawayo, Zimbabwe.
A customer sent this WhatsApp message: "${customerMessage}"

Read the message and extract these details. Return ONLY valid JSON — no extra text:
{
  "request_type": "business" or "talent",
  "category": "the type of service or product they need",
  "location": "the area in Bulawayo they mentioned, or null",
  "budget": "any price or budget mentioned, or null",
  "urgency": "high if they say urgent/now/asap, otherwise normal",
  "summary": "one sentence describing what they need"
}

Rules:
- request_type = "talent" only if they want to HIRE a person
- request_type = "business" for products or services
- category should be short: Phone Repair, Catering, Hair Salon, Plumbing, etc.
- Return ONLY the JSON object. Nothing else.
`;

  try {
    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();

    // Remove markdown code blocks if Gemini adds them
    const cleaned = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    return { success: true, data: parsed };

  } catch (error) {
    console.error('[Tessa Error]', error.message);
    return {
      success: false,
      error: error.message,
      data: {
        request_type: 'business',
        category: 'General',
        location: null,
        budget: null,
        urgency: 'normal',
        summary: customerMessage
      }
    };
  }
}

// ═══════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    service: 'AskTessa',
    ai: 'Gemini 1.5 Flash',
    timestamp: new Date().toISOString()
  });
});

// Tessa understands a message
app.post('/tessa/understand', async (req, res) => {
  const { message } = req.body;

  if (!message || message.trim() === '') {
    return res.status(400).json({
      error: 'No message provided',
      hint: 'Send: { "message": "your customer message here" }'
    });
  }

  console.log('[Tessa] Processing:', message);
  const result = await tessaUnderstand(message);

  res.json({
    original_message: message,
    tessa_understood: result.data,
    ai_success: result.success,
    processed_at: new Date().toISOString()
  });
});

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('  ══════════════════════════════════════');
  console.log('  AskTessa — Tessa AI Brain is RUNNING');
  console.log('  ══════════════════════════════════════');
  console.log('  http://localhost:' + PORT + '/health');
  console.log('  http://localhost:' + PORT + '/tessa/understand');
  console.log('');
});