/**
 * Simple Web Tools - Express Server
 * --------------------------------------------------------------------------
 * Responsibilities:
 *   1. Serve the static frontend (public/) with caching + compression.
 *   2. Apply security headers (Helmet) with a CSP that allows our CDN libs.
 *   3. Expose a small JSON API:
 *        - GET  /api/health        -> uptime/health check
 *        - POST /api/food-chat     -> rule-based food recommendations
 *                                     (LLM-ready: see foodChatReply()).
 *   4. Serve SEO files (robots.txt, sitemap.xml, manifest) correctly.
 *   5. Graceful 404 + centralized error handling.
 *
 * Run:  npm start   (or)  npm run dev
 * --------------------------------------------------------------------------
 */

import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Path helpers (ES modules have no __dirname by default)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PAGES_DIR = path.join(__dirname, 'pages');

// ---------------------------------------------------------------------------
// App + config
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust the first proxy (needed for correct protocol/IP behind hosting proxies)
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security headers (Helmet)
// CSP is configured to allow the free CDN libraries used on the frontend:
//   - Chart.js          (jsdelivr)
//   - pdf-lib           (unpkg / jsdelivr)
//   - @imgly/background-removal (unpkg / jsdelivr, uses WASM + workers)
// 'wasm-unsafe-eval' is required for the in-browser background-removal model.
// blob: is required for generated downloads + web workers.
// ---------------------------------------------------------------------------
const CDN = ['https://cdn.jsdelivr.net', 'https://unpkg.com'];

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", ...CDN],
        // 'unsafe-inline' for styles keeps small inline style hooks simple;
        // all real styling lives in style.css.
        styleSrc: ["'self'", "'unsafe-inline'", ...CDN, 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', ...CDN],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...CDN],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null,
      },
    },
    // Allow loading cross-origin resources (CDN scripts/wasm) from the page.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.use(compression()); // gzip responses -> faster loading
app.use(express.json({ limit: '1mb' })); // parse JSON bodies for the API
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev')); // request logs

// ---------------------------------------------------------------------------
// Static assets
// HTML is served fresh (no-cache) so updates show immediately.
// Other assets (css/js/img) get long-lived caching for performance.
// ---------------------------------------------------------------------------
function setStaticCacheHeaders(res, filePath) {
  if (filePath.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache');
  } else if (/\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders: setStaticCacheHeaders,
  })
);

app.use(
  '/pages',
  express.static(PAGES_DIR, {
    extensions: ['html'],
    setHeaders: setStaticCacheHeaders,
  })
);

// ---------------------------------------------------------------------------
// SEO files with explicit content types
// (express.static already serves them, but we set correct MIME types here
//  and keep robots/sitemap easily overridable/dynamic in future.)
// ---------------------------------------------------------------------------
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').sendFile(path.join(PUBLIC_DIR, 'robots.txt'));
});

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').sendFile(path.join(PUBLIC_DIR, 'sitemap.xml'));
});

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').sendFile(
    path.join(PUBLIC_DIR, 'manifest.webmanifest'),
    (err) => {
      if (!err) return;

      res.status(200).json({
        name: 'Simple Web Tools',
        short_name: 'Simple Tools',
        description:
          'Free student, finance, food, image and PDF tools in one simple web app.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7fb',
        theme_color: '#6d28d9',
        icons: [],
      });
    }
  );
});

// ---------------------------------------------------------------------------
// API: health check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: NODE_ENV,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API: Food recommendation chat (rule-based, LLM-ready)
//
// The frontend chat UI (built in the Food phase) POSTs:
//   { "message": "high protein veg meals" }
// and renders the returned { reply }.
//
// To upgrade to a real LLM later, replace the body of foodChatReply() with a
// call to your provider (OpenAI, Gemini, Ollama, etc.). The request/response
// shape stays identical, so no frontend changes are needed.
// ---------------------------------------------------------------------------

/** Knowledge base used by the rule-based recommender. */
const FOOD_DB = {
  proteinRich: [
    'Eggs', 'Greek yogurt', 'Paneer', 'Tofu', 'Lentils (dal)', 'Chickpeas',
    'Rajma (kidney beans)', 'Soya chunks', 'Chicken breast', 'Fish', 'Whey protein',
  ],
  healthyIndian: [
    'Dal + brown rice', 'Vegetable khichdi', 'Roti + sabzi + curd',
    'Idli + sambar', 'Grilled tandoori chicken + salad', 'Palak paneer + roti',
  ],
  budget: [
    'Boiled eggs', 'Peanuts', 'Banana', 'Dal + rice', 'Soya chunks curry',
    'Sattu drink', 'Seasonal vegetables', 'Oats',
  ],
  vegetarian: [
    'Paneer bhurji', 'Chana masala', 'Tofu stir-fry', 'Mixed dal',
    'Sprout salad', 'Curd + fruits', 'Vegetable upma',
  ],
  nonVegetarian: [
    'Grilled chicken', 'Fish curry', 'Egg curry', 'Chicken salad',
    'Boiled eggs', 'Prawn stir-fry',
  ],
  weightGain: [
    'Banana + peanut butter', 'Full-fat milk', 'Dry fruits & nuts',
    'Paneer paratha', 'Rice + dal + ghee', 'Mass-gainer smoothie (oats + milk + banana)',
  ],
  weightLoss: [
    'Vegetable soup', 'Salad with sprouts', 'Grilled chicken/fish',
    'Oats', 'Greek yogurt', 'Green vegetables', 'Buttermilk',
  ],
};

