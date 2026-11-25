// The runner's GP-200 commands (gp50/cli/gp200.js): gp200-backup reads only;
// gp200-restore is the web app's restore behind a gate that lets through
// only reads, the set-up messages, and whole uploads and preset changes to
// the planned slots. Always the fake GP-200; files go to temp folders.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { patchWriteGate } from "../gp50/cli/gp200.js";
import { main } from "../gp50/cli/run.js";
import { readGp200, writeGp200 } from "../gp50/convert.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { labelToSlot } from "../src/core/slots.js";
import { buildEnterEditorMode, buildIdentityQuery, buildPresetChange, buildReadRequest, buildUploadChunks, buildUploadImage } from "../src/core/sysex.js";
import { readZip } from "../src/core/unzip.js";
import { createZip } from "../src/core/zip.js";
import { baseDump, dumpWithName } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

const S63A = labelToSlot("63-A");
const patch = (name, dstOn = false) => {
  const p = readGp200(skeletonBytes());
  p.name = name;
  p.modules[2].on = dstOn;
  return writeGp200(p);
};
const uploadTo = (slot) => buildUploadChunks(buildUploadImage(patch("X"), slot));

test("GP-200 gate: reads, set-up and whole uploads/preset changes to planned slots pass; anything else is refused", () => {
  const sent = [];
  const gate = patchWriteGate({ send: (m) => sent.push(m) }, [S63A, S63A + 1]);
  for (const m of [buildReadRequest(5), buildReadRequest(5, true), buildIdentityQuery(), buildEnterEditorMode()]) gate.send(m);
  const chunks = uploadTo(S63A);
  assert.equal(chunks.length, 7);
  for (const c of chunks) gate.send(c);
  gate.send(buildPresetChange(S63A));
  assert.equal(sent.length, 4 + 7 + 1, "all of those went through");
  const refused = (m, re) => { const n = sent.length; assert.throws(() => gate.send(m), re); assert.equal(sent.length, n, "nothing sent"); };
  refused(uploadTo(S63A + 2)[0], /an upload to 63C, which isn't in the plan/);
  refused(buildPresetChange(0), /not a read, nor an upload or preset change to a planned slot/);
  refused(uploadTo(S63A)[1], /out of order/);
  const other = uploadTo(S63A + 1);
  gate.send(other[0]);
  refused(buildReadRequest(1), /an upload to 63B is unfinished/);
  refused(other[2], /out of order/);
  for (const c of other.slice(1)) gate.send(c);
  const bad = Uint8Array.from(uploadTo(S63A)[0]);
  bad[10] = 0x08;
  refused(bad, /without the 0x09 marker/);
  refused(Uint8Array.from([...buildEnterEditorMode().slice(0, 9), 0x13, 0, 0, 0, 0xf7]), /not a read/);
  // Backup's gate plans no slot: no write of any kind.
  const ro = patchWriteGate({ send: () => {} }, []);
  assert.throws(() => ro.send(uploadTo(S63A)[0]), /isn't in the plan/);
  assert.throws(() => ro.send(buildPresetChange(S63A)), /not a read/);
});

test("the bridge sends GP-200 patch writes only with --gp200-patch-writes, and only those kinds", () => {
  const py = readFileSync(new URL("../gp50/cli/midi_bridge.py", import.meta.url), "utf8");
  assert.match(py, /GP200_PATCH_WRITES = False/);
  assert.match(py, /return gp200_read_only\(data\) or \(GP200_PATCH_WRITES and gp200_patch_write\(data\)\)/);
  assert.match(py, /if PEDAL == "gp200" and not gp200_allowed\(data\):/);
  assert.match(py, /if args\[2:\] == \["--gp200-patch-writes"\] and args\[1\] == "gp200":/);
  assert.match(py, /\(cmd == 0x11 and sub == 0x12\) or \(cmd == 0x12 and sub == 0x20 and data\[10\] == 0x09\) or \(cmd == 0x12 and sub == 0x08\)/);
  const js = readFileSync(new URL("../gp50/cli/winmm.js", import.meta.url), "utf8");
  assert.match(js, /\.\.\.\(gp200Writes \? \["--gp200-patch-writes"\] : \[\]\)/);
});

function setup(t, pedalOpts = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gp200-runner-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pedal = new FakePedal({ defaultDump: baseDump(), dumps: new Map([[S63A, dumpWithName("Old One")], [S63A + 1, dumpWithName("Old Two")]]), ...pedalOpts });
  const s = { dir, pedal, printed: [], opened: [] };
  s.run = (...args) => main([...args, "--out", dir], {
    timing: { gp200TimeoutMs: 200 },
    print: (line) => s.printed.push(line),
    open: async (log, opts = {}) => {
      s.opened.push(`${opts.pedal}${opts.gp200Writes ? " writes" : ""}`);
      return { input: pedal.input, output: pedal.output, close: async () => {} };
    },
  });
  s.saved = (re) => readdirSync(dir).filter((f) => re.test(f));
  s.text = () => s.printed.join("\n");
  s.file = (name, data) => { const f = path.join(dir, name); writeFileSync(f, data); return f; };
  return s;
}

const names = async (zipPath) => [...(await readZip(readFileSync(zipPath)))].map(([n]) => n);

test("gp200-backup: reads only, a zip with the CLI's entry names", async (t) => {
  const s = setup(t);
  assert.equal(await s.run("gp200-backup", "--from", "63-A", "--to", "63-B"), 0, s.text());
  assert.deepEqual(s.opened, ["gp200"], "opened without patch writes");
  const [zip] = s.saved(/^gp200_63A_to_63B_.*\.zip$/);
  assert.deepEqual(await names(path.join(s.dir, zip)), ["63A_Old One.prst", "63B_Old Two.prst"]);
  assert.equal(s.pedal.writes.size, 0);
  assert.ok(!s.pedal.sent?.some?.((m) => m[8] === 0x12), "no write-kind message sent");
});

test("gp200-restore: the planned slots written the app's way, verified, and read again at the end", async (t) => {
  const s = setup(t);
  assert.equal(await s.run("gp200-backup", "--from", "63-A", "--to", "63-B"), 0, s.text());
  const reference = path.join(s.dir, s.saved(/^gp200_63A_to_63B_.*\.zip$/)[0]);
  const zip = s.file("two.zip", createZip([{ name: "63B_Copy Two.prst", data: patch("Copy Two") }, { name: "63A_Copy One.prst", data: patch("Copy One", true) }]));
  assert.equal(await s.run("gp200-restore", zip, "--start", "63-A", "--reference", reference, "--write"), 0, s.text());
  assert.deepEqual(s.opened, ["gp200", "gp200 writes"]);
  assert.deepEqual([...s.pedal.writes.keys()].sort(), [S63A, S63A + 1], "only the planned slots");
  assert.ok(s.pedal.editorMode, "connect() put it in editor mode, as the app does");
  assert.match(s.text(), /Wrote 2 of 2 patch\(es\) in .* s: 2 verified, 0 not verified/);
  assert.match(s.text(), /End check: all 2 written slot\(s\) read again and match their files/);
  assert.equal(await s.run("gp200-backup", "--from", "63-A", "--to", "63-B"), 0, s.text());
  const after = s.saved(/^gp200_63A_to_63B_.*\.zip$/).sort().at(-1);
  assert.deepEqual(await names(path.join(s.dir, after)), ["63A_Copy One.prst", "63B_Copy Two.prst"], "in slot-label order");
});

test("gp200-restore asks (exit 2, nothing written): a slot changed since the reference, a slot not in it, no reference; refuses without --write", async (t) => {
  const s = setup(t);
  assert.equal(await s.run("gp200-backup", "--from", "63-A", "--to", "63-B"), 0, s.text());
  const reference = path.join(s.dir, s.saved(/^gp200_63A_to_63B_.*\.zip$/)[0]);
  const one = s.file("63A_Copy One.prst", patch("Copy One"));
  s.pedal.dumps.set(S63A, dumpWithName("Saved Meanwhile"));
  assert.equal(await s.run("gp200-restore", one, "--start", "63-A", "--reference", reference, "--write"), 2);
  assert.match(s.text(), /Nothing written; ask the developer: 63A no longer holds what the reference has\. To write anyway, only on the developer's explicit instruction: --skip-reference-check/);
  assert.match(s.text(), /gp200-restore: NEEDS AN ANSWER/);
  assert.equal(await s.run("gp200-restore", one, "--start", "63-C", "--reference", reference, "--write"), 2);
  assert.match(s.text(), /Nothing written; ask the developer: the reference has no patch for 63C/);
  const opened = s.opened.length;
  assert.equal(await s.run("gp200-restore", one, "--start", "63-A", "--write"), 2);
  assert.match(s.text(), /Nothing written; ask the developer: there's no --reference/);
  assert.equal(await s.run("gp200-restore", one, "--start", "63-A", "--reference", reference), 1);
  assert.match(s.text(), /"gp200-restore" writes to the pedal; add --write to say so/);
  assert.equal(await s.run("gp200-restore", one, "--start", "63-A", "--reference", reference, "--skip-reference-check", "--write"), 1);
  assert.match(s.text(), /Give --reference or --skip-reference-check, not both/);
  assert.equal(await s.run("gp200-backup", "--skip-reference-check"), 1);
  assert.match(s.text(), /--skip-reference-check is for restore, copy, gp200-restore only/);
  assert.equal(s.opened.length, opened, "the last four before the pedal was opened");
  assert.equal(s.pedal.writes.size, 0, "nothing written in any of them");
  assert.equal(s.pedal.editorMode, false, "never even put in editor mode");
});

test("gp200-restore --skip-reference-check: written whatever the slot holds, verified and read again; said in the log", async (t) => {
  const s = setup(t);
  s.pedal.dumps.set(S63A, dumpWithName("Not Backed Up"));
  const one = s.file("63A_Copy One.prst", patch("Copy One"));
  assert.equal(await s.run("gp200-restore", one, "--start", "63-A", "--skip-reference-check", "--write"), 0, s.text());
  assert.match(s.text(), /Reference check skipped \(--skip-reference-check\): 63A overwritten whatever they hold/);
  assert.match(s.text(), /End check: all 1 written slot\(s\) read again and match their files/);
  assert.deepEqual([...s.pedal.writes.keys()], [S63A], "only the planned slot");
});
