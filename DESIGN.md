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
- **A folder per publish** (journal, Q7): the published copy keeps the
  code in `v/<commit>/src/` and the pages point there
  (`tools/stamp-site.js`, run by CI). Browsers may reuse a cached file for
  10 minutes, and this way an old cached page can never get newer files.
  The repo and localhost keep the plain `src/`.
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

Protocol knowledge that came from other projects is credited in the
README and in the source file that implements it. Not in the page's
footer (developer, 2026-10-02: the README is enough); the footer keeps the
copyright and GPL-3.0 notice. The CLI's rules carry over unchanged:

- **GP200 Studio** (GPL-3.0): the SysEx message formats and `.prst`
  layout were ported from it (via the CLI). Credit by name, with a link.
  This project is GPL-3.0 too.
- **RigSheet** (all rights reserved): read-only cross-check only.
  Independently confirmed *facts* may be used and credited; RigSheet's code
  and text are never copied. Credited for the upload addressing (in the
  write code and the README), but **not recommended** as
  a tool (developer, 2026-10-02: its UI is too hard to follow). GP200
  Studio is the only editor the README and page point users to.

## Architecture

Two layers, kept strictly apart:

1. **Protocol core** (`src/core/`): Web MIDI I/O, SysEx framing, slot
   reads, normalization, `.prst` building. No DOM or UI code, so it can be
   unit-tested in Node against a fake MIDI device.
2. **UI** (`src/ui/`): two pages on the same core. `index.html` is the
   designed interface. `test.html` is the bare test page that proved the
   core on hardware, kept as a reference: a fault that also shows there
   is in the core, one that doesn't is in the new UI. Labelled as a
   developer page and **not published** (developer, 2026-10-02): run it
   on localhost, or publish it temporarily by running the CI workflow by
   hand with "include test page" ticked; the next normal publish takes it
   down. The proven state is tagged `test-page-proven` (developer,
   2026-10-02: keep the proven interface rather than replace it; one
   repo, so the core is never copied).

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
  screen has its own address, so Back and bookmarks work. Screens:
  **Back up**, **Restore**, **Template**, **Help**: one operation per screen, so the
  list's highlight always means one thing (two control sets above one
  list were ambiguous, developer 2026-10-02).
- **The patch list:** all 256 patches on one screen. Readability before
  fitting without scrolling (developer, 2026-10-02: the first build's
  12 px was too small; a bit of scrolling is fine). One list,
  each entry labelled the way Valeton writes it, "12-A Oldschool Fuzz",
  flowing down 8 columns of 8 banks; a faint line between banks; default
  names greyed. **Always shows what is on the pedal** (developer,
  2026-10-02): read on connect, re-read after every restore or Template
  run (also one that stopped early or had failures), and updated with
  the names the Template's pre-write re-check reads.
- **Slots are chosen as ranges**, not by clicking around the list
  (developer: patches live together in a bank or consecutive banks).
  Back up: From/To; Restore: a start slot. Clicking a patch fills in the
  boxes: first click both ends, second click the other end. **Dragging**
  across the list from one patch to another sets From/To too (developer,
  2026-10-05: it felt natural); on Restore a drag does nothing. The list
  can't be text-selected, so a drag never leaves a browser highlight that
  looks like a range. Each screen keeps its own range. Help's "Choosing
  slots" explains drag, click and typing. The app shows labels as "12-A" and accepts "12A"/"12-a"; file
  names keep the CLI's style (`12A_Name.prst`).
- **The list shows the range before anything runs:** blue for the chosen
  range, the same on Back up and Template (developer, 2026-10-05: Template
  had only a faint outline until a file was chosen); orange for "will be
  overwritten" (Restore; Template's slots to write once a file is chosen,
  its kept slots stay blue), with a switch to show the list as it is now
  or after the write (that is the preview). Range colours are brighter
  than the panels' tints (`--sel-fill`, `--over-fill`) so they stand out.
