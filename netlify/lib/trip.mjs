import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// One site, many trips. The original trip keeps its store names; every other trip gets its own prefix.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;
export function tripOf(req) {
  const h = (req.headers.get("x-trip") || "").toLowerCase();
  if (h && SLUG_RE.test(h)) return h;
  try { const q = (new URL(req.url).searchParams.get("trip") || "").toLowerCase(); if (q && SLUG_RE.test(q)) return q; } catch (_) {}
  return "myrtle";
}
let CUR = "myrtle";
export const setTrip = (slug) => { CUR = SLUG_RE.test(slug || "") ? slug : "myrtle"; return CUR; };
export const currentTrip = () => CUR;
export const tripStore = (base) => getStore({ name: CUR === "myrtle" ? base : `${CUR}--${base}`, consistency: "strong" });
export function storeFor(req, base) { setTrip(tripOf(req)); return tripStore(base); }
export const hashPin = (pin) => createHash("sha256").update("fairwaze|" + String(pin)).digest("hex");
export async function metaFor(slug) {
  return (await getStore({ name: "fairwaze-trips", consistency: "strong" }).get("trip-" + slug, { type: "json" })) || null;
}
export async function pinOk(req, pin) {
  if (process.env.DEMO_MODE === "1") return true;   // the demo is wide open
  const slug = tripOf(req);
  if (slug === "myrtle") return process.env.PLATFORM === "1" ? false : pin === (process.env.COMMISSIONER_PIN || "1022");
  const meta = await metaFor(slug);
  return !!(meta && pin && meta.pinHash === hashPin(pin));
}
export async function listTrips() {
  const reg = getStore({ name: "fairwaze-trips", consistency: "strong" });
  const { blobs } = await reg.list({ prefix: "trip-" });
  const out = [];
  for (const b of blobs) { const m = await reg.get(b.key, { type: "json" }); if (m && m.slug) out.push(m); }
  return out;
}
