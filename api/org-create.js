import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const resp = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "My Agency").slice(0, 80);

    const { data: org, error } = await supabaseAdmin
      .from("orgs")
      .insert({ owner_id: userData.user.id, name })
      .select()
      .single();

    if (error) return resp(500, { error: error.message });

    await supabaseAdmin.from("org_members").insert({
      org_id: org.id,
      user_id: userData.user.id,
      role: "owner",
    });

    await supabaseAdmin.from("org_credits").insert({
      org_id: org.id,
      credits_remaining: 0,
    });

    return resp(200, { ok: true, org });
  } catch (e) {
    return resp(500, { error: e?.message || "Server error" });
  }
}
