// server/index.js
// DecipherAlgo Realtime Token Server + TikTok OAuth
// - Mints ephemeral tokens for OpenAI Realtime
// - Handles TikTok OAuth (login/callback) and simple API fetches
// - Bakes in Kira's persona + Founder Playbook so she "knows the app vision"

import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ----- ENV -----
const {
  OPENAI_API_KEY,
  PORT = 3000,
  HOST = "0.0.0.0",

  // Persona spice (0..3): 0=no cussing, 1=minimal (default), 2=occasional, 3=spicy
  KIRA_SPICE = "1",

  // TikTok OAuth (optional; fill these on Render > Environment)
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  TIKTOK_REDIRECT_URI = "https://realtime-server-4szb.onrender.com/tiktok/callback",
  // CSV of scopes requested in TikTok dev console
  TIKTOK_SCOPES = "user.info.basic,video.list",
} = process.env;

if (!OPENAI_API_KEY) {
  console.warn("⚠️ Missing OPENAI_API_KEY");
}

// ----- Founder Playbook (concise) -----
const FOUNDER_PLAYBOOK = `
PRODUCT: DecipherAlgo (MVP) — “decipher your algorithm”
GOAL: Help users understand the *kind* of content they consume by analyzing videos they save/like
      (start with TikTok; later Instagram/Facebook).
"DecipherAlgo is built to decode how people think — their “personal algorithms.”
By analyzing their TikTok (and later Instagram, YouTube) videos, we reveal cognitive and emotional
patterns through humor and deep insight.
This app is the introspective twin to DexTracker — where DexTracker measures creator performance,
DecipherAlgo measures the psychology behind their behavior."
"Purpose:
DecipherAlgo helps users understand their personal algorithm — the thought patterns and interests reflected in the videos and posts they engage with. It’s a light, insight-driven MVP designed to blend entertainment with self-awareness.

Core Functionality

How It Works:

Connect a TikTok account (future support for Instagram, Facebook, and YouTube).

Import and transcribe up to 10 user-selected videos (liked or saved).

Analyze speech content to identify recurring topics, tone, and cognitive themes.

Generate a fun or reflective “algorithm profile” summarizing the user’s media influence and thinking patterns.

Output Personality:
Results vary by content tone — humorous for chaotic/meme-heavy feeds, thoughtful for introspective content.

Example Analysis Categories

Levels of Thinking & Awareness

Emotional & Moral Development

Cognitive / Systems Thinking

Communication & Relationship Dynamics

Social Media Influence & Conditioning

Empathy, Self-Reflection, and Metacognition

Behavioral & Psychological Triggers

Spiritual or Existential Reflection

Feature Tiers

Free Tier:

Analyze & transcribe up to 10 videos

Basic algorithm category breakdown

Fun or humorous summary feedback

Premium Tier:

Deep cognitive and moral development insights

“Algorithm Evolution” (historical trend tracking)

Custom video reports and summaries

Compare your algorithm with friends

“Personality Overlay” (content fingerprint visualization)

Unlimited scans + exportable reports

Monetization Model

Free: up to 10 video analyses

Tier 1: 20 videos – $5.99

Tier 2: 50 videos – $25.00

Skip invalid or silent clips automatically until 10 valid are analyzed.

Future Expansions

Text & Context Analysis (“Thinking Lens” Tool):

Analyze posts, captions, or messages to detect levels of thinking.

Provide “AI Reflections” — rewrites from different perspectives.

Generate growth prompts and a development map that tracks user progress over time.

Social Fingerprinting: Compare how thinking differs by context (dating, work, social).

Strategic Goals & Team Roles

CTO: Ensure technical feasibility and optimize API usage.

CFO: Forecast costs and margins per usage tier.

CEO: Define vision, brand identity, and long-term differentiation.

Marketing: Create viral positioning through humor and self-awareness.

Research Tasks

Identify competing “algorithm analysis” or “content reflection” apps.

Evaluate their positioning and features.

Determine DecipherAlgo’s unique edge in humor, self-insight, and AI-driven feedback."

"DecipherAlgo Advantage:
• Focuses on real human cognitive levels (awareness, moral, emotional, reflective).
• Video-based analysis instead of text-only data.
• Fun + serious dual-tone analysis (entertainment meets reflection).
• Cross-context growth tracking (dating, self-awareness, relationships).
• Built with OpenAI APIs, ensuring long-term performance, not hacks." 
MVP FLOW:
1) Connect TikTok (or import locally).
2) Fetch up to 10 videos (cap free tier). Transcribe audio → analyze → summarize “your algorithm”.
3) Funny, supportive tone; call out “brain-rot” vs. thoughtful content playfully.
4) Output: brief summary + themes + “levels” (e.g., Thinking/Awareness, Moral Dev., Emotional Awareness,
   Systems Thinking, Behavior Analysis, Communication Styles, Empathy/EQ, Conformity vs Individualism, etc.).
5) Pricing (tentative): Free = 10 videos; 20 = $5.99; 50 = $25.

DESIGN PRINCIPLES:
- Fast, minimal, playful; never shaming; always helpful.
- Be transparent: “transcribe → analyze → summarize”.
- If a clip has music but no speech, note it and skip or classify.
- Suggest next step (scan, import, connect, upgrade) only when useful.

KIRA’S ROLE:
- On voice requests: short, upbeat, slightly roasty guidance.
- During scans: quick one-liners for steps; deeper summaries on demand.
- Respect quotas/paywalls and never leak secrets/keys.

FUTURE:
- More platforms, smarter selection (≥60s, speech present), better tagging, coaching-style insights.
`;

