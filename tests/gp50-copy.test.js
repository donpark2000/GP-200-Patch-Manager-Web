// Copying between the pedals from the command line (gp50/cli/copy.js, the
// runner's copy and convert): the GP-200 is only ever read, the converted
// patches land on the (fake) GP-50, and every run leaves its sheet. Temp
// folders only.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { slotFileName } from "../gp50/backup.js";
import { isGp200Read, readOnly } from "../gp50/cli/copy.js";
import { freeTag, main } from "../gp50/cli/run.js";
import { gp200ToGp50, gp50EmptyPrst, readGp200, readGp50, writeGp50 } from "../gp50/convert.js";
import { FakeGp50 } from "../gp50/fake-gp50.js";
import { buildPrst, toHex } from "../gp50/protocol.js";
import { buildEnterEditorMode, buildIdentityQuery, buildPresetChange, buildReadRequest, buildUploadChunks, buildUploadImage } from "../src/core/sysex.js";
import { readZip } from "../src/core/unzip.js";
import { createZip } from "../src/core/zip.js";
import { baseDump, dumpWithName, fixtureBytes } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

const FAST = { gp200TimeoutMs: 100, timeoutMs: 100, settleMs: 0, quietMs: 20, ackTimeoutMs: 100, frameGapMs: 0, writeSettleMs: 0 };
const map = JSON.parse(readFileSync(new URL("../gp50/effect-map.json", import.meta.url), "utf8"));
const gp50Contents = (pedal) => pedal.names.map((n, i) => buildPrst(n, pedal.bodies[i]));

function setup(t, gp200Opts = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gp50-copy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gp50 = new FakeGp50({ writable: true, later: setImmediate });
  const reference = gp50Contents(gp50);
  const zip = path.join(dir, "reference.zip");
  writeFileSync(zip, createZip(reference.map((data, i) => ({ name: slotFileName(i, gp50.names[i]), data }))));
  const gp200 = new FakePedal({ defaultDump: baseDump(), dumps: new Map([[0, dumpWithName("Lack of Oxygen")], [1, dumpWithName("Clean")]]), ...gp200Opts });
  const s = { dir, gp50, gp200, zip, printed: [], opened: [] };
  s.run = (...args) => main([...args, "--out", dir], {
    timing: FAST,
    print: (line) => s.printed.push(line),
    open: async (log, opts = {}) => {
      s.opened.push(opts.pedal ?? "gp50");
      const p = opts.pedal === "gp200" ? gp200 : gp50;
      return { input: p.input, output: p.output, close: async () => {} };
    },
  });
  s.saved = (re) => readdirSync(dir).filter((f) => re.test(f));
  s.text = () => s.printed.join("\n");
  return s;
}

test("GP-200 gate: reads and the identity query pass; uploads, preset changes and editor mode never reach the pedal", () => {
  assert.ok(isGp200Read(buildReadRequest(5)));
  assert.ok(isGp200Read(buildReadRequest(5, true)));
  assert.ok(isGp200Read(buildIdentityQuery()));
  const sent = [];
  const out = readOnly({ send: (m) => sent.push(m) });
  const writes = [buildEnterEditorMode(), buildPresetChange(3), buildUploadChunks(buildUploadImage(fixtureBytes("skeleton.prst"), 3))[0]];
  for (const m of writes) {
    assert.equal(isGp200Read(m), false);
    assert.throws(() => out.send(m), /Refused to send to the GP-200: not a read/);
  }
  out.send(buildReadRequest(0));
  assert.equal(sent.length, 1, "only the read went through");
  // The bridge refuses the same (midi_bridge.py gp200_read_only).
  const py = readFileSync(new URL("../gp50/cli/midi_bridge.py", import.meta.url), "utf8");
  assert.match(py, /GP200_READS = \{0x04, 0x10, 0x20\}/);
  assert.match(py, /if PEDAL == "gp200" and not gp200_allowed\(data\):/);
  assert.match(py, /GP200_PATCH_WRITES = False/, "writes only when the runner asks (gp200-restore)");
});