/** Intent rules: each maps trigger keywords to a knowledge-base category. */
const FOOD_INTENTS = [
  { key: 'weightLoss', label: 'weight loss foods', words: ['weight loss', 'lose weight', 'fat loss', 'cutting', 'slim'] },
  { key: 'weightGain', label: 'weight gain foods', words: ['weight gain', 'gain weight', 'bulk', 'mass', 'muscle gain'] },
  { key: 'budget', label: 'budget-friendly foods', words: ['budget', 'cheap', 'low cost', 'affordable', 'student'] },
  { key: 'nonVegetarian', label: 'non-vegetarian options', words: ['non veg', 'non-veg', 'nonveg', 'chicken', 'fish', 'egg', 'meat'] },
  { key: 'vegetarian', label: 'vegetarian options', words: ['veg', 'vegetarian', 'plant'] },
  { key: 'healthyIndian', label: 'healthy Indian meals', words: ['indian', 'meal', 'lunch', 'dinner', 'thali'] },
  { key: 'proteinRich', label: 'protein-rich foods', words: ['protein', 'high protein', 'protein rich'] },
];

/** Format a list of foods into a friendly bulleted reply. */
function formatList(title, items) {
  const bullets = items.map((i) => `• ${i}`).join('\n');
  return `Here are some ${title}:\n${bullets}`;
}

/**
 * Core recommendation logic.
 * @param {string} message - the user's chat message.
 * @returns {string} reply text.
 *
 * LLM UPGRADE POINT: replace the logic below with an async provider call.
 */
function foodChatReply(message) {
  const text = String(message || '').toLowerCase().trim();

  if (!text) {
    return "Tell me what you're looking for, e.g. \"high protein veg meals\", \"budget foods\", or \"weight loss diet\".";
  }

  // Greetings / help
  if (/\b(hi|hello|hey|help)\b/.test(text)) {
    return [
      'Hi! I can recommend foods for your goals. Try asking about:',
      '• Protein-rich foods',
      '• Healthy Indian meals',
      '• Budget meals',
      '• Vegetarian / Non-vegetarian options',
      '• Weight gain or weight loss foods',
    ].join('\n');
  }

  // Match all intents present in the message (so "high protein veg" returns both).
  const matched = FOOD_INTENTS.filter((intent) =>
    intent.words.some((w) => text.includes(w))
  );

  if (matched.length === 0) {
    return [
      "I didn't quite catch that. I can suggest:",
      '• Protein-rich foods',
      '• Healthy Indian meals',
      '• Budget meals',
      '• Vegetarian / Non-vegetarian options',
      '• Weight gain / weight loss foods',
      '',
      'Try: "high protein vegetarian budget meals".',
    ].join('\n');
  }

  // De-duplicate by category key while preserving priority order.
  const seen = new Set();
  const sections = [];
  for (const intent of matched) {
    if (seen.has(intent.key)) continue;
    seen.add(intent.key);
    sections.push(formatList(intent.label, FOOD_DB[intent.key]));
  }

  return sections.join('\n\n');
}

app.post('/api/food-chat', (req, res) => {
  try {
    const { message } = req.body || {};

    if (typeof message !== 'string' || message.length > 1000) {
      return res.status(400).json({
        error: 'Invalid input. "message" must be a string up to 1000 characters.',
      });
    }

    const reply = foodChatReply(message);
    return res.json({ reply, source: 'rule-based' });
  } catch (err) {
    console.error('food-chat error:', err);
    return res.status(500).json({ error: 'Something went wrong generating a reply.' });
  }
});

// ---------------------------------------------------------------------------
// SPA-friendly fallback for clean URLs:
// If a GET request accepts HTML and didn't match a static file or API route,
// try to serve the matching page; otherwise fall through to 404.
// ---------------------------------------------------------------------------
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (!req.accepts('html')) return next();

  // Serve the landing/login page for the root.
  if (req.path === '/' || req.path === '') {
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  }
  return next();
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  res
    .status(404)
    .type('html')
    .send(
      '<!doctype html><meta charset="utf-8"><title>404 - Not Found</title>' +
        '<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}a{color:#60a5fa}</style>' +
        '<div style="text-align:center"><h1>404</h1><p>Page not found.</p><a href="/">Go home</a></div>'
    );
});

// ---------------------------------------------------------------------------
// Centralized error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  const isJson = _req?.path?.startsWith('/api/');
  if (isJson) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
  res.status(500).type('text/plain').send('Internal Server Error');
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  Simple Web Tools running:`);
  console.log(`  > Local:       http://localhost:${PORT}`);
  console.log(`  > Environment: ${NODE_ENV}\n`);
});

export default app;
