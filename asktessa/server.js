// ═══════════════════════════════════════════
// AskTessa — Stage 3: Tessa AI + Database
// ═══════════════════════════════════════════

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient }       = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});
// Connect to Gemini (Tessa's brain)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Connect to Supabase (the database)
const supabaseUrl = process.env.SUPABASE_URL
  ? process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '')
  : undefined;

const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_KEY
);

console.log('[AskTessa] Gemini AI connected');
console.log('[AskTessa] Supabase database connected');

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
    const result  = await model.generateContent(prompt);
    const rawText = result.response.text().trim();
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
// DATABASE — find matching businesses
// ═══════════════════════════════════════════

async function findBusinesses(intent) {
  // Search by category
  let query = supabase
    .from('businesses')
    .select('*')
    .eq('is_active', true)
    .ilike('category', '%' + (intent.category || '') + '%')
    .order('tier', { ascending: false })
    .limit(3);

  // Also filter by location if Tessa detected one
  if (intent.location) {
    query = supabase
      .from('businesses')
      .select('*')
      .eq('is_active', true)
      .ilike('category', '%' + (intent.category || '') + '%')
      .ilike('location', '%' + intent.location + '%')
      .order('tier', { ascending: false })
      .limit(3);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[Database Error]', error);
    return [];
  }

  // If location search returns nothing, retry without location filter
  if ((!data || data.length === 0) && intent.location) {
    const { data: fallback } = await supabase
      .from('businesses')
      .select('*')
      .eq('is_active', true)
      .ilike('category', '%' + (intent.category || '') + '%')
      .order('tier', { ascending: false })
      .limit(3);
    return fallback || [];
  }

  return data || [];
}

// ═══════════════════════════════════════════
// BUILD TESSA'S REPLY
// ═══════════════════════════════════════════

function buildReply(businesses, intent) {
  if (businesses.length === 0) {
    return `Hi! I'm Tessa from AskTessa 👋\n\nI searched our directory but couldn't find a match for *${intent.category || 'what you need'}* right now.\n\nWe add new businesses every day — check back soon!\n\n_Powered by AskTessa — Bulawayo's smart business directory_`;
  }

  let reply = `Hi! I'm *Tessa* from AskTessa 👋\n\nI found *${businesses.length} business${businesses.length > 1 ? 'es' : ''}* matching your request:\n\n`;

  businesses.forEach((b, i) => {
    reply += `*${i + 1}. ${b.name}*\n`;
    reply += `📍 ${b.location}\n`;
    if (b.description) reply += `📋 ${b.description}\n`;
    if (b.price_range)  reply += `💰 ${b.price_range}\n`;
    const pays = [];
    if (b.accepts_ecocash) pays.push('EcoCash');
    if (b.accepts_cash)    pays.push('Cash');
    if (pays.length > 0)   reply += `💳 Accepts: ${pays.join(' & ')}\n`;
    reply += `📞 ${b.whatsapp || b.phone}\n\n`;
  });

  reply += `_Tap a number to connect directly on WhatsApp_ 👌`;
  return reply;
}

// ═══════════════════════════════════════════
// LOG LEAD TO DATABASE
// ═══════════════════════════════════════════

async function logLead(customerMessage, intent, matches, customerPhone) {
  await supabase.from('leads').insert({
    customer_message:   customerMessage,
    category_detected:  intent.category,
    location_detected:  intent.location,
    budget_detected:    intent.budget,
    urgency:            intent.urgency,
    request_type:       intent.request_type,
    businesses_matched: matches.map(b => b.id),
    customer_whatsapp:  customerPhone || 'test',
    status:             'new'
  });
}

// ═══════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:    'running',
    service:   'AskTessa',
    ai:        'Gemini 1.5 Flash',
    database:  'Supabase connected',
    timestamp: new Date().toISOString()
  });
});

// Full Tessa flow — understand + search + reply
app.post('/tessa/ask', async (req, res) => {
  const { message, phone } = req.body;

  if (!message || message.trim() === '') {
    return res.status(400).json({ error: 'No message provided' });
  }

  console.log('[Tessa] Message:', message);

  // Step 1: Understand the message
  const intent = await tessaUnderstand(message);
  console.log('[Tessa] Understood:', intent.data);

  // Step 2: Search the database
  const matches = await findBusinesses(intent.data);
  console.log('[Tessa] Matches found:', matches.length);

  // Step 3: Build the reply
  const reply = buildReply(matches, intent.data);

  // Step 4: Log the lead
  await logLead(message, intent.data, matches, phone);

  res.json({
    message,
    intent:   intent.data,
    matches:  matches.length,
    reply,
    businesses: matches
  });
});

// Business registration
app.post('/api/register', async (req, res) => {
  const {
    name, owner_name, phone, whatsapp,
    category, location, description,
    price_range, accepts_ecocash, accepts_cash
  } = req.body;

  if (!name || !phone || !category || !location) {
    return res.status(400).json({ error: 'Name, phone, category and location are required.' });
  }

  const { data, error } = await supabase
    .from('businesses')
    .insert({
      name, owner_name, phone,
      whatsapp: whatsapp || phone,
      category, location, description,
      price_range, accepts_ecocash, accepts_cash
    })
    .select()
    .single();

  if (error) {
    console.error('[Register Error]', error);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }

  console.log('[Registered]', name, '|', category, '|', location);
  res.json({ success: true, message: 'Business registered!', id: data.id });
});

// Admin: view all businesses
app.get('/api/businesses', async (req, res) => {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ businesses: data || [], count: data?.length || 0 });
});

// Admin: view all leads
app.get('/api/leads', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ leads: data || [], count: data?.length || 0 });
});

// ═══════════════════════════════════════════
// ROOT PAGE
// ═══════════════════════════════════════════

app.get('/', (req, res) => {
  res.redirect('/health');
});

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

// For local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ══════════════════════════════════════════');
    console.log('  AskTessa — AI + Database RUNNING');
    console.log('  ══════════════════════════════════════════');
    console.log('  Health:     http://localhost:' + PORT + '/health');
    console.log('  Tessa ask:  http://localhost:' + PORT + '/tessa/ask');
    console.log('  Businesses: http://localhost:' + PORT + '/api/businesses');
    console.log('  Leads:      http://localhost:' + PORT + '/api/leads');
    console.log('');
  });
}

// For Vercel — export the app
module.exports = app;
