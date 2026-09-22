import { getStore } from "@netlify/blobs";
import { setTrip, listTrips, tripStore } from "../lib/trip.mjs";
import { webcrypto as crypto } from "node:crypto";
import { notify } from "../lib/push.mjs";
import { raceSummary, postToFeed } from "../lib/racefeed.mjs";
import { replayDuel } from "../lib/duelfeed.mjs";

// Runs on a schedule: starts any race whose post time has passed, even if every phone is asleep.
const NAMES = { joe: "Joe", matt: "Matt", ian: "Ian", don: "Don", bill: "Bill", brett: "Brett", jake: "Jake", jared: "Jared" };

async function runTrip() {
  // heartbeat so the app can show whether the scheduler is actually running
  try { await tripStore("myrtle-push").setJSON("heartbeat", { at: new Date().toISOString() }); } catch (_) {}
  const store = tripStore("myrtle-bets");
  const { blobs } = await store.list({ prefix: "ev-" });
  const keys = blobs.map((b) => b.key).sort();
  const events = (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);

  const races = new Map();
  for (const e of events) {
    if (e.type === "create" && e.kind === "race") races.set(e.id, { ...e, started: false, voided: false, bets: 0 });
    else if (races.has(e.bet)) {
      const r = races.get(e.bet);
      if (e.type === "start") r.started = true;
      if (e.type === "void") r.voided = true;
      if (e.type === "wager" && Number(e.stake) > 0) r.bets++;
    }
  }

  const now = Date.now();
  const due = [...races.values()].filter((r) => !r.started && !r.voided && r.bets > 0 && r.postAt && Date.parse(r.postAt) <= now);
  const ran = [];

  // countdown calls: one hour out and ten minutes out, each sent once
  const calls = [];
  for (const r of races.values()) {
    if (r.started || r.voided || !r.postAt) continue;
    const mins = (Date.parse(r.postAt) - now) / 60000;
    const when = new Date(r.postAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    for (const [mark, lo, hi, body] of [[60, 59, 60.5, `Post time is ${when} ET — one hour to get your bets in.`], [10, 9, 10.5, `Ten minutes to post. Last call at Fairwaze Downs.`]]) {
      if (!(mins > lo && mins <= hi)) continue;
      const key = "call-" + r.id + "-" + mark;
      if (await store.get(key, { type: "json" })) continue;
      await store.setJSON(key, { at: new Date().toISOString() });
      await notify((s) => (s.pref !== "off" ? { title: mark === 60 ? "🏇 One hour to post" : "🏇 Ten minutes to post", body, url: "/?go=race", tag: key } : null));
      calls.push(key);
    }
  }

  for (const r of due) {
    const odds = (r.horses || []).map((h) => Number(h.odds));
    if (odds.length < 2) continue;
    const w = odds.map((o) => 1 / (o + 1));
    const idx = odds.map((_, i) => i);
    const order = [];
    while (idx.length) {
      const total = w.reduce((s, v) => s + v, 0);
      const buf = new Uint32Array(1); crypto.getRandomValues(buf);
      let x = (buf[0] / 4294967296) * total, k = 0;
      while (k < w.length - 1 && x > w[k]) { x -= w[k]; k++; }
      order.push(idx[k]); idx.splice(k, 1); w.splice(k, 1);
    }
    // someone may have tapped They're off in the same minute — never start twice
    if (await store.get("started-" + r.id, { type: "json" })) continue;
    { const { blobs: prior } = await store.list({ prefix: "ev-" }); let dup = false;
      for (const b2 of prior) { const x = await store.get(b2.key, { type: "json" }); if (x && x.type === "start" && x.bet === r.id) { dup = true; break; } }
      if (dup) continue; }
    await store.setJSON("started-" + r.id, { at: new Date().toISOString() });
    const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
    await store.setJSON("ev-" + id, { id, at: new Date().toISOString(), type: "start", by: r.by || null, bet: r.id, order });
    ran.push(r.id);
    try {
      const fresh = [...events, { id, at: new Date().toISOString(), type: "start", by: r.by || null, bet: r.id, order }];
      const line = raceSummary(fresh, r.id, NAMES, await tripDowns());
      if (line && !(await store.get("posted-" + r.id, { type: "json" }))) { await store.setJSON("posted-" + r.id, { at: new Date().toISOString() }); await postToFeed(line); }
    } catch (_) {}
    const won = (r.horses[order[0]] || {}).name || "The winner";
    await notify((s) => (s.pref !== "off" ? { title: "🏇 And they're off", body: `${won} took it at Fairwaze Downs — see who cashed.`, url: "/?go=games", tag: "raceoff-" + r.id } : null));
  }

  // Imaginary Open: nudge whoever's on the tee once he's sat on it for a day
  const nudged = [];
  const lastAt = {};
  for (const e of events) if (e.bet) lastAt[e.bet] = Math.max(lastAt[e.bet] || 0, Date.parse(e.at) || 0);
  for (const e of events) {
    if (e.type !== "create" || e.kind !== "duel" || e.game !== "skins") continue;
    const b = replayDuel(events, e.id);
    if (!b || !b.accepted || b.voided || b.conceded || b.scrap.length >= 2 || b.holes >= 9) continue;
    const idle = now - (lastAt[e.id] || Date.parse(e.at));
    if (idle < 24 * 3600e3) continue;
    const days = Math.floor(idle / (24 * 3600e3));
    const key = `nudge-${e.id}-${b.holes}-${days}`;
    if (await store.get(key, { type: "json" })) continue;
    await store.setJSON(key, { at: new Date().toISOString() });
    const turn = b.holes % 2 === 0 ? b.opp : b.by;
    const other = turn === b.by ? b.opp : b.by;
    const lines = [
      `You've been standing on the tee for ${days} day${days > 1 ? "s" : ""}. ${NAMES[other] || other} is waiting. Play hole ${b.holes + 1}.`,
      `Hole ${b.holes + 1} isn't going to play itself. ${NAMES[other] || other} has been in the cart for ${days} day${days > 1 ? "s" : ""}.`,
      `The marshal is asking about pace of play. ${NAMES[other] || other} is waiting on you.`,
    ];
    await notify((s) => (s.who === turn && s.pref !== "off" ? { title: days >= 2 ? "⛳ Seriously. Your turn." : "⛳ Your turn in the Imaginary Open", body: lines[(days + b.holes) % lines.length], url: "/?go=open", tag: key } : null));
    nudged.push(key);
  }

  // scheduled broadcasts (the Sunday-morning wrap-up), sent once when their time comes
  const sent = [];
  try {
    const pushStore = tripStore("myrtle-push");
    const { blobs: sb } = await pushStore.list({ prefix: "sched-" });
    for (const s of sb) {
      const m = await pushStore.get(s.key, { type: "json" });
      if (!m || Date.parse(m.at) > now) continue;
      await pushStore.delete(s.key);
      await notify((sub) => (sub.pref !== "off" ? { title: m.title, body: m.body, url: m.url || "/?go=home", tag: s.key } : null));
      sent.push(s.key);
    }
  } catch (_) {}

  // bystander tax: at 8 p.m. Eastern, nudge anyone with no action today (once per day)
  const taxed = [];
  try {
    const et = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const hh = et.find((p) => p.type === "hour").value;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (hh === "20") {
      const stateRaw = await tripStore("myrtle-championship").get("mbc26-state");
      const S = stateRaw ? JSON.parse(stateRaw) : null;
      const T = S && S.tournament;
      if (S && T && T.taxOn !== false && Date.now() < Date.parse(T.start || 0)) {
        const key = "taxnudge-" + today;
        if (!(await store.get(key, { type: "json" }))) {
          await store.setJSON(key, { at: new Date().toISOString() });
          const active = new Set();
          for (const e of events) if (e.by && new Date(e.at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === today) active.add(e.by);
          try { const fs = tripStore("myrtle-feed"); const { blobs: pb } = await fs.list({ prefix: "post-" }); for (const b2 of pb) { const p = await fs.get(b2.key, { type: "json" }); if (p && p.author && new Date(p.at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === today) active.add(p.author); } } catch (_) {}
          const rate = Number(T.taxRate) || 2.5;
          for (const p of S.players || []) {
            if (active.has(p.id)) continue;
            await notify((s) => (s.who === p.id && s.pref !== "off" ? { title: "💸 Bystander Tax", body: `Nothing from you today. $${rate.toFixed(2)} at midnight unless you bet, post, or open a duel.`, url: "/?go=games", tag: key + "-" + p.id } : null));
            taxed.push(p.id);
          }
        }
      }
    }
  } catch (_) {}
  return Response.json({ checked: races.size, ran, calls, nudged, sent, taxed });
};

export default async () => {
  const out = {};
  const slugs = ["myrtle"];
  try { for (const m of await listTrips()) if (m.slug && !slugs.includes(m.slug)) slugs.push(m.slug); } catch (_) {}
  for (const slug of slugs) {
    setTrip(slug);
    try { out[slug] = await (await runTrip()).json(); } catch (e) { out[slug] = { error: String(e && e.message || e) }; }
  }
  setTrip("myrtle");
  return Response.json(out);
};
export const config = { schedule: "* * * * *" };
