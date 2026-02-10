import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.https://hkahomqynwgwdsgvqejr.supabase.co,
      process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrYWhvbXF5bndnd2RzZ3ZxZWpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDc4MDMsImV4cCI6MjA4NjMyMzgwM30.A5WookIa6Vn1b1BDvgGtDvhXBqXP-18Kcp0KY9-T9nk
    );

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid token" });

    const { data, error } = await supabase.rpc("get_my_status");
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true, user: { email: userData.user.email }, ...data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
