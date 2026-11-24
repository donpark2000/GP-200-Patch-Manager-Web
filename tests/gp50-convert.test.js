// The GP-200 <-> GP-50 converter (stage 3): names, effects, on/off, chain
// order, the converter rules, the report, and refusals. Patches are built
// from the GP-200 skeleton and the GP-50 empty patch, with the repo's map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GP200_CTRLS, GP50_CTRL_MAX, gp200ToGp50, gp50EmptyPrst, gp50ToGp200, readGp200, readGp50, shortenName, writeGp200, writeGp50 } from "../gp50/convert.js";
import { GP200_MODULES, GP50_MODULES } from "../gp50/effect-map.js";
import { fileProblem } from "../gp50/restore.js";
import { CHECKSUM_OFF, prstChecksum, prstFileName } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";

const map = JSON.parse(readFileSync(new URL("../gp50/effect-map.json", import.meta.url), "utf8"));
const f32 = (v) => Math.fround(v);

/** A GP-200 patch from the skeleton, changed by `edit(parts)`. */
function gp200(edit = () => {}, raw = () => {}) {
  const p = readGp200(skeletonBytes());
  for (const m of p.modules) m.on = false;
  p.name = "Test";
  edit(p);
  const out = writeGp200(p);
  raw(out);
  const c = prstChecksum(out);
  out[CHECKSUM_OFF] = c >> 8;
  out[CHECKSUM_OFF + 1] = c & 0xff;
  return out;
}
/** A GP-50 patch from the empty patch, changed by `edit(parts)`. */
function gp50(edit = () => {}) {
  const p = readGp50(gp50EmptyPrst());
  p.name = "Test";
  edit(p);
  return writeGp50(p);
}
const codeOf = (k) => Number(k) >>> 0;
const find = (side, test) => Object.entries(map[side]).find(([k, e]) => test(e, k));
const setFx = (m, code, fx, pick = (c) => c.def) => { m.code = codeOf(code); m.values = m.values.map(() => 0); for (const c of fx.controls) m.values[c.pos] = pick(c); };

test("names: Valeton style, never over 10, kept when they fit", () => {
  const cases = {
    "Clean": "Clean", "Twin Clean": "Twin Clean", "Wu Shizheng3": "WuShizhen3", "Nathania Jualim1": "NathaniaJ1",
    "Modern Clean": "Modern CL", "Love of God": "Love God", "Lack of Oxygen": "LackOxygen", "Fat Bird (Wah)": "FatBirdWah",
    "Wild Fruit (Wah)": "WildFruitW", "Friedman BE100": "FriedmanBE", "Classic 800": "Classic800", "Power Lead Tone": "PowerLDTon",
  };
  for (const [from, want] of Object.entries(cases)) assert.equal(shortenName(from), want, from);
  for (const n of ["Juan Fer Ramirez", "Test IR and NAM", "  I Was a Bass Am  ", "AAAAAAAAAAAAAAAA", "Yuri Vermilion12"]) assert.ok(shortenName(n).length <= 10, n);
  assert.equal(shortenName("Yuri Vermilion12"), "YuriVerm12");
});

test("GP-50 empty patch is a valid GP-50 file with every module off", () => {
  const e = gp50EmptyPrst();
  assert.equal(fileProblem(e), null);
  const p = readGp50(e);
  assert.equal(p.name, "GP-50");
  assert.ok(p.modules.every((m) => !m.on));
  assert.deepEqual(p.order, [0, 1, 2, 9, 3, 4, 5, 6, 7, 8]);
});

const KEPT = ["same", "rename"]; // every setting carried
// Back on the GP-50 as the same effect with every one of its settings: a
// GP-200 cab's Low and High Cut, which the GP-50 lacks, may be dropped.
const comesBack = (k, e) => {
  const b = map.toGp50[map.toGp200[k].to];
  return b?.to === k && e.controls.length > 0 && e.controls.every((c) => b.moves.some((mv) => mv.to === c.pos));
};

