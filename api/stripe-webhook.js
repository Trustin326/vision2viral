// /api/stripe-webhook.js  (Vercel serverless, Node.js)
// Updates: profiles.plan, profiles.credits_remaining, subscriptions table
// Events: checkout.session.completed, invoice.payment_succeeded, customer.subscription.updated, customer.subscription.deleted

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false }, // IMPORTANT for Stripe signature verification
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function planCredits(plan) {
  const p = String(plan || "starter").toLowerCase();
  if (p === "starter") return 200;
  if (p === "creator") return 1000;
  if (p === "agency") return 999999; // "unlimited"
  return 50; // fallback
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    requireEnv("STRIPE_SECRET_KEY");
    requireEnv("STRIPE_WEBHOOK_SECRET");

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const sig = req.headers["stripe-signature"];
    const rawBody = await readRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook signature error: ${err.message}`);
    }

    // Helper: upsert subscription row
    async function upsertSubscription({ user_id, customer_id, subscription_id, plan, status, current_period_end }) {
      // Try update first
      const { data: existing } = await supabaseAdmin
        .from("subscriptions")
        .select("id")
        .eq("stripe_subscription_id", subscription_id)
        .maybeSingle();

      if (existing?.id) {
        await supabaseAdmin
          .from("subscriptions")
          .update({
            plan,
            status,
            current_period_end: current_period_end ? new Date(current_period_end * 1000).toISOString() : null,
            stripe_customer_id: customer_id || null,
          })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("subscriptions").insert({
          user_id,
          stripe_customer_id: customer_id || null,
          stripe_subscription_id: subscription_id || null,
          plan,
          status,
          current_period_end: current_period_end ? new Date(current_period_end * 1000).toISOString() : null,
        });
      }
    }

    // Helper: award affiliate commission (simple starter)
    async function awardAffiliateIfAny({ referred_user_id, amount_paid_cents }) {
      // Find referral code used by referred user
      const { data: refRow } = await supabaseAdmin
        .from("affiliate_referrals")
        .select("affiliate_code")
        .eq("referred_user", referred_user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!refRow?.affiliate_code) return;

      // Commission: 30% of first payment (starter implementation)
      const commission = Math.round((amount_paid_cents || 0) * 0.30);

      // Map code -> affiliate record
      const { data: aff } = await supabaseAdmin
        .from("affiliates")
        .select("id, earnings_cents")
        .eq("referral_code", refRow.affiliate_code)
        .maybeSingle();

      if (!aff?.id) return;

      await supabaseAdmin
        .from("affiliates")
        .update({ earnings_cents: (aff.earnings_cents || 0) + commission })
        .eq("id", aff.id);

      await supabaseAdmin.from("affiliate_payout_events").insert({
        affiliate_code: refRow.affiliate_code,
        referred_user: referred_user_id,
        amount_cents: commission,
        reason: "first_payment_commission",
      });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // You must set session.metadata.plan and session.metadata.user_id when creating checkout session
        const plan = session?.metadata?.plan || "starter";
        const user_id = session?.metadata?.user_id;

        if (!user_id) break; // can't attach without user_id

        // Set plan + credits on profile
        await supabaseAdmin
          .from("profiles")
          .update({
            plan,
            credits_remaining: planCredits(plan),
          })
          .eq("id", user_id);

        // Record subscription if present
        if (session.subscription) {
          await upsertSubscription({
            user_id,
            customer_id: session.customer,
            subscription_id: session.subscription,
            plan,
            status: "active",
            current_period_end: null,
          });
        }

        // Affiliate: award on first payment if session has amount_total
        await awardAffiliateIfAny({
          referred_user_id: user_id,
          amount_paid_cents: session.amount_total || 0,
        });

        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subscription_id = invoice.subscription;

        // Look up our subscription row
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id, plan")
          .eq("stripe_subscription_id", subscription_id)
          .maybeSingle();

        if (sub?.user_id) {
          // Refill monthly credits
          await supabaseAdmin
            .from("profiles")
            .update({ credits_remaining: planCredits(sub.plan) })
            .eq("id", sub.user_id);
        }

        break;
      }

      case "customer.subscription.updated": {
        const s = event.data.object;
        const subscription_id = s.id;
        const status = s.status;
        const current_period_end = s.current_period_end;

        const { data: row } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id, plan")
          .eq("stripe_subscription_id", subscription_id)
          .maybeSingle();

        if (row?.user_id) {
          await upsertSubscription({
            user_id: row.user_id,
            customer_id: s.customer,
            subscription_id,
            plan: row.plan,
            status,
            current_period_end,
          });
        }

        break;
      }

      case "customer.subscription.deleted": {
        const s = event.data.object;
        await supabaseAdmin
          .from("subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", s.id);

        // Optionally downgrade plan (recommended)
        const { data: row } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", s.id)
          .maybeSingle();

        if (row?.user_id) {
          await supabaseAdmin
            .from("profiles")
            .update({ plan: "free", credits_remaining: 10 })
            .eq("id", row.user_id);
        }

        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Webhook error" });
  }
}
