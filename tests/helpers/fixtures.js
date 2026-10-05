// Loading test fixtures relative to this file, never the working directory,
// so the suite runs the same from any folder on any machine.

import { readFileSync } from "node:fs";

const FIXTURES = new URL("../fixtures/", import.meta.url);

export function fixtureBytes(relPath) {
  return new Uint8Array(readFileSync(new URL(relPath, FIXTURES)));
}

export function goldenManifest() {
  return JSON.parse(readFileSync(new URL("golden/golden.json", FIXTURES), "utf8"));
}

/** A plausible dump: the skeleton's content region, 1176 bytes like the real pedal's (journal 2026-10-02). */
export function baseDump() {
  return fixtureBytes("skeleton.prst").slice(0x28, 0x28 + 1176);
}

export function dumpWithName(name, dump = baseDump()) {
  const d = Uint8Array.from(dump);
  d.fill(0, 28, 44);
  d.set(new TextEncoder().encode(name).subarray(0, 16), 28);
  return d;
}
