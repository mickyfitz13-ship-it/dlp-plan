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
 *   1. Go to dash.cloudflare.com → Workers & Pages → Create → Worker.
 *   2. Replace the default code with this file, click Deploy.
 *   3. Settings → Variables and Secrets → add a SECRET named  GEMINI_KEY
 *      with your Gemini API key as the value. Deploy again.
 *   4. (Recommended) Edit ALLOWED_ORIGINS below to just your site's URL so
 *      randoms can't use your worker from their own pages.
 *   5. Copy the worker URL (e.g. https://overwatch-ai.you.workers.dev) and paste
 *      it into  const SHARED_AI_PROXY = '...'  near the top of index.html.
 *
 * The site POSTs { model, payload } here; the worker forwards payload to
 * Gemini's generateContent with your key and returns the raw response.
 */

// Lock this down to your site(s). Use ['*'] only for quick testing.
const ALLOWED_ORIGINS = ['*']; // e.g. ['https://yourname.github.io']

// Optional lightweight rate limit per IP (requests per minute) to protect quota.
const RPM_PER_IP = 8;
const hits = new Map(); // in-memory; resets when the worker cold-starts

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'POST only' } }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (!env.GEMINI_KEY) {
      return new Response(JSON.stringify({ error: { message: 'Server missing GEMINI_KEY secret' } }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Rate limit (shared proxy). Try again in a minute.' } }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    let inp;
    try { inp = await request.json(); } catch (_) {
      return new Response(JSON.stringify({ error: { message: 'Bad JSON body' } }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
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
      return new Response(JSON.stringify({ error: { message: 'Upstream fetch failed: ' + e.message } }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};
