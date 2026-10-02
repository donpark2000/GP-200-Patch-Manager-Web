# Dev journal

A running record of decisions, findings, and open questions, newest at the
bottom. Findings record **evidence**: what was tested, what was observed,
and what it does and doesn't prove.

Protocol knowledge inherited from the CLI lives in the CLI repo's
[`PROTOCOL.md`](https://github.com/donpark2000/GP-200-Patch-Manager/blob/main/PROTOCOL.md)
and
[`PROTOCOL_NOTES.md`](https://github.com/donpark2000/GP-200-Patch-Manager/blob/main/PROTOCOL_NOTES.md).
This journal records only what's new or different for the browser.

## Open questions

None. (Q3-Q6 closed 2026-10-02, see "Resolved".)

## Resolved

- **Q3-Q6.** *Closed 2026-10-02 with the developer (entry "Open questions
  Q3-Q6 closed").* Claude had raised them while setting up and porting;
  none was ever a decision for the developer. Outcomes:
  - **Q3 (`file://` page): parked** until a downloadable version is
    wanted. The hosted site is the product; trying it is a 5-minute test.
  - **Q4 (SysEx delivered whole): resolved by the evidence.** Every full
    export on both computers had 0 re-reads and matched byte for byte; a
    split or merged message would have failed the sanity checks and forced
    a re-read. The F7 warning stays in the log as a tripwire.
  - **Q5 (real read layout): resolved.** The hardware logs show 7 chunks
    at offsets 0, 185, ... 1110 (370 nibbles each, 132 in the last), 1176
    decoded bytes (entry "Hosted site, this computer"). The fake pedal had
    assumed 183-byte chunks and 1182 bytes; it now uses the real layout,
    and a test pins it.
  - **Q6 (handshake for reads): settled, keep CLI parity.** The app keeps
    sending the identity query and "enter editor mode", as the tested CLI
    does. Whether editor mode visibly changes the pedal isn't pursued.

  The original questions, for the record:

  - **Q3. Does Web MIDI SysEx work from a local `file://` page** in Chrome
    and Edge? This decides whether a downloadable single-file version is
    possible.
  - **Q4. Does the browser deliver each SysEx message whole?** Web MIDI
    should, but a split or merged message would need reassembly in the core.
    *The app logs a warning for any SysEx without a closing F7.*
  - **Q5. What do real read replies look like?** The CLI never recorded the
    exact chunk layout (offset units, payload sizes) or the decoded dump
    length. The fake pedal in the tests *assumes* the write path's layout:
    183-byte strides, offsets in decoded bytes, a 1182-byte dump. Only
    chunk order depends on the offsets, so a wrong assumption wouldn't break
    exports, but the fake should match reality. *The app logs the real
    layout on the first read of every export ("First read ...").*
  - **Q6. Is the connect handshake needed for read-only use?** The CLI always
    sends the identity query and "enter editor mode"; reads work without
    them (PROTOCOL.md §2). The web app does the same, for parity with the
    tested CLI. Open: does editor mode have any visible effect on the pedal?

- **T1. Background-tab timer throttling.** *Resolved 2026-10-02: a hidden
  tab doesn't slow the fast restore.* Two full restores on this computer
  (Edge, live site), each hidden for all but its first second or so: 27.8 s
  and 27.4 s, writes about 108 ms apart hidden vs about 124 ms visible,
  511 of 511 verified, both compares MATCH (entry "Hidden-tab round
  trip"). Not covered: a write needing re-reads while hidden (the 25 ms
  re-read pause is the one timer left; none was needed), and a hidden tab
  on laptop battery. The original question:

  Chrome slows timers in hidden tabs (to about once a second as soon as
  the tab is hidden, and after about 5 minutes hidden it can throttle chained timers to roughly once a
  minute). The write pacing (40 ms chunk gaps, 1 s settle) runs on
  `setTimeout`, so a restore in a hidden tab could slow down drastically.
  Longer gaps are probably harmless to the pedal, but this is untested.
  *Now built (see the entry "Write-timing test"): per-write timing with a
  warning when a write runs long, hidden/visible changes in the log, a
  banner after a hidden mid-write, and a screen wake lock during jobs.*
  Still to do: measure a hidden-tab restore on real Chrome; if it's slow,
  fix the remaining timers (a Web Worker clock, or timestamped
  `MIDIOutput.send(data, timestamp)`). If T2 shows the settle can be
  replaced by read-backs, only the 7 chunk gaps would still need timers.

- **Q1. Does the browser's MIDI path behave like Python's?** The CLI's
  read noise (dead bytes `0x43`/`0x9F`, about 10% of reads) is suspected to
  come from the Windows USB-MIDI driver. The browser reaches the pedal
  through a different MIDI layer, so it may be cleaner, the same, or
  different. *Resolved 2026-10-02: it produces the same backups, and
  cleaner reads.* Full exports matched the CLI's byte for byte on this
  computer (2026-09-30) and the backup from the hosted site on both
  computers (2026-10-02 entries); none needed a re-read. The dead bytes
  are normalized anyway, so this doesn't change any rule.

- **Q2. How long does reading all 256 slots take in the browser?** This
  decides how much progress/cancel UI is needed. *Resolved 2026-10-02:
  about 0.3 s (1 ms per slot), 0 re-reads, on this computer from the
  hosted site in Edge; the export matched the backup byte for byte (entry
  "Hosted site, this computer"). A full backup is effectively instant, so
  it needs no cancel button; the progress UI can stay minimal. The laptop
  log will add a second data point.*

- **T2. Restore speed.** *Resolved 2026-10-02: the fast pacing (no
  pauses, read back until it matches, then the preset change; about 0.11 s
  per patch, a full restore in about 28 s) is the restore's pacing.* Two
  full-pedal round trips (shifted from 1B, back from 1A), the second
  without `?dev`: 1,022 of 1,022 writes verified, all four `compare-zips`
  results MATCH (256 of 256 slots each), not even a pedal-managed byte
  different. The only side effect ever seen, 0x44e/0x456 reading or
  becoming 0, changes no setting in Valeton's editor. See the entries of
  2026-10-02. The original question and plan, for the record:

  T2 as it stood: *Reopened. The read-back pacing (no pauses) was
    shipped, then withdrawn after the phase 2 gate showed the pedal changing
    a byte after verify (entries of 2026-10-01). The restore is back on the
    CLI's pacing. Any speed-up needs a test that re-reads slots after moving
    on, with patches carrying nonzero 0x44e/0x456.* Original question: about 1.9 s per patch at the CLI's pacing (a full
    restore takes about 8 minutes); the 1 s settle dominates. The CLI's
    `calibrate-settle` history shows settle was once suspected in write
    failures that later traced to the dead bytes, so a shorter settle may be
    safe now. Only change it with a measured test. Agreed approach:
    - There is no write ACK (PROTOCOL.md section 2), and Web MIDI's `send()`
      is fire-and-forget, so the pedal's flash-commit time is invisible. The
      ~0.3 s is only our own chunk pacing, not the write time.
    - **Sweep:** add a developer-only timing control plus an "alternate
      set X / set Y on 64A-64D for N cycles" test mode. Every write must
      *change* the slot's content, or a write that silently didn't land
      would still verify. Try settle 1000, 500, 250, 100, 0 ms; count
      verify failures per setting; finish with export + `compare-zips`.
    - **Idea: the read-back as the ACK.** Instead of a fixed settle, start
      reading back right after the burst and repeat (bounded) until the new
      content appears, which measures the real commit time per write. Unknown:
      whether a read during the flash commit can disturb the write. Test on
      scratch slots before relying on it.
    - Scratch slots 64A-64D are factory defaults, safe to overwrite (a
      factory reset restores them). Keep the defaults unchanged until the
      data supports a change.

- **W1. Does the pedal keep what's written at 0x3E/0x40 and tail +5/+10/+11?**
  *Yes, as far as tested.* Every hardware restore on 2026-09-30 (6 writes of
  real exported patches, all with those bytes zeroed) verified, and the
  CLI's verification checks those offsets. A pedal substituting its own
  values there would have failed every one. See the entry "Write path
  confirmed on real hardware".

---

## 2026-09-30: Kickoff decisions

Context: the CLI's read path is trustworthy on real hardware and its write
path is mostly confirmed. The next step is a GUI. These decisions came out
of a planning discussion before any code was written.

**Web app instead of a native GUI.** Considered: a Python desktop GUI (Qt
or Tkinter), a Python program serving a local web page, Electron/Tauri, or
a pure web app. Only the web app avoids building per-platform executables.
The CLI already shows that cost is real: unsigned-app warnings on Windows
and macOS, and glibc limits on Linux.

**Chrome/Edge only is acceptable.** Web MIDI with SysEx works in
Chromium-based browsers on every desktop OS; Safari lacks it, and Firefox
gates it behind an unusual permission add-on. Other open-source GP-200 web
tools have the same limitation and the community knows it.

**GitHub Pages hosting.** Free, HTTPS (which Web MIDI requires), and fits
a static app.

**New repo, JavaScript, not Python.** The browser runs JavaScript. Running
Python in the browser (Pyodide) was ruled out: a download of roughly 10 MB,
and the code would still need JavaScript glue for Web MIDI. The expensive
part of the CLI was *learning the protocol*, and that lives in the protocol
notes, not in Python syntax. A separate repo keeps two toolchains and CI
setups apart; the CLI stays the stable reference.

**Plain JavaScript modules, no build step.** Simplest fit for Pages;
what's committed is what runs.

**Read-only first.** Phase 1 is connect, list, export. It's useful by
itself and can't damage anyone's patches. Writing waits until the browser's
MIDI path is proven (Q1) and the CLI's write path is fully confirmed.

**Diagnostic commands stay in the CLI.** `reread`, `drift`, `soak` and the
rest were research tools; users don't need them.

**Simpler read reliability than the CLI.** The CLI's "read until two
reads agree" (up to 7 tries) was, on the evidence, a workaround for one
quirk. From `PROTOCOL_NOTES.md`:
- Every read-to-read disagreement ever observed landed on the two dead
  bytes (`0x43`, `0x9F`), never elsewhere.
- The device persists `0x00` there even when asked to write another value,
  and Valeton Desktop shows no setting difference.
- `drift` showed it's single-read noise around a fixed `0x00`, tied to the
  number of reads rather than elapsed time.
- Once the CLI ignored and normalized those bytes, `export --all` retries
  nearly disappeared on both machines.

So the web app does one read, normalizes the known-changing bytes, runs
sanity checks, and re-reads only on a failed check. Writes (phase 2) get
one read-back compare with clear pass/fail, not retry loops. **Caveat:**
this rests on evidence gathered through Python's MIDI path; Q1 must confirm
it holds in the browser.

**Acceptance tests replace a separate diagnostics page.** Originally we
planned a hidden link-check page. The developer proposed a better test:
compare CLI and web app export-all zips, then a full round trip. That tests
the real feature end to end against a trusted reference. Refinement agreed
during discussion: the round trip must write something *different* first,
or a write that silently does nothing would still pass. Details in
`DESIGN.md`.

**Order of work.** Web MIDI layer before screen design. The transport is
the biggest risk and the UI can't fix it, and what we learn (Q2) shapes the
UI. Plan:
1. Repo with `DESIGN.md` and this journal.
2. Protocol core plus a bare page (Connect, Export All, log), published on
   Pages.
3. Run the phase 1 comparison test on both computers.
4. Clickable screen mockups.
5. Real phase 1 UI on top of the proven core.

UI ideas captured for step 4: a slot grid with select-all, an export
button disabled until something is selected; for restore, a starting slot
plus a file picker for `.prst`/`.zip`. See `DESIGN.md`, "Phases".

## 2026-09-30: Read path ported; bare test page

Built step 2 of the plan: the protocol core for reading, a bare page, and
the tooling for the phase 1 acceptance test.

**What was ported, from the CLI at commit `9a6cc68`:** slot labels, the
read request, identity query and enter-editor-mode messages, chunk
reassembly (7-bit offsets, nibble decoding), `.prst` building from the
skeleton, `normalize_export_dynamic_fields`, export file naming
(`safe_filename`), User-IR/NAM detection, and the export warnings (gap and
IR/NAM). Deliberately *not* ported: `read_dump_confirmed` (see the
reliability rules in `DESIGN.md`), all write code, all diagnostics.

**Parity is tested against the CLI's own code, not a reading of it.**
`tools/make_golden.py` imports the CLI's `gp200.py` (with `mido` stubbed,
since only pure functions are called) and runs 10 dumps through it. They
cover the dynamic fields that must be zeroed and the 0x34/0x90 slot mirrors
that must *not* be, empty and unsafe names, non-ASCII bytes, and short and
long dumps. The JS must match every output byte-for-byte.

Two porting details the golden tests pin down, either of which would have
produced different file names from the CLI:
- Python's `str.strip()` also strips `\x1c`-`\x1f`; JavaScript's `trim()`
  doesn't. Ported as an explicit character set.
- Python's `decode("ascii", "replace")` turns each non-ASCII byte into one
  U+FFFD, which ends up in the CLI's file names. The port does the same, so
  names compare equal; the zip writer sets the UTF-8 flag for such names,
  as Python's `zipfile` does.

**Verification so far.** Node.js isn't installed on the development
machine yet, so the Node suite hasn't run locally. Instead, the page was
served locally and exercised in Chromium (the desktop app's built-in
browser):
- All modules load with no console errors.
- All 10 golden cases match, plus the embedded skeleton equals the CLI's.
- A 256-slot export against the fake pedal with simulated dropped chunks
  on 5 slots: 256 of 256 read, 5 re-reads logged, zip built (343 KB).
- The real page, with the fake pedal presented as a Web MIDI port next to
  an unrelated "Microsoft GS Wavetable Synth" port: auto-detect picked
  the GP-200, Connect ran the handshake, and exporting 34A-34D saved
  `gp200_34A_to_34D.zip` with 4 entries.

None of this touches real hardware; that's the phase 1 acceptance test.

**Why `.prst` building overlays at most 1182 bytes.** The overlay stops
at the checksum (0x4C6), exactly like the CLI, even when a dump is longer.
Tested with a 1300-byte dump.

## 2026-09-30: First real-hardware run (connectivity)

Reported by the developer after running the bare page from localhost in
Chrome/Edge against the real pedal: **connecting and exporting both work.**
The full CLI comparison (phase 1 gate) is next and isn't done yet.

UI feedback from that run: with only **To** filled in, Export appeared to
do nothing. Cause: a lone To was treated as a one-slot range, so it quietly
exported just that slot. Fixed with `slotsBetween()` in `src/core/slots.js`
(tested): a blank From means 1A, a blank To means 64D. The log now names the
range it's exporting. For the designed UI (step 4): range entry should make
its meaning visible before anything runs, e.g. by highlighting the selected
slots in the grid.

**First CLI comparison: 4 of 4 identical.** The developer exported the same
four slots with the CLI and with the web app (from localhost), and
`tools/compare-zips.js` reported all 4 slots byte-identical. Small sample,
but it's the first real evidence for Q1: through the browser's MIDI layer,
the JS port produced exactly what the Python CLI did. The full 256-slot
comparison, repeated on both computers, is still the phase 1 gate.

**Full comparison, computer 1: 256 of 256 identical.** CLI `export --all`
vs. the web app's export of all slots (from localhost), one after the
other: `compare-zips.js` reported `256 slot(s) identical, RESULT: MATCH`.

The compare finished instantly, so the result was double-checked rather
than taken on trust:
- Two genuinely different files: the CLI's zip is deflated (120,444 bytes),
  the web app's stored (342,682 bytes), written 56 s apart.
- Inside: 256 entries each, all 1224 bytes, 313,344 bytes per side, and
  **256 distinct contents per side**. Slots sharing the default name
  "It's GP-200" still differ, since each carries its own slot-mirror bytes.
- Negative controls, run against the web zip modified in memory: one
  flipped bit in 35B was reported at exactly 0x144 (255 identical);
  swapping the contents of 3C and 3D under their original names was
  reported as both differing (254 identical); removing 64D was reported as
  "only in CLI" (255 identical).

Conclusion: the compare really checks every byte, and on this computer the
browser path reproduces the CLI's full backup exactly. This is strong
evidence for Q1, not yet a resolution: the plan calls for repeat runs and
the second computer. The instant finish is expected, since 313 KB is a
trivial amount to compare.

**User-IR/NAM warning confirmed on real hardware.** During the full web
export, the page warned that 2 of the developer's patches reference
User-IR/NAM (SnapTone) slots. Those are real patches using those
features, so the ported detection (`findIrNamDependencies`) works on real
dumps, not just the golden fixtures.

## 2026-09-30: Write path ported (restore, test build)

Moved phase 2 forward on the developer's call: reading was proven well
enough, and the untested half of the Web MIDI layer was writing. The
original precondition, "the CLI's write path must be confirmed on hardware
first", was re-checked against `PROTOCOL_NOTES.md` and found met for the
flash upload: since the RigSheet addressing fix, uploads persist (the
dead-byte write test verified everything except the two dead bytes), and
three soak runs recorded 0 writes that failed to store. The "live" method
has a known bug with some effect types, so it isn't ported.

**Ported from the CLI:** `build_upload_image`, `build_upload_chunks`,
`build_preset_change`, `write_slot`'s sequence and pacing (40 ms per chunk,
1 s settle, preset change, 300 ms; 300 ms between patches),
`verify_write_full`'s comparison (`diff_prst_content` + dead bytes), and
`upload`'s ordering and placement rules.

