# Design

The agreed direction for GP-200 Patch Manager Web. This file records
**decisions**; the reasoning, evidence, and anything still open live in
[`DEV_JOURNAL.md`](DEV_JOURNAL.md).

## Goal

A browser-based GUI for **bulk backup and restore of Valeton GP-200
patches**, with the same narrow scope as the command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager):
it moves whole `.prst` patches between the pedal and files on disk. It is
not a patch editor.

## Platform

- **A static web app hosted on GitHub Pages.** No install, and no
  per-platform executables to build or sign.
- **Talks to the pedal through the browser's Web MIDI API** (SysEx over
  USB-MIDI), the same wire protocol the CLI uses.
- **Supported browsers: Chrome and Edge** (any desktop OS). Safari has no
  Web MIDI, and Firefox's permission flow is awkward. Other community GP-200
  web tools have the same limitation, and users are used to it.
- **Plain JavaScript (ES modules), no build step.** What's in the repo is
  what's served. Unit tests run under Node without a bundler.
- **A downloadable single-file build is a maybe.** It depends on whether
  Web MIDI SysEx works from a `file://` page (open question in the journal).

## Relationship to the CLI

- The CLI repo stays as it is: a stable, scriptable tool and the
  **reference implementation**.
- Its `PROTOCOL.md` and `PROTOCOL_NOTES.md` are the **spec** for the
  JavaScript port. This repo doesn't copy them; it links to them and records
  only what's new or different in the browser.
- File names match the CLI's so outputs can be compared one-to-one:
  - one slot: `<slot>_<name>.prst` (e.g. `34A_Clean.prst`)
  - all slots: `gp200_all_patches.zip`, whose entries use the same names
  - a range: `gp200_<start>_to_<end>.zip` (e.g. `gp200_34A_to_36D.zip`)

## Credit and licensing

Protocol knowledge that came from other projects is credited wherever it's
used: in the README, in the source file that implements it, and in the
page's footer, since that's what users actually see. The CLI's rules carry
over unchanged:

- **GP200 Studio** (GPL-3.0): the SysEx message formats and `.prst`
  layout were ported from it (via the CLI). Credit by name, with a link.
  This project is GPL-3.0 too.
- **RigSheet** (all rights reserved): read-only cross-check only.
  Independently confirmed *facts* may be used and credited; RigSheet's code
  and text are never copied.

When the write path is ported (phase 2), its RigSheet-derived addressing
finding gets the same credit in the write code.

## Architecture

Two layers, kept strictly apart:

1. **Protocol core** (`src/core/`): Web MIDI I/O, SysEx framing, slot
   reads, normalization, `.prst` building. No DOM or UI code, so it can be
   unit-tested in Node against a fake MIDI device.
2. **UI** (`src/ui/`): starts as a bare test page and is replaced by the
   designed interface later without touching the core.

A **debug log** is built in from the start (standards §1): an on-screen log
panel plus "save log to file", including browser, OS, and MIDI port
details, so a user can send it back for support.

## Reliability rules

These are deliberately simpler than the CLI's. See the journal entry of
2026-09-30 for why.

- **Reads: one read per slot.** Then:
  1. Normalize the known-changing bytes to fixed values: the dead bytes
     `0x43` and `0x9F`, `0x2E`, and the tail block, exactly as the CLI's
     `normalize_export_dynamic_fields` does.
  2. Run cheap sanity checks: all 7 chunks arrived, every payload byte is a
     valid nibble (≤ 0x0F), payloads have even length, and the dump is long
     enough to cover the name and all 11 effect blocks.
  3. Re-read that slot only if a read times out or fails a check, up to 3
     attempts in all; then skip it with an error. No "read until two reads
     agree" loop.
- **Writes (phase 2): write, then one read-back compare**, ignoring the
  device-owned bytes and the dead bytes, exactly as the CLI's
  `verify_write_full` does. If the read-back mismatches, re-read **once**
  before calling it a failure, so read noise can't pose as a failed write.
  Report a clear pass/fail. No automatic rewrites (the CLI tries up to 10);
  the user decides whether to retry.
- **Write method: flash upload only**, ported byte-for-byte from the CLI
  (golden-tested) with the CLI's pacing: 40 ms between the 7 chunks, a
  1 s settle, then a preset change to the written slot. So after a
  restore, **the pedal is left on the last slot written**. The CLI's
  "live" method and experimental save-commit are not ported.
- These rules hold only if the browser's MIDI path behaves like the CLI's.
  The acceptance tests below exist to prove that.

## Phases

### Phase 1: read-only backup

- Connect to the pedal (auto-detect the port; let the user pick if
  ambiguous).
- **Slot grid:** 64 banks × 4 slots (A–D), each cell showing its label and
  patch name.
- **Selection:** click, shift-click for a range, **Select all**, **Clear**.
- **Export:** disabled until something is selected. One slot downloads a
  `.prst`; several download a `.zip`.
- Progress while reading, since reading all 256 slots takes a while.

### Phase 2: restore

- Choose a **starting slot**, then pick `.prst` files or one `.zip` with
  the file dialog.
- **Preview before writing:** show a "file → slot (replacing *current
  name*)" table and ask for confirmation. The browser doesn't guarantee the
  order of picked files, so the preview is where the user confirms what
  lands where.
- **Order and placement follow the CLI:** by leading slot label if every
  file name has one, otherwise alphabetical; consecutive slots from the
  start slot; an invalid file keeps its slot position (that slot is left
  unchanged); nothing past 64D. Plain `.prst` files get the same ordering
  rule as a zip, because the browser's file order isn't reliable.
- *Status: built in the bare test page (section 3, "Restore"), awaiting
  real-hardware tests.*
- Show the **User-IR / NAM (SnapTone) warning** in the preview (CLI README,
  "Known limitations"; `PROTOCOL_NOTES.md` Finding 11).
- Write method (flash vs. live) is chosen by the app, not the user, based
  on whichever is confirmed on hardware at the time.

### Later

- Load one template into many slots (the CLI's `apply-template`).
- Anything else users ask for.

### Out of scope

The CLI's diagnostic commands (`diag-write`, `calibrate-settle`, `reread`,
`drift`, `raw-sweep`, `soak`). They were research tools for learning the
protocol; the CLI still has them.

## Acceptance tests

### Phase 1 gate: CLI comparison

1. Run CLI `export --all` and the web app's export-all against the same
   pedal.
2. Compare the **files inside** the two zips (not the zip files
   themselves, since timestamps and ordering differ) with the compare
   script.
3. **Expected: byte-identical**, since both normalize the same bytes. Any
   difference gets investigated.
4. Repeat several times, **on both of the developer's computers**.

This tests the Web MIDI transport *and* the JavaScript port's parity with
the Python logic at the same time.

### Phase 2 gate: real round trip

Writing a patch back to where it came from proves nothing, because a write
that silently did nothing would still pass. So:

1. Export all → **backup A** (with a CLI backup kept as a safety net).
2. Write something *different* (e.g. restore A shifted by one slot).
3. Export and confirm the change actually landed.
4. Restore A with the web app.
5. Export all → must match A exactly.

## Parity with the CLI

`tools/make_golden.py` runs the CLI's own Python functions on a set of
test dumps and saves the results as fixtures. `tests/golden.test.js`
requires the JavaScript port to reproduce them byte-for-byte: `.prst`
contents, file names, displayed names, and User-IR/NAM detection. Re-run the
generator whenever the CLI's export logic changes.

## Process

This project follows the `software-project-standards` practices: debug
output per feature, a test per feature, one-command regression suite, and a
running journal (`DEV_JOURNAL.md`). See `CLAUDE.md`.
