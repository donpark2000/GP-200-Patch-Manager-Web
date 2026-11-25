# Rules review

Every rule Claude works under on this project, with who set it, for the
developer to review. Set up 2026-11-25 at the developer's request, after
rules Claude had inferred were written in as if agreed (journal,
2026-11-25). Covers `CLAUDE.md`, `DESIGN.md` (the rules on how work is
done, not the app's design decisions) and Claude's memory files (kept
outside the repo).

**Set by:**
- **Developer:** the developer's own words, quoted or recorded in the
  journal.
- **Claude, agreed:** Claude proposed it and the developer said yes. The
  date and the words are given.
- **Claude, not confirmed:** Claude wrote it with no yes on record. These are
  the ones to decide: keep, change or drop.
- **Not traced:** the record doesn't show who proposed it.

## 1. To decide now

| # | Rule | Where | Set by | Note |
|---|---|---|---|---|
| 1 | Defer a write run when a usage limit is over **85%** | CLAUDE.md | The check: developer, 2026-11-25. The 85%: Claude, not confirmed | Is 85% right, or another number? |
| 2 | **Conflict:** no backup before a write run, but both runner write paths refuse to overwrite a patch that doesn't match a reference backup | CLAUDE.md vs. `gp50/cli` and `gp200-restore` | No backup: developer, 2026-11-25. The reference check: Claude, built 2026-11-22 (GP-50) and 2026-11-24 (GP-200) under "safely" | As things stand, a write run needs a backup or fails. See the options below the table |
| 3 | GP-200 writes only through `gp200-restore`, which allows planned patches only and reads every written patch again at the end | CLAUDE.md, DESIGN.md | Developer: "remove the block. Safely." (2026-11-24). The gate's details: Claude, not separately confirmed | Keep the gate? |
| 4 | The GP-50 write page (`gp50/write.html`) stays at patches 55-99, after confirmation | CLAUDE.md | Claude, not confirmed ("added by Claude while recording", journal 2026-11-22) | An unpublished developer page. Keep, widen, or drop the limit? |
| 5 | GP-50 writes: a patch whose write isn't acknowledged is started again, up to 3 times; any other problem stops the run | DESIGN.md "GP-50 writes" | Claude, from hardware tests (stage 1), under the agreed plan; not separately confirmed | |
| 6 | Converter: which effect gets a module two effects want; chain order follows the source | DESIGN.md "Converter rules", `gp50/CONVERSION_RULES.md` 4.2-4.3 | Claude (stage 3); the developer listened to the results ("the algorithm is definitely working", 2026-11-24) but didn't rule on these two specifically | |
| 7 | A periodic review of this list, at each checkpoint (end of a stage, before a fresh session) | Proposed | Claude, not confirmed (the developer suggested "maybe" a periodic review) | When, if at all? |

**Options for row 2** (the developer's choice):
- **A.** Drop the reference check. A write run overwrites whatever is there.
  This matches "no patch is precious".
- **B.** Keep the check against the newest backup already on file. No new
  backup is taken, but a patch changed since that backup stops the run.
- **C.** Keep a fresh backup only for the patches a run will overwrite. It's
  part of the run, takes a fraction of a second, and Claude doesn't ask
  about it.

## 2. CLAUDE.md

| Rule | Set by |
|---|---|
| Session start routine: load the skill, read DESIGN.md and the journal's status, `git fetch`, summary, wait for the go-ahead; name the session | Not traced (added 2026-10-02; in the developer's CLAUDE.md template) |
| Working standards (debug output, a test per feature, one-command suite, journal, propose lessons) | Developer's standards skill |
| The CLI is the reference implementation; its PROTOCOL files are the spec | Not traced (initial setup, 2026-09-30) |
| `src/core/` has no DOM code; plain JS modules, no build step | Not traced (initial setup) |
| Nothing loaded from other sites; only the anonymous usage counts are sent | Developer (Stats, 2026-10-10) |
| Web app: writes only from Restore and Template, after confirmation in the app | Developer, 2026-10-02 |
| Dev write-timing test: scratch patches 64-A to 64-D only, after confirmation | Not traced (2026-09-30) |
| Runner: patch writes anywhere on both pedals, no asking first | Developer, 2026-11-25 |
| No backup before a run; ask first if one seems worth it | Developer, 2026-11-25 |
| Patch writes only: never firmware, global settings or unknown commands | Claude, agreed: part of the stage plan, developer "yes to the plan" (2026-11-22) |
| Rules come from the developer; each says who set it | Developer, 2026-11-25 |
| Files: code in the repo, backups in `GP-200\Backups`, test output in dated session folders | Not traced (2026-10-01) |
| Instructions start with `cd` into the session folder and give tools by full path | Not traced |
| Purge a session folder only once recorded, with a yes, to the Recycle Bin | Not traced |

## 3. DESIGN.md: how work is done

| Rule | Set by |
|---|---|
| Publish from `main` only; merging is the publish step, with the developer's OK | Not traced (DESIGN.md "Platform") |
| Reads: one per patch, re-read only on a timeout or a failed check, up to 3 | Not traced (kickoff, 2026-09-30) |
| Restore: one read-back compare; no automatic rewrites, the user decides | Not traced (kickoff, 2026-09-30) |
| What counts as damage: anything that changes how a patch plays | Developer, 2026-10-01 |
| Both pedals: work through a stage without approval at each step; report at its end or when hands, ears or a decision are needed | Developer, 2026-11-22 |
| Stop and report if a pedal stops answering or a patch changes that shouldn't | Claude, agreed (the stage plan, 2026-11-22) |
| Commit and push to the branch; never merge or publish without the OK | Developer (memory "push after commit", 2026-10-02) |
| A file's pedal is decided by its content, never its name | Claude, agreed (the stage plan, 2026-11-22) |

The app's design decisions (screens, wording, CTRL ranking, names and so on)
are mostly marked "developer" in DESIGN.md itself, and aren't repeated here.

## 4. Claude's memory (outside the repo)

| Memory | Rule | Set by | Status |
|---|---|---|---|
| Reliability over speed | Pedal I/O tuning: remove a step only when hardware proves it unneeded; experiments on 64-A to 64-D | Developer, 2026-10-01 | **Partly stale:** its reason ("the pedal holds the user's real patches") no longer holds, and the runner writes anywhere now. Keep the tuning rule, drop the 64-A to 64-D part? |
| Work in stages | Unattended stages; follow DESIGN.md's write limits; GP-200 untouched before stage 3 | Developer, 2026-11-22 | **Stale** in its write limits (replaced 2026-11-25); the rest stands |
| Speed goal | Don't offer to drop fast restore; set pass criteria before tests | Developer, 2026-10-01 | Stands |
| Consistency, explain changes | Reuse the developer's commands and names; say why when changing | Developer, 2026-10-01 | Stands |
| Clear questions | One plain question, apart from the background | Developer, 2026-10-01 | Stands |
| Flag long sessions | Say so at a break; status entry and commit first | Developer, 2026-10-01 | Stands |
| Handoff: all published | Commit, push and publish (with OK) before a new session | Developer, 2026-10-04 | Stands |
| Push after commit | Push after commits; never merge or publish without asking | Developer, 2026-10-02 | Stands |
| Record open questions | Keep logging them; review at checkpoints | Developer, 2026-10-02 | Stands |
| Say "patch", not "slot" | In messages | Developer, 2026-11-22 | Stands |
| Model and effort | Suggest model and effort before new work | Developer, 2026-11-23 | Stands |
| ai-dev-practices repo | Commit skill changes to that repo; say if the loaded skill differs | Not traced (2026-10-06) | Stands |
| Web-Games sessions | Move a Web-Games session to its folder | Developer (2026-10-04) | Stands |
| No precious patches | Writes anywhere, no backup first, usage check before writes | Developer, 2026-11-25 (85%: Claude, not confirmed) | New |
| No inferred rules | Propose rules and wait for a yes; tag who set each | Developer, 2026-11-25 | New |
