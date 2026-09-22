import { SLUG_RE, setTrip } from "../lib/trip.mjs";
import { configured, stripe, statusOf, metaFor, hashPin, saveMeta, TRIAL_DAYS } from "../lib/billing.mjs";

// GET  /api/pay?slug=x            -> the trip's billing status (no secrets)
// POST /api/pay {slug,pin}        -> a Stripe Checkout link for this trip's plan
// POST /api/pay {slug,pin,action:"manage"} -> Stripe's page to update the card or cancel
export default async (req) => {
  setTrip("myrtle");
  const u = new URL(req.url);
  if (req.method === "GET") {
    const slug = (u.searchParams.get("slug") || "").toLowerCase();
    if (!SLUG_RE.test(slug) || slug === "myrtle") return Response.json({ exists: false, configured: configured() });
    return Response.json(statusOf(await metaFor(slug)), { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!configured()) return new Response("Payments aren’t switched on yet.", { status: 503 });
  let b = {}; try { b = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const slug = String(b.slug || "").toLowerCase();
  const meta = await metaFor(slug);
  if (!meta || meta.pinHash !== hashPin(String(b.pin || ""))) return new Response("Wrong PIN", { status: 403 });
  const origin = process.env.PUBLIC_ORIGIN || u.origin;
  const back = `${origin}/t/${slug}/`;
  if (b.action === "manage") {
    if (!meta.customer) return new Response("No payment on file yet.", { status: 400 });
    const p = await stripe("/billing_portal/sessions", { customer: meta.customer, return_url: back });
    return Response.json({ url: p.url });
  }
  const tier = b.tier === "weekend" || b.tier === "season" ? b.tier : (meta.tier === "weekend" ? "weekend" : "season");
  if (tier !== meta.tier) await saveMeta(slug, { tier });
  const params = {
    mode: "subscription",
    "line_items[0][price]": tier === "season" ? process.env.STRIPE_PRICE_SEASON : process.env.STRIPE_PRICE_WEEKEND,
    "line_items[0][quantity]": 1,
    payment_method_collection: "always",                 // the card is taken now, even for the free week
    success_url: back + (meta.trialUsed ? "?paid=1" : "?started=1"),
    cancel_url: back + "?pay=cancel",
    client_reference_id: slug,
    "metadata[slug]": slug,
    "subscription_data[metadata][slug]": slug,
    "subscription_data[metadata][tier]": tier,
    allow_promotion_codes: "true",
  };
  if (!meta.trialUsed) params["subscription_data[trial_period_days]"] = TRIAL_DAYS;   // one free week per trip, ever
  if (meta.customer) params.customer = meta.customer; else if (meta.email) params.customer_email = meta.email;
  const s = await stripe("/checkout/sessions", params);
  return Response.json({ url: s.url });
};
export const config = { path: "/api/pay" };
