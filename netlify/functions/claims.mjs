import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";
import { ID, DEV, hash, getClaim, allClaims, putClaim, dropClaim } from "../lib/claims.mjs";

export default async (req) => {
  setTrip(tripOf(req));
  const device = req.headers.get("x-device") || "";
  if (req.method === "GET") {
    const rows = await allClaims();
    return Response.json(rows.map((c) => ({ player: c.player, at: c.at, hasPin: !!c.pinHash, mine: !!device && c.device === hash(device) })), { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let b; try { b = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const player = String(b.player || "");
  if (!ID.test(player)) return new Response("Bad player", { status: 400 });
  if (!DEV.test(device)) return new Response("Bad device", { status: 400 });
  const pin = typeof b.pin === "string" ? b.pin.trim() : "";
  const commish = await pinOk(req, req.headers.get("x-commish-pin"));
  const cur = await getClaim(player);

  if (b.action === "claim") {
    if (!cur) { await putClaim({ player, device: hash(device), at: new Date().toISOString() }); return Response.json({ ok: true, claimed: true }); }
    if (cur.device === hash(device)) return Response.json({ ok: true, claimed: true });
    if (commish) { await putClaim({ ...cur, device: hash(device), at: new Date().toISOString() }); return Response.json({ ok: true, claimed: true, moved: true }); }
    if (cur.pinHash && pin && cur.pinHash === hash(pin)) { await putClaim({ ...cur, device: hash(device), at: new Date().toISOString() }); return Response.json({ ok: true, claimed: true, moved: true }); }
    return new Response(cur.pinHash ? "Wrong PIN" : "Claimed on another phone — ask the commissioner", { status: 403 });
  }
  if (b.action === "setpin") {
    if (!cur || cur.device !== hash(device)) return new Response("Not your name on this phone", { status: 403 });
    if (!/^\d{4,8}$/.test(pin)) return new Response("PIN must be 4 to 8 digits", { status: 400 });
    await putClaim({ ...cur, pinHash: hash(pin) });
    return Response.json({ ok: true });
  }
  if (b.action === "release") {
    if (!commish && !(cur && cur.device === hash(device))) return new Response("Commissioner PIN required", { status: 403 });
    await dropClaim(player);
    return Response.json({ ok: true });
  }
  return new Response("Bad action", { status: 400 });
};

export const config = { path: "/api/claims" };
