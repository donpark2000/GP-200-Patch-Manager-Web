// Developer only (?dev&fake on localhost): connect the designed UI to the
// test suite's fake pedal instead of Web MIDI, to check the screens without
// hardware. tests/ is never published, so this can't work on the live site.

import { skeletonBytes } from "../core/skeleton.js";

const DUMP_LEN = 1176; // what the real pedal sends (journal 2026-10-02)

function dumpNamed(name) {
  const d = skeletonBytes().slice(0x28, 0x28 + DUMP_LEN);
  d.fill(0, 28, 44);
  d.set(new TextEncoder().encode(name).subarray(0, 16), 28);
  return d;
}

/** A pedal with made-up patches in banks 1-20, a run of "Template"
 *  copies in 21-22, and empty slots ("It's GP-200") everywhere else. */
export async function fakePorts(log) {
  const { FakePedal } = await import("../../tests/helpers/fake-pedal.js");
  const dumps = new Map();
  const styles = ["Clean", "Crunch", "Lead", "Ambient"];
  for (let s = 0; s < 80; s++) dumps.set(s, dumpNamed(`${styles[s % 4]} ${Math.floor(s / 4) + 1}`));
  for (let s = 80; s < 88; s++) dumps.set(s, dumpNamed("Template"));
  const pedal = new FakePedal({ dumps, defaultDump: dumpNamed("It's GP-200") });
  pedal.input.name = "Fake GP-200 (developer)";
  pedal.output.name = "Fake GP-200 (developer)";
  log.warn("Using the FAKE pedal (?dev&fake): nothing here talks to real hardware");
  // For checks from the browser console, e.g. "a patch saved on the pedal":
  // fakePedal.dumps.set(88, fakeDumpNamed("New Song"))
  Object.assign(window, { fakePedal: pedal, fakeDumpNamed: dumpNamed });
  return { input: pedal.input, output: pedal.output, pedal };
}
