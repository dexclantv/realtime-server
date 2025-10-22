// server/index.js
// DecipherAlgo Realtime Token Server + TikTok OAuth + Persona Merge
// - Mints ephemeral tokens for OpenAI Realtime
// - Handles TikTok OAuth (login/callback) and simple API fetches
// - Lets you merge extra persona knowledge at runtime (founder playbook, FAQs, etc.)

import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

// ---------- CORS ----------
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// ---------- ENV ----------
const {
  OPENAI_API_KEY,
  PORT = 3000,
  HOST = "0.0.0.0",

  // Persona spice (0..3)
  KIRA_SPICE = "1",

  // Optional baked-in extras via env (multiline supported on Render)
  KIRA_EXTRA = "",

  // TikTok OAuth (fill these in on Render Dashboard > Environment)
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  TIKTOK_REDIRECT_URI = "https://realtime-server-4szb.onrender.com/tiktok/callback",
  TIKTOK_SCOPES = "user.info.basic,video.list",
} = process.env;

if (!OPENAI_API_KEY) {
  console.warn("⚠️ Missing OPENAI_API_KEY");
}

// ============================================================================
//                                Persona builder
// ============================================================================

// Runtime-merge store (in-memory; good for MVP)
let runtimePersonaSections = [];

/** Build base persona with cussing “spice” dial */
function persona(spice = Number(KIRA_SPICE)) {
  const filters =
    {
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
- Help users navigate importing videos, starting scans, and reading reports.
- Explain "Deciphering" simply: transcribe → analyze → summarize.
- If a clip has music but no speech, call it out.

# Narration Mode
- On “explain_step” events, speak a short 1-liner status.

# Context
- TikTok connected if the user logs in; otherwise local imports.
- Keep explanations short during scanning; expand on request.
`;
}

/** Merge base + baked extras + runtime extras into one instructions string */
function buildInstructions() {
  const base = persona();
  const baked = KIRA_EXTRA?.trim() ? `\n\n## Extra (env)\n${KIRA_EXTRA.trim()}` : "";
  const runtime =
    runtimePersonaSections.length > 0
      ? "\n\n## Extra (runtime)\n" +
        runtimePersonaSections
          .map((s, i) => `### ${s.title || `Section ${i + 1}`}\n${s.text || ""}`)
          .join("\n\n")
      : "";
  return `${base}${baked}${runtime}`.trim();
}

// ============================================================================
//                                Health + Root
// ============================================================================
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send("DecipherAlgo Realtime server active. /health • /realtime-ephemeral • /persona • /tiktok/login");
});
app.get("/health", (_req, res) => res.json({ ok: true }));

// ============================================================================
//                                Persona API
// ============================================================================

/**
 * POST /persona/merge
 * Body: { sections: [{title?: string, text: string}, ...] }
 * Example:
 *  { "sections": [
 *      {"title":"Founder Playbook","text":"..."},
 *      {"title":"FAQs","text":"..."}
 *    ] }
 */
app.post("/persona/merge", (req, res) => {
  const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
  const sanitized = sections
    .map((s) => ({
      title: String(s.title || "").slice(0, 120),
      text: String(s.text || "").slice(0, 40000),
    }))
    .filter((s) => s.text.length > 0);

  runtimePersonaSections.push(...sanitized);
  return res.json({ ok: true, mergedCount: sanitized.length, totalSections: runtimePersonaSections.length });
});

/** POST /persona/clear */
app.post("/persona/clear", (_req, res) => {
  runtimePersonaSections = [];
  return res.json({ ok: true, totalSections: 0 });
});

/** GET /persona (for debugging) */
app.get("/persona", (_req, res) => {
  res.json({
    spice: Number(KIRA_SPICE),
    bakedEnvExtra: KIRA_EXTRA?.trim()?.length ? true : false,
    runtimeSections: runtimePersonaSections.map((s, i) => ({ idx: i, title: s.title || "" })),
    preview: buildInstructions().slice(0, 1000) + "…",
  });
});

// ============================================================================
//                      OpenAI Realtime: mint ephemeral session
// ============================================================================
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
        instructions: buildInstructions(),
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
//                                TikTok OAuth
// ============================================================================

// In-memory "session" store keyed by state (good enough for MVP/dev)
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
    // Exchange code for access token
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

    // MVP confirmation page
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

// Who am I?
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

// List my videos (posted). Liked/Saved require other scopes/products.
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

// =============================================================================

app.listen(PORT, HOST, () => {
  console.log(`🚀 Realtime token server running on http://${HOST}:${PORT}`);
  console.log(`   Health:            http://${HOST}:${PORT}/health`);
  console.log(`   Realtime token:    http://${HOST}:${PORT}/realtime-ephemeral`);
  console.log(`   Persona:           GET  ${HOST}:${PORT}/persona`);
  console.log(`                      POST ${HOST}:${PORT}/persona/merge`);
  console.log(`                      POST ${HOST}:${PORT}/persona/clear`);
  console.log(`   TikTok login:      http://${HOST}:${PORT}/tiktok/login`);
});
