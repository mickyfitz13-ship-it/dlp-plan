/**
 * Overwatch AI — shared Gemini proxy (Cloudflare Worker)
 * =====================================================
 * Lets EVERY visitor to your site use the AI assistant WITHOUT their own key,
 * while your Gemini key stays secret on the server (never in the public page).
 *
 * WHY A PROXY (and not a key in the HTML)?
 *   A key pasted into index.html is visible to anyone who views source. Bots
 *   scrape public sites for keys within hours and will burn your quota or, if
 *   you've enabled billing, run up real charges. A proxy keeps the key server-side.
 *
 * DEPLOY (free, ~3 minutes):
 *   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker.
 *   2. Replace the default code with this file, click Deploy.
 *   3. Settings -> Variables and Secrets:
 *        - add a SECRET named  GEMINI_KEY  = your Gemini API key.
 *        - (recommended) add a VARIABLE named  ALLOWED_ORIGINS  = your site URL(s),
 *          comma-separated, e.g.  https://yourname.github.io
 *          Leave it unset to allow any origin ('*', fine for quick testing).
 *      Deploy again after adding them.
 *   4. Copy the worker URL and paste it into  const SHARED_AI_PROXY = '...'  in index.html.
 *
 * Open the worker URL in a browser — a GET returns "Overwatch AI proxy: online".
 * The site POSTs { model, payload }; the worker forwards payload to Gemini's
 * generateContent with your key and returns the raw response.
 */

const DEFAULT_ORIGINS = ['*'];      // used when ALLOWED_ORIGINS isn't set
const RPM_PER_IP = 8;               // per-IP requests/minute, to protect your quota
const MAX_BODY = 32 * 1024;         // reject request bodies larger than 32 KB
const hits = new Map();             // in-memory; resets when the worker cold-starts

function allowedOrigins(env) {
  if (env && env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_ORIGINS;
}

function corsHeaders(origin, origins) {
  const allow = origins.includes('*')
    ? '*'
    : (origins.includes(origin) ? origin : origins[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
  rec.n++;
  hits.set(ip, rec);
  return rec.n > RPM_PER_IP;
}

function jsonResponse(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const origins = allowedOrigins(env);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, origins);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') {
      return new Response('Overwatch AI proxy: online', { status: 200, headers: { ...cors, 'Content-Type': 'text/plain' } });
    }
    if (request.method !== 'POST') return jsonResponse({ error: { message: 'POST only' } }, 405, cors);
    if (!env.GEMINI_KEY) return jsonResponse({ error: { message: 'Server missing GEMINI_KEY secret' } }, 500, cors);

    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (rateLimited(ip)) {
      return jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Rate limit (shared proxy). Try again in a minute.' } }, 429, cors);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) return jsonResponse({ error: { message: 'Request body too large.' } }, 413, cors);

    let inp;
    try { inp = JSON.parse(raw); } catch (_) {
      return jsonResponse({ error: { message: 'Bad JSON body' } }, 400, cors);
    }

    // Only allow flash-family models through the shared proxy to control cost.
    const model = String(inp.model || 'gemini-flash-latest').replace(/[^a-zA-Z0-9._-]/g, '');
    const payload = inp.payload || {};

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return jsonResponse({ error: { message: 'Upstream fetch failed: ' + e.message } }, 502, cors);
    }

    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};
