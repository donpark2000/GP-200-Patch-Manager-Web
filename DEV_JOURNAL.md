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

## Resolved

*(none yet)*

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
