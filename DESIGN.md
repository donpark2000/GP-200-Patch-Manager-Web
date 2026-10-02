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
  iPhone/iPad: unsupported in any browser (confirmed 2026-10-02, Edge on
  iPhone). Android: untested.
- **Published from `main` only.** CI tests every pull request and
  publishes to GitHub Pages only on `main`, stamping the commit into the
  page. Work happens on branches; merging to `main` is the deliberate
  publish step, done with the developer's OK.
- **Plain JavaScript (ES modules), no build step.** What's in the repo is
  what's served. Unit tests run under Node without a bundler.
- **A downloadable single-file build is a maybe.** It depends on whether
  Web MIDI SysEx works from a `file://` page; untested, parked (journal, Q3).

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
  and text are never copied. Credited for the upload addressing (in the
  write code, the README and the page footer), but **not recommended** as
  a tool (developer, 2026-10-02: its UI is too hard to follow). GP200
  Studio is the only editor the README and page point users to.

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
  `verify_write_full` does. If the read-back still mismatches (after one
  re-read; the fast pacing reads until it matches), read it **3 more
  times** before calling it a failure: a later full match passes the
  write, and otherwise the log says whether the difference was the same
  in every read (stored in the pedal) or changed between reads (read
  noise). So read noise can't pose as a failed write.
  Report a clear pass/fail. No automatic rewrites (the CLI tries up to 10);
  the user decides whether to retry.
- **Write method: flash upload only**, ported byte-for-byte from the CLI
  (golden-tested), with the fast pacing below. After a restore, **the
  pedal is left on the last slot written**. The CLI's "live" method and
  experimental save-commit are not ported. The CLI's pacing (40 ms between
  the 7 chunks, a 1 s settle, a preset change, 300 ms, the read-back,
  300 ms between patches) stays available as a developer fallback (`?dev`).
- **Pedal-managed bytes: 0x44e and 0x456.** With fast pacing the pedal
  changed these (a 2 became 0) in 44 slots after their read-back had
  matched, and some patches read back differently there until selected.
  Patches that differ only there show identical settings in Valeton's
  editor, CTRL, footswitch and EXP included (journal, 2026-10-01). So the
  verify and `compare-zips` don't fail on them, but report every change.
  Any other byte that changes is still a failure.
- **Fast pacing: the restore's pacing.** Upload with no pauses, read back
  until it matches (up to 3 s), then the preset change; none between
  patches: about 0.11 s per patch instead of about 1.9 s (a full restore
  in about 30 s instead of 8 min). Passed the phase 2 gate and a
  confirming round trip on 2026-10-02 (1,022 writes verified, four
  compares MATCH).
- **What counts as damage** (developer, 2026-10-01): a restore must
  preserve everything that affects how a patch plays, including the CTRL
  button, footswitch and expression-pedal settings, not only the effect
  settings. A byte the pedal changes is acceptable only if it's shown not
  to change any of these; an unexplained change is treated as damage
  until then.
- These rules hold only if the browser's MIDI path behaves like the CLI's.
  The acceptance tests below exist to prove that.

## Designed UI

Agreed 2026-10-02 (journal, "Designed UI: first decisions"); layout still
to be designed.

- **One page, several screens.** Header links switch screens without
  reloading, so the pedal connection, the selection, picked files and a
  running restore survive (a Help screen can be read mid-restore). Each
  screen has its own address, so Back and bookmarks work. Screens to
  start: **Patches** (slot grid with backup and restore; the restore
  preview shown on the grid) and **Help**.
- **Header:** "GP-200 Patch Manager", the screen links, and whether the
  pedal is connected.
- **Footer:** "© Donald Parker", GPL-3.0, link to the GitHub project,
  GP200 Studio as the place to build and edit patches, the credits
  required above (GP200 Studio, RigSheet), the app version, and a "not
  affiliated with Valeton" line.
- **Devices:** designed for desktop/laptop; usable on a narrow window,
  not built for phones. Browsers that can't reach the pedal get a clear
  message.
- **Logs hidden.** Always recorded; "Save log" in Help so a user can send
  it for support. The on-screen log panel only with `?dev`.
- **Progress** for anything that takes time: a restore shows a progress
  bar, the slot and patch being written, and the elapsed time; a backup
  (under a second) gets a short status line.
- **Help screen:** quick start, what a restore overwrites, the
  User-IR/NAM limitation, browser compatibility, troubleshooting
  (permission prompt, pedal not found); links to the README.
  Browser compatibility (developer, 2026-10-02) names examples that work
  (Chrome, Edge on a computer) and that don't (Firefox, Safari, any
  browser on iPhone/iPad), and says how to tell: the app checks on
  opening and says plainly if this browser can't reach the pedal.

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
- *Status: core and bare test page built; gate passed. Export-all matched
  the CLI's byte-for-byte on the developer's first computer, and from the
  hosted site matched the backup on both computers (see the journal).*

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
- *Status: built in the bare test page (section 3, "Restore") and
  confirmed on real hardware on the developer's first computer: scratch-slot
  writes with changed content, then a full 256-slot round robin (see the
  journal). Phase 2 gate passed with the fast pacing on both computers,
  the second from the hosted site (2026-10-02).*
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

**Pass criteria for the fast pacing** (agreed 2026-10-01): steps 2-5 with
the fast pacing, compared with `compare-zips` (`--shift 1` for step 3).
MATCH means every byte matches except the ones the CLI already ignores and
the pedal-managed bytes, which are listed but don't fail. Both compares
MATCH and every write verified: the fast pacing ships. Anything else: only
that difference gets investigated.

Restoring A from 1B shifts every patch up one slot: 1A is left as it is,
and the 64D file doesn't fit and isn't written (the preview says so). A
shifted write only proves something where neighbouring patches differ;
runs of identical patches (blank templates, factory defaults) can't show
whether their writes landed. Step 3 therefore compares each slot with A's
patch from the slot below, and counts how many slots really changed.

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
