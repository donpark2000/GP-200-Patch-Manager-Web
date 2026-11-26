// The module-by-module sound tests (gp50/sound-tests.js) and their tool
// (tools/sound-tests.js): the repo's choices against the repo's map, the
// banks, the split, the Restore-style check (shown to fail), and the tool in
// a temp folder.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readGp200, writeGp200 } from "../gp50/convert.js";
import { buildBank, candidates, carried, checkPick, EMPTY_NAME, planZips, resolveChoices, sheet, splitSizes, verifyZip } from "../gp50/sound-tests.js";
import { labelToSlot } from "../src/core/slots.js";
import { createZip } from "../src/core/zip.js";
import { main } from "../tools/sound-tests.js";

const map = JSON.parse(readFileSync(new URL("../gp50/effect-map.json", import.meta.url), "utf8"));
const choices = JSON.parse(readFileSync(new URL("../gp50/sound-test-choices.json", import.meta.url), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const code = (side, name) => Object.entries(map[side]).find(([, e]) => e.name === name)[0];
const START = labelToSlot("32-A");
const mini = (effects, extra = {}) => ({ chains: choices.chains, tests: [{ module: "AMP", effects }], notTested: {}, ...extra });
const one = (name, alts, chain = "clean", module = "AMP") => {
  const r = resolveChoices({ chains: choices.chains, tests: [{ module, effects: [{ name, chain, alts }] }] }, map);
  return { r, t: r.tests[0], e: r.tests[0].effects[0] };
};
const mod = (prst, m) => readGp200(prst).modules.find((x) => x.module === m);

test("sound tests: the repo's choices fit the map and cover every GP-200 effect whose GP-50 copy is another", () => {
  const r = resolveChoices(choices, map);
  // A new effect (newer firmware, a changed map) shows here: add it to the
  // choices, or to notTested with the reason.
  assert.deepEqual(r.missing, []);
  const tested = r.tests.reduce((n, t) => n + t.effects.length, 0);
  assert.equal(tested + Object.keys(choices.notTested).length, candidates(map).length);
  assert.equal(r.tests.find((t) => t.module === "AMP").effects.length, 39);
  assert.equal(r.tests.find((t) => t.module === "CAB").effects.length, 49);
  // The map's pick is always B where the GP-200 can play it.
  const dlx = r.tests[0].effects[0];
  assert.deepEqual(dlx.alts[0], { code: code("gp50", "Dark Twin"), isPick: true });
  const plate = r.tests.find((t) => t.module === "RVB").effects.find((e) => map.gp200[e.a].name === "Plate");
  assert.match(plate.pickNote, /isn't on the GP-200/);
  assert.ok(plate.alts.every((a) => !a.isPick));
});

test("sound tests: choices that don't fit are refused, naming what is wrong", () => {
  const bad = [
    [mini([{ name: "No Such Amp", chain: "clean", alts: [] }]), /No Such Amp": no such effect/],
    [mini([{ name: "Dark DLX", chain: "clean", alts: [] }, { name: "Dark DLX", chain: "clean", alts: [] }]), /tested twice/],
    [mini([{ name: "Dark DLX", chain: "clean", alts: ["Dark Twin"] }]), /listed twice, or is the map's pick/],
    [mini([{ name: "Dark DLX", chain: "clean", alts: ["Tweedy", "UK 45", "UK 800"] }]), /4 alternatives/],
    [mini([{ name: "Plate", chain: "clean", alts: ["Plate L"] }]), /alternative "Plate L": no such effect/],
    [mini([{ name: "Dark DLX", chain: "nope", alts: [] }]), /no chain "nope"/],
    [mini([{ name: "Dark DLX", chain: "clean", alts: [] }], { notTested: { "Dark DLX": "x" } }), /both tested and not tested/],
    [mini([{ name: "Dark Twin", chain: "clean", alts: [] }]), /Dark Twin": no such effect/], // the same effect on both pedals: nothing to test
    [{ ...mini([]), chains: { x: { AMP: "UK GRN 4x12" } } }, /isn't a GP-200 AMP effect/],
    [mini([{ name: "Plate", chain: "clean", alts: [] }]), /nothing to hear it against/],
  ];
  for (const [c, why] of bad) assert.throws(() => resolveChoices(c, map), why);
});

test("sound tests: a bank is A at its defaults, then B-D at what a copy carries, the chain the same, the rest off", () => {
  const { r, t, e } = one("Dark DLX", ["Tweedy"]);
  const bank = buildBank(t, e, r.chains, map);
  assert.deepEqual(bank.map((p) => p.name), ["A Dark DLX", "B Dark Twin", "C Tweedy", EMPTY_NAME]);
  assert.equal(bank[3].empty, true);
  const a = mod(bank[0].prst, "AMP");
  assert.equal(a.code, Number(code("gp200", "Dark DLX")));
  for (const c of map.gp200[code("gp200", "Dark DLX")].controls) assert.equal(a.values[c.pos], Math.fround(c.def), c.name);
  // Every patch: the clean chain's cab, the volume pedal, nothing else on.
  for (const p of bank.slice(0, 3)) {
    const on = readGp200(p.prst).modules.filter((m) => m.on).map((m) => m.module);
    assert.deepEqual(on, ["AMP", "CAB", "VOL"], p.name);
    assert.equal(mod(p.prst, "CAB").code, Number(code("gp50", "Dark Twin 2x12")));
  }
  // Tweedy (Gain, Tone, Volume) by name from Dark DLX (Gain, Volume, Bass,
  // Treble): Gain and Volume carried, Bass and Treble lost, Tone at its default.
  assert.deepEqual(bank[2].dropped, ["Bass", "Treble"]);
  assert.deepEqual(bank[2].defaulted, ["Tone 50"]);
  // B is what the real converter makes of A.
  assert.equal(checkPick({ bank: "32", patches: bank }, map), null);
});

test("sound tests: the current pick carries the map's hand pairings; the others pair by name only", () => {
  // Saturate -> Boost: the map pairs Saturation with Gain (journal 2026-11-26, candidate 1).
  const { e } = one("Saturate", ["B-Boost"], "clean", "PRE");
  const sat = map.gp200[e.a].controls.find((c) => c.name === "Saturation");
  const boost = carried(e.a, code("gp50", "Boost"), true, map);
  const gain = map.gp200[code("gp50", "Boost")].controls.find((c) => c.name === "Gain");
  assert.equal(boost.values[gain.pos], sat.def);
  const bb = carried(e.a, code("gp50", "B-Boost"), false, map);
  const bbGain = map.gp200[code("gp50", "B-Boost")].controls.find((c) => c.name === "Gain");
  assert.equal(bb.values[bbGain.pos], bbGain.def, "no Saturation -> Gain by name");
  assert.ok(bb.dropped.includes("Saturation"));
});

test("sound tests: a cab's cut filters at their off ends aren't listed as lost; one that is set would be", () => {
  const a = code("gp200", "SUP ZEP"), to = code("gp50", "Dark VIT 1x12");
  assert.deepEqual(carried(a, to, false, map).dropped, []);
  const m = clone(map);
  m.gp200[a].controls.find((c) => c.name === "Low Cut").def = 120;
  assert.deepEqual(carried(a, to, false, m).dropped, ["Low Cut"]);
});

test("sound tests: an alternative from another module sits in its own; the tested module is then off", () => {
  // Ring Mod (PRE) against Ring Echo (DLY).
  const { r, t, e } = one("Ring Mod", ["Ring Echo"], "clean", "SPECIAL");
  const bank = buildBank(t, e, r.chains, map);
  assert.equal(bank[0].module, "PRE");
  assert.equal(bank[1].module, "DLY");
  assert.equal(mod(bank[1].prst, "PRE").on, false);
  assert.equal(mod(bank[1].prst, "DLY").code, Number(code("gp50", "Ring Echo")));
});

test("sound tests: B checked against the converter, and the check fails when B's settings differ", () => {
  const { r, t, e } = one("UK 50", []);
  const bank = buildBank(t, e, r.chains, map);
  assert.equal(checkPick({ bank: "32", patches: bank }, map), null);
  const p = readGp200(bank[1].prst);
  p.modules.find((m) => m.module === "AMP").values[0] += 1;
  bank[1] = { ...bank[1], prst: writeGp200(p) };
  assert.match(checkPick({ bank: "32", patches: bank }, map).problem, /aren't what the converter carries/);
});

test("sound tests: splitting into zips that fit, as even as possible", () => {
  assert.deepEqual(splitSizes(39, 33), [20, 19]);
  assert.deepEqual(splitSizes(49, 33), [25, 24]);
  assert.deepEqual(splitSizes(33, 33), [33]);
  assert.deepEqual(splitSizes(34, 33), [17, 17]);
  assert.deepEqual(splitSizes(1, 1), [1]);
  assert.throws(() => splitSizes(3, 0), /no room/);
});

test("sound tests: every zip, as Restore reads it from 32-A, holds what was built; the check catches a swap, an extra module, a wrong start", async () => {
  const r = resolveChoices(choices, map);
  const zips = planZips(r, map, START);
  assert.deepEqual(zips.map((z) => z.base), ["01_AMP-1", "02_AMP-2", "03_CAB-1", "04_CAB-2", "05_MOD", "06_PRE", "07_DST", "08_DLY", "09_RVB", "10_WAH", "11_NR", "12_SPECIAL"]);
  for (const z of zips) {
    assert.ok(z.banks.length <= 33, z.base);
    const v = await verifyZip(createZip(z.files), z, START, map);
    assert.deepEqual(v.problems, [], z.base);
    assert.equal(v.checked.files, z.banks.length * 4, `${z.base}: every file checked`);
    assert.ok(v.checked.modules > 0);
  }
  assert.throws(() => planZips(r, map, labelToSlot("32-B")), /starts on an A patch/);

  const z = zips.find((x) => x.base === "11_NR");
  assert.deepEqual(z.files.map((f) => f.name), ["32A_A Gate 2.prst", "32B_B Gate.prst", `32C_${EMPTY_NAME}.prst`, `32D_${EMPTY_NAME}.prst`, "33A_A Gate 3.prst", "33B_B Gate.prst", `33C_${EMPTY_NAME}.prst`, `33D_${EMPTY_NAME}.prst`]);
  const swapped = [...z.files];
  [swapped[0], swapped[1]] = [{ ...swapped[0], data: swapped[1].data }, { ...swapped[1], data: swapped[0].data }];
  assert.match((await verifyZip(createZip(swapped), z, START, map)).problems.join("\n"), /32A_A Gate 2\.prst: not the patch built/);
  const extra = readGp200(z.files[1].data);
  extra.modules.find((m) => m.module === "RVB").on = true;
  const zx = { ...z, banks: z.banks.map((b, i) => (i ? b : { ...b, patches: b.patches.map((p, k) => (k === 1 ? { ...p, prst: writeGp200(extra) } : p)) })) };
  assert.match((await verifyZip(createZip(z.files), zx, START, map)).problems.join("\n"), /32B RVB: should be off/);
  assert.match((await verifyZip(createZip(z.files), z, START + 4, map)).problems.join("\n"), /goes to 33A, built for 32A/);
  assert.match(sheet(z, map), /"32","Gate 2 \(NR\)","Gate \(GP-200: Gate 1\) \[map's pick\]","\(empty\)"/);
});

function session(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sound-tests-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const printed = [];
  return { dir, printed, run: (args, opts = {}) => main(args, { print: (l) => printed.push(l), ...opts }) };
}

test("sound-tests tool: writes the zips, sheets, read-me and log, and passes; wrong commands refused (exit 2)", async (t) => {
  const s = session(t);
  assert.equal(await s.run(["--out", s.dir]), 0, s.printed.join("\n"));
  assert.match(s.printed.at(-1), /^Sound tests: 12 zips, 162 tests; checked 648 files, \d+ modules as Restore reads them from 32A; 0 problem\(s\)\. PASSED$/);
  const names = readdirSync(s.dir);
  for (const n of ["00_READ ME.txt", "01_AMP-1.zip", "01_AMP-1.csv", "12_SPECIAL.zip", "log"]) assert.ok(names.includes(n), n);
  const me = readFileSync(path.join(s.dir, "00_READ ME.txt"), "utf8");
  assert.match(me, /01_AMP-1\.zip {2}20 tests, 32-A to 51-D \(part 1 of 2\)/);
  assert.match(me, /Hyper EQ: At its defaults/);
  assert.match(me, /Plate: the map's pick, the GP-50's Plate, isn't on the GP-200/);
  assert.match(readFileSync(path.join(s.dir, "log", readdirSync(path.join(s.dir, "log"))[0]), "utf8"), /Node v.*\n[\s\S]*01_AMP-1\.zip: 20 banks/);

  for (const [args, why] of [[[], /usage/], [["--out", path.join(s.dir, "nope")], /usage/], [["--out", s.dir, "--start", "99-Z"], /--start 99-Z/], [["--out", s.dir, "--start", "32-B"], /start on an A patch/], [["--out", s.dir, "--bogus"], /usage/]]) {
    s.printed.length = 0;
    assert.equal(await s.run(args), 2, args.join(" "));
    assert.match(s.printed.join("\n"), why, args.join(" "));
  }
});

test("sound-tests tool: an effect left out of the choices fails the run (exit 1); choices that don't fit the map, exit 2", async (t) => {
  const s = session(t);
  const c = clone(choices);
  c.tests[0].effects = c.tests[0].effects.filter((e) => e.name !== "Dark DLX");
  const f = path.join(s.dir, "choices.json");
  writeFileSync(f, JSON.stringify(c));
  assert.equal(await s.run(["--out", s.dir], { choicesFile: f }), 1);
  assert.match(s.printed.join("\n"), /not in the tests or "notTested": Dark DLX[\s\S]*FAILED/);
  c.tests[0].effects.push({ name: "Nope", chain: "clean", alts: [] });
  writeFileSync(f, JSON.stringify(c));
  s.printed.length = 0;
  assert.equal(await s.run(["--out", s.dir], { choicesFile: f }), 2);
  assert.match(s.printed.join("\n"), /don't fit the map: .*"Nope": no such effect/);
});