test("round trip: a GP-50 patch of 'same' effects comes back unchanged through the GP-200", () => {
  let n = 0;
  const src = gp50((p) => {
    for (const m of p.modules) {
      if (m.module === "NAM") continue;
      const hit = find("gp50", (e, k) => e.module === m.module && KEPT.includes(map.toGp200[k]?.match) && map.gp200[map.toGp200[k].to]?.modules.includes(m.module) && comesBack(k, e));
      assert.ok(hit, `a same or renamed effect for ${m.module}`);
      // Values off their defaults, inside their ranges.
      setFx(m, hit[0], hit[1], (c) => (c.menu ? Math.min(1, c.max) : f32(c.min + (c.max - c.min) / 3)));
      m.on = n++ % 2 === 0;
    }
    p.modules[1].on = true; // PRE on, so the GP-200's empty WAH can't take it
    p.order = [0, 1, 2, 9, 3, 4, 6, 5, 7, 8]; // MOD before EQ
    p.tempo = 97;
    p.volume = 63;
    p.name = "RoundTrip1";
  });
  const logs = [];
  const there = gp50ToGp200(src, map, { log: (s) => logs.push(s) });
  assert.deepEqual(there.notes, [], "nothing to report one way");
  assert.equal(logs.length, 1);
  const back = gp200ToGp50(there.prst, map);
  // Only a module that was off left out, or a GP-200 control the GP-50 lacks dropped.
  assert.ok(back.notes.every((t) => /left out \(was off\)/.test(t) || /a close match: ([\w ]+ dropped(, )?)+$/.test(t)), back.notes.join("\n"));
  const a = readGp50(src), b = readGp50(back.prst);
  assert.equal(b.name, "RoundTrip1");
  assert.equal(b.tempo, 97);
  assert.equal(b.volume, 63);
  assert.deepEqual(b.order, a.order);
  for (const m of a.modules) {
    const o = b.modules[m.index];
    assert.equal(o.on, m.on, `${m.module} on/off`);
    if (m.module === "NAM") continue;
    assert.equal(o.code, m.code, `${m.module} code`);
    for (const c of map.gp50["0x" + m.code.toString(16).toUpperCase().padStart(8, "0")].controls) assert.equal(o.values[c.pos], m.values[c.pos], `${m.module} ${c.name}`);
  }
  assert.equal(fileProblem(back.prst), null);
});

