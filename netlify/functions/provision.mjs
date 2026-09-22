import { getStore } from "@netlify/blobs";
import { SLUG_RE, hashPin, metaFor, setTrip, tripStore } from "../lib/trip.mjs";
import { configured as billingOn } from "../lib/billing.mjs";

// Creates a trip: registers the slug, stores the commissioner PIN (hashed), seeds the state.
// The intake page builds the state with the same engine the app uses, so day one looks exactly like the real thing.
export default async (req) => {
  if (req.method === "GET") {
    const slug = (new URL(req.url).searchParams.get("slug") || "").toLowerCase();
    if (!SLUG_RE.test(slug)) return Response.json({ ok: false, reason: "bad" });
    if (slug === "myrtle" || slug === "new" || slug === "demo") return Response.json({ ok: false, reason: "taken" });
    return Response.json({ ok: !(await metaFor(slug)), reason: (await metaFor(slug)) ? "taken" : "free" });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let b = {};
  try { b = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (b.action === "photos") {
    // big fields send their photos a batch at a time, after the trip exists; the commissioner PIN proves it's theirs
    const slug2 = String(b.slug || "").toLowerCase(); const meta2 = await metaFor(slug2);
    if (!meta2 || meta2.pinHash !== hashPin(String(b.pin || ""))) return new Response("Not your trip", { status: 403 });
    const ph = b.photos && typeof b.photos === "object" ? b.photos : {};
    const keys = Object.keys(ph).filter((k) => /^m[a-z0-9]{4,20}$/.test(k) && typeof ph[k] === "string" && ph[k].startsWith("data:image/jpeg;base64,") && ph[k].length < 900_000).slice(0, 12);
    setTrip(slug2); const st2 = tripStore("myrtle-championship");
    for (const k of keys) await st2.set("mbc26-photo-" + k, ph[k]);
    setTrip("myrtle");
    return Response.json({ ok: true, saved: keys.length });
  }
  const slug = String(b.slug || "").toLowerCase();
  if (!SLUG_RE.test(slug) || ["myrtle", "new", "demo", "api", "t"].includes(slug)) return new Response("Bad slug", { status: 400 });
  const pin = String(b.pin || "");
  if (!/^\d{4,8}$/.test(pin)) return new Response("PIN must be 4–8 digits", { status: 400 });
  const existing = await metaFor(slug);
  if (existing) {
    // the same commissioner retrying (double tap, dropped connection): hand back the trip he already made
    if (existing.pinHash === hashPin(pin) && existing.email && existing.email === String(b.email || "").slice(0, 120)) return Response.json({ ok: true, slug, url: `/t/${slug}/`, again: true });
    return new Response("That link is taken", { status: 409 });
  }
  const state = b.state;
  if (!state || !Array.isArray(state.players) || state.players.length < 2 || state.players.length > 144 || !Array.isArray(state.rounds) || !state.rounds.length || state.rounds.length > 12) return new Response("Bad state", { status: 400 });
  const raw = JSON.stringify(state);
  if (raw.length > 4_000_000) return new Response("State too large", { status: 413 });
  const photos = b.photos && typeof b.photos === "object" ? b.photos : {};
  const photoKeys = Object.keys(photos).filter((k) => /^m[a-z0-9]{4,20}$/.test(k) && typeof photos[k] === "string" && photos[k].startsWith("data:image/jpeg;base64,") && photos[k].length < 900_000).slice(0, 20);
  const email = String(b.email || "").slice(0, 120);
  const agree = b.agree && typeof b.agree === "object" ? { at: String(b.agree.at || "").slice(0, 40), by: String(b.agree.by || "").slice(0, 80), email: String(b.agree.email || "").slice(0, 120) } : null;
  const meta = { slug, agree, pinHash: hashPin(pin), name: String(state.tournament && state.tournament.name || slug).slice(0, 80), email, tier: b.tier === "weekend" ? "weekend" : "season", createdAt: new Date().toISOString(), paid: false, trialUsed: false, grandfathered: !billingOn(), players: state.players.length, rounds: state.rounds.length };
  await getStore({ name: "fairwaze-trips", consistency: "strong" }).setJSON("trip-" + slug, meta);
  setTrip(slug);
  const st = tripStore("myrtle-championship");
  await st.set("mbc26-state", raw);
  for (const k of photoKeys) await st.set("mbc26-photo-" + k, photos[k]);
  setTrip("myrtle");
  // tell the owner
  try {
    const hook = process.env.ORDER_WEBHOOK; // optional: a Zapier/Make/email webhook
    if (hook) await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...meta, url: `${new URL(req.url).origin}/t/${slug}/` }) });
  } catch (_) {}
  return Response.json({ ok: true, slug, url: `/t/${slug}/` });
};
export const config = { path: "/api/provision" };
