import { getStore } from "@netlify/blobs";
import { storeFor, pinOk, tripOf, setTrip } from "../lib/trip.mjs";
import { webcrypto as crypto } from "node:crypto";
import { notify } from "../lib/push.mjs";
import { guard } from "../lib/claims.mjs";
import { raceSummary, postToFeed } from "../lib/racefeed.mjs";
import { duelFeedLine } from "../lib/duelfeed.mjs";

const ID = /^[a-z][a-z0-9]{0,15}$/;
const EVID = /^[0-9a-z-]{6,40}$/i;
const TYPES = new Set(["create", "accept", "decline", "join", "leave", "cancel", "void", "settle", "unsettle", "hole", "press", "concede", "scrap", "wager", "start"]);

export default async (req, context) => {
  setTrip(tripOf(req));
  const store = storeFor(req, "myrtle-bets");

  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "ev-" });
    const keys = blobs.map((b) => b.key).sort();
    const events = (await Promise.all(keys.map((k) => store.get(k, { type: "json" })))).filter(Boolean);
    return Response.json(events, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    let e;
    try { e = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
    if (!TYPES.has(e.type)) return new Response("Bad type", { status: 400 });
    if (e.type === "void") {
      if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });
    } else if (e.type === "unsettle" && e.by === "admin") {
      if (!(await pinOk(req, req.headers.get("x-commish-pin")))) return new Response("Commissioner PIN required", { status: 403 });
    } else if (!ID.test(e.by || "")) return new Response("Bad player", { status: 400 });
    if (e.by) { const bad = await guard(req, e.by); if (bad) return bad; }

    const id = String(Date.now()).padStart(15, "0") + "-" + Math.random().toString(36).slice(2, 7);
    const ev = { id, at: new Date().toISOString(), type: e.type, by: e.by || null };
    if (e.type === "create") {
      if (e.kind === "fee") {
        const stake = Number(e.stake);
        if (!(Number.isInteger(stake) && stake >= 1 && stake <= 5000)) return new Response("Bad stake", { status: 400 });
        if (!ID.test(e.payer || "") || !ID.test(e.to || "")) return new Response("Bad fee", { status: 400 });
        const { blobs: prior } = await store.list({ prefix: "ev-" });
        for (const b2 of prior) { const x = await store.get(b2.key, { type: "json" }); if (x && x.type === "create" && x.kind === "fee") { const voided = (await Promise.all(prior.map((b3) => store.get(b3.key, { type: "json" })))).some((y) => y && y.type === "void" && y.bet === x.id); if (!voided) return Response.json(x); } }
        Object.assign(ev, { kind: "fee", payer: e.payer, to: e.to, stake, how: ["spin", "wheel"].includes(e.how) ? e.how : "loser" });
        await store.setJSON("ev-" + id, ev);
        try { await notify((s) => (s.pref !== "off" ? { title: "🧾 Somebody is buying the app", body: `${nm(e.payer)} pays $${stake} for the year.`, url: "/?go=home", tag: "fee-" + id } : null)); } catch (_) {}
        return Response.json(ev);
      }
      if (!["h2h", "team", "duel", "race"].includes(e.kind)) return new Response("Bad kind", { status: 400 });
      const round = e.kind === "duel" ? "duel" : e.kind === "race" ? "race" : e.round === "champ" ? "champ" : Number(e.round);
      if (round !== "champ" && round !== "duel" && round !== "race" && !(round >= 1 && round <= 5)) return new Response("Bad round", { status: 400 });
      const stake = e.kind === "race" ? 0 : Number(e.stake);
      if (e.kind !== "race" && !(Number.isInteger(stake) && stake >= 1 && stake <= 1000)) return new Response("Bad stake", { status: 400 });
      if (!["team", "race"].includes(e.kind) && (!ID.test(e.opp || "") || e.opp === e.by)) return new Response("Bad opponent", { status: 400 });
      Object.assign(ev, { kind: e.kind, round, stake, opp: ["team", "race"].includes(e.kind) ? null : e.opp, hcp: e.kind === "h2h" ? e.hcp !== false : false, game: e.kind === "duel" ? (e.game === "skins" ? "skins" : "card") : undefined });
      if (e.kind === "race") {
        // the card is dealt here so nobody can shop for a better field
        const NAMES = ["Cart Path Only", "Breakfast Beer", "Provisional", "Mulligan Man", "Sandbagger", "Three Putt", "Lost Pro V1", "Winter Rules", "Bogey Juice", "Whiff City", "Gimme Please", "Hazard Ahead", "Fried Egg", "Snowman", "Beer Cart Bandit", "Shank Redemption"];
        const ODDS = [2, 3, 4, 6, 8, 12, 20, 30];
        const rnd = (m) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % m; };
        const pool = [...NAMES];
        const horses = ODDS.map((odds) => ({ name: pool.splice(rnd(pool.length), 1)[0], odds }));
        for (let i = horses.length - 1; i > 0; i--) { const j = rnd(i + 1); [horses[i], horses[j]] = [horses[j], horses[i]]; }
        ev.horses = horses;
        const t = Date.parse(e.postAt || "");
        if (t && t > Date.now() - 60000 && t < Date.now() + 14 * 864e5) ev.postAt = new Date(t).toISOString();
      }
    } else if (e.type === "settle") {
      const amt = Number(e.amt);
      if (!ID.test(e.from || "") || !ID.test(e.to || "") || e.from === e.to) return new Response("Bad players", { status: 400 });
      if (!(amt > 0 && amt <= 10000)) return new Response("Bad amount", { status: 400 });
      if (e.by !== e.from && e.by !== e.to) return new Response("Only the two players can settle", { status: 400 });
      Object.assign(ev, { from: e.from, to: e.to, amt: Math.round(amt * 100) / 100, method: e.method === "pay" ? "pay" : "charge" });
    } else {
      if (!EVID.test(e.bet || "")) return new Response("Bad bet", { status: 400 });
      ev.bet = e.bet;
      if (e.type === "wager") {
        const s = Number(e.stake);
        if (!(Number.isInteger(s) && s >= 0 && s <= 1000)) return new Response("Bad stake", { status: 400 }); // 0 tears up the ticket
        const h = Number(e.horse);
        if (!(Number.isInteger(h) && h >= 0 && h <= 15)) return new Response("Bad horse", { status: 400 });
        Object.assign(ev, { stake: s, horse: h });
      }
      if (e.type === "start") {
        // the gate opens once: a second start (another phone, or the scheduler) is ignored
        const { blobs: prior } = await store.list({ prefix: "ev-" });
        for (const b2 of prior) { const x = await store.get(b2.key, { type: "json" }); if (x && x.type === "start" && x.bet === e.bet) return Response.json(x); }
        const odds = Array.isArray(e.odds) ? e.odds.map(Number) : null;
        if (!odds || odds.length < 2 || odds.length > 16 || odds.some((o) => !(o >= 1 && o <= 99))) return new Response("Bad field", { status: 400 });
        // chance of winning tracks the odds: a 2-1 shot wins far more than a 30-1
        const weights = odds.map((o) => 1 / (o + 1));
        const order = [];
        const idx = odds.map((_, i) => i);
        const w = [...weights];
        while (idx.length) {
          const total = w.reduce((s2, v) => s2 + v, 0);
          const buf = new Uint32Array(1); crypto.getRandomValues(buf);
          let r = (buf[0] / 4294967296) * total, k = 0;
          while (k < w.length - 1 && r > w[k]) { r -= w[k]; k++; }
          order.push(idx[k]); idx.splice(k, 1); w.splice(k, 1);
        }
        ev.order = order;
        await store.setJSON("started-" + e.bet, { at: new Date().toISOString() });
      }
      if (e.type === "hole") {
        const n = Number(e.n);
        if (!(Number.isInteger(n) && n >= 1 && n <= 9)) return new Response("Bad hole", { status: 400 });
        const PARS = [4, 5, 3, 4, 4, 3, 5, 4, 4];
        const rnd = (m) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % m; };
        const swing = () => { const r = rnd(100); return r < 10 ? -1 : r < 45 ? 0 : r < 75 ? 1 : r < 92 ? 2 : 3; };
        const par = PARS[n - 1];
        Object.assign(ev, { n, par, a: par + swing(), b: par + swing() });
      }
      if (e.type === "accept" && e.duel) {
        // the server deals/plays, so neither player can re-roll it
        const rnd = (n) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
        if (e.game === "skins") {
          // holes are dealt one at a time as they are played
        } else {
          const suits = ["s", "h", "d", "c"];
          const pick = () => ({ r: 2 + rnd(13), s: suits[rnd(4)] });
          ev.cards = { by: pick(), opp: pick() };
        }
      }
    }
    await store.setJSON("ev-" + id, ev);

    // nudge the other guy so a challenge doesn't sit unseen
    const names = typeof e.names === "object" && e.names ? e.names : {};
    const nm = (id2) => (typeof names[id2] === "string" ? names[id2].slice(0, 20) : "Somebody");
    let msg = null;
    if (ev.type === "create" && ev.kind === "duel" && ev.opp) {
      const what = ev.game === "skins" ? "the Imaginary Open" : "a high-card duel";
      msg = { who: ev.opp, title: `${nm(ev.by)} called you out`, body: `${what} for $${ev.stake}${ev.game === "skins" ? " a skin" : ""}. Your move.`, tag: "duel-" + id };
    } else if (ev.type === "create" && ev.kind === "race") {
      const when = ev.postAt ? new Date(ev.postAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) : null;
      msg = { all: true, title: `${nm(ev.by)} opened a race`, body: when ? `Post time ${when} — get your bet in.` : "Eight horses at Fairwaze Downs. Pick one.", tag: "race-" + id };
    } else if (ev.type === "start" && e.kind === "race") {
      msg = { all: true, title: "🏇 And they're off", body: "The race just ran — see who cashed.", tag: "raceoff-" + (e.bet || id) };
      try {
        const { blobs } = await store.list({ prefix: "ev-" });
        const all = (await Promise.all(blobs.map((b2) => store.get(b2.key, { type: "json" })))).filter(Boolean);
        const line = raceSummary(all, e.bet, names);
        if (line && !(await store.get("posted-" + e.bet, { type: "json" }))) { await store.setJSON("posted-" + e.bet, { at: new Date().toISOString() }); await postToFeed(line); }
      } catch (_) {}
    } else if (ev.type === "create" && ev.kind === "h2h" && ev.opp) {
      msg = { who: ev.opp, title: `${nm(ev.by)} wants a bet`, body: `$${ev.stake} on Round ${ev.round}. Accept or duck it.`, tag: "bet-" + id };
    } else if (ev.type === "accept" && e.otherId) {
      msg = { who: e.otherId, title: `${nm(ev.by)} accepted`, body: e.game === "skins" ? "Your match is live — go play a hole." : "Cards are out. Go look.", tag: "acc-" + id };
    } else if (ev.type === "hole" && e.otherId) {
      msg = { who: e.otherId, title: `${nm(ev.by)} played hole ${ev.n}`, body: "Your turn in the Imaginary Open.", tag: "hole-" + (e.bet || id) };
    } else if (ev.type === "press" && e.otherId) {
      msg = { who: e.otherId, title: `${nm(ev.by)} pressed`, body: "Every remaining skin just doubled.", tag: "press-" + (e.bet || id) };
    }
    // duels and Imaginary Open matches announce themselves the moment they settle
    if (["accept", "hole", "concede"].includes(ev.type) && e.bet) {
      try {
        const { blobs } = await store.list({ prefix: "ev-" });
        const all = (await Promise.all(blobs.map((b2) => store.get(b2.key, { type: "json" })))).filter(Boolean);
        const before = all.filter((x) => x.id !== ev.id);
        const line = duelFeedLine(all, e.bet, names);
        const already = duelFeedLine(before, e.bet, names);
        if (line && !already) {
          const who = line.startsWith("🃏") ? "🃏 The Duel" : "⛳ The Imaginary Open";
          await postToFeed(line.replace(/^(🃏 THE DUEL|⛳ IMAGINARY OPEN): /, ""), who);
        }
      } catch (_) {}
    }
    if (msg) {
      const job = notify((s) => (((msg.all && s.who !== ev.by) || s.who === msg.who) && s.pref !== "off" ? { title: msg.title, body: msg.body, url: "/?go=games", tag: msg.tag } : null));
      if (context && context.waitUntil) context.waitUntil(job); else await job;
    }
    return Response.json(ev);
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/bets" };
