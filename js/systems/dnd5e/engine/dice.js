// Dice engine for the D&D 5e system. Pure functions only (no DOM), so the
// same code runs in the browser and under Node for tests.
//
// Expression grammar (case-insensitive, spaces ignored):
//   term      := [+-] ( dice | number )
//   dice      := N d S [ modifiers ]            e.g. 4d6kh3, 2d20kl1, 8d6, d%, d20
//   modifiers := kh<n> | kl<n>                  keep highest / lowest n
//              | dh<n> | dl<n>                  drop highest / lowest n
//              | r<n>  | r<=n | r<n (once)      reroll dice showing <= n, once (Great Weapon Fighting: r2)
//              | ro<n>                          same as r<n>
//              | mi<n>                          treat any die lower than n as n (Elemental Adept: mi2)
//              | !                              explode on the maximum
//   plus the words  adv / advantage / dis / disadvantage  anywhere in the text,
//   which turn the first d20 term into 2d20kh1 / 2d20kl1.

export const MAX_DICE = 200;
export const MAX_SIDES = 1000;

let rng = Math.random;
export function setRng(fn) { rng = typeof fn === "function" ? fn : Math.random; }

export function rollDie(sides) {
  return 1 + Math.floor(rng() * sides);
}

const TERM_RE = /([+-]?)(\d*)d(%|\d+)((?:kh\d*|kl\d*|dh\d*|dl\d*|ro?<?=?\d+|mi\d+|!)*)|([+-]?)(\d+)/gy;

function applyAdvWords(text) {
  let mode = null;
  let t = String(text).toLowerCase();
  if (/\b(disadvantage|dis)\b/.test(t)) mode = "dis";
  else if (/\b(advantage|adv)\b/.test(t)) mode = "adv";
  t = t.replace(/\b(disadvantage|advantage|dis|adv)\b/g, "");
  return { text: t.replace(/\s+/g, ""), mode };
}

// Returns an array of term descriptors, or null if the text isn't a roll.
export function parseExpression(input) {
  const { text, mode } = applyAdvWords(input);
  if (!text) return null;
  const terms = [];
  TERM_RE.lastIndex = 0;
  let pos = 0;
  let first = true;
  while (pos < text.length) {
    TERM_RE.lastIndex = pos;
    const m = TERM_RE.exec(text);
    if (!m || m.index !== pos) return null;
    pos = TERM_RE.lastIndex;
    if (m[3] !== undefined) {
      const sign = m[1] === "-" ? -1 : 1;
      if (!first && !m[1]) return null; // "2d6 3d4" without an operator
      const count = m[2] === "" ? 1 : Number(m[2]);
      const sides = m[3] === "%" ? 100 : Number(m[3]);
      if (count < 1 || count > MAX_DICE || sides < 1 || sides > MAX_SIDES) return null;
      const t = { kind: "dice", sign, count, sides, keep: null, drop: null, reroll: null, min: null, explode: false };
      const mods = m[4] || "";
      const modRe = /kh(\d*)|kl(\d*)|dh(\d*)|dl(\d*)|ro?(<?=?)(\d+)|mi(\d+)|!/g;
      let mm;
      while ((mm = modRe.exec(mods))) {
        if (mm[0].startsWith("kh")) t.keep = { high: true, n: mm[1] === "" ? 1 : Number(mm[1]) };
        else if (mm[0].startsWith("kl")) t.keep = { high: false, n: mm[2] === "" ? 1 : Number(mm[2]) };
        else if (mm[0].startsWith("dh")) t.drop = { high: true, n: mm[3] === "" ? 1 : Number(mm[3]) };
        else if (mm[0].startsWith("dl")) t.drop = { high: false, n: mm[4] === "" ? 1 : Number(mm[4]) };
        else if (mm[0].startsWith("r")) t.reroll = Number(mm[6]);
        else if (mm[0].startsWith("mi")) t.min = Number(mm[7]);
        else if (mm[0] === "!") t.explode = true;
      }
      terms.push(t);
    } else {
      const sign = m[5] === "-" ? -1 : 1;
      if (!first && !m[5]) return null;
      terms.push({ kind: "num", sign, value: Number(m[6]) });
    }
    first = false;
  }
  if (!terms.length) return null;
  if (mode) {
    const d20 = terms.find((t) => t.kind === "dice" && t.sides === 20 && t.count === 1 && !t.keep && t.sign > 0);
    if (d20) { d20.count = 2; d20.keep = { high: mode === "adv", n: 1 }; }
  }
  return terms;
}

function rollTerm(t, crit) {
  const count = crit ? t.count * 2 : t.count;
  const dice = [];
  for (let i = 0; i < count; i++) {
    let v = rollDie(t.sides);
    let note = null;
    if (t.reroll !== null && v <= t.reroll) { note = `rerolled ${v}`; v = rollDie(t.sides); }
    if (t.min !== null && v < t.min) { note = `${v}→${t.min}`; v = t.min; }
    dice.push({ v, kept: true, note });
    if (t.explode && t.sides > 1) {
      let guard = 0;
      while (dice[dice.length - 1].v === t.sides && guard++ < 20) dice.push({ v: rollDie(t.sides), kept: true, note: "exploded" });
    }
  }
  // keep / drop
  const idx = dice.map((d, i) => i);
  const byValue = (high) => [...idx].sort((a, b) => (high ? dice[b].v - dice[a].v : dice[a].v - dice[b].v) || a - b);
  if (t.keep) {
    const keepSet = new Set(byValue(t.keep.high).slice(0, t.keep.n));
    dice.forEach((d, i) => { d.kept = keepSet.has(i); });
  }
  if (t.drop) {
    const dropSet = new Set(byValue(t.drop.high).slice(0, t.drop.n));
    dice.forEach((d, i) => { if (dropSet.has(i)) d.kept = false; });
  }
  const subtotal = dice.reduce((s, d) => s + (d.kept ? d.v : 0), 0);
  return { dice, subtotal };
}

