// /api/generate.js
// Production Vercel Serverless Function (Node.js)
// - Verifies Supabase JWT (Authorization: Bearer <access_token>)
// - Checks credits by plan
// - Creates a signed URL for the uploaded image (private bucket)
// - Calls OpenAI (vision + copywriting) to generate hooks/caption/tags/script/ideas
// - Saves result to Supabase `generations`
// - Decrements credits (unless agency/unlimited)

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function normalizePlan(plan) {
  const p = String(plan || "free").toLowerCase();
  if (["starter", "creator", "agency", "free"].includes(p)) return p;
  return "free";
}

function isUnlimited(plan, role) {
  const p = normalizePlan(plan);
  return p === "agency" || String(role || "").toLowerCase() === "owner";
}

function creditsCostForRequest({ hooksCount = 10, includeScript = true } = {}) {
  // Simple, predictable credit model:
  // Base 1 credit + 1 for script + 1 if hooks > 10 (rare)
  let cost = 1;
  if (includeScript) cost += 1;
  if (hooksCount > 10) cost += 1;
  return cost;
}

async function openaiGenerate({
  openaiKey,
  imageUrl,
  platform,
  niche,
  tone,
  cta,
  audience,
  hooksCount,
  hashtagCount,
  videoIdeasCount,
  lengthSeconds,
}) {
  // Uses OpenAI Responses API (recommended).
  // If your account/model differs, adjust `model`.
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"; // safe default; change if you want

  const system = `You are an elite viral social strategist and conversion copywriter.
You generate platform-native content from an IMAGE plus brief context.
Return ONLY valid JSON in the exact schema requested. No markdown. No extra keys.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      hooks: { type: "array", items: { type: "string" } },
      caption: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      video_script: {
        type: "object",
        additionalProperties: false,
        properties: {
          hook: { type: "string" },
          scene_by_scene: { type: "array", items: { type: "string" } },
          voiceover: { type: "string" },
          on_screen_text: { type: "array", items: { type: "string" } },
          cta: { type: "string" },
        },
        required: ["hook", "scene_by_scene", "voiceover", "on_screen_text", "cta"],
      },
      video_ideas: { type: "array", items: { type: "string" } },
    },
    required: ["hooks", "caption", "hashtags", "video_script", "video_ideas"],
  };

  const userPrompt = `Create content for:
Platform: ${platform}
Niche: ${niche || "general creator/business"}
Tone: ${tone || "confident"}
Audience: ${audience || "general"}
CTA: ${cta || "Follow for more / Visit link in bio"}
Requirements:
- Hooks: ${hooksCount} (short, punchy, platform-native)
- Caption: 1 (ready-to-post, include subtle CTA)
- Hashtags: ${hashtagCount} (mix: reach + niche + buyer intent; no spaces; include #)
- Video script: ${lengthSeconds}s short-form script:
  * hook (0-2s)
  * scene-by-scene steps
  * voiceover
  * on-screen text
  * CTA close
- Video ideas: ${videoIdeasCount} (each a 1-sentence concept)
Return ONLY JSON (no backticks).`;

  const body = {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userPrompt },
          { type: "input_image", image_url: imageUrl },
        ],
      },
    ],
    // Force structured JSON output
    text: {
      format: {
        type: "json_schema",
        name: "vision2viral_output",
        schema,
        strict: true,
      },
    },
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`OpenAI error (${resp.status}): ${raw.slice(0, 800)}`);
  }

  // Responses API puts structured text in output_text; we requested JSON schema, so output_text should be JSON.
  const parsed = JSON.parse(raw);
  const outputText =
    parsed?.output?.[0]?.content?.find?.((c) => c.type === "output_text")?.text ||
    parsed?.output_text;

  if (!outputText) throw new Error("OpenAI response missing output_text.");

  let jsonOut;
  try {
    jsonOut = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI output_text was not valid JSON.");
  }

  // Normalize hashtags to strings beginning with #
  jsonOut.hashtags = (jsonOut.hashtags || []).map((t) => {
    const s = String(t || "").trim();
    if (!s) return s;
    return s.startsWith("#") ? s : `#${s.replace(/^#+/, "")}`;
  });

  return jsonOut;
}

