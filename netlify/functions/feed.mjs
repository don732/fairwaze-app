import { getStore } from "@netlify/blobs";
import { paywall } from "../lib/billing.mjs";
import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";
import { notify, escRe } from "../lib/push.mjs";
import { guard } from "../lib/claims.mjs";

const MAX_TEXT = 280;
const MAX_PHOTO = 1_500_000;
const LIMIT = 200;
const EMOJI = new Set(["😂","👍","🍺","💰","🔥","💀","🐐","🤡","🗑️","⛳"]);

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000B-\u001F]/g, "").trim().slice(0, n);

export default async (req, context) => {
  setTrip(tripOf(req));
  if (req.method !== "GET" && req.method !== "HEAD") { const pw = await paywall(tripOf(req)); if (pw) return pw; }
  const url = new URL(req.url);
  const store = storeFor(req, "myrtle-feed");

  if (req.method === "GET") {
    const photo = url.searchParams.get("photo");
    if (photo) {
      if (!/^[0-9a-z-]{6,40}$/i.test(photo)) return new Response("Bad id", { status: 400 });
      const v = await store.get("photo-" + photo);
      return v == null ? new Response("", { status: 404 }) : new Response(v, { headers: { "content-type": "text/plain", "cache-control": "public, max-age=86400" } });
    }
    const { blobs } = await store.list({ prefix: "post-" });
    const keys = blobs.map((b) => b.key).sort().slice(-LIMIT);
    const posts = (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
    const { blobs: rb } = await store.list({ prefix: "react-" });
    const reactions = (await Promise.all(rb.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
    return Response.json({ posts, reactions }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST" && url.searchParams.get("react")) {
    let e;
    try { e = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (!EMOJI.has(e.emoji)) return new Response("Bad emoji", { status: 400 });
    if (!/^[0-9a-z-]{6,40}$/i.test(e.post || "")) return new Response("Bad post", { status: 400 });
    if (!/^([a-z][a-z0-9]{0,15}|guest-[a-z0-9]{6,12})$/.test(e.by || "")) return new Response("Bad reactor", { status: 400 });
    if (/^[a-z][a-z0-9]{0,15}$/.test(e.by)) { const bad = await guard(req, e.by); if (bad) return bad; }
    const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
    const ev = { id, at: new Date().toISOString(), post: e.post, emoji: e.emoji, by: e.by, on: e.on !== false };
    await store.setJSON("react-" + id, ev);
    if (ev.on) {
      const post = await store.get("post-" + e.post, { type: "json" });
      if (post && post.author && post.author !== e.by) {
        const who = clean(e.byName || "Someone", 30);
        const job = notify((s) => (s.who === post.author && s.pref !== "off" ? { title: `${who} reacted ${e.emoji}`, body: post.text ? `to “${post.text.slice(0, 90)}”` : "to your photo", url: "/?go=feed", tag: "react-" + e.post } : null));
        if (context && context.waitUntil) context.waitUntil(job); else await job;
      }
    }
    return Response.json(ev);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    const text = clean(body.text, MAX_TEXT);
    const photo = typeof body.photo === "string" ? body.photo : null;
    if (photo && (!photo.startsWith("data:image/jpeg;base64,") || photo.length > MAX_PHOTO)) return new Response("Photo too large", { status: 413 });
    if (!text && !photo) return new Response("Empty post", { status: 400 });
    const author = /^[a-z][a-z0-9]{0,15}$/.test(body.author || "") ? body.author : null;
    if (author) { const bad = await guard(req, author); if (bad) return bad; }
    const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
    const post = { id, at: new Date().toISOString(), author, name: author ? null : clean(body.name || "Guest", 30), text, hasPhoto: !!photo };
    if (photo) await store.set("photo-" + id, photo);
    await store.setJSON("post-" + id, post);
    const who = author ? clean(body.authorName || "Someone", 30) : post.name;
    const job = notify((s) => {
      if (s.pref === "off" || (author && s.who === author)) return null;
      const mentioned = s.name && text && new RegExp(`(^|[^a-z])@?${escRe(s.name)}([^a-z]|$)`, "i").test(text);
      if (s.pref === "mine" && !mentioned) return null;
      return { title: mentioned ? `${who} mentioned you` : `${who} posted`, body: text ? text.slice(0, 140) : "📷 New photo", url: "/?go=feed", tag: "post-" + id };
    });
    if (context && context.waitUntil) context.waitUntil(job); else await job;
    return Response.json(post);
  }

  if (req.method === "DELETE") {
    if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });
    const id = url.searchParams.get("id") || "";
    if (!/^[0-9a-z-]{6,40}$/i.test(id)) return new Response("Bad id", { status: 400 });
    await store.delete("post-" + id);
    await store.delete("photo-" + id);
    return new Response("ok");
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/feed" };