**Pinned to the CLI's own code** (golden fixtures from `make_golden.py`):
the full upload SysEx for 4 patch/slot combinations is byte-identical; the
verify comparison flags exactly the same offsets as the CLI's for 16
probed offsets; zip ordering matches for labelled and mixed names.

**Deliberate difference:** one write, then verify. A mismatch gets one
confirming re-read (to tell read noise from a bad write) but no automatic
rewrite; the CLI rewrote up to 10 times. Rationale in `DESIGN.md`.

**Negative controls, in the test suite against the fake pedal** (the fake
now models the documented write behaviour: writes discarded without
editor mode, slot mirrors recomputed, dead bytes forced to 0):
- a write without the editor-mode handshake is discarded; verify reports
  it with the name mismatch
- one wrong nibble in one upload chunk is reported as a failed write
- a glitched read-back is re-read and correctly *not* reported as failed
- export -> write elsewhere -> export: identical apart from ignored bytes

**In the browser (Chromium), real page, simulated pedal:** exported
64A-64D, picked a 1A-1D zip, restore start 64A. The plan table showed
file -> slot -> replaces "It's GP-200"; the confirm prompt appeared; 4 of
4 written and verified in 7.6 s. At the CLI's pacing that's about
1.9 s per patch, so a full 256-slot restore will take about 8 minutes.

**Not verified yet: real hardware.** Test plan agreed with the developer:
scratch slots 64A-64D (factory defaults; a factory reset restores them),
single patch first, then a range, then the full round robin (export all,
restore all, export all, compare).

## 2026-09-30: Write path confirmed on real hardware (scratch slots)

Run by the developer from localhost in Chrome/Edge against the real pedal,
using factory-default slots 64A-64D as scratch. **Everything passed:**
1. Baseline: exported 64A-64D.
2. Single patch: exported one of the developer's own patches and restored
   it to 64A. Verified; the pedal switched to 64A showing the patch.
3. Range: restored the earlier 1A-1D web export to 64A-64D. 4 of 4
   verified.
4. Put back: restored the step-1 baseline to 64A-64D, exported again, and
   `compare-zips` against the baseline reported MATCH. So the round trip
   holds per an independent tool, not just the app's own verification.

This settles W1 (see Resolved) and is the first evidence that the browser's
MIDI output behaves like Python's. No read-back needed its confirming
re-read.

Next: the full round robin (export all -> restore all -> export all ->
compare), about 8 minutes of writing at the CLI's pacing; then the second
computer; then merge and GitHub Pages.

**Retrospective note (developer):** the web port reached this point in
under a day, against many days for the CLI. The difference was the CLI's
slow, careful, documented groundwork: `PROTOCOL.md`/`PROTOCOL_NOTES.md`
were the spec, and the CLI's own code served as a byte-exact reference
through the golden fixtures. The expensive knowledge (dead bytes, device-
owned fields, upload addressing, pacing) carried over to a completely
different implementation for free.

## 2026-09-30: Full round robin passed (all 256 slots)

Run by the developer from localhost against the real pedal:
1. Web export of all slots, 3:37 PM (`gp200_all_patches.zip`).
2. Restore of that zip to all 256 slots from 1A: **256 of 256 verified.**
   The developer observed a little over a second per patch.
3. Web export of all slots again, 3:48 PM (`gp200_all_patches-roundrobin.zip`).
4. `compare-zips` (1) vs (3): 256 entries each, 313,344 bytes compared,
   **256 identical, MATCH.**

A second comparison was run against the 2:35 PM export, which predates all
of today's writing and had itself matched the CLI's `export --all`
byte-for-byte: again **MATCH**. So after every write made today (the scratch
tests on 64A-64D, putting them back, and the full restore), the pedal holds
exactly what it held this morning, per both the web reader and, by
transitivity, the CLI's.

What this does and doesn't prove: it proves 256 back-to-back writes plus
verifications through Web MIDI with no corruption and no failures. On its
own it can't prove each write *landed*, because each slot got back the
content it already had. That was proven separately on 64A-64D with
content that differed. The step-6 CLI re-export (independent reader after
the restore) wasn't run; it's optional given the transitive chain above.

**Status at end of day:** read and write paths confirmed on real hardware
on the developer's main computer. Open before UX work: T1 (background-tab
throttling), T2 (restore speed, via a settle-time sweep that alternates
two different patch sets on the scratch slots so every write changes
content, with the read-back as the evidence), and the second computer.
Then merge to GitHub Pages and start mockups.

## 2026-09-30: Write-timing test (T1/T2 tooling)

**Principle agreed with the developer:** don't risk flakiness for speed.
Pauses and steps get removed only when a measured hardware test shows
they're unnecessary; until then the shipped timing stays the CLI's.

**Why read-backs instead of a shorter fixed settle.** The pedal sends no
write ACK, so any fixed settle is a guess sized for the worst case. A read
finishes when the pedal's reply arrives, which (a) measures the real
commit time per write and (b) is a MIDI event, not a timer, so hidden-tab
throttling doesn't stretch it. The 7 chunk gaps can't be replaced this
way (no reply per chunk), so T1 still needs a small fix for those if the
hidden-tab measurement shows it matters.

**What was built** (developer-only; the panel appears only with `?dev` in
the address):
- `src/core/tuning.js`: writes to the scratch slots 64A-64D only (item i
  of each set goes to 64A+i). Before each write it picks whichever set the
  slot doesn't already hold, so every write changes the content, including
  the first (the slots are read first) and the one after a failed write.
  Two modes:
  - *fixed*: settle, preset change, verify: a restore with adjustable
    chunk gap / settle / preset-change / between-writes pauses.
  - *poll*: settle (can be 0), then read repeatedly from the end of the
    burst until the new patch appears (poll timeout and limit adjustable),
    then the same preset change and verify. Each answer is classed as the
    new patch, the old one, or "other" (neither: a partial commit, or
    chunks from two replies mixed after a timed-out poll).
  Pass/fail is exactly a restore's `verifyWrite` in both modes. Results: one
  log line per write (actual burst/settle/write times, the poll trace,
  whether the page was hidden), a summary (verify failures, re-reads,
  min/median/max times, what the first reply held), and a CSV download.
- `GP200.readOnce()` (one read attempt, its own timeout, no warnings) is
  now `readDump`'s building block; `writeSlot` is split into `sendUpload`
  and `selectSlot` (same bytes and the same pauses as before) and returns
  how long each phase really took.
- Restores now log each write's real time and warn when it took at least
  twice the plan and 500 ms over (`slowWriteWarning`), noting a hidden page.
- The page logs every hidden/visible change (a warning while writing),
  shows a banner after a hidden mid-write, and holds a screen wake lock
  during export, restore and the timing test.

**Fake pedal:** `commitMs` delays when an upload lands; reads during it get
the old patch, or no reply with `readsDuringCommit: "ignore"`. Tests cover
both, plus a write that never lands (poll limit reached, verify fails),
sets that can't show a write (same patch in X and Y), the slot that already
holds X, and cancel. Suite: 76 tests, all passing (ran three times).

**Checked in the desktop app's built-in Chromium, fake pedal as a Web MIDI
port, poll mode, settle 0, 150 ms fake commit:** 8 of 8 verified; first
reply 10-13 ms after the burst held the old patch, the new one appeared at
108-114 ms (the burst's trailing 40 ms gap counts toward the 150 ms). The
pane was hidden throughout (`document.visibilityState` "hidden") and every
row was flagged hidden, yet bursts took 328-350 ms against 280 ms planned:
no 1-per-second throttling there. That's an embedded browser, not evidence
about real Chrome.

**Hardware plan** (scratch slots 64A-64D, 4 different patches in each set):
1. Fixed mode at the CLI's timing, tab visible: the baseline (should be
   all verified, like the round robin).
