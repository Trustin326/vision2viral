import { createClient } from "@supabase/supabase-js";

const COST_BY_FEATURE = {
  hooks: 1,
  caption: 1,
  hashtags: 1,
  script: 2,
  video_ideas: 1,
  bundle: 4
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid token" });

    const user_id = userData.user.id;
    const { feature = "bundle", platform = "tiktok", input_image_path = null } = req.body || {};
    const cost = COST_BY_FEATURE[feature] ?? 0;
    if (cost <= 0) return res.status(400).json({ error: "Invalid feature" });

    // Read plan + credits
    const { data: statusObj, error: statusErr } = await supabaseAdmin.rpc("get_my_status", {});
    if (statusErr) return res.status(500).json({ error: statusErr.message });

    const credits = statusObj.credits ?? 0;
    const plan = statusObj.plan ?? "free";
    const subStatus = statusObj.status ?? "inactive";

    // Require active subscription for paid plans (starter/creator/agency); allow free with low credits if you want.
    const isPaidPlan = plan !== "free";
    if (isPaidPlan && subStatus !== "active" && subStatus !== "trialing") {
      return res.status(402).json({ error: "Subscription not active", plan, status: subStatus });
    }

    if (credits < cost) {
      return res.status(402).json({ error: "Insufficient credits", credits, cost });
    }

    // ✅ TODO: Replace this mock with real OpenAI image→content pipeline
    const output = {
      hooks: ["Stop scrolling — try this"],
      caption: "High-converting caption generated from your image.",
      hashtags: ["#viral", "#contentcreator", "#aicontent"],
      script: { hook: "Hook", scene_by_scene: ["Scene 1", "Scene 2"], voiceover: "VO", cta: "Follow" },
      video_ideas: ["Idea 1", "Idea 2"]
    };

    // Spend credits
    await supabaseAdmin.from("credit_ledger").insert({
      user_id,
      delta: -cost,
      reason: `generation_${feature}`
    });

    // Log generation
    await supabaseAdmin.from("generations").insert({
      user_id,
      feature,
      input_image_path,
      platform,
      payload: output
    });

    // Activity
    await supabaseAdmin.from("activity").insert({
      user_id,
      type: "generation",
      message: `Generated ${feature} (${platform})`,
      meta: { feature, platform, cost }
    });

    return res.status(200).json({ ok: true, plan, credits_left: credits - cost, cost, output });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
