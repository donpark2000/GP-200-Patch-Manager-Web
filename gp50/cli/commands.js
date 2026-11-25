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

/**
 * Nothing was written, and Claude asks the developer before going on
 * (CLAUDE.md, developer 2026-11-25: the reference check asks instead of
 * refusing). The runner exits with 2 for it, not 1.
 */
export class NeedsAnswer extends Error {}

export const SKIP_FLAG = "--skip-reference-check";
const askTail = `To write anyway, only on the developer's explicit instruction: ${SKIP_FLAG}`;

/** Before any write: the patches `items` would overwrite whose contents aren't in `reference`. Reads only. */
export async function notInReference(reader, items, reference, { log, isCancelled = () => false }) {
  const known = new Set(reference.map((p) => p.join()));
  const unknown = [];
  for (const { slot } of items) {
    if (isCancelled()) throw new Error("Stopped before writing anything");
    const now = await reader.readSlotPatch(slot);
    if (!known.has(now.prst.join())) unknown.push({ slot, name: now.name });
  }
  log.info(`Reference check: ${items.length} patch(es) read, ${items.length - unknown.length} hold a patch in the reference${unknown.length ? `, ${unknown.length} don't` : ""}`);
  return unknown;
}

/**
 * Writes `items`. Unless `skipCheck`: first, every patch to be overwritten is
 * read, and if any holds a patch that isn't in `reference`, nothing is written
 * and NeedsAnswer is thrown, listing them (`checked`: the caller has just
 * compared all 100 with the reference). During the write, a patch is
 * overwritten only if it is in `reference`, or this run wrote it.
 */
export async function write(writer, items, reference, { log, label, touched = new Set(), skipCheck = false, checked = false, ...opts }) {
  const t0 = performance.now();
  log.info(`Write "${label}": ${items.length} patches, to ${slotRanges(items.map((i) => i.slot))}`);
  if (skipCheck) log.warn(`Reference check skipped (${SKIP_FLAG}): any patch may be overwritten`);
  else if (!reference) throw new Error("No reference, and the check isn't skipped");
  else if (!checked) {
    const unknown = await notInReference(writer, items, reference, { log, isCancelled: opts.isCancelled });
    if (unknown.length) {
      throw new NeedsAnswer(`Nothing written; ask the developer: ${unknown.map((u) => `patch ${u.slot} "${u.name}"`).join(", ")} ` +
        `${unknown.length === 1 ? "holds a patch that isn't" : "hold patches that aren't"} in the reference. ${askTail}`);
    }
  }
  const guard = skipCheck ? () => {} : onlyKnown(reference, touched);
  const r = await writePatches(writer, items, { log, touched, confirmed: true, guard, selectedEach: false, ...opts });
  const ok = !r.problem && r.verified.length === items.length;
  const text = `Write "${label}": ${ok ? "DONE" : "STOPPED"}. ${r.verified.length} of ${items.length} written and read back identical, ` +
    `${((performance.now() - t0) / 1000).toFixed(1)} s; ${r.restarted.length} started again${r.restarted.length ? ` (${slotRanges(r.restarted)})` : ""}; selected ${r.selectedBefore} before, ${r.selectedAfter} after${r.problem ? `; ${r.problem}` : ""}`;
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
  // Both writes: the check just before compared all 100 with the reference.
  if (!(await write(writer, items(moved), reference, { log, label, checked: true, ...opts })).ok) return false;
  if (!(await check(writer, moved, label, { log })).pass) return false;
  if (!(await write(writer, items(reference), reference, { log, label: "put back", checked: true, ...opts })).ok) return false;
  if (!(await check(writer, reference, "as the reference, after", { log })).pass) return false;
  log.info(`Round trip, ${label}: PASSED`);
  return true;
}
