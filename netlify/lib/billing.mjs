import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { metaFor, hashPin } from "./trip.mjs";

// Stripe, without the SDK: plain REST calls. Nothing here runs until STRIPE_SECRET_KEY is set.
export const TRIAL_DAYS = 7;
export const WEEKEND_DAYS = 30; // The Weekend: live 30 days from its first payment
export const configured = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_SEASON && process.env.STRIPE_PRICE_WEEKEND);
const API = () => (process.env.STRIPE_API || "https://api.stripe.com") + "/v1";
const reg = () => getStore({ name: "fairwaze-trips", consistency: "strong" });

export async function stripe(path, params) {
  const body = new URLSearchParams();
  const add = (k, v) => { if (v !== undefined && v !== null && v !== "") body.append(k, String(v)); };
  for (const [k, v] of Object.entries(params || {})) add(k, v);
  const r = await fetch(API() + path, { method: "POST", headers: { authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || "Stripe error " + r.status);
  return j;
}

export async function saveMeta(slug, patch) {
  const m = (await metaFor(slug)) || { slug };
  const next = { ...m, ...patch };
  await reg().setJSON("trip-" + slug, next);
  return next;
}

// Is the trip allowed to take new scores, bets and posts right now?
// Card up front: a trip starts its 7 free days only once a card is on file (Stripe trial). Stripe charges on day 8.
const ALIVE = ["trialing", "active", "canceling", "past_due"];
export function statusOf(meta, now = Date.now()) {
  if (!meta) return { exists: false };
  const tier = meta.tier === "weekend" ? "weekend" : "season";
  const sub = meta.subStatus || "";
  const trialEnds = meta.trialEnds ? Date.parse(meta.trialEnds) : 0;
  const endsAt = meta.paidThrough ? Date.parse(meta.paidThrough) : 0;
  const alive = ALIVE.includes(sub) && !(sub === "canceling" && endsAt && now > endsAt + 864e5);
  // trips made before payments were switched on stay free and open; they never get put on hold
  const legacyFree = !!meta.grandfathered && !meta.customer;
  const trialing = alive && !meta.paid && trialEnds > now;
  return {
    exists: true, configured: configured(), tier,
    needsCard: configured() && !meta.customer && !legacyFree,   // built, but never finished checkout
    trialing, paid: !!meta.paid && alive,
    active: !configured() || alive || legacyFree,
    trialDaysLeft: trialing ? Math.max(0, Math.ceil((trialEnds - now) / 864e5)) : 0,
    trialEnds: trialEnds ? new Date(trialEnds).toISOString() : null,
    endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    canceling: sub === "canceling", canceled: sub === "canceled", pastDue: sub === "past_due",
    trialUsed: !!meta.trialUsed,
    price: tier === "weekend" ? 99 : 149,
    manage: !!meta.customer, grandfathered: legacyFree,
  };
}

// Writes are refused once the free week is over and nobody has paid. Reads always work.
export async function paywall(slug) {
  if (!slug || slug === "myrtle" || process.env.DEMO_MODE === "1" || !configured()) return null;
  const st = statusOf(await metaFor(slug));
  if (!st.exists || st.active) return null;
  return new Response("This trip’s free week is over. The commissioner can reactivate it from the site.", { status: 402 });
}

export function verifySignature(raw, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i).trim(), kv.slice(i + 1)]; }).filter(([k]) => k));
  const sigs = header.split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
export { hashPin, metaFor };