2. Poll mode, settle 1000 (reads start only after today's settle): does the
   first reply already hold the new patch?
3. Poll mode, settle 0: when does the pedal first answer, and with what?
   Any "other" or verify failure here is the "can a read disturb the
   commit" answer, and a reason to stop.
4. If 3 is clean over enough writes, fixed mode at shorter settles to
   cross-check.
5. Fixed mode at the CLI's timing with the tab hidden for 5+ minutes (T1).
6. Restore the 64A-64D baseline; export and `compare-zips` against it.
Any change to the shipped timing or to DESIGN.md's "one read-back" rule
waits for these results.

**Hardware step 1 (fixed mode, CLI timing, tab visible): 16 of 16 verified.**
4 slots x 4 writes (`gp200_timing_fixed_settle1000_2026-09-30T23-49-59.csv`),
alternating the developer's own patches (Y: Hard Rock, Lead, Special,
Mandolin; X: 65 Super Reverb, Friedman BE100, GLASGOW KISS, JCM800 Recipe).
No confirming re-reads, never hidden. The slots already held set X, so the
run started with Y and every write changed content.
- Write (before verify): 1630-1664 ms against 1580 planned. The burst took
  310-342 ms against 280 (browser timer overhead on 7 chained timers);
  settle 1001-1017 ms.
- **The verify read-back took only 3-5 ms** (totalMs - writeMs). A full
  7-chunk read is nearly free, so the per-patch time is almost all our own
  pauses (1.3 s of the ~1.65 s), and poll mode can check very often.

**Hardware step 2 (poll mode, settle 1000, tab visible): 16 of 16 verified.**
(`gp200_timing_poll_settle1000_2026-09-30T23-55-01.csv`, same sets.) Every
write's first read, 1004-1019 ms after the burst, already held the new
patch: one poll each, no "old", no "other", no re-reads, never hidden. So
after the CLI's settle the patch is stored *before* the preset change; the
preset change isn't what makes it land. Reads again took 3-5 ms.

**Hardware step 3 (poll mode, settle 0, tab visible): 16 of 16 verified.**
(`gp200_timing_poll_settle0_2026-09-30T23-57-02.csv`, same sets.) The very
first read after the burst held the new patch every time: first reply
13-29 ms after the burst (median about 17), one poll each, no timed-out
polls, no "old", no "other", no re-reads. Write time before verify fell
from about 1650 ms to 651-674 ms.
- "After the burst" includes the burst's trailing 40 ms gap, so the pedal
  answered with the new patch roughly 55-70 ms after the last chunk.
- These first reads took 10-24 ms against 3-5 ms after a 1 s settle, so
  the pedal seems to hold the reply briefly while it finishes storing the
  patch, rather than ignoring the read or answering with the old one.
- **What this doesn't prove yet:** (a) that a patch read back this early is
  in flash, not just in RAM: needs a power cycle, then an export; (b) that
  the preset change, sent about 20 ms after the burst instead of 1 s, was
  honoured (the verify read passes either way; only the pedal's display
  shows it); (c) anything at scale: 16 writes. The shipped timing is
  unchanged.

**Settle-0 follow-up checks: both pass.**
- *Preset change honoured:* after the settle-0 run the pedal's display
  showed 64D "JCM800 Recipe" (developer), so the preset change sent about
  20 ms after the burst, instead of 1.3 s, was acted on.
- *The patches were stored, not just held in RAM:* the developer power-
  cycled the pedal, then exported 64A-64D (`gp200_64A_to_64D-new.zip`). Each
  entry was compared with the set X file last written to it (settle-0 run)
  using `diffPrstContent`. 64A, 64B, 64D: 0 differences, even counting the
  dead bytes. 64C (GLASGOW KISS): one difference, at 0x471 (file 1,
  export 0). That is tail block entry 1 +5, one of the bytes every export
  forces to 0 (`STUDIO_ADDITIONAL_ZEROED_OFFSETS`, as the CLI does); this
  file came from elsewhere, not from an export, and is the only one of the
  four with a non-zero value there. So it's export normalization, not the
  pedal. The verify, which isn't normalized and does check 0x471, passed all
  8 GLASGOW KISS writes; the export can't show that one byte after the power
  cycle, but every byte it does carry persisted.

**Hardware step 3b (poll mode, settle 0, 100 writes, tab visible): 100 of
100 verified.** (`gp200_timing_poll_settle0_2026-10-01T00-06-21.csv`, 25
writes per slot, same sets.) Every write's first read held the new patch:
one poll each, no "old", no "other", no timed-out polls, no re-reads,
never hidden.
- First reply after the burst: min 12, median 16, 95th percentile 27,
  max 34 ms. By slot, the medians were 16-19 ms; 64D had the slowest (34).
- Write before verify: min 625, median 657, max 677 ms (CLI timing: about
  1650). With verify: median 662 ms.
- Together with the settle-0 run, power cycle and preset-change checks:
  116 settle-0 writes, all landed and verified, all persisted (last
  write of each slot), and the preset change was obeyed. On this pedal and
  computer the 1 s settle is not needed for the write to land or for the
  read-back to see it.

**Hardware step 3c (poll mode, settle 0, after preset change 0, between
writes 0, 100 writes, tab visible): 100 of 100 verified.**
(`gp200_timing_poll_settle0_2026-10-01T00-10-01.csv`.) First read held the
new patch every time (13-34 ms, median 20), one poll each, no re-reads.
The verify read, sent right after the preset change, answered in 2-5 ms,
so the pedal doesn't ignore reads while loading a preset, and the next
upload right after the verify landed every time. Write 336-377 ms, nearly
all of it the 7-chunk burst (median 336 ms). So the two CLI 300 ms pauses
aren't needed for writes to land on this pedal and computer.

**Tool change for the chunk-gap test:** `sendUpload` with `chunkGapMs: 0`
now sends all 7 chunks at once with no timer. Before, a 0 ms gap still
went through `setTimeout`, which browsers stretch to about 4 ms after a few
nested calls, so "0" really meant about 4 ms. The shipped 40 ms is
unaffected. Test added (77 tests, all passing).

**Hardware step 4a (chunk gap 10 ms, all other pauses 0, poll mode, 100
writes, tab visible): 100 of 100 verified.**
(`gp200_timing_poll_settle0_2026-10-01T00-56-07.csv`.) First read held the
new patch every time, one poll each, no re-reads. Burst 75-83 ms (planned
70); whole write 127-201 ms (median 143) against about 356 ms with 40 ms
gaps.
- The pedal took longer to answer after a faster burst: first reply 51-121
  ms after the burst (median 63) against 13-34 ms with 40 ms gaps. Counted
  from the *first* chunk instead, it's much faster (about 145 ms against
  about 356), so the pedal seems to work through queued chunks after the
  burst rather than needing gaps between them.
- **Commit time depends on the patch.** First reply by patch: JCM800 Recipe
  106-121 ms and Friedman BE100 median 106 (one 70), the others medians
  57-72. In the 40 ms run the slowest writes were also on 64D. A fixed
  settle sized from one patch could be too short for another; reading
  until the patch appears adapts to that.

**Hardware step 4b (chunk gap 0, i.e. all 7 chunks sent at once, all other
pauses 0, poll mode, 100 writes, tab visible): 100 of 100 verified.**
(`gp200_timing_poll_settle0_2026-10-01T00-57-05.csv`.) First read held the
new patch every time, one poll each, no re-reads. The burst itself took
0 ms of page time (the sends are queued, not paced); the first reply came
67-154 ms later (median 117), and that is the whole write: 72-159 ms with
verify, median 122. At that rate a 256-slot restore is about 35 s of
writing, against about 8 minutes at the CLI's pacing.
- Per patch, the first-reply time was again patch-dependent (medians
  107-143 ms), and some patches were bimodal (JCM800 Recipe: about 80 or
  about 145-155).
- Every pause in the write path has now been run at 0 for 100 writes each,
  with no failures. The write path then has no timers at all, which would
  also settle T1 (a hidden tab can't slow a timer that isn't there), apart
  from read timeouts, which only fire when something has already gone
  wrong.
- **Limits of the evidence so far:** 0 failures in 100 writes bounds the
  failure rate at roughly 3% (95%); not yet checked at these settings: the
  pedal's display (slot switch obeyed), persistence across a power cycle,
  a hidden tab, more than 8 different patches, and the second computer.

