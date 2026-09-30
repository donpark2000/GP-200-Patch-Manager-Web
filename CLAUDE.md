# Notes for Claude

Read `DESIGN.md` (decisions) and `DEV_JOURNAL.md` (reasoning, findings,
open questions) before starting work.

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
- Never write to the pedal outside the phase 2 restore feature, and never
  without the user's confirmation in the app. One exception: the
  developer-only write-timing test (`?dev`, `src/core/tuning.js`), which
  may write only to the scratch slots 64A-64D, also after confirmation.
