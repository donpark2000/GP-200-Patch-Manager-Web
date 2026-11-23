// The GP-50 command-line runner (gp50/cli/) and restore.js. Always the fake
// pedal, and a stand-in for the Windows MIDI helper; files go to temp folders.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { slotFileName } from "../gp50/backup.js";
import { ANY_PATCH, shifted } from "../gp50/cli/commands.js";
import { main } from "../gp50/cli/run.js";
import { connect, SysexStream } from "../gp50/cli/winmm.js";
import { FakeGp50 } from "../gp50/fake-gp50.js";
import { buildPrst, buildRead, parseFrame, READS, toHex } from "../gp50/protocol.js";
import { fileKind, fileProblem, orderPatches, planRestore, writePatches } from "../gp50/restore.js";
import { buildPatchWrite, WriteGate } from "../gp50/write-protocol.js";
import { Gp50Writer } from "../gp50/writer.js";
import { Logger } from "../src/core/log.js";
import { readZip } from "../src/core/unzip.js";
import { createZip } from "../src/core/zip.js";

const FAST = { timeoutMs: 100, settleMs: 0, quietMs: 20, ackTimeoutMs: 100, frameGapMs: 0, writeSettleMs: 0 };
const source = (f) => readFileSync(new URL(`../gp50/${f}`, import.meta.url), "utf8");
const GP200 = readFileSync(new URL("fixtures/skeleton.prst", import.meta.url));

const contents = (pedal) => pedal.names.map((n, i) => buildPrst(n, pedal.bodies[i]));
const hexAll = (patches) => patches.map((p) => toHex(p));
const writesSent = (pedal) => pedal.sent.map((m) => parseFrame(m)).filter((f) => f.total === 29);
const starts = (pedal) => writesSent(pedal).filter((f) => f.index === 0).map((f) => f.payload[2]);

/** A temp session folder holding the pedal's contents as reference.zip, and a runner for it. */
function setup(t, opts) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gp50-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pedal = new FakeGp50({ writable: true, later: setImmediate, ...opts });
  const reference = contents(pedal);
  const zip = path.join(dir, "reference.zip");
  writeFileSync(zip, createZip(reference.map((data, i) => ({ name: slotFileName(i, pedal.names[i]), data }))));
  const s = { dir, pedal, reference, zip, printed: [], opened: 0, closed: 0 };
  s.run = (...args) => main(args, {
    timing: FAST,
    print: (line) => s.printed.push(line),
    isCancelled: s.isCancelled,
    open: async () => {
      s.opened++;
      return { input: pedal.input, output: pedal.output, close: async () => { s.closed++; } };
    },
  });
  s.file = (name, data) => {
    writeFileSync(path.join(dir, name), data);
    return path.join(dir, name);
  };
  s.saved = (pattern) => readdirSync(dir).filter((f) => pattern.test(f));
  s.text = () => s.printed.join("\n");
  return s;
}

test("gp50 file kind: told by the contents; the other pedal's and damaged files are refused with the reason", () => {
  const good = buildPrst("Mine", new Array(511).fill(7));
  assert.deepEqual([fileKind(good), fileKind(GP200), fileKind(new Uint8Array(3)), fileKind(Buffer.from("GP-500xx"))], ["GP-50", "GP-200", null, null]);
  assert.equal(fileProblem(good), null);
  assert.match(fileProblem(GP200), /GP-200 patch, and the pedal is a GP-50/);
  assert.match(fileProblem(new Uint8Array(552)), /not a GP-50 patch/);
  assert.match(fileProblem(good.slice(0, 551)), /551 bytes/);
  assert.match(fileProblem(good.with(100, 1)), /Damaged/);
});