function termLabel(t, crit) {
  if (t.kind === "num") return String(t.value);
  const n = crit ? t.count * 2 : t.count;
  let s = `${n}d${t.sides}`;
  if (t.keep) s += (t.keep.high ? "kh" : "kl") + t.keep.n;
  if (t.drop) s += (t.drop.high ? "dh" : "dl") + t.drop.n;
  if (t.reroll !== null) s += `r${t.reroll}`;
  if (t.min !== null) s += `mi${t.min}`;
  if (t.explode) s += "!";
  return s;
}

// roll("2d6+3") -> { total, terms:[{label, sign, dice:[{v,kept,note}], subtotal}], text, crit }
// opts.crit doubles the number of dice (never the flat modifiers), per the 5e crit rule.
export function roll(expression, opts = {}) {
  const terms = parseExpression(expression);
  if (!terms) return null;
  const crit = !!opts.crit;
  let total = 0;
  const out = [];
  for (const t of terms) {
    if (t.kind === "num") {
      total += t.sign * t.value;
      out.push({ label: String(t.value), sign: t.sign, dice: [], subtotal: t.value });
    } else {
      const r = rollTerm(t, crit);
      total += t.sign * r.subtotal;
      out.push({ label: termLabel(t, crit), sign: t.sign, dice: r.dice, subtotal: r.subtotal });
    }
  }
  return { total, terms: out, text: describe(out), crit };
}

export function describe(terms) {
  return terms.map((t, i) => {
    const sign = t.sign < 0 ? "−" : (i === 0 ? "" : "+");
    if (!t.dice.length) return `${sign}${t.label}`;
    const dice = t.dice.map((d) => (d.kept ? String(d.v) : `(${d.v})`)).join(", ");
    return `${sign}${t.label} [${dice}]`;
  }).join(" ").replace(/\+ /g, "+");
}

// min / max / average of an expression (flat for numbers)
export function stats(expression) {
  const terms = parseExpression(expression);
  if (!terms) return null;
  let min = 0, max = 0, avg = 0;
  for (const t of terms) {
    if (t.kind === "num") { min += t.sign * t.value; max += t.sign * t.value; avg += t.sign * t.value; continue; }
    const n = t.keep ? Math.min(t.keep.n, t.count) : t.count - (t.drop ? Math.min(t.drop.n, t.count) : 0);
    const lo = (t.min || 1), hi = t.sides;
    const per = (lo + hi) / 2;
    const smin = n * lo, smax = n * hi;
    // keep-highest/lowest averages are approximated by simulation-free formula for 2 dice, otherwise plain
    let savg = n * per;
    if (t.keep && t.count === 2 && t.keep.n === 1) {
      const s = t.sides;
      savg = t.keep.high ? ((s + 1) * (4 * s - 1)) / (6 * s) : ((s + 1) * (2 * s + 1)) / (6 * s);
    } else if (t.keep || t.drop) {
      savg = n * per;
    }
    if (t.sign > 0) { min += smin; max += smax; avg += savg; }
    else { min -= smax; max -= smin; avg -= savg; }
  }
  return { min, max, avg };
}

// ---------------------------------------------------------------- d20 tests

// rollD20({ mod, mode: "normal"|"adv"|"dis", reliable10 })
// reliable10 models Reliable Talent: a d20 showing 9 or lower counts as 10.
export function rollD20({ mod = 0, mode = "normal", reliable10 = false } = {}) {
  const a = rollDie(20);
  const b = mode === "normal" ? null : rollDie(20);
  let chosen = a;
  if (mode === "adv") chosen = Math.max(a, b);
  else if (mode === "dis") chosen = Math.min(a, b);
  const natural = chosen;
  if (reliable10 && chosen < 10) chosen = 10;
  return {
    rolls: b === null ? [a] : [a, b], natural, chosen, mod, total: chosen + mod, mode,
    crit: natural === 20, fumble: natural === 1,
  };
}

export function fmtMod(n) {
  const v = Math.trunc(Number(n) || 0);
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`;
}

// "1d8" + a flat modifier -> "1d8+3" style text (used when building damage strings)
export function withMod(dice, mod) {
  if (!mod) return dice;
  return `${dice}${mod > 0 ? "+" : "-"}${Math.abs(mod)}`;
}

// Scales a damage expression's dice count (cantrip scaling: 1d10 -> 2d10 ...).
export function scaleDice(expr, mult) {
  return String(expr).replace(/(\d*)d(\d+)/g, (m, n, s) => `${(n === "" ? 1 : Number(n)) * mult}d${s}`);
}
