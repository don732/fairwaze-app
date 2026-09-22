import { SLUG_RE, metaFor } from "../lib/trip.mjs";
// A manifest per trip so Add to Home Screen opens that trip.
export default async (req) => {
  const u = new URL(req.url);
  const slug = (u.searchParams.get("trip") || "").toLowerCase();
  let name = "The Myrtle Beach Championship 2026", short = "Myrtle", start = "/";
  if (slug && SLUG_RE.test(slug) && slug !== "myrtle") { const m = await metaFor(slug); if (m) { name = m.name || slug; short = (m.name || slug).split(" ").slice(0, 2).join(" ").slice(0, 12); start = `/t/${slug}/`; } }
  const man = { name, short_name: short, start_url: start, scope: start, display: "standalone", background_color: "#0b3d24", theme_color: "#0b3d24", icons: [{ src: "/icon-192.png?v=123", sizes: "192x192", type: "image/png", purpose: "any maskable" }, { src: "/icon-512.png?v=123", sizes: "512x512", type: "image/png", purpose: "any maskable" }] };
  return new Response(JSON.stringify(man), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
};
export const config = { path: "/manifest.json" };
