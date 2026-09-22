import { getStore } from "@netlify/blobs";
import { setTrip } from "../lib/trip.mjs";
import { verifySignature, saveMeta, metaFor, stripe } from "../lib/billing.mjs";

// Stripe calls this after checkout, on every renewal, and when a subscription is cancelled.
const reg = () => getStore({ name: "fairwaze-trips", consistency: "strong" });
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

export default async (req) => {
  setTrip("myrtle");
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) return new Response("Bad signature", { status: 400 });
  let ev; try { ev = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  const o = (ev.data && ev.data.object) || {};
  const bySub = async (sub) => { if (!sub) return null; const x = await reg().get("sub-" + sub, { type: "json" }); return x && x.slug; };
  const subSlug = (s) => (s && s.metadata && s.metadata.slug) || null;

  const subState = (x) => (x.status === "canceled" ? "canceled" : (x.cancel_at_period_end || x.cancel_at) && ["trialing", "active", "past_due"].includes(x.status) ? "canceling" : x.status);
  const periodEnd = (x) => x.cancel_at || x.current_period_end || (x.items && x.items.data && x.items.data[0] && x.items.data[0].current_period_end) || null;

  if (ev.type === "checkout.session.completed") {
    const slug = o.client_reference_id || (o.metadata && o.metadata.slug);
    const meta = slug && (await metaFor(slug));
    if (meta) {
      const patch = { customer: o.customer || null, subscription: o.subscription || null, trialUsed: true, cardAt: new Date().toISOString() };
      if (!meta.trialUsed) { patch.subStatus = "trialing"; patch.trialEnds = new Date(Date.now() + 7 * 864e5).toISOString(); }
      else patch.subStatus = "active";
      if (o.subscription) await reg().setJSON("sub-" + o.subscription, { slug });
      await saveMeta(slug, patch);
    }
  } else if (ev.type === "customer.subscription.created" || ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
    const slug = (await bySub(o.id)) || subSlug(o);
    if (slug && (await metaFor(slug))) {
      if (o.id) await reg().setJSON("sub-" + o.id, { slug });
      const patch = { subStatus: ev.type === "customer.subscription.deleted" ? "canceled" : subState(o), subscription: o.id };
      if (o.trial_end) patch.trialEnds = iso(o.trial_end);
      const end = periodEnd(o); if (end) patch.paidThrough = iso(end);
      await saveMeta(slug, patch);
    }
  } else if (ev.type === "invoice.paid") {
    // the free week's $0 invoice doesn't count; the first real charge does
    const sub = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
    const slug = (await bySub(sub)) || subSlug(o.subscription_details) || subSlug(o.parent && o.parent.subscription_details);
    const meta = slug && (await metaFor(slug));
    if (meta && (o.amount_paid || 0) > 0) {
      const end = o.lines && o.lines.data && o.lines.data[0] && o.lines.data[0].period && o.lines.data[0].period.end;
      const patch = { paid: true, paidAt: new Date().toISOString(), amountPaid: o.amount_paid / 100, subStatus: meta.subStatus === "canceling" ? "canceling" : "active" };
      if (meta.tier === "weekend") {
        // The Weekend is one payment: stop the subscription 30 days after it's paid, no renewals
        const until = Math.floor(Date.now() / 1000) + 30 * 86400;
        try { await stripe("/subscriptions/" + sub, { cancel_at: until, proration_behavior: "none" }); } catch (_) {}
        patch.paidThrough = iso(until); patch.subStatus = "canceling";
      } else if (end) patch.paidThrough = iso(end);
      await saveMeta(slug, patch);
    }
  } else if (ev.type === "invoice.payment_failed") {
    const sub = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
    const slug = await bySub(sub);
    if (slug && (await metaFor(slug))) await saveMeta(slug, { subStatus: "past_due", lastFailure: new Date().toISOString() });
  }
  return Response.json({ received: true });
};
export const config = { path: "/api/stripe-webhook" };
