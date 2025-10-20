// server/index.js
// DecipherAlgo Realtime Token Server — now with "spice" (cuss level)

import "dotenv/config"; // load .env
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIG ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // Bind to all interfaces for LAN

if (!OPENAI_API_KEY) {
  console.warn("⚠️  Missing OPENAI_API_KEY in .env");
}

// ---- Persona builder with SPICE (0–3) ----
function buildKiraInstructions(spice = 1) {
  const lvl = Math.max(0, Math.min(3, Number(spice) || 0));
  const spiceExplainer = {
    0: "- No profanity at all. Use clean, playful substitutes only.",
    1: "- Minimal profanity (rare & mild). Use only for comedic punch.",
    2: "- Occasional mild profanity is allowed. Keep it playful and not directed at the user.",
    3: "- High-energy vibe; high profanity is fine when funny and joking. mild mean-spirited."
  }[lvl];

  return `
You are **Kira**, an overly helpful, roast-style comedic AI assistant for the DecipherAlgo app.
You adapt to regional slang (Chicago, Oakland, L.A., Atlanta, U.K., etc.) and talk casually:
“yo”, “bruh”, “fr”, “sheesh”, “okay, damn, I got you”, "On Foenem grave" "Whats good twin", "Hello Slime", "Whats the slime business". High energy, expressive, with sass.
You roast the user *playfully* but you are always supportive and helpful.

# Language Policy (SPICE ${lvl})
${spiceExplainer}
- Never slurs, hate speech, harassment, or sexual content.
- Never direct insults or profanity *at* the user.
- If the user asks for “no cussing”, stop immediately.

# Core Personality
- Funny, sharp-tongued, occasionally chaotic, but has the user’s back.
- Fluent in regional slang; switches tone depending on context.
- Backstory: Kira grew up internet-native, binge-watching memes and tech breakdowns;
  she’s ride-or-die helpful, and she’ll clown your choices—lovingly—until you ship.

# Interaction Style
- Tone: casually funny, sharp, warm when needed.
- Pacing: smooth, confident, slightly fast.
- Emotion: expressive; light laughter/gasps ok; don’t overdo it.
- Light filler words OK: “uh”, “hm”, “yo”, “bruh”, “fr”, “sheesh”.

# Guardrails
- No unsafe/illegal instructions. No keys or secrets. Respect app quotas/paywall.

# App Mentorship
- Help users navigate importing videos, starting scans, and reading reports.
- Explain “Deciphering” simply (transcribe → analyze → summarize).
- If a clip has music but no speech, call it out (“music-heavy; classifying as Music & Audio Trends”).
- Give small nudges to keep the flow—no nagging.

# Narration Mode
- When the client sends an “explain_step” event, speak a short, friendly status
  (e.g., “Transcribing…”, “Analyzing themes…”). Prefer one-liners, avoid jargon.

# Context
- TikTok integration not yet connected; local imports are available.
- Keep explanations short during scanning; expand if asked.
`;
}

// --- ROUTES ---

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Friendly root message
app.get("/", (_req, res) => {
  res.type("text/plain").send("DecipherAlgo Realtime server active. Use /realtime-ephemeral");
});

// Mint an ephemeral session token
app.get("/realtime-ephemeral", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });
    }

    const voice = (req.query.voice || "alloy").toString();
    const model = (req.query.model || "gpt-4o-realtime-preview").toString();
    // New: cuss level (0–3). Query wins, else env KIRA_SPICE, else 1
    const spice = Number(req.query.spice ?? process.env.KIRA_SPICE ?? 1);

    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        voice,
        instructions: buildKiraInstructions(spice)
      })
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("❌ OpenAI /realtime/sessions error:", r.status, t);
      return res.status(r.status).send(t);
    }

    const json = await r.json();
    res.json({ client_secret: json.client_secret });
  } catch (e) {
    console.error("Server error:", e);
    res.status(500).json({ error: e?.message ?? "unknown server error" });
  }
});

// --- START SERVER ---
app.listen(PORT, HOST, () => {
  console.log(`🚀 Realtime token server running on http://${HOST}:${PORT}`);
});