test("gp50 restore plan: ordered by number if every file has one, else by name; unusable files keep their place", async () => {
  const p = (n) => buildPrst(n, new Array(511).fill(1));
  const f = (name) => ({ name, data: p(name.slice(0, 8)) });
  assert.deepEqual(orderPatches([f("10-B.prst"), f("02-C.prst"), f("07_A.prst")]).ordered.map((e) => e.name), ["02-C.prst", "07_A.prst", "10-B.prst"]);
  const named = orderPatches([f("zed.prst"), f("10-B.prst"), f("Alpha.prst")]);
  assert.deepEqual(named.ordered.map((e) => e.name), ["10-B.prst", "Alpha.prst", "zed.prst"]);
  assert.match(named.orderedBy, /file name/);
  const plan = await planRestore([f("03-c.prst"), { name: "02-x.prst", data: new Uint8Array(GP200) }, f("01-a.prst"), f("04-d.prst")], 97);
  assert.deepEqual(plan.items.map((i) => [i.fileName, i.slot]), [["01-a.prst", 97], ["03-c.prst", 99]]);
  assert.deepEqual(plan.skipped.map((i) => [i.fileName, i.slot]), [["02-x.prst", 98]]);
  assert.match(plan.skipped[0].reason, /patch 98 is left unchanged/);
  assert.deepEqual(plan.overflow, ["04-d.prst"]);
  for (const bad of [-1, 100, 1.5, NaN, undefined]) await assert.rejects(planRestore([f("a.prst")], bad), /isn't a patch/);
});

test("gp50 runner safety: only the runner's range opens every patch; never outside 0-99, never in the pages", () => {
  const prst = buildPrst("x", new Array(511).fill(0));
  for (let s = 0; s <= 99; s++) assert.equal(buildPatchWrite(s, prst, ANY_PATCH).length, 29);
  for (const s of [-1, 100, 256, 1.5, "5", null, NaN]) {
    assert.throws(() => buildPatchWrite(s, prst, { first: -1000, last: 1000 }), /Refused/, `${s}`);
    assert.throws(() => new WriteGate(s, prst, ANY_PATCH), /Refused/, `${s}`);
  }
  assert.throws(() => buildPatchWrite(54, prst), /Refused/);
  assert.equal(new Gp50Writer({}, {}, new Logger()).range.first, 55);
  for (const f of ["write-page.js", "page.js", "page-common.js", "write.html", "index.html"]) assert.doesNotMatch(source(f), /cli\/|range|ANY_PATCH/, f);
});

test("gp50 helper: opens only GP-50, sends only SysEx, and resets nothing", () => {
  const py = source("cli/midi_bridge.py");
  assert.match(py, /"gp50": \("GP-50", lambda name: re\.search\(r"GP-50\(\?!\\d\)", name, re\.I\)\)/, "as isGp50Name");
  assert.match(py, /^PEDAL = "gp50"$/m, "the GP-50 unless --pedal says otherwise");
  assert.match(source("device.js"), /\/GP-50\(\?!\\d\)\/i/);
  assert.doesNotMatch(py, /midiOutReset\(|midiOutReset"|midiOutShortMsg/);
  assert.equal(py.split("mm.midiOutLongMsg(").length - 1, 1);
  for (const f of ["cli/run.js", "cli/commands.js", "restore.js"]) assert.doesNotMatch(source(f), /\.send\(/, f);
});

test("gp50 runner: wrong commands and options are refused before the port is opened", async (t) => {
  const s = setup(t);
  const cases = [
    [[], /Commands:/], [["format", "--out", s.dir], /Commands:/], [["info"], /--out/], [["info", "--out", path.join(s.dir, "no")], /--out/],
    [["check", "--out", s.dir], /--reference/], [["roundtrip", "--out", s.dir, "--reference", s.zip], /add --write/],
    [["restore", s.zip, "--out", s.dir, "--reference", s.zip, "--start", "0"], /add --write/],
    [["restore", s.zip, "--out", s.dir, "--reference", s.zip, "--write"], /--start/],
    [["restore", "--out", s.dir, "--reference", s.zip, "--write", "--start", "0"], /needs files/],
    [["check", "--out", s.dir, "--reference", s.zip, "--shift", "100"], /more than 99/],
    [["check", "--out", s.dir, "--reference", s.zip, "--shift", "-1"], /shift/],
    [["check", "--out", s.dir, "--reference", s.file("bad.zip", "no zip")], /./],
    [["backup", "--out", s.dir, "--nonsense"], /nonsense/i],
  ];
  for (const [args, why] of cases) {
    s.printed.length = 0;
    assert.equal(await s.run(...args), 1, args.join(" "));
    assert.match(s.text(), why, args.join(" "));
  }
  assert.deepEqual([s.opened, s.pedal.sent.length, s.saved(/\.log$/)], [0, 0, []]);
});

test("gp50 runner: backup of all, a range and one patch; an incomplete one is named so and fails", async (t) => {
  const s = setup(t);
  assert.equal(await s.run("backup", "--out", s.dir), 0);
  const [all] = s.saved(/^gp50_all_.*\.zip$/);
  assert.deepEqual(hexAll([...(await readZip(readFileSync(path.join(s.dir, all)))).values()]), hexAll(s.reference));
  assert.equal(await s.run("backup", "--out", s.dir, "--from", "10", "--to", "12"), 0);
  const [range] = s.saved(/^gp50_10_to_12_.*\.zip$/);
  assert.deepEqual([...(await readZip(readFileSync(path.join(s.dir, range)))).keys()], ["10-Fake 10.prst", "11-Fake 11.prst", "12-Fake 12.prst"]);
  assert.equal(await s.run("backup", "--out", s.dir, "--from", "99", "--to", "99"), 0);
  assert.equal(toHex(readFileSync(path.join(s.dir, "99-Fake 99.prst"))), toHex(s.reference[99]));
  assert.equal(await s.run("backup", "--out", s.dir, "--from", "12", "--to", "10"), 1);
  assert.equal(await s.run("backup", "--out", s.dir, "--from", "0", "--to", "100"), 1);
  s.pedal.faults = (f, fn, args) => (fn === 0x4f && args[0] === 11 ? [] : f);
  assert.equal(await s.run("backup", "--out", s.dir, "--from", "10", "--to", "12"), 1);
  assert.equal(s.saved(/INCOMPLETE/).length, 1);
  assert.deepEqual([s.opened, s.closed, writesSent(s.pedal).length], [6, 6, 0]);
  const log = readFileSync(path.join(s.dir, s.saved(/^gp50_backup.*\.log$/)[0]), "utf8");
  assert.match(log, /DEBUG TX f0/);
  assert.match(log, /Firmware 1\.1\.0, on patch 2/);
  assert.doesNotMatch(s.text(), /DEBUG/);
});

test("gp50 runner: check passes on the reference, fails on one changed byte or a moved pedal", async (t) => {
  const s = setup(t);
  const check = (...more) => s.run("check", "--out", s.dir, "--reference", s.zip, ...more);
  assert.equal(await check(), 0);
  assert.equal(await check("--shift", "1"), 1);
  s.pedal.bodies[41] = s.pedal.bodies[41].with(300, s.pedal.bodies[41][300] ^ 1);
  assert.equal(await check(), 1);
  assert.match(s.text(), /DIFFERENT\. 100 of 100 compared, 99 identical.*differ: 41/);
  assert.equal(writesSent(s.pedal).length, 0);
});

test("gp50 runner: restore one patch and a range; only those change", async (t) => {
  const s = setup(t);
  const restore = (...a) => s.run("restore", ...a, "--out", s.dir, "--reference", s.zip, "--write");
  assert.equal(await restore(s.file("07-Fake 07.prst", s.reference[7]), "--start", "3"), 0);
  assert.deepEqual(hexAll(contents(s.pedal)), hexAll(s.reference.with(3, s.reference[7])));
  const some = s.file("some.zip", createZip([20, 21, 22].map((n) => ({ name: slotFileName(n, `Fake ${n}`), data: s.reference[n] }))));
  assert.equal(await restore(some, "--start", "2"), 0);
  const want = [...s.reference];
  want.splice(2, 3, ...s.reference.slice(20, 23));
  assert.deepEqual(hexAll(contents(s.pedal)), hexAll(want));
  assert.deepEqual(s.pedal.stored, [3, 2, 3, 4]);
  assert.match(s.text(), /3 of 3 written and read back identical/);
});

test("gp50 runner: a GP-200, damaged or overflowing file stops a restore before anything is written", async (t) => {
  const s = setup(t);
  const restore = (start, ...a) => s.run("restore", ...a, "--start", start, "--out", s.dir, "--reference", s.zip, "--write");
  const good = s.file("01-a.prst", s.reference[1]);
  assert.equal(await restore("10", good, s.file("02-b.prst", GP200)), 1);
  assert.match(s.text(), /02-b\.prst: this is a GP-200 patch/);
  assert.equal(await restore("10", good, s.file("03-c.prst", s.reference[3].with(60, 99))), 1);
  assert.equal(await restore("99", good, s.file("04-d.prst", s.reference[4])), 1);
  assert.match(s.text(), /04-d\.prst: doesn't fit/);
  assert.equal(await restore("100", good), 1);
  assert.equal(writesSent(s.pedal).length, 0);
});

test("gp50 runner: a patch that isn't in the reference is never overwritten", async (t) => {
  const s = setup(t);
  s.pedal.names[4] = "My own";
  assert.equal(await s.run("restore", s.zip, "--start", "0", "--out", s.dir, "--reference", s.zip, "--write"), 1);
  assert.match(s.text(), /Slot 4 holds "My own"/);
  assert.deepEqual(s.pedal.stored, [0, 1, 2, 3]);
});

test("gp50 runner: round trips, every step checked over all 100; a write that did nothing fails it", async (t) => {
  const s = setup(t);
  let midway = null;
  const store = s.pedal._store.bind(s.pedal);
  s.pedal._store = (slot, data) => {
    store(slot, data);
    if (s.pedal.stored.length === 100) midway = contents(s.pedal);
  };
  const trip = (...a) => s.run("roundtrip", "--out", s.dir, "--reference", s.zip, "--write", ...a);
  assert.equal(await trip("--times", "2"), 0);
  assert.equal(starts(s.pedal).length, 400);
  assert.deepEqual(hexAll(midway), hexAll([s.reference[99], ...s.reference.slice(0, 99)]));
  assert.deepEqual(hexAll(contents(s.pedal)), hexAll(s.reference));
  assert.match(s.text(), /100 of 100 patches get different contents/);
  assert.deepEqual(hexAll(shifted(s.reference, 45)).indexOf(toHex(s.reference[0])), 45);
  assert.equal(await trip("--times", "0"), 1, "no round trip isn't a passed one");

  // The pedal acknowledges but doesn't store.
  s.pedal._store = () => {};
  assert.equal(await trip(), 1);
  assert.match(s.text(), /Slot 0 read back different/);
});

test("gp50 runner: stopping finishes the patch being written, and fails the run", async (t) => {
  const s = setup(t);
  s.isCancelled = () => s.pedal.stored.length >= 3;
  assert.equal(await s.run("roundtrip", "--out", s.dir, "--reference", s.zip, "--write"), 1);
  assert.deepEqual(s.pedal.stored, [0, 1, 2]);
  assert.equal(s.closed, 1);
});

test("gp50 selected patch: the pages ask before every patch, the runner only before the first and after the last", async (t) => {
  const asked = (pedal) => pedal.sent.filter((m) => toHex(m) === toHex(buildRead(READS.slot))).length;
  const items = [5, 6, 7].map((slot) => ({ slot, prst: buildPrst(`n${slot}`, new Array(511).fill(slot)) }));

  // The pages' way (the default): asked 3 times, plus once after.
  const pedal = new FakeGp50({ writable: true, later: setImmediate });
  const seen = [];
  const writer = new Gp50Writer(pedal.input, pedal.output, new Logger(), { ...FAST, range: ANY_PATCH });
  const r = await writePatches(writer, items, { log: new Logger(), confirmed: true, guard: (f) => seen.push(f.selected), onProgress: () => { pedal.slot = 60; } });
  assert.equal(r.problem, null);
  assert.equal(asked(pedal), 4);
  assert.deepEqual(seen, [2, 60, 60], "a selection changed mid-run reaches the guard");

  // The runner: 1 at connecting, 1 before the first, 1 after the last.
  const s = setup(t);
  const some = s.file("some.zip", createZip([20, 21, 22, 23].map((n) => ({ name: slotFileName(n, `Fake ${n}`), data: s.reference[n] }))));
  s.pedal.later = (fn) => { if (s.pedal.stored.length === 2) s.pedal.slot = 9; setImmediate(fn); };
  assert.equal(await s.run("restore", some, "--start", "0", "--out", s.dir, "--reference", s.zip, "--write"), 0);
  assert.equal(asked(s.pedal), 3);
  assert.match(s.text(), /4 of 4 written and read back identical.*selected 2 before, 9 after/);
});

test("gp50 runner: a slow acknowledgement is waited for, and logged", async () => {
  const pedal = new FakeGp50({ writable: true, later: setImmediate });
  const log = new Logger();
  const writer = new Gp50Writer(pedal.input, pedal.output, log, { ...FAST, range: ANY_PATCH, ackTimeoutMs: 2000 });
  let n = 0;
  pedal.later = (fn) => (++n === 5 ? setTimeout(fn, 260) : setImmediate(fn));
  const r = await writer.writeSlotPatch(3, buildPrst("x", new Array(511).fill(9)), { confirmed: true });
  assert.ok(r.slowestAckMs >= 250, `${r.slowestAckMs}`);
  assert.match(log.text(), /Slow acknowledgement: slot 3, frame 5 of 29/);
});

test("gp50 SysEx stream: messages cut or joined by Windows come out whole; strays are reported", () => {
  const got = [];
  const stray = [];
  const s = new SysexStream((m) => got.push(toHex(m)), (b) => stray.push(toHex(b)));
  s.push([0xf0, 1, 2]);
  s.push([3, 0xf7, 0xf0, 4, 0xf7]);
  assert.deepEqual([got, stray], [["f0 01 02 03 f7", "f0 04 f7"], []]);
  s.push([9, 0xf0, 5, 0xf0, 6, 0xf7]);
  assert.deepEqual([got.slice(2), stray], [["f0 06 f7"], ["09", "f0 05"]]);
});

// A helper standing in for midi_bridge.py: answers every tx with the same
// message, one byte changed, cut in two.
const helper = (script) => ({ command: [process.execPath, "-e", script] });
const ECHO = `
  const rl = require("readline").createInterface({ input: process.stdin });
  console.log('ports {"in":["GP-50"],"out":["GP-50"]}');
  console.log("ready GP-50 | GP-50");
  rl.on("line", (l) => {
    if (l === "close") process.exit(0);
    const h = l.slice(3);
    if (h === "f07ff7") { console.log("fatal Windows closed the port"); process.exit(1); }
    console.log("sent 60.0"); console.log("rx 12 " + h.slice(0, 4)); console.log("rx 13 " + h.slice(4));
  });`;

test("gp50 helper connection: both ways, closing, losing the port, and failing to open", async () => {
  const log = new Logger();
  log.debugEnabled = true;
  let gone = null;
  const c = await connect(log, { ...helper(ECHO), onGone: (why) => { gone = why; } });
  assert.deepEqual([c.input.name, c.output.name, c.ports], ["GP-50", "GP-50", { in: ["GP-50"], out: ["GP-50"] }]);
  const answer = new Promise((resolve) => { c.input.onmidimessage = (e) => resolve(toHex(e.data)); });
  c.output.send([0xf0, 1, 2, 0xf7]);
  assert.equal(await answer, "f0 01 02 f7");
  assert.match(log.text(), /Windows took 60\.0 ms/);
  await c.close();
  assert.throws(() => c.output.send([0xf0, 0xf7]), /closed/);
  assert.equal(gone, null, "closing isn't losing");

  const d = await connect(log, { ...helper(ECHO), onGone: (why) => { gone = why; } });
  d.output.send([0xf0, 0x7f, 0xf7]);
  await d.close().catch(() => {});
  const lost = await connect(log, { ...helper(ECHO), onGone: (why) => { gone = why; } });
  lost.output.send([0xf0, 0x7f, 0xf7]);
  for (let i = 0; !gone && i < 500; i++) await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(gone, "Windows closed the port");
  assert.throws(() => lost.output.send([0xf0, 0xf7]), /Windows closed the port/);

  await assert.rejects(connect(log, helper('console.log("fatal 0 MIDI input ports are named GP-50")')), /0 MIDI input ports/);
  await assert.rejects(connect(log, helper('throw new Error("boom")')), /./);
  await assert.rejects(connect(log, { command: ["no-such-program-gp50"] }), /couldn't be started/);
});

test("gp50 runner: a patch started again is reported; a stopped restore fails; a name not as in the list makes a backup incomplete", async (t) => {
  let s = setup(t);
  let once = true;
  s.pedal.ackFaults = (acks, i, slot) => (slot === 5 && i === 9 && once ? ((once = false), []) : acks);
  assert.equal(await s.run("restore", s.zip, "--start", "0", "--out", s.dir, "--reference", s.zip, "--write"), 0);
  assert.match(s.text(), /100 of 100 written and read back identical, [\d.]+ s; 1 started again \(5\)/);

  s = setup(t);
  s.isCancelled = () => s.pedal.stored.length >= 2;
  assert.equal(await s.run("restore", s.zip, "--start", "0", "--out", s.dir, "--reference", s.zip, "--write"), 1);
  assert.deepEqual(s.pedal.stored, [0, 1]);

  s = setup(t);
  const answer = s.pedal._answer.bind(s.pedal);
  s.pedal._answer = (fn, args) => {
    const data = answer(fn, args);
    return fn === 0x40 ? data.with(4 + 20 * 11, "X".charCodeAt(0)) : data;
  };
  assert.equal(await s.run("backup", "--out", s.dir, "--from", "10", "--to", "12"), 1);
  assert.match(s.text(), /Slot 11 came back as "Fake 11", the list says "Xake 11"/);
});

test("gp50 runner: damage to another patch, in either half of a round trip, fails it", async (t) => {
  for (const half of [1, 2]) {
    const s = setup(t);
    const store = s.pedal._store.bind(s.pedal);
    s.pedal._store = (slot, data) => {
      store(slot, data);
      const n = s.pedal.stored.length;
      if (slot === 60 && (half === 1 ? n <= 100 : n > 100)) s.pedal.bodies[59] = s.pedal.bodies[59].with(9, 0x55);
    };
    assert.equal(await s.run("roundtrip", "--out", s.dir, "--reference", s.zip, "--write"), 1, `half ${half}`);
    assert.match(s.text(), new RegExp(`Check "${half === 1 ? "all moved by 1" : "as the reference, after"}": DIFFERENT.*differ: 59`), `half ${half}`);
  }
});
