import { getStore } from "@netlify/blobs";
import { paywall } from "../lib/billing.mjs";
import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";

const KEY_RE = /^mbc26-[A-Za-z0-9_-]{1,120}$/;
const MAX_BYTES = 5_000_000;

export default async (req) => {
  setTrip(tripOf(req));
  if (req.method !== "GET" && req.method !== "HEAD") { const pw = await paywall(tripOf(req)); if (pw) return pw; }
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key || !KEY_RE.test(key)) return new Response("Invalid key", { status: 400 });
  const store = storeFor(req, "myrtle-championship");

  if (req.method === "GET") {
    const value = await store.get(key);
    if (value == null) return new Response("", { status: 404 });
    return new Response(value, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }

  if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });

  if (req.method === "PUT") {
    const body = await req.text();
    if (body.length > MAX_BYTES) return new Response("Too large", { status: 413 });
    await store.set(key, body);
    return new Response("ok");
  }
  if (req.method === "DELETE") {
    await store.delete(key);
    return new Response("ok");
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/state" };
