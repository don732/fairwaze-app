import { getStore } from "@netlify/blobs";
import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";
export default async (req) => {
  setTrip(tripOf(req));
  if (req.method === "GET") {
    let lastTick = null;
    try { const hb = await storeFor(req, "myrtle-push").get("heartbeat", { type: "json" }); lastTick = hb && hb.at || null; } catch (_) {}
    const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
    return Response.json({ backend: "netlify", lastTick, pushReady }, { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let pin = "";
  try { ({ pin } = await req.json()); } catch {}
  if (!(await pinOk(req, String(pin)))) {
    await new Promise((r) => setTimeout(r, 600));
    return new Response("Wrong PIN", { status: 403 });
  }
  return Response.json({ ok: true });
};

export const config = { path: "/api/auth" };