export default async function handler(req) {
  try {
    if (req.method === "OPTIONS") return json(200, { ok: true });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const SUPABASE_URL = requireEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const OPENAI_API_KEY = requireEnv("OPENAI_API_KEY");

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization Bearer token" });
    }
    const token = authHeader.slice("Bearer ".length).trim();

    // Supabase admin client (service role) for DB operations + auth verification
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Verify token / get user
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return json(401, { error: "Invalid token" });
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const {
      upload_id,
      platform = "tiktok",
      niche = "",
      tone = "confident",
      cta = "Follow for more",
      audience = "general",
      hooks_count = 10,
      hashtag_count = 18,
      video_ideas_count = 6,
      video_length_seconds = 30,
    } = body || {};

    if (!upload_id) return json(400, { error: "upload_id is required" });

    // Load profile
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id,email,role,plan,credits_remaining")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) return json(403, { error: "Profile not found" });

    const plan = normalizePlan(profile.plan);
    const role = profile.role || "user";
    const unlimited = isUnlimited(plan, role);

    // Compute cost and enforce credits
    const cost = creditsCostForRequest({
      hooksCount: Number(hooks_count) || 10,
      includeScript: true,
    });

    if (!unlimited) {
      const credits = Number(profile.credits_remaining ?? 0);
      if (credits < cost) {
        return json(402, {
          error: "Not enough credits",
          credits_remaining: credits,
          needed: cost,
          plan,
        });
      }
    }

    // Load upload row (ensure ownership)
    const { data: uploadRow, error: uploadErr } = await supabaseAdmin
      .from("uploads")
      .select("id,user_id,image_path")
      .eq("id", upload_id)
      .single();

    if (uploadErr || !uploadRow) return json(404, { error: "Upload not found" });
    if (uploadRow.user_id !== user.id && String(role).toLowerCase() !== "owner") {
      return json(403, { error: "Not allowed to use this upload" });
    }

    // Create a signed URL for the private object
    const bucket = process.env.SUPABASE_UPLOADS_BUCKET || "uploads";
    const expiresIn = 60 * 10; // 10 minutes
    const { data: signed, error: signedErr } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(uploadRow.image_path, expiresIn);

    if (signedErr || !signed?.signedUrl) {
      return json(500, { error: "Failed to sign image URL" });
    }

    // Call OpenAI
    const gen = await openaiGenerate({
      openaiKey: OPENAI_API_KEY,
      imageUrl: signed.signedUrl,
      platform,
      niche,
      tone,
      cta,
      audience,
      hooksCount: Math.max(5, Math.min(20, Number(hooks_count) || 10)),
      hashtagCount: Math.max(8, Math.min(30, Number(hashtag_count) || 18)),
      videoIdeasCount: Math.max(3, Math.min(12, Number(video_ideas_count) || 6)),
      lengthSeconds: Math.max(10, Math.min(60, Number(video_length_seconds) || 30)),
    });

    // Save generation
    const hooksText = (gen.hooks || []).join("\n");
    const hashtagsText = (gen.hashtags || []).join(" ");
    const videoIdeasText = (gen.video_ideas || []).map((x, i) => `${i + 1}. ${x}`).join("\n");
    const scriptText = JSON.stringify(gen.video_script || {}, null, 2);

    const { data: genRow, error: genErr } = await supabaseAdmin
      .from("generations")
      .insert({
        user_id: user.id,
        upload_id: uploadRow.id,
        platform,
        niche,
        tone,
        hooks: hooksText,
        caption: gen.caption || "",
        hashtags: hashtagsText,
        video_script: scriptText,
        video_ideas: videoIdeasText,
      })
      .select()
      .single();

    if (genErr || !genRow) return json(500, { error: "Failed to save generation" });

    // Decrement credits (atomic-ish)
    let credits_remaining = profile.credits_remaining ?? 0;
    if (!unlimited) {
      const newCredits = Math.max(0, Number(credits_remaining) - cost);
      credits_remaining = newCredits;

      const { error: creditErr } = await supabaseAdmin
        .from("profiles")
        .update({ credits_remaining: newCredits })
        .eq("id", user.id);

      if (creditErr) {
        // Not fatal; generation succeeded. Return warning.
        return json(200, {
          ok: true,
          generation: genRow,
          output: gen,
          credits_remaining: newCredits,
          warning: "Generation saved but credits update failed.",
        });
      }
    }

    return json(200, {
      ok: true,
      generation: genRow,
      output: gen,
      credits_cost: cost,
      credits_remaining: unlimited ? "unlimited" : credits_remaining,
      plan,
      role,
    });
  } catch (e) {
    return json(500, { error: e?.message || "Server error" });
  }
}
