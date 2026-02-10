import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  try {
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    if (!userData?.user) return res.status(401).json({ error: "Invalid token" });

    const { data: customer } = await supabaseAdmin
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!customer?.stripe_customer_id) {
      return res.status(400).json({ error: "No Stripe customer found yet" });
    }

    const baseUrl =
      process.env.PUBLIC_BASE_URL || "https://trustin326.github.io/vision2viral";

    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: `${baseUrl}/web/app.html`
    });

    return res.status(200).json({ ok: true, url: portal.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