test("GP-200 to GP-50: chain order follows the GP-200, the volume module left out", () => {
  // NR, VOL, PRE, WAH, DST, AMP, CAB, ... as 74 factory patches have it.
  const a = readGp50(gp200ToGp50(gp200((p) => { p.order = [4, 10, 0, 1, 2, 3, 5, 6, 7, 8, 9]; }), map).prst);
  assert.deepEqual(a.order.map((i) => GP50_MODULES[i]), ["NR", "PRE", "DST", "NAM", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB"]);
  // The GP-200's default order has the gate after the amp, and it stays there.
  const b = readGp50(gp200ToGp50(gp200(), map).prst);
  assert.deepEqual(b.order.map((i) => GP50_MODULES[i]), ["PRE", "DST", "NAM", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB"]);
});

test("GP-200 to GP-50: a wah worked by the expression pedal is switched off and reported", () => {
  const wah = find("gp200", (e, k) => e.modules.join() === "WAH" && map.toGp50[k]?.match === "close");
  assert.ok(wah, "a GP-200 wah with a GP-50 match");
  const r = gp200ToGp50(gp200((p) => { setFx(p.modules[1], wah[0], wah[1]); p.modules[1].on = true; }), map);
  const pre = readGp50(r.prst).modules[GP50_MODULES.indexOf("PRE")];
  assert.equal(pre.code, codeOf(map.toGp50[wah[0]].to));
  assert.equal(pre.on, false);
  assert.ok(r.notes.some((t) => /^WAH: .*switched off: the expression pedal/.test(t)), r.notes.join("\n"));
});

test("GP-200 to GP-50: two modules wanting the GP-50's one PRE: the one that's on wins, the other is reported", () => {
  const wah = find("gp200", (e, k) => e.modules.includes("WAH") && map.gp50[map.toGp50[k]?.to]?.module === "PRE");
  const comp = find("gp200", (e, k) => e.modules.includes("PRE") && map.toGp50[k]?.match === "same" && map.gp50[map.toGp50[k].to].module === "PRE");
  const r = gp200ToGp50(gp200((p) => { setFx(p.modules[0], comp[0], comp[1]); p.modules[0].on = true; setFx(p.modules[1], wah[0], wah[1]); p.modules[1].on = false; }), map);
  const pre = readGp50(r.prst).modules[GP50_MODULES.indexOf("PRE")];
  assert.equal(pre.code, codeOf(comp[0]));
  assert.equal(pre.on, true);
  assert.ok(r.notes.some((t) => t.startsWith(`WAH: ${wah[1].name} left out (was off): the GP-50 has one PRE module, taken by ${comp[1].name} from PRE`)), r.notes.join("\n"));
  // Both on: the PRE module's own effect keeps the place.
  const both = gp200ToGp50(gp200((p) => { setFx(p.modules[0], comp[0], comp[1]); setFx(p.modules[1], wah[0], wah[1]); p.modules[0].on = p.modules[1].on = true; }), map);
  assert.equal(readGp50(both.prst).modules[1].code, codeOf(comp[0]));
  assert.ok(both.notes.some((t) => t.startsWith(`WAH: ${wah[1].name} left out:`)));
});

test("GP-200 to GP-50: a stand-in goes in switched off, at its defaults, and is reported", () => {
  const hit = find("gp200", (e, k) => map.toGp50[k]?.match === "stand-in" && e.modules.includes("MOD"));
  assert.ok(hit, "a stand-in that sits in MOD");
  const r = gp200ToGp50(gp200((p) => { setFx(p.modules[7], hit[0], hit[1]); p.modules[7].on = true; }), map);
  const mod = readGp50(r.prst).modules[GP50_MODULES.indexOf("MOD")];
  const en = map.toGp50[hit[0]];
  const to = en.inModule?.MOD?.to ?? en.to;
  assert.equal(mod.code, codeOf(to));
  assert.equal(mod.on, false);
  for (const c of map.gp50[to].controls) assert.equal(mod.values[c.pos], f32(c.def));
  assert.ok(r.notes.some((t) => t.startsWith(`MOD: ${hit[1].name} -> ${map.gp50[to].name}, a stand-in, switched off`)));
});

test("tempo sync: a synced Time is carried as a note length, not clamped as a time", () => {
  const hit = find("gp200", (e, k) => {
    const en = map.toGp50[k];
    const sync = e.controls.find((c) => /sync/i.test(c.name) && c.max === 1);
    return sync && en?.moves?.some((mv) => mv.from === sync.pos) && en.moves.some((mv) => /^time/i.test(mv.name) && mv.clamp) && e.modules.includes("DLY");
  });
  assert.ok(hit, "a GP-200 delay with Sync whose Time is limited on the GP-50");
  const sync = hit[1].controls.find((c) => /sync/i.test(c.name) && c.max === 1);
  const time = map.toGp50[hit[0]].moves.find((mv) => /^time/i.test(mv.name));
  const out = (synced) => readGp50(gp200ToGp50(gp200((p) => { setFx(p.modules[8], hit[0], hit[1]); p.modules[8].values[sync.pos] = synced ? 1 : 0; p.modules[8].values[time.from] = 4; p.modules[8].on = true; }), map).prst).modules[GP50_MODULES.indexOf("DLY")];
  assert.equal(out(true).values[time.to], 4, "synced: note length 4 carried");
  assert.equal(out(false).values[time.to], time.clamp[0], "not synced: 4 ms limited to the GP-50's least");
});

test("extra EXP assignments are reported, not carried; pedal notes come last", () => {
  const r = gp200ToGp50(gp200(() => {}, (out) => { out[0x3b8 + 16 * 1 + 5] = 8; out[GP200_CTRL_AT + 12 + 9] = 0x04; }), map);
  assert.ok(r.notes.some((t) => t.startsWith("EXP: its assignment to DLY not carried")), r.notes.join("\n"));
  assert.ok(r.notes.includes("CTRL 2: VOL not carried: that module isn't in the GP-50 patch"), r.notes.join("\n"));
  assert.equal(r.notes.at(-1).startsWith("CTRL") || r.notes.at(-1).startsWith("EXP"), true, "pedal notes come last");
});

// The GP-50's CTRL layout, from the pedal (journal 2026-11-24, "CTRL
// confirmed"): patch 99 read back with CTRL 1 = NR, CTRL 2 = EQ had 01 00 00 00
// and 20 00 00 00 at 542 and 546 (factory 47 Bass Drive, PRE/DST: 2 and 4).
const GP50_CTRL_AT = 542;
const ctrlOf = (prst) => [0, 1].map((n) => GP50_MODULES.filter((_, m) => (readGp50(prst).ctrlMasks[n] >>> m) & 1));

test("GP-50 CTRL: read where the pedal keeps it, a bit per module", () => {
  const raw = gp50EmptyPrst();
  assert.deepEqual(readGp50(raw).ctrlMasks, [0, 0], "the empty patch has no CTRL");
  raw.set([1, 0, 0, 0, 0x20, 0, 0, 0], GP50_CTRL_AT);
  assert.deepEqual(ctrlOf(raw), [["NR"], ["EQ"]]);
  raw.set([2, 0, 0, 0, 4, 0, 0, 0], GP50_CTRL_AT);
  assert.deepEqual(ctrlOf(raw), [["PRE"], ["DST"]]);
  const written = writeGp50({ ...readGp50(gp50EmptyPrst()), ctrlMasks: [0x180, 0x42] });
  assert.deepEqual([...written.slice(GP50_CTRL_AT, GP50_CTRL_AT + 10)], [0x80, 1, 0, 0, 0x42, 0, 0, 0, ...gp50EmptyPrst().slice(GP50_CTRL_AT + 8, GP50_CTRL_AT + 10)], "the 2 bytes after the masks are kept");
});

// The GP-200's CTRL, from the pedal (journal 2026-11-24, "GP-200 CTRL: eight
// masks"): records 0F 00 08 00 n 00 00 00 + u32 at 0x460 + 12n, bit m = module
// m. The developer read 1-C, 3-B and 7-B off the GP-200; their bytes as read.
const GP200_CTRL_AT = 0x460;
const ctrl200 = (prst) => readGp200(prst).ctrlMasks.map((mask) => GP200_MODULES.filter((_, m) => (mask >>> m) & 1));
const withMasks = (masks) => gp200((p) => { p.ctrlMasks = [...masks, ...Array(GP200_CTRLS - masks.length).fill(0)]; });
const bit = (...names) => names.reduce((m, x) => m | (1 << GP200_MODULES.indexOf(x)), 0);

test("GP-200 CTRL: eight masks at 0x460, as the developer read them off the pedal", () => {
  const real = {
    "1-C": [[0x0101, 0x0004, 0x0080, 0x0200], [["PRE", "DLY"], ["DST"], ["MOD"], ["RVB"]]],
    "3-B": [[0x9001, 0x98c0], [["PRE"], ["EQ", "MOD"]]],
    "7-B": [[0x0240], [["EQ", "RVB"]]],
  };
  for (const [slot, [raw, want]] of Object.entries(real)) {
    const out = gp200(() => {}, (b) => raw.forEach((v, n) => { for (let k = 0; k < 4; k++) b[GP200_CTRL_AT + 12 * n + 8 + k] = (v >>> (8 * k)) & 0xff; }));
    assert.deepEqual(ctrl200(out).slice(0, want.length), want, slot);
    if (slot !== "3-B") assert.deepEqual(ctrl200(out).slice(want.length).flat(), [], `${slot}: the other CTRLs hold nothing`);
  }
  assert.equal(readGp200(skeletonBytes()).ctrlMasks.length, 8);
  assert.deepEqual(readGp200(skeletonBytes()).ctrlMasks, Array(8).fill(0), "the skeleton has no CTRL");
  const written = writeGp200({ ...readGp200(skeletonBytes()), ctrlMasks: [0x9001, 0, 0, 0, 0, 0, 0, 0x0400] });
  assert.deepEqual([...written.slice(GP200_CTRL_AT, GP200_CTRL_AT + 12)], [0x0f, 0, 8, 0, 0, 0, 0, 0, 0x01, 0x90, 0, 0], "CTRL 1 written whole");
  assert.deepEqual([...written.slice(GP200_CTRL_AT + 12 * 7 + 4, GP200_CTRL_AT + 12 * 8)], [7, 0, 0, 0, 0, 4, 0, 0], "CTRL 8");
  assert.deepEqual([...written.slice(0x448, 0x460)], [...skeletonBytes().slice(0x448, 0x460)], "the 0x448 records stay the skeleton's");
});

test("CTRL, GP-200 to GP-50: the developer's DST/MOD and two modules on one CTRL carried, nothing reported", () => {
  const r = gp200ToGp50(withMasks([bit("DST"), bit("MOD")]), map);
  assert.deepEqual(ctrlOf(r.prst), [["DST"], ["MOD"]]);
  assert.ok(!r.notes.some((t) => t.startsWith("CTRL")), r.notes.join("\n"));
  const two = gp200ToGp50(withMasks([bit("DST", "DLY"), bit("MOD", "RVB")]), map);
  assert.deepEqual(ctrlOf(two.prst), [["DST", "DLY"], ["MOD", "RVB"]]);
  assert.ok(!two.notes.some((t) => t.startsWith("CTRL")), two.notes.join("\n"));
  const none = gp200ToGp50(gp200(), map);
  assert.deepEqual(readGp50(none.prst).ctrlMasks, [0, 0], "no CTRL stays no CTRL");
});

test("CTRL, GP-200 to GP-50: more than 3 on one CTRL keeps the first 3 in playing order; CTRL 3-8 reported", () => {
  const r = gp200ToGp50(withMasks([bit("RVB", "DLY", "MOD", "DST", "AMP"), 0, bit("DLY"), 0, 0, 0, 0, bit("EQ", "RVB")]), map);
  assert.deepEqual(ctrlOf(r.prst), [["DST", "AMP", "MOD"], []], "skeleton order: DST, AMP, MOD before DLY, RVB");
  assert.equal(GP50_CTRL_MAX, 3);
  assert.ok(r.notes.includes("CTRL 1: DLY not carried: a GP-50 CTRL switches 3 modules at most, and CTRL 1 has DST, AMP, MOD"), r.notes.join("\n"));
  assert.ok(r.notes.includes("CTRL 1: RVB not carried: a GP-50 CTRL switches 3 modules at most, and CTRL 1 has DST, AMP, MOD"), r.notes.join("\n"));
  assert.ok(r.notes.includes("CTRL 3: DLY not carried: the GP-50 has CTRL 1 and 2 only"), r.notes.join("\n"));
  assert.ok(r.notes.includes("CTRL 8: EQ + RVB not carried: the GP-50 has CTRL 1 and 2 only"), r.notes.join("\n"));
  const high = gp200ToGp50(withMasks([0xf800 | bit("DST")]), map);
  assert.deepEqual(ctrlOf(high.prst)[0], ["DST"], "bits 11-15 aren't modules: not carried");
});

test("CTRL, GP-50 to GP-200: every module carried, two on one CTRL included; CTRL 3-8 none", () => {
  const r = gp50ToGp200(gp50((p) => { p.ctrlMasks = [0b11, 1 << 5]; }), map);
  assert.deepEqual(ctrl200(r.prst).slice(0, 2), [["PRE", "NR"], ["EQ"]]);
  assert.ok(!r.notes.some((t) => t.startsWith("CTRL")), r.notes.join("\n"));
  assert.deepEqual(readGp200(r.prst).ctrlMasks.slice(2), Array(6).fill(0));
  const none = readGp200(gp50ToGp200(gp50(), map).prst).ctrlMasks;
  assert.deepEqual(none, Array(8).fill(0), "no CTRL: none");
});

test("CTRL round trip GP-200 -> GP-50 -> GP-200 keeps DST + DLY / MOD", () => {
  const there = gp200ToGp50(withMasks([bit("DST", "DLY"), bit("MOD")]), map);
  assert.deepEqual(ctrl200(gp50ToGp200(there.prst, map).prst).slice(0, 2), [["DST", "DLY"], ["MOD"]]);
});

test("names on the way over: shortened and reported, and a GP-50 name fits the GP-200 as it is", () => {
  const r = gp200ToGp50(gp200((p) => { p.name = "Lack of Oxygen"; }), map);
  assert.equal(r.name, "LackOxygen");
  assert.equal(readGp50(r.prst).name, "LackOxygen");
  assert.equal(r.notes[0], 'Name shortened: "Lack of Oxygen" -> "LackOxygen" (the GP-50 takes 10 characters)');
  const back = gp50ToGp200(r.prst, map);
  assert.equal(prstFileName(back.prst), "LackOxygen");
  assert.equal(prstChecksum(back.prst), (back.prst[CHECKSUM_OFF] << 8) | back.prst[CHECKSUM_OFF + 1]);
});

test("refusals say why", () => {
  assert.throws(() => gp200ToGp50(gp50EmptyPrst(), map), /Not a GP-200 patch \(552 bytes\)/);
  assert.throws(() => gp50ToGp200(skeletonBytes(), map), /Not a GP-50 patch \(1224 bytes\)/);
  assert.throws(() => gp200ToGp50(gp200((p) => { p.modules[3].code = 0x7ffffff0; }), map), /^Error: AMP: effect code 0x7FFFFFF0 isn't in the effect map/);
  assert.throws(() => gp200ToGp50(gp200(() => {}, (out) => { out[0xa0 + 72 * 2] = 0x15; }), map), /module DST's block isn't laid out as expected/);
  assert.throws(() => gp200ToGp50(gp200(() => {}, (out) => { out[0x94] = out[0x95]; }), map), /chain order .* isn't the 11 modules once each/);
  const broken = gp50EmptyPrst();
  broken[148] = 0x99;
  assert.throws(() => readGp50(broken), /record 3001 isn't where it is/);
  assert.throws(() => gp50ToGp200(gp50((p) => { p.modules[3].code = 0x7ffffff0; }), map), /AMP: effect code 0x7FFFFFF0 isn't in the effect map/);
});

test("every GP-200 module index in the converter matches the file's block order", () => {
  const p = readGp200(skeletonBytes());
  assert.deepEqual(p.modules.map((m) => m.module), GP200_MODULES);
  assert.equal(p.exp.length, 9);
  assert.equal(p.ctrlMasks.length, GP200_CTRLS);
});
