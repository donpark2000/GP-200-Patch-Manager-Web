# Converting patches between the GP-200 and the GP-50: the rules

Every rule the converter uses when a patch can't be copied one to one, in one
place. Written by hand (2026-11-25) from the decisions in `DESIGN.md` ("Both
pedals": "Effect map" and "Converter rules"), the effect map, the converter
(`gp50/convert.js`) and the journal. When a rule changes, change it here and in
`DESIGN.md`.

- **Per-effect decisions** (which effect goes to which, with each reason):
  `gp50/effect-map-choices.json`, shown in `gp50/EFFECT_MAP.md`. Both are
  generated; don't repeat their rows here.
- **Who decided:** "developer" means the rule was the developer's call;
  "Claude" means Claude proposed it and the developer accepted it.
- **Still open:** the last section, and the journal's open questions.

## 1. Principles

1. **A close copy, said plainly, is worth having** (developer, 2026-11-23: "I
   never expected the conversion to be perfect"). Changing one module on the
   pedal is easier than building a patch from scratch.
2. **Never fail silently.** Every substitution, dropped setting, limited
   value and left-out module goes in the patch's report, in playing order. A
   patch that can't be converted is refused with the reason (an unknown effect
   code, an effect without a map entry, a "conflict" entry).
3. **Facts from Valeton's own files; judgments kept apart.** The effect list,
   control positions, ranges and defaults come from Valeton's installed files
   (the GP-200 editor's `algorithm.xml`, Valeton Suite's `module50_data.json`).
   Near matches and stand-ins are judgments, each with a written reason, in the
   choices file. A choice whose names no longer match Valeton's files is
   refused by the tool.
4. **Don't guess a layout.** A field is carried only once its place in the
   file is confirmed on a pedal. Until then it's kept as the target's empty
   patch has it, and the report says so. (CTRL was held back this way until it
   was confirmed on both pedals.)
5. **Same effect, same sound, no report.** An effect with the same code (or
   the same effect under another name) carries every setting and isn't
   mentioned, even when a setting moves to another position.

## 2. Matching effects

The class of each effect, in each direction (counts as of 2026-11-24):

| Class | Meaning | GP-200 to GP-50 | GP-50 to GP-200 |
|---|---|---|---|
| same | same code, every setting carried | 69 | 100 |
| rename | same effect, another name | 4 | 6 |
| close | a setting dropped or limited, or a near match picked by hand | 195 | 6 |
| stand-in | nothing like it: a placeholder, switched off (rule 2.4) | 6 | 0 |
| none | left out, reported | 1 (Volume) | 0 |
| out of scope | NAM/SnapTone, user IRs: left out, reported | 30 | 100 |
| conflict | same code, the two files describe different effects: refused until settled | 0 | 0 |

**2.1 Near matches by kind** (developer, 2026-11-23). An effect the other pedal
lacks goes to one of the same kind, even if it's a different model:
- one compressor is much like another (to COMP4, the GP-50's most adjustable);
- one chorus is much like another (to A-Chorus);
- high-gain amps are much alike; prefer the same maker (Mesa Mark leads to
  Mess DualV), then the same amp's other channel (Bogner XTC blue to red,
  Friedman BE to HBE), then the same family (Fender blackface, Marshall Plexi);
- overdrives to an overdrive of the same character (Tube Screamer, Klon and
  Zendrive styles to Green OD; low-gain Bluesbreaker style to Yellow OD);
  distortions to SM Dist or, if amp-like, La Charger; bass drives to Bass OD;
- cabs by maker and speaker layout (number and size of speakers), then by
  layout alone; bass cabs to AMPG 4x10; acoustic bodies to the GP-50's one AC;
- delays to the nearest plain delay of the same kind (tape to Tape, analog to
  Analog, digital or ambient to Pure); stereo delays lose their stereo
  controls; Dual Echo keeps its A side as Ping Pong;
- reverbs to the same kind (spring to Spring, plate to Plate, small room to
  Room, big rooms to Hall; Shimmer to N-Star, bright and lush, no octave);
- the GP-50's only wah, gate, acoustic sim and pitch shifter take every
  effect of that kind.

**2.2 Same name, another code** (4 GP-50 effects: Rev Echo, Plate, Plate L,
Sweet Space). Mapped to the GP-200's effect of the same name.

**2.3 Conflicts settled by ear or by reasoning** (developer, 2026-11-23). Two
codes that Valeton's files describe as different effects (0x03000022 Sora
Fuzz / Lazaro; 0x0A000020 EV 4x12 / UK TD) are kept on the same code, as close
matches: any of the possible originals is "usable and close".

