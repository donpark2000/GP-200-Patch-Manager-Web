# Lessons learned

What building the two GP-200 Patch Managers taught us: the command-line
[GP-200 Patch Manager](https://github.com/donpark2000/GP-200-Patch-Manager)
(Python) and this web version. Each lesson comes with the evidence behind
it and where to find the full record: this repo's
[`DEV_JOURNAL.md`](DEV_JOURNAL.md) (entries named by date and title), or
the CLI's
[`PROTOCOL_NOTES.md`](https://github.com/donpark2000/GP-200-Patch-Manager/blob/main/PROTOCOL_NOTES.md)
("CLI notes" below).

## The story in one paragraph

On the CLI, writes looked flaky at first: about 15% failed to verify. A
power-supply test changed nothing. Then a test that only read, with no
writes at all, found reads disagreeing with each other, so the reads were
the problem, not the writes. The retry protocol grew (two reads must agree,
then 3, 5 and 7 tries with pauses) until we noticed that every
disagreement fell on the same two bytes, and that the pedal stores 0 there
whatever is written. Once those two bytes were ignored, the stalls and the
false write failures stopped. The web version started from those notes and
reached real hardware in under a day; in the browser the read noise never
appeared. Speeding up the restore by waiting for the pedal's answer
instead of fixed pauses cut a full restore from about 8 minutes to about
30 seconds, and turned up two more bytes that the pedal manages itself.
We spent seven test runs trying to reproduce that change before checking
in Valeton's editor, which showed that it changes no setting. Once the
change was classified as harmless, the speed-up passed its acceptance test
on the first run.

## The lessons

**1. Classify a difference before fighting it.** A byte that differs can
be read noise (it changes from read to read), a field the pedal owns or
recomputes (slot numbers, a block that changes on every read), a value the
pedal enforces (always 0 whatever is written), a value the pedal manages
(changes after a slot switch), or real damage. Each needs different
handling, and only the last is a failed write. Retrying a write can never
fix a value the pedal won't store.
*Evidence:* the CLI's retries went from 3 to 7, with pauses added, while
every disagreement sat on 0x43 and 0x9F; ignoring those two bytes made
`export --all` clean on both computers, and a test patch that had failed
10 write attempts verified on the first. A field nobody had told the
comparison about made `read_dump_confirmed` fail 13 times out of 13.
*Record:* CLI notes, "The write-side test" and "Decision made:
verification is about choosing what to check", finding 8; journal,
"Phase 2 gate, first pass" (2026-10-01).

**2. Re-read before deciding a write failed, and suspect your own side.**
The check can be wrong too. Read again, without writing, and see whether
the difference stays the same (stored) or changes (read noise).
*Evidence:* the CLI's `reread` test found reads disagreeing with nothing
written in between. Three 20-write soak runs: 3 mismatches, none of them
stored. The noise came from the computer's MIDI path (a laptop needed the
pedal rebound from Valeton's driver to Windows' own), and the browser's
path never showed it: every full export, 0 re-reads. The web app's verify
now reads 3 more times before failing a write and reports "stable" or
"varies".
*Record:* CLI notes, findings 5 and 7, "The 7/256 `export --all` failure
run"; journal, "Plan for the fast pacing; confirmation reads" (2026-10-02).

**3. Define damage by what affects playing, and check it in Valeton's
editor.** A byte difference matters if it changes something the player
can hear or set, including the CTRL, footswitch and expression-pedal
settings. Load the before and after into Valeton's desktop editor and
compare. This is cheap and answers the question directly. The editor shows
settings, not every byte, so a change it can't show is noted, not assumed
harmless forever.
*Evidence:* 0x43/0x9F (CLI) and 0x44e/0x456 (web) both showed no
difference in the editor.
*Record:* CLI notes, "The write-side test"; journal, "Does the 2 -> 0
change matter?" (2026-10-01); `DESIGN.md`, "What counts as damage".

**4. Write down the goal and the pass criteria before tuning.** Otherwise
every new result raises another question, and nothing says when you are
done.
*Evidence:* seven timing-test runs (152 writes) and several tool changes
went into reproducing a byte change before anyone asked whether it
mattered. With a goal and criteria written down (full-pedal round trip,
every write verified, both compares MATCH), the fast restore passed on the
first run and again on a confirming run: 1,022 of 1,022 writes. The
hidden-tab test also had its criteria set first.
*Record:* journal, "Fast restore: goal, pass criteria, and the build"
(2026-10-01), "Hidden-tab round trip (T1)" (2026-10-02).

**5. Wait for the device's answer, not a fixed pause.** The pedal sends
no acknowledgement for a write, so a fixed pause is a guess sized for the
worst case. Reading the slot back until the new patch appears measures the
real save time for each write.
*Evidence:* the save time depends on the patch (about 12 to 155 ms). On
the CLI, longer settles (up to 1.3 s) never stopped its failures, because
they were read noise (CLI notes, section 3, item 1). Read-until-match took a patch from
about 1.9 s to about 0.11 s. Because nothing waits on a timer, a hidden
browser tab doesn't slow it: 27.8 s and 27.4 s hidden, against about 28 s
visible.
*Record:* journal, "Write-timing test (T1/T2 tooling)" (2026-09-30),
"Restore switched to read-back pacing" (2026-10-01).

**6. Check the end state, with data like the real data.** A check right
after each step proves only that step, at that moment.
*Evidence:* 516 timing-test writes all passed their immediate read-back,
but the first fast full restore left 44 slots changed after their verify
had passed. The 8 test patches all had 0 in the affected bytes, and the
test never re-read a slot after moving on. The full-pedal round trip,
compared afterwards with `compare-zips`, is what caught it.
*Record:* journal, "Phase 2 gate, first pass" (2026-10-01).

**7. Measure a worry before building around it.** Plausible risks are
cheap to test and expensive to design around.
*Evidence:* on the CLI, the power supply (15% failures on both), the
audio cables and CPU load were each tested and ruled out. On the web,
hidden-tab slowdown got a warning banner and "keep this tab in front"
advice before it was measured; the measurement showed hidden writes
slightly faster, and both were removed. "Close Valeton's editor, only one
program can use the pedal" was an inference; testing that often had the
editor open, and passed, said otherwise.
*Record:* CLI notes, finding 4, "The 7/256 `export --all` failure run";
journal, "Hidden-tab round trip (T1)" (2026-10-02), "Published #8"
(2026-10-05), "Help: the editor may stay open" (2026-10-03).

**8. Test against the real thing's own outputs.** Build the fake device
from real captures, and test a port against the reference's actual
outputs rather than your reading of its code.
*Evidence:* the fake pedal first assumed 183-byte read chunks and a
1182-byte dump, copied from the write path; the real pedal sends 185 and
1176. The golden fixtures, made by running the CLI's own Python, pin
down two details that would otherwise give different file names: Python's
`strip()` removes characters that JavaScript's `trim()` keeps, and the two
languages decode non-ASCII bytes differently by default.
*Record:* journal, "Read path ported; bare test page" (2026-09-30),
"Open questions Q3-Q6 closed" (2026-10-02).

**9. Another tool's clean result is evidence only if that tool checks.**
*Evidence:* GP200 Studio's exports looked stable, but it never compares
reads, and its export rewrites the two noisy bytes as 0 whatever it
received. Its stability came from its file format, not from clean reads.
*Record:* CLI notes, findings 14 and 15.

## If you start again tomorrow

1. Write down what you know as you go, with the evidence. The CLI's notes
   are why the web port took under a day.
2. Before writing anything, build a read-only test that measures read
   noise.
3. When something differs, classify it (lesson 1) before retrying,
   pausing or tuning.
4. Decide what counts as damage, and check differences in the official
   editor.
5. Set the goal and pass criteria before each round of tests.
6. Wait for the device's replies; add a fixed pause only when a test shows
   it's needed.
7. Test end to end: back up everything, restore, back up again, compare.
   Use real patches, and write something different first, so a write that
   silently did nothing can't pass.
8. Make every compare report how much it checked, and feed it broken input
   once to prove it can fail.
9. Measure a worry before designing around it.
