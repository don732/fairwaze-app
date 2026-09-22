import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";
import { pushStore, subKey, configured, notify } from "../lib/push.mjs";
import { guard } from "../lib/claims.mjs";

const ID = /^[a-z][a-z0-9]{0,15}$/;
const PREFS = new Set(["all", "mine", "off"]);
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, n);

export default async (req) => {
  setTrip(tripOf(req));
  const url = new URL(req.url);
  if (req.method === "GET") {
    return Response.json({ configured: configured(), publicKey: process.env.VAPID_PUBLIC_KEY || null }, { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let b; try { b = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const store = pushStore();

  if (b.action === "subscribe") {
    const sub = b.sub;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return new Response("Bad subscription", { status: 400 });
    const row = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, who: ID.test(b.who || "") ? b.who : null, name: clean(b.name, 30) || null, pref: PREFS.has(b.pref) ? b.pref : "all", unread: 0, at: new Date().toISOString() };
    await store.setJSON(subKey(sub.endpoint), row);
    return Response.json({ ok: true });
  }
  if (b.action === "schedule") {
    if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });
    const at = Date.parse(b.at || "");
    if (!at || at < Date.now() - 60000 || at > Date.now() + 30 * 864e5) return new Response("Bad time", { status: 400 });
    const id = "sched-" + String(at).padStart(15, "0");
    await store.setJSON(id, { at: new Date(at).toISOString(), title: clean(b.title, 60), body: clean(b.body, 160), url: /^\/[\w?=\/.-]*$/.test(b.url || "") ? b.url : "/?go=home" });
    return Response.json({ ok: true, id });
  }
  if (b.action === "poke") {
    const to = String(b.to || ""), by = String(b.by || ""), ref = String(b.ref || "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
    if (!ID.test(to) || !ID.test(by) || !ref) return new Response("Bad poke", { status: 400 });
    const commish = await pinOk(req, req.headers.get("x-commish-pin"));
    if (!commish) { const bad = await guard(req, by); if (bad) return bad; }
    const store = pushStore();
    const key = "poke-" + ref + "-" + to;
    const last = await store.get(key, { type: "json" });
    if (last && Date.now() - Date.parse(last.at) < 2 * 3600e3) return new Response("Poked recently", { status: 429 });
    await store.setJSON(key, { at: new Date().toISOString(), by });
    const url = /^\/[\w?=\/.-]*$/.test(b.url || "") ? b.url : "/?go=games";
    const r = await notify((s) => (s.who === to && s.pref !== "off" ? { title: "👉 You’re holding things up", body: clean(b.body, 160) || "Somebody is waiting on you.", url, tag: key } : null));
    return Response.json({ ok: true, sent: r && r.sent ? r.sent : 0 });
  }
  if (b.action === "broadcast") {
    if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });
    const title = clean(b.title, 60) || "Myrtle Beach Championship";
    const body = clean(b.body, 160);
    const url = /^\/[\w?=\/.-]*$/.test(b.url || "") ? b.url : "/?go=home";
    const r = await notify((s) => (s.pref !== "off" ? { title, body, url, tag: "bcast-" + Date.now() } : null));
    return Response.json(r);
  }
  const key = subKey(b.endpoint || "");
  const row = await store.get(key, { type: "json" });
  if (!row) return new Response("Not subscribed", { status: 404 });

  if (b.action === "pref") {
    if (!PREFS.has(b.pref)) return new Response("Bad pref", { status: 400 });
    await store.setJSON(key, { ...row, pref: b.pref, who: ID.test(b.who || "") ? b.who : row.who, name: clean(b.name, 30) || row.name });
    return Response.json({ ok: true });
  }
  if (b.action === "seen") { await store.setJSON(key, { ...row, unread: 0 }); return Response.json({ ok: true }); }
  if (b.action === "unsubscribe") { await store.delete(key); return Response.json({ ok: true }); }
  if (b.action === "test") {
    const r = await notify((s) => (s.sub.endpoint === row.sub.endpoint ? { title: "⛳ Myrtle Beach Championship", body: "Notifications are working. The feed will find you.", url: "/?go=feed", tag: "test", test: true } : null));
    return Response.json(r);
  }
  return new Response("Bad action", { status: 400 });
};

export const config = { path: "/api/push" };