- **Template screen** (the CLI's `apply-template`, developer
  2026-10-02): one `.prst` into a From/To range, one confirmation for the
  range, then the restore's write, verify and progress. **By default it
  writes only empty slots** and keeps every other patch; "Every slot in
  the range" overwrites them too (the CLI's behaviour). The summary counts
  empty slots and the user's patches, and names the kept ones.
  - **Empty** means the patch name "It's GP-200", nothing else.
  - **Re-checked before writing.** The plan comes from the patch list
    read on connect; just before writing, the range is read again (a
    fraction of a second). If any slot changed (a patch saved on the
    pedal meanwhile, a slot that can't be read), nothing is written and
    the plan is shown again. The CLI instead reads each name right before
    its write; that would add a read to the proven fast write sequence,
    so the check happens once, before the first write.
  - No other name is treated as a template: a patch name doesn't say
    whether it was made as a patch or loaded as a template, and different
    ranges may hold different templates (developer).
  - **Plain wording** (developer): the "template" is any ordinary `.prst`.
    The screen keeps the name Template but says so in a fixed line at the
    top; the button is "Choose a .prst file...", the action "Write to
    range". Help says **why before how** (developer, 2026-10-03): a
    template is a personal starting point that carries the player's
    standards (wah, noise gate and its place in the chain, effects loop
    placement, what CTRL 1/2 do), so patches work alike on stage, and
    different banks can use different templates (clean, metal). Then the
    use cases: new sounds from the template, a block set up for a gig,
    and clearing a range with an exported empty ("It's GP-200") patch and
    "Every slot".
- **Other GP-200 tools may stay open** (developer, 2026-10-03, from
  testing with Valeton's editor open): Help says not to use them while
  this app reads or writes, and to reload their patches after a restore
  before editing there. "Close them" is only a "Pedal not found" step.
- **Controls never appear or disappear.** A button stays visible, greyed
  out with the reason next to it, until its inputs are valid. The
  progress line is always there ("Ready." when idle).
- **Opening screen** (developer, 2026-10-02): the home page (`#home`,
  also the page with nothing after the `#`) is a welcome panel: what the
  app does (three lines), what to do first (USB; Valeton's editor can
  stay open but not be used while this app reads or writes), and one large "Connect to pedal" button, with the port picker
  there if the GP-200 can't be told apart, beside a drawing of the pedal
  (a placeholder until the developer's own photos). Until the pedal is
  connected, Back up, Restore and Template show the same panel. Help
  stays reachable.
  - **After connecting: Back up**, with its range filled in as 1-A to
    64-D (in the boxes, not as grey hints). After a lost connection, the
    user returns to the screen they were on.
  - **Connected:** the home page shows "Connected to the pedal" with links
    to the three screens in place of the connect steps and button.
  - **Lost connection** (pedal unplugged, or it stops answering so the
    list can't be read again after a write): the panel comes back with
    the reason under "Connect to pedal". That is the only way to
    reconnect; the header's "Reconnect" was dropped (developer: never
    needed).
- **Header:** "GP-200 Patch Manager" (a link to the home page), the screen
  links, and whether the pedal is connected.
- **Text sizes:** page text 16 px, controls 15 px, the list 14 px when 8
  columns of 16-character names fit, shrinking to 12 px; below a
  1,200 px window the list has 4 columns (14 px down to 12 px). No
  sideways scrolling from 600 px up (measured, journal 2026-10-02).
- **Footer:** "© Donald Parker", GPL-3.0, link to the GitHub project,
  GP200 Studio (its site, gp200studio.com) as the place to build and edit
  patches, and the app version. No credits (see "Credit and licensing").
- **Not Valeton's** (developer, 2026-10-02: kept out of the footer for a
  clean interface): the welcome page's first sentence ends "An
  independent tool, not made by Valeton.", and Help has an "About"
  section saying it in full.
- **Links to other sites open in a new tab**, so the app (and a
  connection or a running restore) stays open (developer, 2026-10-02).
- **Devices:** designed for desktop/laptop; usable on a narrow window,
  not built for phones. Browsers that can't reach the pedal get a clear
  message.
- **Logs hidden.** Always recorded; "Save log" in Help so a user can send
  it for support. The on-screen log panel only with `?dev`, together with
  the restore-pacing fallback and "Download failed read-backs". The
  write-timing test stays on the test page (`test.html?dev`) only.
- **`?dev&fake`** connects to the test suite's fake pedal instead of Web
  MIDI, to check the screens without hardware. It loads `tests/`, which
  is never published, so it works only on localhost.
- **Fonts:** the computer's own (the list in Arial Narrow where
  installed); nothing is loaded from other sites. The mockup's IBM Plex
  from Google Fonts was dropped so the app has no outside dependency.
- **Progress** for anything that takes time: a restore shows a progress
  bar, the slot and patch being written, and the elapsed time; a backup
  (under a second) gets a short status line. A **"Stop after this
  patch"** button sits on the progress line, always visible, greyed out
  unless a restore or Template write is running (the test page had one;
  a restore takes about 30 s).
- **Help screen:** quick start, choosing slots, what a restore overwrites, the
  User-IR/NAM limitation, browser compatibility, troubleshooting
  (permission prompt, pedal not found), Report a problem, About; links
  to the README.
- **Report a problem** (developer, 2026-10-02): support is through
  GitHub issues (free account; public). In Help, not a tab of its own.
  The button saves the log and opens GitHub's new-issue form in a new
  tab, filled in with headings for the user's description, the log
  file's name, and the app version, browser, page, connection, screen
  and last error (`src/core/report.js`). The user drags the log in and
  posts it; the app sends nothing (a link can't carry a file, and is
  kept under 6,000 characters). Help says what the log contains, that
  issues are public, and that the log is only in memory until saved.
  The repo has an issue form (`.github/ISSUE_TEMPLATE/problem.yml`) with
  the same headings for issues opened on GitHub directly; blank issues
  stay enabled for the app's link.
  Browser compatibility (developer, 2026-10-02) names examples that work
  (Chrome, Edge on a computer) and that don't (Firefox, Safari, any
  browser on iPhone/iPad), and says how to tell: the app checks on
  opening and says plainly if this browser can't reach the pedal.

## Phases

### Phase 1: read-only backup

- Connect to the pedal (auto-detect the port; let the user pick if
  ambiguous).
- **Patch list:** all 256 patches, each with its label and name (see
  "Designed UI"; replaces the earlier 64 × 4 grid).
- **Selection:** a From/To range (see "Designed UI"; replaces the
  earlier click/shift-click idea).
- **Export:** disabled until the range is valid. One slot downloads a
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

- Load one template into many slots: now planned as the Template screen
  ("Designed UI").
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
