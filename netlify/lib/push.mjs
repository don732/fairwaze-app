import webpush from "web-push";
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

import { tripStore, currentTrip } from "./trip.mjs";
export const pushStore = () => tripStore("myrtle-push");
export const subKey = (endpoint) => "sub-" + createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40);
export const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function allSubs() {
  const store = pushStore();
  const { blobs } = await store.list({ prefix: "sub-" });
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

// msgFor(sub) returns {title, body, url, tag} or null to skip that subscriber
export async function notify(msgFor) {
  const slug = currentTrip(); const fix = (m) => (m && slug !== "myrtle" && m.url && m.url.startsWith("/") && !m.url.startsWith("/t/")) ? { ...m, url: `/t/${slug}${m.url === "/" ? "/" : m.url}` } : m;
  const _msgFor = msgFor; msgFor = (s) => fix(_msgFor(s));
  if (!configured()) return { sent: 0, skipped: "not configured" };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:commissioner@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const store = pushStore();
  const subs = await allSubs();
  let sent = 0;
  await Promise.allSettled(subs.map(async (s) => {
    const msg = msgFor(s);
    if (!msg) return;
    const unread = (s.unread || 0) + (msg.test ? 0 : 1);
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ ...msg, badge: unread }), { TTL: 6 * 3600, urgency: "normal" });
      sent++;
      if (!msg.test) await store.setJSON(subKey(s.sub.endpoint), { ...s, unread });
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) await store.delete(subKey(s.sub.endpoint));
    }
  }));
  return { sent };
}
