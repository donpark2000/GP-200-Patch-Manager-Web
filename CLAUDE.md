# Notes for Claude

## Starting a session

Do this at the start of every session, before anything else, without
being asked (the developer's first message may just be "start"):

1. Load the `software-project-standards` skill.
2. Read `DESIGN.md` (decisions). In `DEV_JOURNAL.md` (reasoning, findings),
   read the "Open questions" section and the **latest "Status (start here
   next session)" entry**; the journal is long, so read older entries only
   when a task needs them.
3. Check `git status` and that the branch matches GitHub (`git fetch`).
4. Reply with a short summary: where things stand, the next step, and
   anything needed from the developer. Then wait for the go-ahead.
5. Name the session in the sidebar as `<Mon D> · <topic>` (e.g. "Oct 2 ·
   Designed UI: build"), once the developer's go-ahead makes the topic
   clear, so sessions can be told apart (they all start as "start").
   Rename it if the work changes a lot; the status entry's topic is a
   good final name.

## Working standards

Follow the `software-project-standards` skill if it's available. If not,
this is the short version:

1. **Debug output with every feature.** Hook it into the app's debug log
   (on-screen panel plus "save log to file" with browser/OS/MIDI details).
2. **A test with every feature**, covering the normal case and at least one
   failure or edge case. Fake the MIDI device; never require hardware for
   the automated suite.
3. **One command runs the whole regression suite** with a single pass/fail
   verdict. Tests are hermetic: temp dirs only, no hardcoded paths, nothing
   left behind.
4. **Keep `DEV_JOURNAL.md` current as you go.** Record evidence, not just
   conclusions. Move open questions to "Resolved" with the evidence that
   settled them.
5. **Propose generalizable lessons** as additions to the standards skill.
   Keep project-specific ones in the journal.

## Project rules

- The CLI repo (`donpark2000/GP-200-Patch-Manager`) is the reference
  implementation, and its `PROTOCOL.md`/`PROTOCOL_NOTES.md` are the spec.
  When porting logic, match the CLI's behavior and file naming exactly
  unless `DESIGN.md` says otherwise.
- Keep `src/core/` free of DOM/UI code.
- Plain JavaScript ES modules, no build step.
- Nothing loaded from other sites. The one thing sent: the anonymous
  usage counts (DESIGN.md "Stats").
- **The web app** never writes to the pedal outside the phase 2 restore
  feature and the Template screen (developer, 2026-10-02), and never
  without the user's confirmation in the app. The developer-only
  write-timing test (`test.html?dev`, `src/core/tuning.js`) writes only to
  the scratch slots 64A-64D, also after confirmation. The GP-50 write page
  (`gp50/write.html`, unpublished) stays at slots 55-99, after
  confirmation in the app.
- **Claude's command-line runner** (developer, 2026-11-25: no patch on
  either pedal is precious; everything worth keeping is backed up, and a
  factory reset is acceptable) may write patches to any slot on either
  pedal without asking first: the GP-50 with the runner's writes, the
  GP-200 only with `gp200-restore` (the web app's restore, gated). No
  backup before a run (developer, 2026-11-25: it has costs; ask first if
  one seems worth it). Before each write run, **check usage**
  (`get_usage`) and defer the run, saying when the limit resets, if
  either the 5-hour or weekly limit is nearly used up (developer,
  2026-11-25; the threshold, 85% as Claude proposed, is still to be
  confirmed). A run cut off partway through is the risk this avoids.
  Patch writes only, never firmware, global settings or unknown commands
  (in CLAUDE.md since 2026-11-24, written by Claude; its source is to be
  confirmed with the developer, since a factory reset or re-flash, the
  developer's safety net, assumes the firmware is untouched).
- **Rules come from the developer** (2026-11-25). Claude doesn't add a
  rule, limit or step by inference; it proposes one and waits for a yes.
  Each rule here says who set it.

## Files: repo vs. test output vs. backups

| Place | Holds | Lifetime |
|---|---|---|
| `C:\Users\dpark\Documents\GP-200-Patch-Manager-Web\` (this repo) | code, tests, docs, journal only | permanent (git) |
| `C:\Users\dpark\Documents\GP-200\Backups\` | real patch backups worth keeping | permanent, the developer's |
| `C:\Users\dpark\Documents\GP-200-testing\<date>_<topic>\` | one hardware test session: exports, logs, CSVs, set files | disposable |

- Never put test output in the repo folder. Files Claude makes for a test
  go in the session folder; Claude's own helper scripts stay in its
  scratchpad.
- Test instructions start with `cd` into the session folder and give repo
  tools by full path, e.g.
  `node C:\Users\dpark\Documents\GP-200-Patch-Manager-Web\tools\compare-zips.js before.zip after.zip`.
  Keep using the same commands and names from one instruction to the next.
- Purge: once a session's results (numbers, conclusion, folder name) are in
  `DEV_JOURNAL.md`, ask "OK to purge `<folder>`?"; on a yes, send the whole
  folder to the Recycle Bin (not a permanent delete) and note the purge in
  the journal. Never purge `GP-200\Backups`.
- This is the project-specific half of a general practice proposed for the
  standards skill (journal, "Proposed additions to the standards skill").