**2.4 Stand-ins** (developer, 2026-11-23). Special effects with nothing like
them on the GP-50 (Step Filter, Ring Mod, Auto Swell, Hold, Freeze, Bit Smash;
rarely used) become a placeholder in the same module, **switched off, at its
defaults, no setting carried**, so the module is there to use:
- MOD: A-Chorus;
- PRE (which can't hold a chorus on the GP-50): COMP4, except Step Filter,
  which gets Crier (the GP-50's auto-wah, a filter like it);
- NR: the GP-50's only gate.

One stand-in per module the effect can sit in. A stand-in stays off: any CTRL
that would switch it on is dropped from that CTRL (rule 6.4).

**2.5 No match, no stand-in.** The GP-200's Volume module (a volume pedal):
the GP-50 has no such module and no built-in expression pedal. Left out.

## 3. Matching settings within an effect

**3.1 Position.** A setting's place is the GP-200 control's `ID` (not its
display index `idx`) and the GP-50's `algId`. Confirmed on 468 real patches:
every value at a control's position is in range.

**3.2 Same code: match by name, then by position.** The same algorithm keeps a
setting in the same place, so where the two files name a control differently
(J-120 CL's Gain / VOL), position pairs them. The map moves settings that sit
in different places (cab Volume 0 / 1; Ping Pong, Ring Echo and Sweep Echo
swap Time and Feedback; Pitch's two volumes).

**3.3 Different effects: match by name only, never by position** (Claude,
2026-11-23, after finding position pairs that made no sense, e.g. S-Comp's
Threshold to COMP4's Sustain, which work in opposite directions). Plus a few
pairs given by hand with a reason (Saturation = Gain, Low = Bass, Gain 1 =
Gain). A pair can be given as "none" to drop a control that only looks like a
match (Vibrato T's Sens sets touch sensitivity, not depth).

**3.4 A setting the target lacks is dropped; one the source lacks gets the
target's default.** Both are reported for close matches. For same and renamed
effects a filled-in default isn't reported (it changes nothing).

**3.5 Out of range: limited to the target's range**, reported with the old and
new value (GP-50 delay Time stops at 1000 ms, Ping Pong at 500, Rev Echo at
780; the GP-200's go to 4000).

**3.6 Tempo-synced Time or Rate.** With Sync on, Time or Rate holds a note
length, not ms or Hz. It's carried as it is when the target is synced too;
otherwise it's set to the target's default and the report says "was set by
tempo".

## 4. Modules and chain

**4.1 Module places.** Each effect goes to the module its target effect
belongs in on the target pedal. The pedals' modules differ: the GP-200 has
PRE, WAH, DST, AMP, NR, CAB, EQ, MOD, DLY, RVB, VOL; the GP-50 has NR, PRE, DST,
AMP, CAB, EQ, MOD, DLY, RVB and NAM, with no WAH or VOL (its wah sits in PRE).

**4.2 Two effects for one module** (Claude, 2026-11-23; usually the GP-200's
PRE and WAH both wanting the GP-50's PRE). The winner is, in order: one that's
on over one that's off; then the effect from the module of the same name;
then the earlier in the chain. The other is left out and reported. GP-50 to
GP-200, an effect whose own module is taken may go to another module that can
hold it.

**4.3 Chain order follows the source** (Claude, 2026-11-23). A module with no
source goes right after the module before it in the target's default order.
The gate (NR) may move, as long as it isn't after delay or reverb, where it
would cut the repeats short (developer, 2026-11-23). No patch seen breaks that.

**4.4 On/off** is carried for every module, except a stand-in (always off) and
an expression-pedal wah (rule 5.2). Modules with no source keep the target's
empty-patch effect, switched off.

## 5. Expression pedal (EXP)

**5.1 GP-200 to GP-50: EXP assignments aren't carried** (developer,
2026-11-23). The GP-50 has a jack for an external pedal but no built-in one;
its EXP is left at its defaults, off. Only assignments other than the GP-200's
defaults (EXP 1 on the volume module, EXP 2 on the wah) are reported.

**5.2 A wah worked by the expression pedal is switched off** (developer,
2026-11-23), so it doesn't sit at one fixed setting. A CTRL that switched it
is dropped too.

**5.3 GP-50 to GP-200: EXP not carried**, because where the GP-50 keeps its
EXP settings isn't confirmed (fields 2003-200A are thought to be EXP). Reported
when they differ from the GP-50's empty patch.

## 6. CTRL switches

Both pedals have CTRL 1 and 2; the GP-200 can make all 8 footswitches CTRLs
(in patch select mode, the developer's only mode, just 1 and 2). A GP-200 CTRL
can switch any of its 11 modules; a GP-50 CTRL up to 3. A CTRL toggles each
of its modules from the state the patch stores. Layouts confirmed on both
pedals (journal 2026-11-24).

**6.1 CTRL 1 and 2 are carried both ways** (developer, 2026-11-24; their own
patches use CTRL 1 for DST, CTRL 2 for MOD). Each module on a CTRL goes to the
module its effect went to; if that's a different module, the report says so.

**6.2 Over 3 modules on a GP-200 CTRL: the developer's ranking** (2026-11-24).
Keep the 3 highest of DST, EQ, DLY, MOD, RVB, PRE, CAB, AMP, NR, VOL, WAH;
report the rest. It keeps what a lead or boost switch is usually for. Never
needed in the developer's backup (at most 3); it's for other people's
patches.

**6.3 A module that can't go over takes no place in the ranking.** That means
VOL, a stand-in, a module whose effect wasn't carried, or an expression-pedal
wah. The next one in the ranking moves up. Two GP-200 modules that land on one
GP-50 module count once.

**6.4 Left out, and reported:** a CTRL on a module that didn't go over, on a
stand-in, or on an expression-pedal wah. GP-200 CTRL 3-8 have nowhere to go on
the GP-50. GP-50 to GP-200, CTRL 3-8 are none.

**6.5 Unknown bits aren't carried.** Bits 11-15 of a GP-200 CTRL mask (set in
73 masks) are logged, not carried, until their meaning is known (Q14).

## 7. Name, tempo, volume

**7.1 Names, GP-200 to GP-50: Valeton style, 10 characters** (developer,
2026-11-23; the GP-50's display and Valeton Suite allow 10). A name that fits
is kept. Otherwise apply these steps in turn and stop once it fits:
1. Keep a 1-2 digit number at the end (not one that's part of a word, as in
   "BE100").
2. Shorten Lead to LD and Clean to CL.
3. Drop "of", "the", "a", "and", "in".
4. Run the words together, with brackets dropped ("Fat Bird (Wah)" →
   "FatBirdWah").
5. Cut.

Tried on the 75 long names in the developer's backup: no two different names
came out the same. Duplicates that do happen are kept and reported. GP-50
names fit the GP-200 unchanged.

**7.2 Tempo and patch volume are carried**; a volume over the GP-50's 100 is
limited and reported. The GP-200's volume module isn't carried (rule 2.5),
and isn't reported: every GP-200 patch has one.

## 8. What isn't carried, by design

- NAM/SnapTone and user IRs (out of scope, developer; backup and restore still
  carry them as bytes).
- Fields whose meaning isn't known keep the target's empty patch's values:
  GP-200 0x448 records, 0x3A, 0x3C, 0x92-0x93; GP-50 tag 3's last 2 bytes.
- Global settings (global EQ, output mode): not part of a patch.

## 9. Open: the unmappables still worth pursuing

Recorded in the journal's open questions (Q14-Q20); the short form:

| Q | Question | What settling it takes |
|---|---|---|
| Q14 | GP-200 CTRL: 3-B's CTRL 3; mask bits 11-15 | Look at a few patches on the pedal |
| Q15 | A synced Time/Rate that the target can't sync: work out ms from the tempo instead of the default? | A rule and a test; no pedal needed |
| Q16 | Tone controls lost in a close match (an amp's Bass/Middle/Treble, Hyper EQ's bands): rebuild them in a free EQ module? | A rule, then listening |
| Q17 | The module that loses a two-for-one fight: put it in another free module if one can hold it? | A count of how often, then a rule |
| Q18 | The GP-200 Volume module at a fixed level (not pedal-driven): fold it into patch volume? | Check how the level adds up, then listening |
| Q19 | EXP: carry it to the GP-50's jack for users with an external pedal, and GP-50 EXP to the GP-200 | Confirm the GP-50's EXP fields (a patch saved with a change) |
| Q20 | GP-50 fields taken but not confirmed: which on/off bit is which module, tempo, volume; do the pedals' volume scales match? | Small write tests on both pedals |