// ----- Persona builder with cussing “spice” dial -----
function persona(spice = Number(KIRA_SPICE)) {
  const filters = {
    0: "Avoid cuss words entirely.",
    1: "Minimal light swearing only (e.g., 'damn', 'hell') and only for humor.",
    2: "Occasional casual swearing; keep it playful and PG-13.",
    3: "Spicy but playful swearing allowed; never mean-spirited or explicit.",
  }[spice] ?? "Minimal light swearing only.";

  return `
You are **Kira**, an overly helpful, roast-style comedic AI assistant for the DecipherAlgo app.
You adapt to regional slang (Chicago, Oakland, L.A., Atlanta, U.K.) and talk casually.
Energy high, expressive, supportive; roast playfully, never cruel.

# Tone & Speech Filter
${filters}

# Guardrails
- No slurs, hate speech, harassment, sexual content, or unsafe advice.
- Do not reveal secrets, keys, or private data.

# App Mentorship
- Help users navigate importing videos, starting scans, reading reports.
- Explain "Deciphering" simply: transcribe → analyze → summarize.
- If a clip has music but no speech, call it out.

# Narration Mode
- On “explain_step” events, speak a short 1-liner status.

# Context (Founder Playbook)
${FOUNDER_PLAYBOOK}
`;
}

// ----- Health + Root -----
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send("DecipherAlgo Realtime server active. /health • /realtime-ephemeral • /tiktok/login");
});
app.get("/health", (_req, res) => res.json({ ok: true }));

// ----- OpenAI Realtime: mint ephemeral session -----
app.get("/realtime-ephemeral", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });
    }
    const voice = String(req.query.voice || "alloy");
    const model = String(req.query.model || "gpt-4o-realtime-preview");

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        instructions: persona(), // <-- Kira + Founder Playbook baked in
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("❌ OpenAI /realtime/sessions error:", r.status, t);
      return res.status(r.status).send(t);
    }

    const json = await r.json();
    // Shape: { client_secret: { value: "<ephemeral-token>", ... } }
    res.json({ client_secret: json.client_secret });
  } catch (e) {
    console.error("Server error:", e);
    res.status(500).json({ error: e?.message ?? "unknown server error" });
  }
});

// ============================================================================
//                                TikTok OAuth (optional)
// ============================================================================

// In-memory "session" store keyed by state (ok for MVP/dev)
const stateStore = new Map();

// Helper: build TikTok authorize URL (OAuth v2)
function tiktokAuthURL(state) {
  const params = new URLSearchParams({
    client_key: TIKTOK_CLIENT_KEY ?? "",
    response_type: "code",
    scope: TIKTOK_SCOPES,
    redirect_uri: TIKTOK_REDIRECT_URI,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

// Step 1. Redirect user to TikTok consent
app.get("/tiktok/login", (req, res) => {
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET || !TIKTOK_REDIRECT_URI) {
    return res
      .status(500)
      .send("TikTok env missing. Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI.");
  }
  const state = Math.random().toString(36).slice(2);
  stateStore.set(state, { createdAt: Date.now() });
  res.redirect(tiktokAuthURL(state));
});

// Step 2. TikTok redirects back with ?code=&state=
app.get("/tiktok/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || !stateStore.has(state)) {
    return res.status(400).send("Invalid or expired OAuth state.");
  }
  stateStore.delete(state);

  try {
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code: String(code),
        grant_type: "authorization_code",
        redirect_uri: TIKTOK_REDIRECT_URI,
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("❌ TikTok token error:", tokenJson);
      return res.status(500).json(tokenJson);
    }

    const mask = (t) => (t ? t.slice(0, 6) + "..." + t.slice(-4) : "<none>");
    res.type("html").send(`
      <html>
        <body style="font-family: -apple-system, system-ui; padding: 24px;">
          <h2>TikTok Connected ✅</h2>
          <p>Access Token: <code>${mask(tokenJson.access_token)}</code></p>
          <p>Refresh Token: <code>${mask(tokenJson.refresh_token)}</code></p>
          <p>You can close this tab and return to the app.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ error: err?.message ?? "token exchange failed" });
  }
});

// Step 3. Simple API helpers (call from your app with a bearer you store client-side)
app.get("/tiktok/me", async (req, res) => {
  const accessToken = req.query.access_token;
  if (!accessToken) return res.status(400).json({ error: "Missing access_token" });

  const r = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const j = await r.json();
  if (!r.ok) return res.status(r.status).json(j);
  res.json(j);
});

app.get("/tiktok/videos", async (req, res) => {
  const accessToken = req.query.access_token;
  const cursor = req.query.cursor ?? "0";
  if (!accessToken) return res.status(400).json({ error: "Missing access_token" });

  const url = new URL("https://open.tiktokapis.com/v2/video/list/");
  url.searchParams.set(
    "fields",
    ["video_id", "create_time", "duration", "title", "share_url", "embed_html"].join(",")
  );
  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("max_count", "20");

  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json();
  if (!r.ok) return res.status(r.status).json(j);
  res.json(j);
});

// ============================================================================

app.listen(PORT, HOST, () => {
  console.log(`🚀 Realtime token server running on http://${HOST}:${PORT}`);
  console.log(`   Health:            http://${HOST}:${PORT}/health`);
  console.log(`   Realtime token:    http://${HOST}:${PORT}/realtime-ephemeral`);
  console.log(`   TikTok login:      http://${HOST}:${PORT}/tiktok/login`);
});
