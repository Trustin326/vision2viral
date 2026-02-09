// /api/org-accept-invite.js
// Accepts pending org invites for the logged-in user's email.
// Creates org_members row + marks invite accepted.

import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function send(res, status, data) {
  res.statusCode = status;
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 200, { ok: true });
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) return send(res, 401, { error: "Missing token" });
    const token = authHeader.slice(7).trim();

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return send(res, 401, { error: "Invalid token" });

    const email = (userData.user.email || "").toLowerCase();

    const { data: invites, error: invErr } = await supabaseAdmin
      .from("org_invites")
      .select("*")
      .eq("email", email)
      .eq("status", "pending");

    if (invErr) return send(res, 500, { error: invErr.message });
    if (!invites?.length) return send(res, 200, { ok: true, accepted: 0, orgs: [] });

    let accepted = 0;
    const orgIds = [];

    for (const inv of invites) {
      // Create membership (idempotent-ish)
      await supabaseAdmin.from("org_members").upsert(
        {
          org_id: inv.org_id,
          user_id: userData.user.id,
          role: inv.role || "member",
        },
        { onConflict: "org_id,user_id" }
      );

      // Mark invite accepted
      await supabaseAdmin
        .from("org_invites")
        .update({ status: "accepted" })
        .eq("id", inv.id);

      accepted += 1;
      orgIds.push(inv.org_id);
    }

    // Return org details
    const { data: orgs } = await supabaseAdmin
      .from("orgs")
      .select("*")
      .in("id", orgIds);

    return send(res, 200, { ok: true, accepted, orgs: orgs || [] });
  } catch (e) {
    return send(res, 500, { error: e?.message || "Server error" });
  }
}
