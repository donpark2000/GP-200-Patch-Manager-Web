// What the GP-50 command-line runner does, once connected. Nothing here opens
// a port, so the tests use the fake pedal.

import { readAllSlots, slotFileName, slotRanges } from "../backup.js";
import { diffOffsets, NAME_COUNT } from "../protocol.js";
import { describeDiff, planRestore, writePatches } from "../restore.js";
import { checkAll, onlyKnown } from "../write-steps.js";

/** CLAUDE.md lets the runner write any GP-50 patch (stages 1-3 of DESIGN.md "Both pedals"). */
export const ANY_PATCH = Object.freeze({ first: 0, last: NAME_COUNT - 1 });

/** Patch s holds the one that was `by` before it; the last ones go to the start. */
export const shifted = (patches, by) => patches.map((_, s) => patches[(s - by + NAME_COUNT) % NAME_COUNT]);

/** Reads a range, as files named like Suite's. `complete` needs every patch read, names matching the pedal's list. */
export async function backup(reader, { log, from = 0, to = NAME_COUNT - 1 }) {
  if (![from, to].every((n) => Number.isInteger(n) && n >= 0 && n < NAME_COUNT) || from > to) throw new Error(`"${from}" to "${to}" isn't a range within 0-${NAME_COUNT - 1}`);
  const r = await readAllSlots(reader, { log, from, count: to + 1 });
  const files = r.entries.map((e) => ({ name: slotFileName(e.slot, e.name), data: e.prst }));
  const complete = files.length === to - from + 1 && !r.wrongName.length;
  log.info(`Read ${files.length} of ${to - from + 1} patches, ${r.retries} retries${complete ? "" : ", INCOMPLETE"}`);
  return { ...r, files, complete };
}

/** Reads all 100 and compares with `expected`; logs one verdict line. */
export async function check(reader, expected, label, { log }) {
  const r = await checkAll(reader, expected, { log });
  for (const d of r.differing) log.warn(`Patch ${d.slot} "${d.name}" differs: ${describeDiff(d.offsets)}`);
  const parts = [`Check "${label}": ${r.pass ? "MATCH" : "DIFFERENT"}. ${r.compared} of ${NAME_COUNT} compared, ${r.compared - r.differing.length} identical, ${r.retries} retries`];
  if (r.differing.length) parts.push(`differ: ${slotRanges(r.differing.map((d) => d.slot))}`);
  if (r.failed.length) parts.push(`couldn't read: ${slotRanges(r.failed)}`);
  if (r.wrongName.length) parts.push(`name differs from the pedal's list: ${slotRanges(r.wrongName)}`);
  parts.push(`selected ${r.selectedBefore} before, ${r.selectedAfter} after`);
  log[r.pass ? "info" : "error"](parts.join("; "));
  return r;
}

/** Writes `items`; overwrites only what is in `reference`, or what this run wrote. */
export async function write(writer, items, reference, { log, label, touched = new Set(), ...opts }) {
  const t0 = performance.now();
  log.info(`Write "${label}": ${items.length} patches, to ${slotRanges(items.map((i) => i.slot))}`);
  const r = await writePatches(writer, items, { log, touched, confirmed: true, guard: onlyKnown(reference, touched), ...opts });
  const ok = !r.problem && r.verified.length === items.length;
  const text = `Write "${label}": ${ok ? "DONE" : "STOPPED"}. ${r.verified.length} of ${items.length} written and read back identical, ` +
    `${((performance.now() - t0) / 1000).toFixed(1)} s; selected ${r.selectedBefore} before, ${r.selectedAfter} after${r.problem ? `; ${r.problem}` : ""}`;
  log[ok ? "info" : "error"](text);
  return { ...r, ok };
}

/** Files into consecutive patches from `start`. A file that can't be used stops it before any write. */
export async function restore(writer, files, start, reference, opts) {
  const { log } = opts;
  const plan = await planRestore(files, start);
  plan.notes.forEach((n) => log.info(n));
  log.info(`Files ordered by ${plan.orderedBy}`);
  for (const s of plan.skipped) log.error(`${s.fileName}: ${s.reason}`);
  for (const name of plan.overflow) log.error(`${name}: doesn't fit before patch ${NAME_COUNT - 1}`);
  for (const i of plan.items) log.info(`  ${i.fileName} -> patch ${i.slot}`);
  if (plan.skipped.length || plan.overflow.length || !plan.items.length) {
    log.error("Nothing written: not every file can be used");
    return { ok: false, plan };
  }
  return { ...(await write(writer, plan.items, reference, { label: `restore from patch ${start}`, ...opts })), plan };
}

/** All 100 patches moved by `by` and checked, then put back and checked (DESIGN.md "Both pedals", stage 1). */
export async function roundTrip(writer, reference, by, { log, ...opts }) {
  const label = `all moved by ${by}`;
  const moved = shifted(reference, by);
  const items = (patches) => patches.map((prst, slot) => ({ slot, prst }));
  const changed = moved.filter((p, s) => diffOffsets(p, reference[s]).length).length;
  log.info(`Round trip, ${label}: ${changed} of ${NAME_COUNT} patches get different contents`);
  if (!(await check(writer, reference, "as the reference, before", { log })).pass) return false;
  if (!(await write(writer, items(moved), reference, { log, label, ...opts })).ok) return false;
  if (!(await check(writer, moved, label, { log })).pass) return false;
  if (!(await write(writer, items(reference), reference, { log, label: "put back", ...opts })).ok) return false;
  if (!(await check(writer, reference, "as the reference, after", { log })).pass) return false;
  log.info(`Round trip, ${label}: PASSED`);
  return true;
}
