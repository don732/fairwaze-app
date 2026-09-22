// Rebuilds a duel or Imaginary Open match from the event log and writes the feed line when it settles.
// The hole math here mirrors the app exactly, so the server and every phone agree on the scores.
const r2 = (n) => Math.round(n * 100) / 100;
const money = (v) => "$" + (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0);
const hashInt = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };
const det = (seed) => { let h = hashInt(seed); h = (h * 1103515245 + 12345) >>> 0; return ((h >>> 8) % 100000) / 100000; };
const swingFor = (seed) => { const r = det(seed) * 100; return r < 10 ? -1 : r < 45 ? 0 : r < 75 ? 1 : r < 92 ? 2 : 3; };
const PARS = [4, 5, 3, 4, 4, 3, 5, 4, 4];
const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RANK = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const card = (c) => (c ? `${RANK[c.r] || c.r}${SUIT[c.s] || ""}` : "?");

export function replayDuel(events, betId) {
  const sorted = [...events].sort((a, b) => (String(a.at) + a.id) < (String(b.at) + b.id) ? -1 : 1);
  const c = sorted.find((e) => e.id === betId && e.type === "create" && e.kind === "duel");
  if (!c) return null;
  const b = { id: c.id, by: c.by, opp: c.opp, stake: Number(c.stake), game: c.game === "skins" ? "skins" : "card", accepted: false, cards: null, acceptId: null, holes: 0, presses: [], conceded: null, scrap: [], voided: false };
  const turnFor = (played) => (played % 2 === 0 ? b.opp : b.by);
  for (const e of sorted) {
    if (e.bet !== betId) continue;
    if (e.type === "accept" && e.by === b.opp && !b.accepted) { b.accepted = true; b.cards = e.cards || null; b.acceptId = e.id; }
    else if (e.type === "hole" && b.accepted && b.game === "skins" && (e.by === b.by || e.by === b.opp)) {
      const n = Number(e.n) || b.holes + 1;
      if (n === b.holes + 1 && n <= 9 && e.by === turnFor(b.holes)) b.holes = n;
    }
    else if (e.type === "press" && b.accepted && b.game === "skins" && (e.by === b.by || e.by === b.opp)) {
      if (b.holes < 9 && b.presses.length < 3 && !b.presses.some((p) => p.after === b.holes)) b.presses.push({ after: b.holes, by: e.by });
    }
    else if (e.type === "concede" && b.accepted && !b.conceded && (e.by === b.by || e.by === b.opp)) b.conceded = { by: e.by, holes: b.holes };
    else if (e.type === "scrap" && (e.by === b.by || e.by === b.opp) && !b.scrap.includes(e.by)) b.scrap.push(e.by);
    else if (e.type === "void") b.voided = true;
  }
  return b;
}

function holeScores(b, n) {
  const base = `${b.id}|${b.acceptId || ""}|${n}`;
  const par = PARS[n - 1];
  return { par, a: par + swingFor(base + "|a"), b: par + swingFor(base + "|b") };
}
function tally(b) {
  let a = 0, bb = 0, pot = 1, $a = 0, $b = 0;
  for (let i = 0; i < b.holes; i++) {
    const h = holeScores(b, i + 1);
    const mult = Math.pow(2, b.presses.filter((p) => p.after <= i).length);
    let win = null;
    if (h.a < h.b) { win = "a"; a += pot; $a += pot * b.stake * mult; } else if (h.b < h.a) { win = "b"; bb += pot; $b += pot * b.stake * mult; }
    pot = win ? 1 : pot + 1;
  }
  return { a, bb, carry: pot - 1, net: r2($a - $b), $a, $b };
}

// returns the feed line if this event just settled the match, else null
export function duelFeedLine(events, betId, names = {}) {
  const b = replayDuel(events, betId);
  if (!b || b.voided || !b.accepted || b.scrap.length >= 2) return null;
  const F = (id) => names[id] || id;
  if (b.game === "card") {
    if (!b.cards || !b.cards.by || !b.cards.opp) return null;
    const A = b.cards.by, C = b.cards.opp;
    if (A.r === C.r) return `🃏 THE DUEL: ${F(b.by)} ${card(A)} vs ${F(b.opp)} ${card(C)} — dead heat, push.`;
    const w = A.r > C.r ? b.by : b.opp, l = w === b.by ? b.opp : b.by;
    return `🃏 THE DUEL: ${F(w)} ${card(w === b.by ? A : C)} beats ${F(l)} ${card(w === b.by ? C : A)} for ${money(b.stake)}.`;
  }
  const t = tally(b);
  if (b.conceded) {
    const w = b.conceded.by === b.by ? b.opp : b.by, l = b.conceded.by;
    const mult = Math.pow(2, b.presses.length);
    const left = (9 - b.holes) + t.carry;
    const owed = r2(Math.max(0, w === b.by ? t.net : -t.net) + left * b.stake * mult);
    return `⛳ IMAGINARY OPEN: ${F(l)} conceded to ${F(w)} after ${b.holes} hole${b.holes === 1 ? "" : "s"}${owed > 0 ? ` — ${F(w)} collects ${money(owed)}` : ""}.`;
  }
  if (b.holes < 9) return null;
  const pr = b.presses.length ? ` (${b.presses.length} press${b.presses.length > 1 ? "es" : ""})` : "";
  if (Math.abs(t.net) < 0.005) return `⛳ IMAGINARY OPEN: ${F(b.by)} and ${F(b.opp)} finish ${t.a}–${t.bb} in skins — all square${pr}.`;
  const w = t.net > 0 ? b.by : b.opp, l = w === b.by ? b.opp : b.by;
  const ws = w === b.by ? t.a : t.bb, ls = w === b.by ? t.bb : t.a;
  return `⛳ IMAGINARY OPEN: ${F(w)} beats ${F(l)} ${ws}–${ls} in skins${pr} — ${F(w)} collects ${money(Math.abs(t.net))}.`;
}