test("copy: GP-200 1-A to 1-B read (reads only), converted, written to GP-50 55-56, and saved with a sheet", async (t) => {
  const s = setup(t);
  const code = await s.run("copy", "--from", "1-A", "--to", "1-B", "--start", "55", "--reference", s.zip, "--write");
  assert.equal(code, 0, s.text());
  assert.deepEqual(s.opened, ["gp200", "gp50"], "the GP-200 is read and closed before the GP-50 opens");
  assert.ok(s.gp200.sent.length > 0 && s.gp200.sent.every((m) => isGp200Read(m)), "nothing but reads went to the GP-200");
  assert.equal(s.gp200.writes.size, 0);
  assert.equal(s.gp200.editorMode, false);
  // On the GP-50: the converted patches, as saved.
  const [conv] = s.saved(/^gp50_converted_copy_.*\.zip$/);
  const files = [...(await readZip(readFileSync(path.join(s.dir, conv))))];
  assert.deepEqual(files.map(([n]) => n), ["55-LackOxygen.prst", "56-Clean.prst"]);
  const now = gp50Contents(s.gp50);
  assert.equal(toHex(now[55]), toHex(files[0][1]));
  assert.equal(toHex(now[56]), toHex(files[1][1]));
  assert.equal(s.gp50.names[54], "Fake 54", "nothing else written");
  // The same as converting the GP-200 originals saved beside them.
  const [src] = s.saved(/^gp200_source_copy_.*\.zip$/);
  const originals = [...(await readZip(readFileSync(path.join(s.dir, src))))];
  assert.equal(readGp200(originals[0][1]).name, "Lack of Oxygen");
  assert.equal(toHex(gp200ToGp50(originals[0][1], map).prst), toHex(files[0][1]));
  const [csv] = s.saved(/^listening_copy_.*\.csv$/);
  const rows = readFileSync(path.join(s.dir, csv), "utf8").trim().split("\r\n");
  assert.equal(rows.length, 3);
  assert.match(rows[0], /"Pair","Source file","GP-50 patch","Name there","What changed","Verdict \(same \/ close \/ off\)","Comment"/);
  assert.match(rows[1], /^"1","1A_Lack of Oxygen.prst","55","LackOxygen","Name shortened: ""Lack of Oxygen"" -> ""LackOxygen""/);
});

test("copy: a GP-200 patch that can't be read stops it before any GP-50 write", async (t) => {
  const s = setup(t, { faults: (slot, n, chunks) => (slot === 1 ? chunks.slice(1) : chunks) });
  const before = gp50Contents(s.gp50).map(toHex);
  const code = await s.run("copy", "--from", "1-A", "--to", "1-B", "--start", "55", "--reference", s.zip, "--write");
  assert.equal(code, 1);
  assert.match(s.text(), /Nothing written: 1 of 2 GP-200 patches read \(couldn't read 1B\)/);
  assert.deepEqual(s.opened, ["gp200"], "the GP-50 is never opened");
  assert.deepEqual(gp50Contents(s.gp50).map(toHex), before);
});

test("copy: refused before any pedal is opened when the range doesn't fit or --write is missing", async (t) => {
  const s = setup(t);
  assert.equal(await s.run("copy", "--from", "1-A", "--to", "2-A", "--start", "96", "--reference", s.zip, "--write"), 1);
  assert.match(s.text(), /5 patches from 96 don't fit before GP-50 patch 99/);
  assert.equal(await s.run("copy", "--from", "1-A", "--to", "1-B", "--start", "55", "--reference", s.zip), 1);
  assert.match(s.text(), /"copy" writes to the pedal; add --write/);
  assert.deepEqual(s.opened, []);
});

test("convert: GP-50 patches to a GP-200 zip numbered from 50-B, no pedal opened; a bad file is refused with why", async (t) => {
  const s = setup(t);
  const zip = path.join(s.dir, "gp50_some.zip");
  // Real-shaped GP-50 patches (the fake pedal's bodies are only numbers, and the converter refuses them).
  const patch = (name) => { const p = readGp50(gp50EmptyPrst()); p.name = name; return writeGp50(p); };
  writeFileSync(zip, createZip([{ name: "01-Fake 01.prst", data: patch("Fake 01") }, { name: "00-Fake 00.prst", data: patch("Fake 00") }]));
  assert.equal(await s.run("convert", zip, "--start", "50-B"), 0, s.text());
  assert.deepEqual(s.opened, []);
  const [conv] = s.saved(/^gp200_converted_convert_.*\.zip$/);
  const files = [...(await readZip(readFileSync(path.join(s.dir, conv))))].map(([n]) => n);
  assert.deepEqual(files, ["50B_Fake 00.prst", "50C_Fake 01.prst"], "in patch order, from 50-B");
  const bad = path.join(s.dir, "junk.prst");
  writeFileSync(bad, new Uint8Array(40));
  assert.equal(await s.run("convert", bad, "--start", "55"), 1);
  assert.match(s.text(), /junk\.prst: can't be converted: not a GP-200 or GP-50 patch/);
});

test("convert: two runs in the same second keep both sheets and zips (a suffix, not an overwrite)", async (t) => {
  const s = setup(t);
  const zip = path.join(s.dir, "gp50_some.zip");
  const p = readGp50(gp50EmptyPrst());
  p.name = "Fake 00";
  writeFileSync(zip, createZip([{ name: "00-Fake 00.prst", data: writeGp50(p) }]));
  assert.equal(await s.run("convert", zip, "--start", "50-B"), 0, s.text());
  const [first] = s.saved(/^listening_convert_.*\.csv$/);
  // The second run is made to land in the same second: the first's names are taken.
  const tag = first.replace(/^listening_|\.csv$/g, "");
  assert.equal(freeTag(s.dir, tag, (x) => [`listening_${x}.csv`]), `${tag}-2`);
  assert.equal(freeTag(s.dir, `${tag}-x`, (x) => [`listening_${x}.csv`]), `${tag}-x`, "a free name is kept as it is");
  writeFileSync(path.join(s.dir, `listening_${tag}-2.csv`), "");
  assert.equal(freeTag(s.dir, tag, (x) => [`listening_${x}.csv`]), `${tag}-3`);
  assert.equal(await s.run("convert", zip, "--start", "50-B"), 0, s.text());
  assert.ok(s.saved(/^listening_convert_.*\.csv$/).length >= 2, "both sheets kept");
  assert.equal(s.saved(/^gp200_converted_convert_.*\.zip$/).length, 2, "both zips kept");
});

test("convert: two different names that come out the same are both kept, and the sheet says so", async (t) => {
  const s = setup(t);
  const { skeletonBytes } = await import("../src/core/skeleton.js");
  const { writeGp200 } = await import("../gp50/convert.js");
  const patch = (name) => { const p = readGp200(skeletonBytes()); p.name = name; return writeGp200(p); };
  const a = path.join(s.dir, "1A_one.prst"), b = path.join(s.dir, "1B_two.prst"), c = path.join(s.dir, "1C_three.prst");
  writeFileSync(a, patch("Forget the Cloud"));
  writeFileSync(b, patch("Forget the Clou"));
  writeFileSync(c, patch("Forget the Cloud"));
  assert.equal(await s.run("convert", a, b, c, "--start", "55"), 0, s.text());
  const [csv] = s.saved(/^listening_convert_.*\.csv$/);
  const rows = readFileSync(path.join(s.dir, csv), "utf8").trim().split("\r\n").slice(1);
  assert.match(rows[0], /Name ""ForgetClou"" is also what ""Forget the Clou"" \(56\) became/);
  assert.match(rows[1], /Name ""ForgetClou"" is also what ""Forget the Cloud"" \(55\), ""Forget the Cloud"" \(57\) became/);
  assert.doesNotMatch(rows[0], /\(57\)/, "the same name twice is no news");
});
