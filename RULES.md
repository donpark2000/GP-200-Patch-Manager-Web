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

## 1. Reviewed 2026-11-25 (developer)

| # | Rule | Decision |
|---|---|---|
| 1 | Usage before a write run | **Developer's goal: never begin a write run that can't finish within both the 5-hour and the weekly limit.** A fixed percentage doesn't fit: 15% of the weekly limit is worth far more than 15% of the 5-hour one, and which resets first differs from day to day. Claude reads both limits and their reset times before every write run. **How Claude judges "can finish": agreed 2026-11-25** (Claude's proposal, developer "Yes, agreed"). Measure a run's cost by reading both limits before and after it, Claude's turns reading its logs included, and record it in the journal (the figures are whole percents, so one run may not show it). Until there are figures: start only when both limits have at least 10 points left, otherwise ask. With figures: start only when each limit has at least twice the run's cost left. In the weekly limit's last 15%: always ask first. |
| 2 | The runner's reference check (a patch is overwritten only if it matches a backup) | **Too hard for now.** It dates from before there was any confidence in the writes. Change it to **ask for confirmation**: a run with no backup to check against, or a patch that doesn't match, stops and asks. It **can be overridden by explicit instruction** (the developer says to write without checking). **Done 2026-11-25** (both runner write paths): with no `--reference`, or a patch to be overwritten that isn't in it, nothing is written and the runner exits with 2 ("NEEDS AN ANSWER"), listing the patches; Claude asks. `--skip-reference-check`, used only on the developer's explicit instruction, writes without it. |
| 3 | `gp200-restore`'s gate: planned patches only, written patches read again at the end | **Keep** (developer). |
| 4 | The GP-50 write page stays at patches 55-99 | **Dropped** (developer). Claude had added it while recording the stage plan (2026-11-22), keeping the page at its old limit "since only the runner needs more", with no other reason. The page's gate now allows any patch, still after confirmation. Its test steps still write 55-99, since that's their layout. |
| 5 | GP-50 writes: an unacknowledged patch is started again, up to 3 times; any other problem stops the run | **Agreed** (developer). |
| 6 | Converter: which effect gets a module two effects want; chain order follows the source | **Agreed** (developer). |
| 7 | A periodic review of this list | **Agreed for now**, to refine with experience (developer). **Also: revisit rules when a milestone passes.** A rule set before there was confidence (row 2) should be looked at again once there is. |

**A principle from this review** (developer): rules made early, before
anything was proven, get too strict. Review them at each milestone (the end
of a stage), not only when one gets in the way.

## 2. CLAUDE.md

| Rule | Set by |
|---|---|
| Session start routine: load the skill, read DESIGN.md and the journal's status, `git fetch`, summary, wait for the go-ahead; name the session | Not traced (added 2026-10-02; in the developer's CLAUDE.md template). The summary's "why we're doing this" and "rules changed": developer, 2026-11-25 |
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
| Reliability over speed | Pedal I/O tuning, both pedals: remove a step only when hardware proves it unneeded | Developer, 2026-10-01 | **Updated 2026-11-25** (developer: yes): the old reason ("the pedal holds the user's real patches") and the 64-A to 64-D limit dropped; where to write: CLAUDE.md |
| Work in stages | Unattended stages; report at stage ends | Developer, 2026-11-22 | **Updated 2026-11-25** (developer: yes): its write limits dropped, pointing to CLAUDE.md and RULES.md instead |
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