**Hardware step 4c (repeat of 4b: chunk gap 0, all pauses 0, 100 writes):
100 of 100 verified.** (`gp200_timing_poll_settle0_2026-10-01T00-59-06.csv`.
`...00-58-08.csv` is a second download of 4b's results, byte-identical.)
First read held the new patch every time; first reply 66-156 ms. So 200
of 200 writes at the most aggressive settings, and 516 of 516 across
every no-settle run so far, with no failure, re-read or timed-out poll.
200 clean writes bounds the failure rate at these settings at roughly
1.5% (95%). The last write to every slot was set Y.

**Fastest-settings follow-up checks: both pass.**
- *Preset change honoured:* after step 4c the pedal's display showed 64D
  (developer), with no pause anywhere in the write path.
- *Stored across a power cycle:* the developer power-cycled the pedal and
  exported 64A-64D (`gp200_64A_to_64D.zip`, 18:01). Every entry matched
  the set Y file last written to it in step 4c (Hard Rock, Lead, Special,
  Mandolin): 0 differences, even counting the dead bytes.

So at chunk gap 0 with no pauses: 200 of 200 writes verified, the last
write to every slot survived a power cycle byte for byte, and the slot
switch was obeyed.

## 2026-10-01: Restore switched to read-back pacing

Agreed with the developer after the T2 runs above. The restore
(`GP200.writeSlot`) now sends all 7 chunks at once, reads the slot back
until it matches (`verifyWrite`: each read up to 500 ms, re-reads 25 ms
apart, at least one re-read, then up to 3 s in all), then sends the preset
change; no fixed pauses, and none between patches. The CLI's pacing is
kept as `CLI_WRITE_TIMING` for the timing test (new "CLI's timing"
button), whose defaults are now the restore's own timing. `DESIGN.md`'s
reliability rules are updated to match.

Why read-until-match and not a short fixed pause: the save time depends on
the patch (12-155 ms seen), so any fixed pause is a guess, and a fixed
pause is a timer a hidden tab can stretch. The 3 s limit is about 20x the
slowest save seen; it only matters when something is wrong.

Change from the old verify: before, a mismatch got exactly one confirming
re-read; now it gets re-reads until the limit. The 0-limit case still
re-reads once (tested). A write that never lands still fails, after about
3 s, with the last mismatches.

Tests (82, all passing): the shipped timing pinned to the measured values;
the order upload -> read -> preset change; a slow save (fake pedal
`commitMs`) waited for; a pedal silent while saving re-read until it
answers; a write that never lands failing after the limit with the slot
still selected; the zero-limit confirming re-read.

**Not yet verified on hardware:** the restore feature itself with this
timing (the timing test exercised the same steps, in a slightly different
order: its verify comes after the preset change). Next: the phase 2 gate
(shifted restore of all 256 slots, then restore back), then a hidden-tab
restore (T1) and the second computer.

Planning note for the gate: in the 15:48 export
(`gp200_all_patches-roundrobin.zip`), 101 of the 255 shifted writes would
put an identical patch over itself (a run of 45 "Template" patches from
36D, and neighbouring "It's GP-200" defaults), so they can't show whether
they landed. About 154 slots really change.

## 2026-10-01: Phase 2 gate, first pass: 50 bytes changed by the pedal

The developer ran the copy-and-shift gate with the new read-back pacing.
Files: `gp200_all_patches-roundrobin.zip` (15:48, "O", the state before
today's writes apart from 64A-64D), `gp200_1A_to_32D.zip` (18:13),
`gp200_all_patches.zip` (18:22, "X"), `gp200_all_patches-S.zip` (18:24, "S").
X turned out to hold 1A-32D already shifted up by one (1B = O's 1A, ...)
plus an unshifted copy of O's 1A-32D in 33A-64D, i.e. the 1A-32D zip was
apparently restored once from 1B before being restored to 33A. S is X
restored from 1B. The checks below use the files as they are.

- **Shift X -> S:** 1A unchanged; every patch landed one slot up with the
  right name. 205 of 255 shifted slots match X's patch from the slot below
  byte for byte (all content bytes except the slot mirrors). **50 differ in
  exactly one byte, always a value 2 that became 0:** 0x456 in 32 slots,
  0x44e in 18. No other offset differs anywhere.
- **Copy O -> X (33A-64D):** 0 differences in 128 slots, including the
  nonzero values at those two offsets. So the same values survived one
  restore and were reset in another.
- Not every nonzero value was reset: X had 60 slots with 2 at 0x456 and 20
  at 0x44e; S still has 28 and 2.
- The last slot written in the shift (64D, never switched away from before
  the export) matches exactly.
- The region looks like 8-byte records at 0x448, 0x450, 0x458
  (`10 00 04 00 | n p v 00`, n = 0, 1, 2); 0x44e and 0x456 are the `v`
  byte of records 0 and 1. Not mentioned in the local copy of the CLI's
  `PROTOCOL_NOTES.md` (2026-09-27).

Open: did the restore's verify pass for these slots (then the pedal
changed the byte after the read-back, e.g. on the preset change or on
switching away), or did they fail? Needs the restore log. Also whether the
first restores ran the old or the new code (the summary line's seconds
per patch tells). The developer saw "a few pauses" during the restores.

**From the log (`gp200_web_2026-10-01T01-34-27.log`), the actual steps:**
export 1A-32D (18:13 zip) -> restore it to 33A (125/128 verified) ->
export all -> restore the 1A-32D zip from 1B (125/128) -> restore it to 33A
again (125/128) -> export all (X) -> restore X from 1B (249/255) -> export
all (S). All four restores ran the new pacing (about 0.2 s per patch).

- **Verify caught 15 failures, all from three source patches:** Hi Sweety
  (1D), Twiggy Blues (4B), Classic 900 (11A). Every time one of them was
  written, the read-back right after the upload had 0 where the file has 2
  (0x456 or 0x44e). Yet the later exports show 2 in those same slots (e.g.
  X 2A, written as Hi Sweety in restore 2, failed verify but exports with
  2). So for these patches the byte reads 0 straight after the upload and
  2 later.
- **44 slots passed verify and changed afterwards** (S vs X: 50 slots
  differ, 6 of them the verify failures). Every one is a 2 that became 0.
  Values of 1 were never changed (12 slots), "I Was a Bass Am" (2/3) kept
  both, and some 2s were kept (Love Yourself, Slow Dancing, COMP Clean,
  Real Jazz, Nathania Jualim4). The same patches behaved the same way in
  both halves of the pedal (e.g. Rock Soul reset at 2C and 34B, Love
  Yourself kept at 5B and 37A), so it depends on the patch, not chance.
- 1A-32D did not change between the 15:48 and 18:13 exports (0 differences).
- With the CLI's pacing this morning, the full round robin (export,
  restore all, export) matched in all 256 slots, and those patches carry
  the same 2s. So the CLI pacing preserved these bytes and the new pacing
  doesn't.

**Conclusion so far:** the no-pause pacing lets the pedal change a byte
after the read-back, which the verify can't see. The timing test missed it
because its 8 patches have 0 in both bytes, and it never re-reads a slot
after moving on. Working hypothesis (untested): with no pause after the
preset change, the next upload arrives while the pedal is still loading
the slot it just switched to, and when it later switches away it saves a
half-initialized state of these bytes back into that slot. Next: put the
restore back on the proven CLI pacing, repair the pedal from the 15:48
export, and then test which pause matters using patches that carry these
values, with a re-read of every slot at the end of the run.

## 2026-10-01: Restore back on the CLI's pacing

On the developer's call, the restore is back to exactly the CLI's sequence
and the original verify: upload with 40 ms gaps, 1 s settle, preset change,
300 ms, one read-back (one confirming re-read on a mismatch), 300 ms
between patches. The read-until-match verify is removed. The timing test
stays (defaults: the CLI's pacing again), and its chunk gap 0 still sends
with no timer. `DESIGN.md` records the withdrawn attempt and the condition
for trying again. Tests: 80, all passing; they pin the CLI values and the
order upload -> preset change -> read-back.

Lesson for the standards skill (proposed): *a timing test must check the
state after the whole operation, not only each step's own read-back, and
its test data must cover the value ranges the real data has.* The 516
clean timing-test writes used 8 patches with 0 in the affected bytes and
never re-read a slot after moving on, so they couldn't see this.

Next: the developer restores `gp200_all_patches-roundrobin.zip` (15:48) from
1A with this pacing, exports all, and `compare-zips` against it. Expected:
MATCH, as this morning; that also re-tests the CLI pacing on the patches
with 2s at 0x44e/0x456.

**Order agreed with the developer:** get computer 1 solid first (repair
restore + compare, then any speed-up proven with the stronger test and a
full-pedal gate). The second computer comes after that, not in parallel.
The developer notes that earlier second-computer testing showed no
difference; this journal has no web-app run on that computer yet, so it
is still to do once computer 1 is solid.

**Pedal repaired: MATCH.** The developer restored
`gp200_all_patches-roundrobin.zip` (15:48) from 1A with the CLI pacing
(commit e651c97), exported all (`1-gp200_all_patches.zip`, 19:28), and
`node tools/compare-zips.js` reported 256 slots identical, MATCH (re-run
here, same result). So the pedal is back to its pre-test state, with
64A-64D at factory defaults, and the CLI pacing again kept every byte,
including the 2s at 0x44e/0x456 that the fast pacing lost, and wrote Hi
Sweety, Twiggy Blues and Classic 900 correctly. (The restore log for this
run wasn't saved; the compare is the evidence.)

## 2026-10-01: Test files moved out of the repo; purge

The repo folder had collected 22 test files (10 exports, 9 timing CSVs, 1
log, 2 stray `.prst` files), all git-ignored, because the browser
downloaded into it and test instructions used repo-relative paths. Agreed
with the developer: test output lives outside the repo, in
`C:\Users\dpark\Documents\GP-200-testing\<date>_<topic>\`; real backups in
`C:\Users\dpark\Documents\GP-200\Backups\`; rules in `CLAUDE.md` ("Files").

- Kept: `gp200_all_patches-roundrobin.zip` (15:48, the pre-test state with
  the developer's own patches) copied to
  `GP-200\Backups\2026-09-30_full-backup.zip`; same SHA-256, and
  `compare-zips` MATCH against the original.
- **Purged to the Recycle Bin on 2026-10-01:** all 22 files, including every
  export, CSV and log named in the entries above. Their results are
  recorded above; those numbers are now the record.

## Proposed additions to the standards skill

For the developer to add to `software-project-standards` (CLAUDE.md
working standard 5). Project-specific details stay in `CLAUDE.md`.

*All three are now in the skill (checked 2026-10-01): item 1 as section 5,
item 2 as "Check the end state" in section 3, item 3 as section 6.*

1. **Keep disposable test artifacts out of the repo.** Hardware or manual
   test runs write their outputs (exports, logs, CSVs, fixtures made for
   one run) to a dated session folder outside the repo
   (`<testing root>/<date>_<topic>/`). Real data worth keeping (e.g.
   device backups) lives in its own permanent place, never in a session
   folder. Test instructions `cd` into the session folder and refer to repo
   tools by full path, consistently from one instruction to the next.
   Once a session's results are recorded in the dev journal, its folder is
   purged, to the recycle bin and with the developer's OK, and the journal
   notes the purge.
2. **A timing or reliability test must check the end state, with
   representative data.** Verify the state after the whole operation (e.g.
   re-read every item after the run has moved on), not only each step's own
   immediate check, and make the test data cover the value ranges real
   data has. Evidence here: 516 clean timing-test writes missed a pedal
   behaviour that changed 44 patches after their per-write verify had
   passed; the 8 test patches had 0 in the affected bytes, and no slot was
   re-read after moving on.
3. **Keep sessions to a manageable length; the journal is the handoff.**
   Long AI-assisted sessions eventually get summarized automatically, and
   detail (exact numbers, file names, what was already tried) can be lost
   or blurred. At natural break points (a result recorded in the journal
   and committed), the assistant says when the session is getting long and
   suggests starting a fresh one. Before switching, it writes a short
   status entry in the journal (what's known, what's left, next steps) and
   commits, so the new session starts from the repo, not from memory.
4. **Before chasing an unexpected difference, check whether it matters.**
   When a test shows something changed that shouldn't have, first find out
   whether the change affects anything the user can see, hear or set
   (e.g. load the before and after into the official editor), *then*
   decide whether to investigate it. Write down the goal and the pass/fail
   criteria before each round of tests, so it's clear when a phase is
   done. Evidence: here, seven timing-test runs and several tool changes
   went into reproducing a byte change that, once checked in the editor,
   changed no setting at all.

## 2026-10-01: Status at end of day (start here next session)

**Known (evidence above):**
- Reading: the web export matches the CLI's byte for byte (all 256 slots).
- Writing at the CLI's pacing (40 ms chunk gaps, 1 s settle, preset
  change, 300 ms, verify, 300 ms between patches; about 1.9 s per patch,
  about 8 min for 256): faithful. Two full restores matched in all 256
  slots, the second one including the patches the fast pacing damaged.
  This is what the restore ships now (commit e651c97).
- Fast pacing (no pauses, about 0.13 s per patch): withdrawn. Each write
  verified, but the pedal later changed a byte (0x44e/0x456, 2 -> 0) in 44
  slots, and 3 patches (Hi Sweety, Twiggy Blues, Classic 900) read back
  wrong right after writing. The verify only checks immediately, so it
  can't see the later change.
- The pedal's save time after an upload is about 12-155 ms depending on
  the patch; with the CLI's 1 s settle, reads always see the new patch.

**Not yet known (performance vs. accuracy decision):**
- Which pause matters. Hypothesis: the pauses after the slot switch (300 ms
  after the preset change, 300 ms between patches) protect those bytes;
  the upload-side pauses (40 ms gaps, 1 s settle) don't. Dropping only the
  upload-side ones would be about 0.6 s per patch (about 2.5 min for 256).
- T1 (hidden tab) with whatever pacing we end up with.
- The second computer: deliberately last, once computer 1 is solid.

**Next steps, in order:**
1. Build the stronger timing test (plan agreed): a late check that re-reads
   each scratch slot before it's overwritten and all of them at the end
   (after switching away), and set files of patches that carry 2s at
   0x44e/0x456 (X: Hi Sweety, Rock Soul, Radio Cat, Shalala; Y: Twiggy
   Blues, Classic 900, Scotland Kiss, Love Yourself), made from
   `GP-200\Backups\2026-09-30_full-backup.zip` into the session folder.
2. Run A (CLI pacing, expect clean), B (all 0, expect late-check failures:
   proves the test can fail), C (chunk gap 0 + settle 0, keep the 300 ms
   pauses), then D (reduce the post-switch pauses one at a time) only if C
   is clean.
3. Anything that passes: the full-pedal shifted gate again, then decide the
   shipped pacing.
4. Then T1, then the second computer, then merge and GitHub Pages.

**Housekeeping:** test files now live outside the repo (`CLAUDE.md`,
"Files"); the developer's pedal will be factory-reset at the end, so its
contents don't matter for testing. At the time of writing, the `CLAUDE.md`
"Files" section and these last journal entries were not yet committed.

## 2026-10-01: Timing test gets a late check

Built as agreed, to look for a faster pacing that keeps the bytes the fast
restore lost. Test tool only (`src/core/tuning.js`, the `?dev` panel);
the restore is unchanged (CLI pacing).

- **Late check:** each write is re-read again after the test has moved on
  and compared with the file (dead bytes ignored, as verify does). Always
  at the end of a run: wait the between-writes pause (so the last slot is
  treated like the others), switch to another scratch slot, wait 1 s,
  re-read every slot used. Optionally (checkbox, on by default) also just
  before each slot is overwritten, which gives a check of every write but
  adds one read (a few ms) before each upload, i.e. slightly lengthens the
  gap under test. Results per write in the log and new CSV columns
  `late`, `lateWhen`, `lateDiff`; the summary counts changed writes and
  how many of them had passed their verify.
- **Fake pedal `fragile` model** of the 2026-10-01 fault: an upload or a
  slot switch within a window after a preset change zeroes a byte in the
  slot just switched to. Tests (84, all passing): the late check catches
  it when every verify passed; longer pauses give no changes; the
  end-of-run check alone still catches it; the final switch doesn't cause
  it.
- **In-page check (built-in browser, fake pedal, 40 ms fault window):**
  all pauses 0: 12 of 12 verified, late check 12 of 12 CHANGED (the old
  test would have reported a clean pass); pauses of 60 ms after the switch
  and between writes: 12 of 12 verified, 12 re-read, none changed.
- **Set files** (session folder
  `C:\Users\dpark\Documents\GP-200-testing\2026-10-01_timing-late-check\`),
  made from `GP-200\Backups\2026-09-30_full-backup.zip`:
  `tuning-set-X.zip` = Hi Sweety, Rock Soul, Radio Cat, Shalala;
  `tuning-set-Y.zip` = Twiggy Blues, Classic 900, Scotland Kiss, Love
  Yourself. Each carries a 2 at 0x44e or 0x456. Files are numbered 1-4 so
  the test keeps that order (64A-64D).

**Runs planned** (10 writes per slot, late check before each overwrite on):
A: CLI pacing, expect clean. B: all four pauses 0, expect late-check
failures (if B is clean, repeat with the checkbox off before trusting the
test). C: chunk gap 0, settle 0, after preset change 300, between 300.
D: only if C is clean, reduce the post-switch pauses one at a time.

## 2026-10-01: Late-check runs A-C (hardware)

Run by the developer in Edge 155 from localhost, session folder
`2026-10-01_timing-late-check\`: baseline export `gp200_64A_to_64D.zip`
(16:00, all four "It's GP-200" factory defaults) and one log for all three
runs, `gp200_web_2026-10-01T23-05-34.log`. No CSVs were downloaded; the log
has every write. **Each run did 4 writes per slot (16 in all), not the
planned 10:** the panel's default was left in place. Late check before each
overwrite on, page visible during every run.

| Run | Mode | Gap / settle / after switch / between (ms) | Verified | Late check changed | Write median (ms) |
|---|---|---|---|---|---|
| A | fixed | 40 / 1000 / 300 / 300 | 16 of 16 | 0 of 16 | 1647 |
| B | poll | 0 / 0 / 0 / 0 | 16 of 16 | 0 of 16 | 95 |
| C | poll | 0 / 0 / 300 / 300 | 16 of 16 | 0 of 16 | 382 |

No confirming re-reads anywhere.

- **A** is clean, as expected.
- **B did not reproduce the fault.** The test that should prove the late
  check can fail on hardware came back clean, so B and C prove nothing yet
  about which pause matters. Per the plan, B is to be repeated with "late
  check before each overwrite" off. That check adds a read in exactly the
  window under test (preset change -> verify read -> late-check read of the
  next slot -> upload). Also, the plan's 10 writes per slot.
- **New: "Love Yourself" never reads back as itself before the preset
  change.** In B and C, all 4 of its writes (64D, #8 and #16 each run)
  polled for the full 5 s limit: about 6,000 reads each, every one complete
  and every one "other" (neither the old patch nor the new one, compared as
  verify does). The verify read just after the preset change then matched,
  and the late check after switching away found it unchanged. The other 7
  patches read back as themselves on the first poll (64-142 ms after the
  burst). Fixed mode (A) never reads before the switch, so it can't see
  this.
- What sets Love Yourself apart in the 0x448 records (`10 00 04 00 | n p v
  00`): both records have p = 08, and record 1 has v = 2 (`01 08 02`). In
  every other set file, p = 08 comes with v = 0, and v = 2 only with p = 02.
  Factory defaults have p = ff, v = 0. *Which bytes the "other" reads
  differed in isn't logged*, so it isn't known whether this is 0x456.
  Working hypothesis (untested): v is a state value the pedal recomputes
  when a preset is loaded, and until then the stored slot reads with its
  own value there. That would also fit the fast-restore fault (bytes in
  0x44e/0x456 changed around slot switches).

**Tool change for the next run:** a poll reply classed "other" now records
where it differed from the new patch: the first such reply (`otherDiff`)
and the last one, if different (`otherDiffLast`), at most 20 offsets each.
Both appear on the write's log line and as new CSV columns. Fake pedal:
`unloadedReads: {off, value}` models the Love Yourself behaviour (reads
show `value` at `off` until a preset change selects the slot). Tests: 86,
all passing (three runs). The new test failed with the recording disabled.

**Next run:** B again, with 10 writes per slot, "late check before each
overwrite" off, log cleared first, and CSV and log both saved to the
session folder.

## 2026-10-01: Run B2 (B again, late check at the end only)

Same session folder: `gp200_timing_poll_settle0_2026-10-01T23-19-22.csv`
and `gp200_web_2026-10-01T23-19-33.log` (cleared before the run). Poll
mode, all four pauses 0, late check at the end only. **Again 4 writes per
slot (16), not 10:** the page logged and ran 4. The page reads the field
as typed and resets it only on load and on "Reset to restore's timing", so
the field held 4 when Run was pressed (cause not known; the confirmation
prompt shows the total).

- 16 of 16 verified, no re-reads. The late check (end of run, so the last
  write per slot only) re-read 4 of 16: none changed. **The fault still
  did not reproduce.**
- Love Yourself (64D, #8 and #16): every poll reply, 2,880 and 2,929 of
  them over 5 s, differed from the file in exactly one byte,
  **0x456: 2 -> 1**, the same in every reply. After the preset change
  the verify read matched (2), and the end-of-run late check found 2. The
  other 7 patches matched on the first poll (65-145 ms).
- So before the slot is selected, the pedal reads back record 1's `v` as 1
  instead of the 2 that was written (`01 08 02` reads as `01 08 01`).
  Selecting it makes it read 2. Contrast with the fast restore (journal
  "Phase 2 gate, first pass"): there Love Yourself verified *before* its
  preset change (at 5B and 37A), and Hi Sweety, Twiggy Blues and Classic
  900 read back 0 instead of 2 before theirs, but here they match on the
  first poll. So what a slot reads back before it is selected depends on
  something beyond the patch itself (perhaps what was loaded or written
  just before). Not yet understood.

**Why B may not reproduce the fault: the order differs from the fast
restore.** The withdrawn restore (commit 540109f, `writeSlot`) did upload
-> read until match -> preset change -> *next upload at once*. The timing
test does upload -> poll -> preset change -> **verify read** -> next
upload, so a full read always lands between the slot switch and the next
upload (it answered in 2-5 ms in step 3c). That's the window the working
hypothesis is about. The 2026-10-01 entry "Restore switched to read-back
pacing" already noted this order difference; it now matters.

*B2's CSV and log were deleted from the session folder by the developer
before a re-run (not a purge). The numbers above are the record.*

## 2026-10-01: Run B3 (B with 10 writes per slot)

`gp200_timing_poll_settle0_2026-10-01T23-23-51.csv` and
`gp200_web_2026-10-01T23-25-02.log`. The log confirms the settings: poll
mode, chunk gap, settle, after preset change and between patches all 0,
poll timeout 500 / limit 5000 ms, late check at the end only, 10 writes
per slot (40). The page was hidden briefly before and after the run, never
during it.

- 40 of 40 verified, no re-reads, never hidden. Late check (end of run,
  last write per slot): 4 of 40 re-read, none changed. **Fault not
  reproduced.**
- Love Yourself, all 5 writes: never read back as itself before the
  preset change (2,090-2,937 polls each), every reply **0x456: 2 -> 1**.
  Verify after the switch matched; its last write was fine at the end-of-run
  check.
- The other 35 writes matched on the first poll, 66-148 ms after the burst
  (median 127).

With the verify read still between the switch and the next upload, three
runs (B, B2, B3: 72 writes) haven't produced the fault.

**Developer's information: patch-change lag.** When changing patches with
the footswitches, the sound changes after a known lag of 3-5 ms, and during
the tests the pedal's screen visibly takes longer to change. Relevance:
(1) the verify read sent right after a preset change answered in 2-5 ms
(step 3c), about the length of that lag, so one read there could be enough
to cover the risky window, which fits B never failing; (2) the screen shows
the pedal keeps working after the sound has changed (the 0x448 records may
be part of that; unconfirmed), so the safe post-switch pause may be nearer
the screen's time than the sound's. Run D should try a range (e.g. 300,
100, 50, 20, 10, 5 ms) rather than assume a few ms is enough.

## 2026-10-01: Timing test: "verify before the switch" option

Built so the test can use the withdrawn fast restore's order: upload ->
(poll) -> verify -> preset change -> next upload, with nothing sent between
the preset change and the next upload (checkbox in the `?dev` panel,
`verifyBeforeSwitch` in `runTuning`). With it on and "late check before
each overwrite" also on, the log warns, since that check reads in the same
gap. The log's header line names the order; the CSV has a
`verifyBeforeSwitch` column and the file name gets `_vfirst`. A failed
verify's reason now lists the offsets (`... differ from the file:
0x456:2->1`). Also: "Reset to restore's timing" no longer resets Writes per
slot (it reset 10 to 4 in run A).

Fake pedal: `fragile.readEndsWindow` (a read after the preset change ends
the fault window: the working hypothesis). Tests (91, all passing, three
runs): the message order in both modes (default: a read right after each
switch; new: an upload right after each switch); under `readEndsWindow`,
the default order gives no fault and the new order gives late-check
CHANGED rows whose verifies all passed; a slot that reads differently until
selected (Love Yourself) fails a before-switch verify with `0x456:2->1`
and is fine at the late check; the warning. Checked in the built-in
browser: page loads with no console errors, checkbox present and unticked,
Reset keeps Writes per slot.

**Expect in B4 (hardware):** Love Yourself's 10 writes fail their verify
(it reads 0x456 = 1 until selected); that is the known quirk, not the
fault. The fault shows as late-check CHANGED rows.

## 2026-10-01: Run B4 (fast restore's order): fault still not reproduced

`gp200_timing_poll_settle0_vfirst_2026-10-01T23-42-02.csv`,
`gp200_web_2026-10-01T23-42-14.log` (commit 13c3222). Poll mode, all four
pauses 0, verify before the preset change, late check at the end only, 10
writes per slot (40), page visible.

- 35 of 40 verified. The 5 failures are all Love Yourself (64D), each
  `0x456:2->1` after a confirming re-read: the known quirk, now seen by a
  verify because it runs before the switch. At the end-of-run late check
  Love Yourself (#40) read as written (2).
- Late check: 4 of 40 re-read, **none changed.** The other 35 writes
  matched on the first poll (69-145 ms).

**Weakness found: the end-of-run late check only covered set Y.** With
"before each overwrite" off, only each slot's last write is re-read, and
with an even number of writes per slot those are all set Y (Twiggy Blues,
Classic 900, Scotland Kiss, Love Yourself). **Rock Soul, the one set patch
known to have been damaged by the fast restore (2C, 34B), was never
late-checked in B2, B3 or B4.** Which of the other set patches were among
the 44 damaged slots isn't known any more (the S export was purged); Hi
Sweety, Twiggy Blues and Classic 900 were the fast restore's *verify*
failures, a different symptom. So B2-B4 check too little to say the fault
is absent: 4 writes each, and the wrong ones. Runs A, B and C did check
every write (before-overwrite check on), but that check puts a read in
the gap under test.

**Proposed fix (not built):** a late check that re-reads each slot *two
writes later*, after that later write's verify and before its preset
change. That's outside the gap after a switch, and it comes after the
pedal has switched away from the slot (in case the damage happens on
switching away). With 4 slots it still comes before the slot is
overwritten. It gives every write a late check without disturbing the
order under test. Cheaper stopgap: an odd number of writes per slot (e.g.
11), so the end-of-run check covers set X including Rock Soul, but still
only 4 checks per run.

## 2026-10-01: Status (start here next session)

**Known:**
- The shipped restore (CLI pacing) is unchanged and faithful.
- Timing test runs this session (scratch slots 64A-64D, sets with 2s at
  0x44e/0x456): A clean; B, C, B2, B3, B4 never reproduced the fast
  restore's late byte change. A, B and C checked every write but with a
  read in the gap after the switch; B2-B4 checked only set Y's last writes
  (see B4).
- Love Yourself reads 0x456 as 1 (file: 2) until its slot is selected;
  after that it reads 2. Repeatable (every write in B, C, B2, B3, B4).
- The pedal's patch-change sound lag is 3-5 ms (developer); its screen
  takes visibly longer.

**Next steps, in order:**
1. Build the "two writes later" late check (above), with a test, then
   B5: poll mode, all pauses 0, verify before the switch, before-overwrite
   check off, 10 writes per slot. Expect late-check CHANGED rows; if none,
   the 4-slot test can't reproduce the fault and the next test needs more
   slots in a row (e.g. a shifted restore over a larger range of scratch
   or real slots: the developer's pedal will be factory-reset at the end).
2. Once the test can fail: C with the same checks, then D (post-switch
   pauses 300, 100, 50, 20, 10, 5 ms).
3. Then the full-pedal shifted gate for whatever passes, T1, the second
   computer, merge and Pages.

Session folder `2026-10-01_timing-late-check\` holds the baseline 64A-64D
export, the set files, and the B3 and B4 CSVs and logs; keep it until
these runs are done.

## 2026-10-01: Timing test: late check "two writes later"

Built as proposed in the B4 entry (step 1 of the Status above). Test tool
only; the restore is unchanged (CLI pacing).

- **New late-check mode:** write k's slot is re-read right after write
  k+2's verify. In the "verify before the switch" order that's before
  k+2's preset change; in the default order it's after k+2's verify read,
  which already follows the switch. Either way nothing is added between a
  preset change and the next upload, the pedal has switched away from the
  slot (at write k+1), and with 3-4 slots it comes before the slot is
  overwritten. Every write gets a late check, in both sets. The end-of-run
  check now re-reads only writes not yet checked (the last two here; in
  the other modes nothing is checked before the end, so they're
  unchanged). The late read's time is kept out of the write's
  `writeMs`/`totalMs`.
- **Change of approach in the panel:** the checkbox "Late-check each slot
  before overwriting it" became a three-way **Late check** choice: before
  each overwrite (still the default), two writes later, at the end only.
  Reason: three modes that exclude each other don't fit a checkbox. Core:
  `runTuning`'s `lateBeforeOverwrite: bool` became `late: "overwrite" |
  "twoLater" | "end"`. "Two writes later" needs 3-4 patches per set (with
  2, write k+2 overwrites the slot first) and is refused before any write
  otherwise. New CSV column `lateMode`; the CSV name gets `_late2`; the log
  header names the mode.
- **Tests: 96, all passing (three runs).** New: under the fault model with
  `readEndsWindow`, vfirst + two-later late-checks all 8 writes and finds
  all 8 CHANGED with every verify passed, while the default order finds
  none; message order in both orders (the late read is a read of the slot
  two writes back, before the switch in vfirst, after it otherwise, and a
  switch is never followed by it); refused with 2 patches per set or an
  unknown mode, nothing written; a 150 ms late read doesn't show in the
  write's times. **Each new test was shown to fail** on a deliberate break:
  late time counted in the write (1 test red), no two-later check (4 red),
  vfirst late read moved after the switch (2 red).
- **In-page check (built-in browser, fake pedal, 4 slots, 3 writes each,
  poll mode, all pauses 0, 40 ms fault window, `readEndsWindow`):** vfirst:
  12 of 12 verified, late check 12 of 12 re-read, **12 CHANGED**; default
  order: 12 of 12 re-read, none changed. Page loads with no console
  errors; the new choice shows with "Before each overwrite" selected.

**Run B5 (next, hardware).** Session folder as before. Expected: Love
Yourself's 10 writes fail their verify with `0x456:2->1` (the known quirk,
not the fault), and the late check re-reads **40 of 40**. The fault shows as
late-check CHANGED rows whose verify passed. If there are none, the 4-slot
test can't reproduce it, and the next test needs more slots in a row.

## 2026-10-01: Run B5 (two writes later): fault not reproduced

`gp200_timing_poll_settle0_vfirst_late2_2026-10-02T00-59-22.csv`,
`gp200_web_2026-10-02T00-59-34.log` (commit 9c6d098). Poll mode, all four
pauses 0, verify before the preset change, late check two writes later, 10
writes per slot (40), page visible throughout.

- 35 of 40 verified. The 5 failures are Love Yourself (64D), each
  `0x456:2->1` after a confirming re-read (2,809-2,928 polls each, every
  one "other" at 0x456 only): the known quirk.
- **Late check: 40 of 40 re-read** (38 two writes later, #39 and #40 at
  the end of the run), **none changed.** That includes all 5 Rock Soul
  writes, the patch the fast restore damaged at 2C and 34B, and Love
  Yourself, which read 2 once selected.
- The other 35 writes matched on the first poll, 73-146 ms after the burst
  (median 128); burst 0 ms; write median 128 ms, with verify 131 ms.

**Conclusion:** with the fast restore's order and pauses, and every write
re-read about 0.3 s later, 4 scratch slots written in rotation don't show
the fault. Seven runs (A, B, C, B2-B5; 152 writes) haven't produced it.
What the timing test still doesn't copy from the failing restore:
1. **Distinct slots in sequence.** The restore walked through 255
   different slots once each; the test cycles 4, so each upload goes to a
   slot it selected about 0.5 s earlier.
2. **Time.** The damage was found by an export minutes after the restore;
   the test re-reads 0.3-1 s after the write.
3. Scale and order of patches: 255 writes of real patches, shifted by one.

**Re-export minutes later: unchanged.** The developer exported 64A-64D
about 3 minutes after B5 ended (17:59 -> 18:02); it was saved as
`gp200_64A_to_64D.zip`, replacing the 16:00 baseline of that name (which
held the four factory defaults; its content is recorded above). Compared
by position with `tuning-set-Y.zip` (scratchpad script, every byte
including the dead bytes): **all 4 identical**, with the 2s at 0x44e
(Twiggy Blues, Scotland Kiss) and 0x456 (Classic 900, Love Yourself)
intact. The same export against `tuning-set-X.zip` differs in 69-97 bytes
per slot (the check can fail). So difference 2 (time) doesn't explain it
for these 4 slots; differences 1 and 3 remain.

## 2026-10-01: Does the 2 -> 0 change matter? Changed-patch pairs

Developer's direction: pursue a faster restore that's reliable, but
remember that not every byte difference changes anything the user can set
or hear; an unexpected change gets attention, then a judgement on whether
it matters. First question: what do 0x44e/0x456 control?

- **Backup survey** (`GP-200\Backups\2026-09-30_full-backup.zip`): 41 of
  256 patches have a nonzero value at 0x44e or 0x456 (all checksums
  valid). The three records at 0x448/0x450/0x458 always start
  `10 00 04 00`, then `n p v 00` with n = 0, 1, 2; p ranges 00-0b (record
  2 is always `02 0b 00`), v 0-3. Seen: v = 2 at 0x44e with p = 02 or 06;
  v = 1, 2 or 3 at 0x456 with p = 00, 02, 03, 06, 08 or 09. Guess (not
  checked): an assignment table (e.g. footswitch/EXP/CTRL), p a module, v
  a parameter or mode.
- **Pairs for the official Valeton desktop software**, session folder
  `GP-200-testing\2026-10-01_changed-patch\` (made by a scratchpad script
  from the backup): `2A_Rock Soul_original.prst` /
  `2A_Rock Soul_changed-0x456.prst` (the patch the fast restore damaged
  after a passing verify) and `4B_Twiggy Blues_original.prst` /
  `4B_Twiggy Blues_changed-0x44e.prst` (read back 0 right after its
  write). Each changed copy differs from its original only at that byte
  (2 -> 0) and the checksum (0x4c7), re-read from disk; both checksums
  valid; originals byte-identical to the backup; patch names unchanged.

Next: the developer loads each pair into the desktop software and
compares every setting, including assignments (footswitch, EXP, CTRL).

**Rule from the developer:** a restore that doesn't preserve the CTRL
button, footswitch and expression-pedal settings isn't good enough, the same
as for effect settings. Recorded in `DESIGN.md` (reliability rules, "What
counts as damage"). The pairs above answer whether the 2 -> 0 change at
0x44e/0x456 breaks that rule.

**Result (developer, Valeton desktop software):** for both pairs the
original and the changed copy **do not differ** in any setting, including
the CTRL, footswitch and expression-pedal settings. The developer has also
checked in earlier testing that uploads preserve these settings. So the
2 -> 0 change at 0x44e/0x456 that the fast pacing caused doesn't change
anything the editor shows. Caveat: the editor shows settings, not
necessarily every piece of state a patch stores; the fast restore's
damage was only ever at these two offsets (S vs X: no other offset
differed in 255 slots).

## 2026-10-01: Fast restore: goal, pass criteria, and the build

Developer's direction: pursue the faster restore; differences that don't
affect a setting don't matter, but any unexpected change gets attention.
The session had drifted into reproducing a byte change before checking
whether it mattered (proposed for the standards skill, item 4 above).

**Goal:** ship the fast pacing (about 0.2 s per patch, about 1 min for 256).
**Pass criteria:** `DESIGN.md`, "Phase 2 gate": the full-pedal round trip
with the fast pacing, both compares MATCH (pedal-managed bytes listed but
not failing), every write verified. Then it ships; otherwise only the
difference found gets investigated.

**Built** (restore still defaults to the CLI's pacing until the gate passes):
- `prst.js`: `PEDAL_MANAGED_FILE_OFFSETS` = 0x44e, 0x456; `splitManaged`;
  `describeOffset` names them.
- `device.js`: `FAST_WRITE_TIMING` (commit 540109f's values plus
  `betweenSlotsMs: 0`); `writeSlot` with fast pacing: upload ->
  `verifyUntilMatch` (540109f's read-until-match) -> preset change. Both
  verifies report pedal-managed differences in `managed` and don't fail
  on them.
- `upload.js` (`writeSlots`): logs the pacing at the start; the pause
  between patches comes from the pacing; a verified slot with managed
  changes logs them; the summary counts them.
- `?dev` restore control "Pacing (developer)": the CLI's (default) or
  fast; the confirmation names fast pacing.
- `compare-zips`: `--shift N`; pedal-managed bytes listed separately and
  not failing; checksum checked for validity instead of compared;
  slot mirrors ignored in shifted slots; the top N slots of A expected
  missing; counts slots and bytes compared.
- Timing test: uses the restore's verify, so managed bytes no longer fail
  it; recorded per write (`managedDiff` column). Its late check still
  reports every byte.
- Fake pedal: `storeAs: {off, value}`.

**Tests: 112, all passing (three runs).** New: fast pacing values; fast
order U x7, R, P; a slow save waited for; a write that never lands fails
after the limit and still selects; in both pacings a managed byte the pedal
changes passes and is reported while the byte next to it fails; fast
restore has no pause between patches, logs the pacing and the managed
changes; the CLI's pacing still pauses 300 ms; compare: managed-only
match, real difference plus managed, invalid checksum, shift with mirrors
and the top slot, a swapped pair caught, mirrors counted unshifted.
**Each was shown to fail** on a deliberate break: managed bytes not split
off (4 red), mirrors not ignored (1), checksum validity unchecked (1),
fast preset change before the read-back (1), between-patches pause not
from the pacing (1). Real data: backup vs itself MATCH (256 slots); backup
vs itself `--shift 1` DIFFERENT, 102 identical (the template runs).
Built-in browser: the pacing choice hidden without `?dev`, shown with it,
default the CLI's; no console errors.

**Gate run (next, hardware):** session folder
`GP-200-testing\2026-10-01_fast-gate\`.

## 2026-10-02: Plan for the fast pacing; confirmation reads

Pushed `read-path` to GitHub (10 commits); from now on each commit is
pushed (developer: protection against disk failure).

**Developer's two ideas, in this order:**
1. **Find out whether anything else should be ignored in verification.**
   Write aggressively over a range of slots; before calling a write
   failed, read it back a few times to see whether the difference stays
   the same or changes; the developer inspects any difference in the
   Valeton editor. Agreed form: the phase 2 gate with the fast pacing
   (511 writes of real patches over the whole pedal, nearly all changing
   the slot) is that test; any difference outside the pedal-managed bytes
   is checked at the exact setting `compare-zips` names. (Writing one
   patch to many slots was considered: a slot already holding it can't
   show a write that didn't land, and the 0x44e/0x456 change depended on
   the patch.) Harmless differences join the ignore list.
2. **Then, only if errors remain, tune the pauses one at a time.** Raise
   all four pauses (chunk gap, settle, after preset change, between
   patches) in 10% steps of their CLI values until clean, then lower one
   at a time to 0 or until errors return. Agreed refinements: all-zero is
   tested first (the gate); time limits (poll/read-back) aren't swept; each
   step is a full-pedal restore + export + compare; the shipped setting
   needs two clean full runs. The developer notes that once harmless
   differences are ignored, everything may pass and idea 2 may not be
   needed.

**Built: confirmation reads** (`device.js`, `CONFIRM_READS` = 3). When a
write's read-back still mismatches (CLI pacing: after its one re-read;
fast: after reading until the limit), the slot is read 3 more times. A full
match passes the write ("matched later"; warning in the log). Otherwise
it fails with `consistency` "stable" (same bytes and values in every read:
stored) or "varies" (read noise, or the pedal still changing it); the
reason says which ("..., the same in all 5 reads"), and for "varies" the
log lists each distinct outcome with a count. A write that matches at once
does no extra reads. `DESIGN.md` updated.

Tests: 117, all passing (twice). New: a write that never lands is
"stable" over 5 reads; in both pacings, a difference that changes from
read to read fails as "varies", and a mismatch that clears on a
confirmation read passes; a clean write does 1 read. Each shown to fail on
a deliberate break (always "stable": 2 red; a later match never passing:
2; no confirmation reads: 6).

Exports read each slot once, so a `compare-zips` difference could be read
noise in the export: before inspecting one, re-export the slots involved
and compare again.

## 2026-10-02: Phase 2 gate with the fast pacing, step 2: MATCH

Session folder `GP-200-testing\2026-10-01_fast-gate\` (commit 25a5121;
Edge 155, localhost).

- `before-gate_gp200_all_patches.zip` (11:53): the pedal before the gate.
  vs the backup: 252 identical; 64A-64D hold the timing test's set Y.
  (A first attempt at step 2 never started writing; a second ran with the
  CLI's pacing by mistake and was stopped with "Stop after this patch",
  leaving a partly shifted pedal. Neither run's log was kept.)
- **Shifted restore, fast pacing** (`after-shift_gp200_web_2026-10-02T19-01-42.log`):
  backup from 1B, 255 patches **in 29.2 s, 255 of 255 verified**, no
  confirmation reads. 3 read back with a pedal-managed byte changed:
  2A Hi Sweety 0x456 2->0, 4C Twiggy Blues 0x44e 2->0, 11B Classic 900
  0x456 2->0 (the same three patches as in the first fast restore).
- **`compare-zips --shift 1`** backup vs `after-shift_gp200_all_patches.zip`
  (12:02): **256 slots identical, RESULT: MATCH**, no pedal-managed
  differences either: the three bytes that read 0 right after writing
  export as 2. The first fast restore's late 2 -> 0 change (44 slots)
  didn't recur. (Some slots already held their shifted patch from the
  stopped CLI-pacing run; step 3 rewrites every changed slot again.)
- **Hidden page (T1), incidental:** the page was hidden 65.2-102.0 s; the
  restore finished at 73.5 s. Writes while hidden: 92, mean 90 ms apart;
  visible: 162, mean 129 ms. No slowdown, as expected with no timers;
  only 8 s of hidden writing, so not a full T1 answer.

Next: step 3, restore the backup from 1A with the fast pacing, export,
compare unshifted.

**Step 3, restore back, fast pacing**
(`after-restore_gp200_web_2026-10-02T19-06-10.log`): backup from 1A, 256
patches **in 28.5 s, 256 of 256 verified**, no confirmation reads, page
visible. The same 3 patches read back with a managed byte at 0 (1D, 4B,
11A). **`compare-zips`** backup vs `after-restore_gp200_all_patches.zip`
(12:06): **256 identical, RESULT: MATCH**, no managed differences. Step 3
changed 154 slots (after-shift vs after-restore: 102 identical, the runs
of identical templates).

**Gate result: PASS** by the criteria in `DESIGN.md` (both compares MATCH,
511 of 511 fast writes verified). No difference outside the pedal-managed
bytes appeared, so nothing new joins the ignore list, and the pause sweep
(idea 2) isn't needed. The pedal is back to the 2026-09-30 backup
exactly (64A-64D at factory defaults again).

## 2026-10-02: Fast pacing made the default (confirming run next)

Agreed with the developer: make the fast pacing the restore's default now
and run the second, confirming round trip with it, so the run tests
exactly what users get and there's no setting to forget.

- `device.js`: `CLI_WRITE_TIMING` = the CLI's values (renamed from
  `WRITE_TIMING`); `WRITE_TIMING` = `FAST_WRITE_TIMING`, also the
  `GP200` default. Fast-pacing doc corrected: the extra re-read happens
  only on a mismatch (a clean write reads once).
- `?dev` restore pacing: "Fast (about 0.1 s per patch)" first and
  selected; "The CLI's (about 1.9 s per patch; fallback)" second; the
  confirmation names the CLI's pacing when chosen. Without `?dev`: fast.
- Timing test: its defaults stay the CLI's values (`CLI_WRITE_TIMING`);
  button renamed "Reset to the CLI's timing".
- `DESIGN.md`: write method and pacing bullets updated.
- Tests: 117, all passing; the default-pacing test fails if
  `WRITE_TIMING` is set back to the CLI's values (checked). Built-in
  browser: Fast selected by default, no console errors.

**Confirming run:** the same round trip without `?dev` (the page as users
get it), files saved to `2026-10-01_fast-gate\` and renamed `confirm-...`.

## 2026-10-02: Confirming round trip (fast by default): MATCH

Page without `?dev` (developer tools off), commit 86f6b50, Edge 155,
visible throughout. Files in `2026-10-01_fast-gate\` with prefix
`confirm-`.

| Step | Writes | Time | Compare vs backup |
|---|---|---|---|
| Shifted from 1B (`confirm-after-shift_...19-15-09.log`) | 255 of 255 verified | 27.0 s | `--shift 1`: 256 identical, MATCH |
| Back from 1A (`confirm-after-restore_...19-18-16.log`) | 256 of 256 verified | 27.5 s | 256 identical, MATCH |

Same three managed-byte read-backs each time (Hi Sweety, Twiggy Blues,
Classic 900); no confirmation reads; step 3 changed 154 slots. **The fast
pacing ships** (T2 resolved). The pedal is back to the 2026-09-30 backup.

## 2026-10-02: Status (start here next session)

**Known:**
- Reading: the web export matches the CLI's byte for byte (computer 1).
- Restore: fast pacing by default, about 28 s for 256 patches; 1,022 of
  1,022 full-pedal writes verified, four compares MATCH. The CLI's pacing
  stays as a `?dev` fallback.
- Pedal-managed bytes 0x44e/0x456: change no setting; verify and
  `compare-zips` list them without failing.
- A failing read-back gets 3 confirmation reads (stable vs varies).

**Next steps, in order:**
1. T1: a deliberate hidden-tab restore (only 8 s of hidden writing seen
   so far, no slowdown). Probably a short test now that nothing waits on
   timers.
2. The second computer: export vs CLI, and a fast round trip.
3. Merge `read-path` to `main` and publish on GitHub Pages.

**Housekeeping:** session folders `2026-10-01_timing-late-check\`,
`2026-10-01_changed-patch\` and `2026-10-01_fast-gate\` have their
results recorded here and are due for purging (with the developer's OK).
The standards-skill proposal (item 4, "check whether a difference
matters") is in "Proposed additions" for the developer to add.

**Purged to the Recycle Bin on 2026-10-02** (developer's OK): `2026-10-01_timing-late-check\` (10 files), `2026-10-01_changed-patch\` (4) and `2026-10-01_fast-gate\` (10). Their results are recorded above; those numbers are now the record. `GP-200\Backups\2026-09-30_full-backup.zip` is untouched.

## 2026-10-02: Merged to main; site published on GitHub Pages

The second computer has no Python and no copy of the repo, so it needs the
hosted site; on the developer's OK the merge came before the
second-computer test instead of after it.

- PR [#1](https://github.com/donpark2000/GP-200-Patch-Manager-Web/pull/1)
  retitled ("Backup and restore over Web MIDI: read path, restore with
  fast pacing, test tools"), description updated, merged with a merge
  commit (0ef1c4f, 36 commits). `read-path` kept.
- CI on main: tests passed, deploy succeeded. Live at
  https://donpark2000.github.io/GP-200-Patch-Manager-Web/, `version.js`
  stamped `0ef1c4f (2026-10-02)`. Built-in browser: secure context, Web
  MIDI present, developer tools hidden without `?dev`, no console errors.
  (CI notes: Node 20 actions are being forced onto Node 24; ubuntu-latest
  moves to Ubuntu 26 from 2026-10-19. Neither affects the build yet.)
- Local server stopped.

Next: export all from the hosted site on this computer and compare with
the backup (session folder `2026-10-02_hosted-site\`), then the same on
the laptop (copy its export here to compare; no Python needed there).

**README:** the developer reviewed PR #2's README; the CLI-comparison
testing is behind us, so the README no longer mentions it (status, file
naming and the compare example reworded). Kept: "web companion to the
command-line GP-200 Patch Manager", the credits chain (required by the
credit rules), and the pointer to the protocol docs in the CLI repo.

**Idea (developer, undecided): backport the speed-up to the CLI.** Once
the web app is complete, the CLI's remaining use is scripted automation.
What a backport would take: the fast pacing (upload, read back until it
matches, preset change), the pedal-managed bytes 0x44e/0x456 in its
verify, and the confirmation reads. Not planned yet.

**RigSheet: credit, don't endorse** (developer, 2026-10-02). The developer
finds RigSheet's UI too hard to follow to recommend it. It still gets
credit where it earned it: the upload addressing (target slot inside the
upload's inner header, outer chunk byte a fixed 0x09) was found by
cross-checking against it, after GP200-Studio-style writes were silently
discarded, and every restore relies on that. Changes: the README and page
footer no longer recommend it as an editor (GP200 Studio only); one
factual credit line each for the addressing; `DESIGN.md` records the
rule. Code comments unchanged.

## 2026-10-02: Status (start here next session)

**Known:**
- The app is live at https://donpark2000.github.io/GP-200-Patch-Manager-Web/
  (version **d263698 (2026-10-02)**), published from `main` by CI.
  `read-path` holds the same content plus later journal entries; work
  continues on it, and each merge to `main` (a publish) needs the
  developer's OK.
- Backup: the web export matches the CLI's byte for byte (this computer,
  via localhost).
- Restore: fast pacing by default, about 28 s for 256 patches; 1,022 of
  1,022 full-pedal writes verified, four compares MATCH. The CLI's pacing
  is a `?dev` fallback.
- Pedal-managed bytes 0x44e/0x456 change no setting; verify and
  `compare-zips` report them without failing. A failing read-back gets 3
  confirmation reads.
- The pedal holds exactly `GP-200\Backups\2026-09-30_full-backup.zip`.
- README and page footer updated (site link, no CLI-testing references,
  RigSheet credited for the upload addressing but not recommended).

**Next steps, in order:**
1. **Hosted site, this computer** (session folder
   `GP-200-testing\2026-10-02_hosted-site\`, already created, empty):
   open the site in Edge, allow MIDI, check the version line, Connect,
   Export all, Save log. Compare with the backup:
   `node C:\Users\dpark\Documents\GP-200-Patch-Manager-Web\tools\compare-zips.js C:\Users\dpark\Documents\GP-200\Backups\2026-09-30_full-backup.zip gp200_all_patches.zip`.
   Expected: 256 identical, MATCH. Optionally a fast round trip from the
   hosted site too.
2. **Laptop** (no Python, no repo; that's why the site is hosted): same
   steps on the site; copy its export and log to this computer's session
   folder (renamed `laptop_...`) and compare the same way. Then a fast
   round trip there (shifted from 1B, back from 1A, export after each;
   `--shift 1` for the first compare).
3. T1: a deliberate hidden-tab restore.
4. Later: the designed UI (work on a branch; publish deliberately).
   Undecided: backport the fast pacing to the CLI.

`CLAUDE.md` now has a "Starting a session" routine, so a new session can
begin with just "start".

## 2026-10-02: Hosted site, this computer: export MATCH

The developer opened the live site in Edge on this computer, connected,
exported all slots and saved the log (session folder
`GP-200-testing\2026-10-02_hosted-site\`: `gp200_all_patches.zip`,
`gp200_web_2026-10-02T20-39-47.log`).

- `compare-zips.js` against `GP-200\Backups\2026-09-30_full-backup.zip`
  (run by the developer, then again by Claude): 256 entries each, 256
  slots and 313,344 bytes compared, **256 identical, RESULT: MATCH**.
- Log: version `d263698 (2026-10-02)`, page
  `https://donpark2000.github.io/GP-200-Patch-Manager-Web/`, Edge 155 on
  Windows, `sysex=true`, one GP-200 in and out (Microsoft driver), wake
  lock available, developer tools off. Identity query answered.
- First read (1A): 7 chunks at offsets 0, 185, ... 1110 (370 nibbles each,
  132 in the last), 1176 decoded bytes: the same layout as before.
- **Read 256 of 256 slots in 0.3 s (1 ms per slot), 0 re-reads, 0
  skipped.** The match with the backup shows the reads were real, so the
  speed is genuine.
- The User-IR/NAM warning named 48B and 48D, as on 2026-09-30.
- The page was hidden for 3.1 s about a minute after the export; nothing
  was running.

So the hosted site (served from GitHub Pages, not localhost) reads the
pedal exactly as the local copy and the CLI do. Q2 resolved (below).

Next: the laptop. Its export and log get copied into the same session
folder as `laptop_...`, so the folder is purged after that, not now.

## 2026-10-02: Hosted site, laptop: export MATCH (phase 1 gate done)

The developer exported all slots from the live site on the laptop (no
Python, no repo there) and copied the files to this computer's session
folder `GP-200-testing\2026-10-02_hosted-site\`:
`laptop_gp200_all_patches.zip` (copied as `Laptop_...`, renamed by
Claude to match the other names) and
`laptop_gp200_web_2026-10-02T20-47-38.log`.

- `compare-zips.js` against `GP-200\Backups\2026-09-30_full-backup.zip`:
  256 entries each, 256 slots and 313,344 bytes compared, **256
  identical, RESULT: MATCH**.
- It's really a second export, not a copy of this computer's: the two
  zips' MD5s differ and their entry timestamps are 13:38:30 (this
  computer) vs 13:47:02 (laptop).
- Log: version `d263698`, live site, Edge 155 on Windows, `sysex=true`,
  one GP-200 in/out (Microsoft driver), wake lock available. The laptop
  exported **twice** (at +80 s and +213 s); both read **256 of 256 in
  0.6 s (2 ms per slot), 0 re-reads, 0 skipped**. The copied zip's
  timestamp fits the second. First-read layout identical to this
  computer's. Same User-IR/NAM warning (48B, 48D).
- The laptop reads at half this computer's speed, still effectively
  instant (Q2).

**Phase 1 gate: done on both computers.** Computer 1: several full
matches with the CLI (2026-09-30) and with the backup from the hosted
site (today). Laptop: two clean full reads, one compared, MATCH. Across
every full export so far the browser needed no re-reads; the CLI's read
noise (dead bytes, about 10% of reads) hasn't appeared. Q1 resolved
(below).

Next: the fast round trip on the laptop (phase 2 on the second
computer).

## 2026-10-02: Laptop round trip, step 1 (shifted from 1B): MATCH

Live site on the laptop (`d263698`, Edge 155, no `?dev`), restoring the
laptop's own export (`laptop_gp200_all_patches.zip`, which matches the
backup byte for byte; the backup file isn't on the laptop). Files in
`GP-200-testing\2026-10-02_hosted-site\`, renamed by Claude to the agreed
names (the developer had used `shifter_...`/`shifted_upload_...`):
`laptop_after-shift-upload_gp200_web_2026-10-02T21-02-50.log` (saved
after the restore), `laptop_after-shift_gp200_web_2026-10-02T21-07-50.log`
(after the export; contains the first log plus the export),
`laptop_after-shift_gp200_all_patches.zip`.

- Preview: 64D's file doesn't fit and isn't written; User-IR/NAM
  warning for 48C and 49A (48B and 48D shifted up one).
- **Wrote 255 of 255 in 29.9 s, 255 verified, 0 not verified**, no
  confirmation reads, page visible throughout. The same three patches as
  on this computer read back with a pedal-managed byte at 0: 2A Hi Sweety
  0x456, 4C Twiggy Blues 0x44e, 11B Classic 900 0x456 (each 2->0).
- Export about 4.3 min after the restore: 256 of 256 in 0.8 s, 0
  re-reads.
- `compare-zips --shift 1` backup vs `laptop_after-shift_...zip`: **256
  identical, RESULT: MATCH**, no pedal-managed differences (the three
  bytes export as 2 again). Unshifted vs the backup: 102 identical, so
  154 slots really changed, the same count as on this computer.

Next: step 2, restore back from 1A, export, compare unshifted.

## 2026-10-02: Laptop round trip, step 2 (back from 1A): MATCH

Same page and source zip. Files: `laptop_after-restore_gp200_web_2026-10-02T21-12-11.log`,
`laptop_after-restore_gp200_all_patches.zip`.

- **Wrote 256 of 256 in 29.7 s, 256 verified, 0 not verified**, no
  confirmation reads, page visible. The same three patches read back with
  a managed byte at 0 (1D 0x456, 4B 0x44e, 11A 0x456; each 2->0).
- The log was saved before the export (saved 21:12:11Z; the zip's entries
  are stamped 14:13:28 local), so it has no export lines. The export
  itself is checked by the compare.
- `compare-zips` backup vs `laptop_after-restore_...zip`: 256 entries
  each, 313,344 bytes compared, **256 identical, RESULT: MATCH**, no
  pedal-managed differences. After-shift vs after-restore: 102 identical,
  so step 2 changed 154 slots back. All four zips in the folder are
  different files (distinct MD5s).

**Phase 2 on the second computer: PASS.** 511 of 511 fast writes
verified from the hosted site on the laptop, both compares MATCH, the
same managed-byte read-backs and timings (29.9 s / 29.7 s) as on this
computer. The pedal is back to `GP-200\Backups\2026-09-30_full-backup.zip`
exactly. With this, both phase gates have passed on both computers.

**Battery** (developer, afterwards): the laptop ran on battery for all of
its tests. So the restore runs at full speed on battery with the page
visible (29.9 s / 29.7 s, same as this computer plugged in). Not
covered: a hidden page on battery, where browsers slow background tabs
the most (T1).

**Purged** `GP-200-testing\2026-10-02_hosted-site\` (developer, by hand,
to the Recycle Bin). Claude's two attempts failed because the folder was
some program's current folder (all 9 files were free; renaming the folder
failed). That was a PowerShell window still `cd`'d into it from the
compares; once closed, the delete worked. Lesson for test instructions:
end with `cd` back out of the session folder (or close the window), or
the purge fails.

## 2026-10-02: Hidden-tab round trip (T1): MATCH, no slowdown

Pass criteria set beforehand (developer agreed): every write verified and
both compares MATCH; the time is recorded, and over about 60 s hidden
(twice the visible time) would mean removing the one slow-able wait, but
wouldn't fail the test. Session folder `GP-200-testing\2026-10-02_hidden-tab\`;
live site (`d263698`), Edge, this computer, restoring
`GP-200\Backups\2026-09-30_full-backup.zip`. After clicking Write and
confirming, the developer pressed Ctrl+T and stayed on the new tab until
the pedal's display stopped changing (it shows every write), then went
back.

| Step | Hidden | Writes | Time | Spacing hidden / visible | Compare vs backup |
|---|---|---|---|---|---|
| Shifted from 1B (`hidden-after-shift_...21-35-47.log`) | 140.8-205.5 s; restore 139.4-167.2 s | 255 of 255 verified | 27.8 s | 108 ms (244) / 125 ms (10) | `--shift 1`: 256 identical, MATCH |
| Back from 1A (`hidden-after-restore_...21-37-49.log`) | 442.8-475.8 s; restore 441.7-469.1 s | 256 of 256 verified | 27.4 s | 107 ms (247) / 123 ms (8) | 256 identical, MATCH |

- Same three managed-byte read-backs as every fast restore (2A/4C/11B,
  then 1D/4B/11A); no confirmation reads, no slow-write warnings, no
  write needed a second read. So the one timer left in the fast path
  (the 25 ms pause between re-reads) never ran: this shows the normal
  path isn't slowed, not how a re-read behaves hidden.
- Hidden writes were slightly *faster* than visible ones, as in the
  incidental 8 s on 2026-10-01. Expected: the fast pacing waits on the
  pedal's MIDI replies, which the browser doesn't throttle.
- Both restores finished while hidden, so the page logged "Page visible
  again" as INFO and showed **no banner**: the banner appears only when
  the page comes back while still writing. (Claude's instructions said to
  expect a banner; wrong.)
- The restore-back log was saved before its export; the export is
  checked by the compare. Export after the shift: 256 in 0.4 s, no
  re-reads. The pedal is back to the backup.

**Result: PASS, well inside the criteria.** T1 resolved (above).
**For the designed UI:** the banner's advice "Keep this tab in front until
writing finishes" is stronger than the evidence now supports; soften it.

**Purged** `GP-200-testing\2026-10-02_hidden-tab\` (4 files) to the
Recycle Bin, with the developer's OK; the backup is untouched.

## 2026-10-02: Status (start here next session)

**Known:**
- The app is live at https://donpark2000.github.io/GP-200-Patch-Manager-Web/
  (version `d263698`), published from `main` by CI. `read-path` is ahead
  of `main` by journal/`CLAUDE.md`/`DESIGN.md` updates only; no publish
  needed for those.
- Both gates passed on both computers, from the hosted site: backup
  matches the backup file (and the CLI) byte for byte; a full fast round
  trip (511 writes) verifies and compares MATCH. Q1 and Q2 resolved.
- A hidden tab doesn't slow the restore (27.4-27.8 s hidden, 511 writes
  verified, MATCH; T1 resolved).
- Reads: about 1-3 ms per slot (0.3-0.8 s for all 256), never a re-read.
  Restore: about 30 s for 256 patches.
- The pedal holds exactly `GP-200\Backups\2026-09-30_full-backup.zip`.

**Next steps, in order:**
1. The designed UI (on a branch; publish deliberately). Notes so far: the
   range entry should show its meaning in the grid; a backup is instant,
   so no cancel button is needed for it; soften the hidden-tab banner.
2. Optional: a hidden-tab restore on the laptop on battery.
3. Undecided: backport the fast pacing to the CLI.

## 2026-10-02: Open questions Q3-Q6 closed

The developer didn't recognise Q3-Q6: Claude had added them (Q3/Q4 in the
first commit, Q5/Q6 with the read-path port) and never brought them up.
After a plain explanation of each, with the risk of dropping it, the
developer agreed to close all four as proposed (details under "Resolved").
The only code change: the fake pedal's read replies now use the real
layout (185-byte chunks, 1176-byte dump, `tests/helpers/fake-pedal.js`,
`baseDump()` in `tests/helpers/fixtures.js`). Uploads keep the CLI's
183-byte chunks. The test "assembleChunks reorders out-of-order chunks"
now checks the offsets and length; it was run with the old 183 stride
put back and failed, then passed again with 185. Full suite: 117 of 117
pass.

On recording questions like these (developer, 2026-10-02): keep doing
it. Writing them down as they come up guards against assuming too early
that something doesn't matter, and closing them at the end of testing was
cheap. Not proposed for the standards skill.


## 2026-10-02: iPhone: no Web MIDI (as expected)

The developer opened the live site in Edge on their iPhone, with no pedal
attached: the page showed the app's "This browser doesn't support Web
MIDI" message (`navigator.requestMIDIAccess` missing). Every iOS browser
runs on Apple's WebKit engine, which has no Web MIDI, so iPhone and iPad
are unsupported whatever the browser. Android (Chrome has Web MIDI) stays
untested: the developer's tablet has only micro-USB, and an adapter isn't
worth buying just to find out.

## 2026-10-02: Designed UI: first decisions (discussion, no layout yet)

The developer's thinking had moved on from the kickoff notes; this is what
was agreed before any layout work. Recorded in `DESIGN.md`, "Designed UI".

- **Header and footer.** The developer asked for both: the name in the
  header; copyright, the GitHub link and GP200 Studio in the footer.
- **Screens, not separate pages.** The test page made the developer
  scroll up and down a lot; they suggested pages linked from the header.
  Separate HTML pages would drop the MIDI connection, the selection, picked
  files and any running restore on every click, so the app stays one page
  whose header links switch screens (each with its own address, so Back
  and bookmarks work). Agreed once that difference was explained.
- **Devices.** Desktop/laptop Chrome and Edge. iPhone confirmed
  unsupported (entry above); Android untested, not worth an adapter.
- **Logs hidden** from users; still recorded, with "Save log" in Help for
  support. The on-screen panel stays for `?dev`.
- **Progress** for anything that takes time, so the user can see it hasn't
  hung (the developer's point); a backup is under a second, a restore
  about 30 s.
- **Help** inside the app.

The developer also fixed the git author name typo ("Donld" -> "Donald",
global config); earlier commits keep the old spelling.

## 2026-10-02: Designed UI: patch list and screens (mockup)

A throwaway mockup (private Claude artifact, built from the developer's
real names in `GP-200\Backups\2026-09-30_full-backup.zip`; no app code,
nothing in the repo) settled the layout questions. Decisions, in order:

- **Ranges, not free selection.** The developer: nobody needs random
  access across 256 patches; related patches sit in one bank or
  consecutive banks. Matches the restore (consecutive from a start slot)
  and the CLI's range file names.
- **"12-A" labels.** The developer worried that a bank x A-D grid would
  confuse: Valeton always writes `<bank>-<letter>`. Of three layouts
  (A: two halves of bank rows, B: 8 x 8 bank blocks, C: one labelled
  list in 8 columns), C was kept. **Fits a full desktop screen** at 12 px
  (developer's check); the laptop wasn't checked.
- **Separate Back up and Restore screens.** With both control sets above
  one list, the developer pointed out that nothing showed which one the
  highlight belonged to, both could be filled in at once, and there was no
  Restore button. Also: controls must not appear and disappear; grey them
  out until their inputs are ready.

Mockup version 3 has: blue backup range with the CLI file name; restore
with example files, orange overwrite range, a "Pedal now / After
restore" switch, counts of real vs default patches replaced, a 64-D
overflow warning, a confirm dialog and a simulated progress bar; a Help
draft with browser compatibility. `DESIGN.md`, "Designed UI", updated.

## 2026-10-02: Designed UI: Template screen (mockup v4)

The developer still values the CLI's `apply-template` and asked for it as
its own screen. Checked against the CLI (`cmd_apply_template`,
`confirm_overwrite` in `gp200.py`): one `.prst` into every slot of a
From/To range, write-and-verify per slot, and a per-slot "overwrite? [y/N]"
showing the current name unless `--force`.

Web version agreed (details in `DESIGN.md`): one confirmation for the
range instead of per-slot prompts; by default it writes only empty slots
and old copies of the template, which is the web form of answering "N" at
your own patches. Developer's rules: only "It's GP-200" counts as empty
(the mockup had also greyed "Template"; Claude had assumed it was a
default, but the developer's 45 "Template" slots are their own); slots
holding an old template must be overwritten too, so an old copy is
recognised by the same patch name.

Mockup v4's example (the developer's real names, 44-A to 51-D, template
named "Template"): 32 slots, writes 25 (9 empty, 16 old "Template"),
keeps 7 (two "Test IR and NAM", Hard Rock, Lead, Special, Mandolin,
JImi); counts checked against the backup's names.

**Revised the same day (mockup v5): empty slots only by default.** The
developer: "Template" was only the name of their `.prst` file; different
ranges can hold different templates with different names, and nothing
tells a template from a patch made by hand. So matching old copies by
name is dropped. Default: write only "It's GP-200" slots, keep every
other patch; "Every slot in the range" is the override. In the example
range (44-A to 51-D) that now writes 9 and keeps 23.
