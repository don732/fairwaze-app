import { getStore } from "@netlify/blobs";
import { tripStore } from "./trip.mjs";

const r2 = (n) => Math.round(n * 100) / 100;
const cash = (v) => "$" + (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0);
const downs = (v) => { const n = Math.round(v * 10) / 10; return `${n.toFixed(n % 1 ? 1 : 0)} Down${Math.abs(n) === 1 ? "" : "s"}`; };

// rebuild one race from the event log and describe how the money moved
export function raceSummary(events, raceId, names = {}, inDowns = true) {
  const money = inDowns ? downs : cash;
  const create = events.find((e) => e.id === raceId && e.type === "create");
  const start = events.find((e) => e.bet === raceId && e.type === "start");
  if (!create || !start || !Array.isArray(create.horses) || !Array.isArray(start.order)) return null;
  const F = (id) => names[id] || id;

  const tickets = [];
  for (const e of events) {
    if (e.bet !== raceId || e.type !== "wager") continue;
    const i = tickets.findIndex((t) => t.by === e.by && t.horse === Number(e.horse));
    const stake = Number(e.stake);
    if (stake <= 0) { if (i >= 0) tickets.splice(i, 1); }
    else if (i >= 0) tickets[i].stake = stake;
    else tickets.push({ by: e.by, horse: Number(e.horse), stake });
  }
  if (!tickets.length) return null;

  const win = start.order[0];
  const h = create.horses[win];
  const winners = tickets.filter((t) => t.horse === win);
  const losers = tickets.filter((t) => t.horse !== win);
  const head = `${h.name} (${h.odds}-1) wins it.`;
  if (!winners.length) return `${head} Nobody had him, so nothing changes hands.`;
  if (!losers.length) return `${head} Everybody was on him. Push.`;

  const tw = winners.reduce((s, t) => s + t.stake * h.odds, 0);
  const net = {};
  losers.forEach((l) => winners.forEach((w) => {
    if (l.by === w.by) return;
    const amt = r2(l.stake * (w.stake * h.odds) / tw);
    net[w.by] = r2((net[w.by] || 0) + amt);
    net[l.by] = r2((net[l.by] || 0) - amt);
  }));
  const up = Object.entries(net).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const down = Object.entries(net).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const parts = [...up.map(([id, v]) => `${F(id)} +${money(v)}`), ...down.map(([id, v]) => `${F(id)} −${money(-v)}`)];
  if (!parts.length) return `${head} Every ticket belonged to the same guy, so nothing changes hands.`;
  return `${head} ${parts.join(" · ")}`;
}

export async function postToFeed(text, name = "🏇 Fairwaze Downs") {
  const store = tripStore("myrtle-feed");
  const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
  const post = { id, at: new Date().toISOString(), author: null, name, text: String(text).slice(0, 280), hasPhoto: false };
  await store.setJSON("post-" + id, post);
  return post;
}
