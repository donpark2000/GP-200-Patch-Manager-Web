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

- **Q1. Does the browser's MIDI path behave like Python's?** The CLI's
  read noise (dead bytes `0x43`/`0x9F`, about 10% of reads) is suspected to
  come from the Windows USB-MIDI driver. The browser reaches the pedal
  through a different MIDI layer, so it may be cleaner, the same, or
  different. *To be answered by the phase 1 CLI-comparison test.*
- **Q2. How long does reading all 256 slots take in the browser?** This
  decides how much progress/cancel UI is needed.
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

- **T1. Background-tab timer throttling.** Chrome slows timers in hidden
  tabs (to about once a second as soon as the tab is hidden, and after
  about 5 minutes hidden it can throttle chained timers to roughly once a
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
- **T2. Restore speed.** About 1.9 s per patch at the CLI's pacing (a full
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

## Resolved

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
