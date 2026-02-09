// /api/create-checkout-session.js
// Creates Stripe Checkout Session with metadata: { plan, user_id }

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return json(res, 200, { ok: true });
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) return json(res, 401, { error: "Missing token" });
    const token = authHeader.slice("Bearer ".length).trim();

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return json(res, 401, { error: "Invalid token" });

    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
    });

    const plan = String(body.plan || "starter").toLowerCase();

    // Put your Stripe PRICE IDs here (from Stripe product pricing)
    const PRICE_IDS = {
      starter: process.env.STRIPE_PRICE_STARTER,
      creator: process.env.STRIPE_PRICE_CREATOR,
      agency: process.env.STRIPE_PRICE_AGENCY,
    };

    const price = PRICE_IDS[plan];
    if (!price) return json(res, 400, { error: "Missing price id for plan" });

    const origin = req.headers.origin || "https://YOURDOMAIN.vercel.app";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: `${origin}/web/app.html?paid=1`,
      cancel_url: `${origin}/web/index.html?canceled=1`,
      customer_email: userData.user.email,
      metadata: {
        plan,
        user_id: userData.user.id,
      },
    });

    return json(res, 200, { url: session.url });
  } catch (err) {
    return json(res, 500, { error: err.message || "Server error" });
  }
}
