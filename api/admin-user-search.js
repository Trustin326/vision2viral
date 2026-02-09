import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function resp(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export default async function handler(req) {
  try {
    if (req.method === "OPTIONS") return resp(200, { ok: true });
    if (req.method !== "POST") return resp(405, { error: "Method not allowed" });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) return resp(401, { error: "Missing token" });
    const token = authHeader.slice("Bearer ".length).trim();

    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return resp(401, { error: "Invalid token" });

    // Confirm caller is owner
    const { data: caller } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if ((caller?.role || "").toLowerCase() !== "owner") return resp(403, { error: "Owner only" });

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return resp(400, { error: "email required" });

    const { data: results } = await supabaseAdmin
      .from("profiles")
      .select("id,email,role,plan,credits_remaining,created_at")
      .ilike("email", `%${email}%`)
      .limit(20);

    return resp(200, { ok: true, results: results || [] });
  } catch (e) {
    return resp(500, { error: e?.message || "Server error" });
  }
}
