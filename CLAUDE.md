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
4. Reply with a short summary: where things stand, **why we're doing the
   current work** (a line or two; the developer works across days with no
   easy way to look back), **any rules that changed since the last
   session** (RULES.md), the next step, and anything needed from the
   developer. Then wait for the go-ahead. (Developer, 2026-11-25.)
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
  (`gp50/write.html`, unpublished) may write any patch, after
  confirmation in the app (developer, 2026-11-25: the 55-99 limit
  dropped).
- **Claude's command-line runner** (developer, 2026-11-25: no patch on
  either pedal is precious; everything worth keeping is backed up, and a
  factory reset is acceptable) may write patches to any slot on either
  pedal without asking first: the GP-50 with the runner's writes, the
  GP-200 only with `gp200-restore` (the web app's restore, gated). No
  backup before a run (developer, 2026-11-25: it has costs; ask first if
  one seems worth it). **Never begin a write run that can't finish
  within both the 5-hour and the weekly limit** (developer, 2026-11-25):
  read both limits and their reset times (`get_usage`) before every
  run. Weigh each by what is left in it, not by one percentage: the
  weekly limit's last 15% is worth far more than the 5-hour limit's.
  When in doubt, defer the run and say when the limits reset. How to
  judge "can finish" (developer agreed, 2026-11-25; RULES.md row 1):
  measure a run's cost by reading both limits before and after, the
  turns reading its logs included, and record it in the journal. Until
  there are figures, start only when both limits have at least 10
  points left, otherwise ask. With figures, start only when each limit
  has at least twice the run's cost left. In the weekly limit's last
  15%, always ask first.
- **The runner's reference check** (a patch is overwritten only if it
  matches a backup) **asks instead of refusing** (developer,
  2026-11-25): with no backup to check against, or a patch that
  doesn't match, Claude asks the developer first. An explicit
  instruction from the developer overrides it. In the code (2026-11-25):
  the runner stops before writing anything and exits with 2, listing
  what to ask; Claude adds `--skip-reference-check` only on the
  developer's explicit instruction (RULES.md row 2).
- **Conversion rules are general and "good enough"** (developer,
  2026-11-26): a mapping rule must apply to any patch, including custom
  patches made in future, not fix one patch. No patch-specific rules; a
  conversion is never expected to be perfect. Findings from listening
  are held as candidates until enough are in to see a general rule.
- **Revisit rules when a milestone passes** (developer, 2026-11-25),
  using RULES.md.
  Patch writes only, never firmware, global settings or unknown commands
  (Claude's, in the stage plan the developer agreed on 2026-11-22: "yes
  to the plan").
- Who set each rule, and which ones are still to confirm: `RULES.md`.
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
