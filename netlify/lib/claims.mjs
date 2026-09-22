import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

export const ID = /^[a-z][a-z0-9]{0,15}$/;
export const DEV = /^[A-Za-z0-9-]{6,60}$/;
import { tripStore } from "./trip.mjs";
const store = () => tripStore("myrtle-claims");
const key = (player) => "claim-" + player;
export const hash = (s) => createHash("sha256").update("mbc:" + String(s)).digest("hex").slice(0, 40);

export async function getClaim(player) {
  if (!ID.test(player || "")) return null;
  return await store().get(key(player), { type: "json" });
}
export async function allClaims() {
  const s = store();
  const { blobs } = await s.list({ prefix: "claim-" });
  return (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
}
export async function putClaim(row) { await store().setJSON(key(row.player), row); }
export async function dropClaim(player) { await store().delete(key(player)); }

// true when this device may act as this player
export async function mayAct(player, device) {
  const c = await getClaim(player);
  if (!c) return true;                     // nobody claimed it yet
  return !!device && c.device === hash(device);
}
export async function guard(req, player) {
  if (!player || !ID.test(player)) return null;
  const device = req.headers.get("x-device") || "";
  if (await mayAct(player, device)) return null;
  return new Response("That name is claimed on another phone", { status: 403 });
}
