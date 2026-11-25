// A/B pairs for listening on the GP-200 alone (journal 2026-11-25, "A/B
// pairs"). Each test patch goes in twice, side by side: A unchanged, B
// converted to the GP-50 format and back. B carries what the GP-50 copy loses
// or substitutes, assuming the same effect at the same settings sounds alike
// on both pedals (not proven). No DOM.
//
// The test patches are picked from the converter's own reports (Claude's
// choice, for the developer's review): every rule that changes what is heard
// (a module that's on, or a CTRL) at least once, close matches of amps, cabs
// and drives twice. Rarest rule first, each from the patch where it comes
// with the fewest other changes, so a pair that sounds off points at few
// rules; then patches whose way back is exact (when the way back also
// guessed, B has two substitutions stacked: marked). One pair with
// nothing heard changed goes first, as a check: A and B should sound the
// same (the amp and at least two more modules on). Patches using a user IR or
// SnapTone are left out (copying them is out of scope).
// Not heard (Claude's call): a module that's off, and a cab that is the same
// cab on both pedals (its match comes back to it exactly) whose Low Cut and
// High Cut, which the GP-50 lacks, are at their off ends (19 and 20001 Hz):
// the converter still notes those as dropped.

import { CHECKSUM_OFF, prstChecksum } from "../src/core/prst.js";
import { slotToLabel } from "../src/core/slots.js";
import { readGp200 } from "./convert.js";
import { hex } from "./effect-map.js";
import { roundTrip } from "./roundtrip.js";

/** Kinds of change a note names; a note can name several. */
const KINDS = [
  [/a stand-in/, () => "stand-in"],
  [/left out, the GP-50 has nothing like it/, () => "no match, left out"],
  [/left out[^:]*: the GP-50 has one \w+ module, taken by/, () => "lost a shared module"],
  [/switched off: the expression pedal/, () => "wah switched off (EXP)"],
  [/was set by tempo/, () => "synced time to a default"],
  [/ limited /, () => "setting limited"],
  [/ dropped/, () => "setting dropped"],
  [/a close match/, (m) => `close match: ${m}`],
  [/^CTRL [12]: .*a GP-50 CTRL switches/, () => "CTRL over 3 modules"],
  [/^CTRL [3-8]:/, () => "CTRL 3-8 not carried"],
  [/^EXP: its assignment/, () => "EXP assignment dropped"],
  [/^Patch volume limited/, () => "patch volume limited"],
];
export const WANT_TWICE = ["close match: AMP", "close match: CAB", "close match: DST"];
const VOLUME_KIND = "volume module at full (Q18)";

/** A cab note that only drops Low Cut / High Cut, both off, on a cab whose match comes back to it. */
function cutsOffOnly(note, a, map) {
  const m = note.match(/a close match(?: \([^)]*\))?: (.*)$/);
  if (!m || !m[1].split(", ").every((c) => /^(Low|High) Cut dropped$/.test(c))) return false;
  const cab = a.modules.find((x) => x.module === "CAB");
  const k = hex(cab.code);
  const fwd = map.toGp50[k], fx = map.gp200[k];
  if (!fwd || !["same", "rename"].includes(map.toGp200[fwd.to]?.match) || map.toGp200[fwd.to].to !== k) return false;
  return fx.controls.filter((c) => /cut/i.test(c.name)).every((c) => cab.values[c.pos] === (/low/i.test(c.name) ? c.min : c.max));
}

/**
 * What a GP-200 patch's GP-50 copy changes that is heard: { kinds, details,
 * backGuessed, skip } (skip: why it can't be a test patch).
 */
export function audibleChanges(r, a, map) {
  if (r.refused) return { skip: `can't be converted: ${r.refused}`, kinds: [], details: [] };
  const on = new Map(a.modules.map((m) => [m.module, m.on]));
  const kinds = new Set(), details = [];
  for (const t of r.there.notes) {
    if (/NAM\/SnapTone and user IRs/.test(t)) return { skip: "uses a user IR or SnapTone", kinds: [], details: [] };
    const mod = t.match(/^([A-Z]{2,3}): /)?.[1];
    if (mod && (!on.get(mod) || /\(was off\)/.test(t))) continue; // not heard
    if (mod === "CAB" && cutsOffOnly(t, a, map)) continue;
    let named = false;
    for (const [re, kind] of KINDS) if (re.test(t)) { kinds.add(kind(mod)); named = true; }
    if (named) details.push(t);
  }
  // The GP-50 has no volume module: B's is the blank patch's, on at full.
  const vol = a.modules.find((m) => m.module === "VOL");
  if (vol.on && vol.values[0] < 100) { kinds.add(VOLUME_KIND); details.push(`VOL: volume pedal at ${Math.round(vol.values[0])}, B at 100 (the GP-50 has no volume module)`); }
  const backGuessed = r.back.notes.filter((t) => /a close match|left out|stand-in/.test(t));
  return { kinds: [...kinds], details, backGuessed };
}

