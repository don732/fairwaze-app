import { getStore } from "@netlify/blobs";
import { paywall } from "../lib/billing.mjs";
import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";
import { guard } from "../lib/claims.mjs";

const KINDS = new Set(["beer", "sotd"]);
const TRIP_START = "2026-10-22"; // first tee, America/New_York
const ADV_DAYS = 24;
const etToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const doorDate = (n) => { const d = new Date(TRIP_START + "T12:00:00-04:00"); d.setUTCDate(d.getUTCDate() - (ADV_DAYS + 1 - n)); return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); };
const ID = /^[a-z][a-z0-9]{0,15}$/;

export default async (req) => {
  setTrip(tripOf(req));
  if (req.method !== "GET" && req.method !== "HEAD") { const pw = await paywall(tripOf(req)); if (pw) return pw; }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (!KINDS.has(kind)) return new Response("Bad kind", { status: 400 });
  const store = storeFor(req, "myrtle-log-" + kind);

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const rows = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
    return Response.json(rows, { headers: { "cache-control": "no-store" } });
  }
  if (req.method === "POST") {
    let e; try { e = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (!ID.test(e.by || "")) return new Response("Bad player", { status: 400 });
    { const bad = await guard(req, e.by); if (bad) return bad; }
    if (kind === "sotd") {
      const round = Number(e.round);
      if (!(Number.isInteger(round) && round >= 1 && round <= 5)) return new Response("Bad round", { status: 400 });
      if (!ID.test(e.pick || "") || e.pick === e.by) return new Response("Bad pick", { status: 400 });
      const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
      const row = { id, at: new Date().toISOString(), by: e.by, round, pick: e.pick };
      await store.setJSON(id, row);
      return Response.json(row);
    }
    const round = String(e.round);
    if (!["1", "2", "3", "4", "5"].includes(round)) return new Response("Bad round", { status: 400 });
    const delta = Number(e.delta) < 0 ? -1 : 1;
    const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
    const row = { id, at: new Date().toISOString(), by: e.by, round, delta, who: ID.test(e.who || "") ? e.who : null };
    await store.setJSON(id, row);
    return Response.json(row);
  }
  if (req.method === "DELETE") {
    if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });
    const id = url.searchParams.get("id") || "";
    if (!/^[0-9a-z-]{6,40}$/i.test(id)) return new Response("Bad id", { status: 400 });
    await store.delete(id);
    return new Response("ok");
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/log" };