/**
 * Picks the test patches: [{ slot, entry, change, control? }], in the
 * source's order with the check pair first. `entries`: [{ slot, name, data }].
 */
export function pickPairs(entries, map, { maxPairs = 20 } = {}) {
  const cands = entries.map((e) => {
    const r = roundTrip(e.data, "GP-200", map);
    const a = readGp200(e.data);
    return { ...e, r, a, change: audibleChanges(r, a, map) };
  }).filter((c) => !c.change.skip);
  const need = new Map();
  for (const c of cands) for (const k of c.change.kinds) need.set(k, WANT_TWICE.includes(k) ? 2 : 1);
  const picked = [];
  const having = (k) => cands.filter((c) => c.change.kinds.includes(k));
  const rarest = [...need.keys()].sort((x, y) => having(x).length - having(y).length || (x < y ? -1 : 1));
  const key = (c) => [c.change.kinds.length, c.change.backGuessed.length, c.slot];
  const before = (x, y) => { const a = key(x), b = key(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  for (const k of rarest) {
    while (need.get(k) > 0 && picked.length < maxPairs - 1) {
      const pool = having(k).filter((c) => !picked.includes(c));
      if (!pool.length) break;
      const best = pool.reduce((x, y) => (before(y, x) ? y : x));
      picked.push(best);
      for (const j of best.change.kinds) if (need.get(j) > 0) need.set(j, need.get(j) - 1);
    }
  }
  picked.sort((x, y) => x.slot - y.slot);
  const heard = (c) => c.a.modules.filter((m) => m.on && m.module !== "VOL");
  const control = cands.find((c) => !c.change.kinds.length && !c.change.backGuessed.length && !picked.includes(c)
    && heard(c).some((m) => m.module === "AMP") && heard(c).length >= 3);
  const uncovered = [...need].filter(([, n]) => n > 0).map(([k, n]) => `${k} (${n} more wanted)`);
  return { pairs: control ? [{ ...control, control: true }, ...picked] : picked, uncovered, candidates: cands.length, kinds: [...need.keys()].sort() };
}

/** A copy of a GP-200 .prst with another name (16 characters at most), checksum redone. */
export function renamed(prst, name) {
  const out = Uint8Array.from(prst);
  out.fill(0, 0x44, 0x54);
  for (let i = 0; i < Math.min(16, name.length); i++) out[0x44 + i] = name.charCodeAt(i) & 0x7f;
  const c = prstChecksum(out);
  out[CHECKSUM_OFF] = c >> 8;
  out[CHECKSUM_OFF + 1] = c & 0xff;
  return out;
}

export const B_MARK = "~50";
const fileSafe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "patch";

/**
 * The files for Restore, from slot `start`: A then B for each pair, A as it
 * is, B named with B_MARK, so each pair sits side by side (start on an A
 * patch and every pair stays in one bank); and the sheet's rows.
 */
export function pairFiles(pairs, start) {
  const files = [], rows = [];
  pairs.forEach((p, i) => {
    const sa = start + 2 * i, sb = sa + 1;
    const nameA = p.r.source;
    const nameB = `${nameA.slice(0, 16 - B_MARK.length).trimEnd()}${B_MARK}`;
    files.push({ name: `${slotToLabel(sa).replace("-", "")}_${fileSafe(nameA)}.prst`, data: p.data });
    files.push({ name: `${slotToLabel(sb).replace("-", "")}_${fileSafe(nameB)}.prst`, data: renamed(p.r.back.prst, nameB) });
    rows.push({
      pair: i + 1, a: slotToLabel(sa), b: slotToLabel(sb), source: `${slotToLabel(p.slot)} ${nameA}`,
      kinds: p.control ? "check pair: nothing heard should change" : p.change.kinds.join("; "),
      details: p.change.details.join(" | "), back: p.change.backGuessed.join(" | "),
    });
  });
  return { files, rows };
}

const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;

/** The listening sheet (CSV). */
export function pairSheet(rows) {
  const head = ["Pair", "A (unchanged)", "B (via GP-50)", "Source patch", "What B changes", "Details", "Way back also guessed", "Verdict (same / close / off)", "Comment"];
  return [head, ...rows.map((r) => [r.pair, r.a, r.b, r.source, r.kinds, r.details, r.back || "no", "", ""])].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
