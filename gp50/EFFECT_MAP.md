# Effect map: review

Made by `tools/make-effect-map.js` from Valeton's own files (the GP-200 editor's
`algorithm.xml`, Valeton Suite's `module50_data.json`) and `gp50/effect-map-choices.json`.
Don't edit by hand: change the choices file and run the tool.

| | same | rename | close | conflict | none | out of scope |
|---|---|---|---|---|---|---|
| GP-50 to GP-200 | 100 | 6 | 6 | 0 | 0 | 100 |
| GP-200 to GP-50 | 69 | 4 | 195 | 0 | 7 | 30 |

- **same / rename**: the same effect, every setting carried over (some to another position).
- **close**: a setting is lost or limited, or a near match picked by hand (with the reason).
- **conflict**: same code, but Valeton's two files describe different effects.
- **none**: no match; a patch using it can't be copied as it is.
- **out of scope**: NAM/SnapTone and user IRs (DESIGN.md "Both pedals").

## 1. Conflicts (listen before copying)

None.

## 2. GP-50 to GP-200: close

| From | To | Why | Settings |
|---|---|---|---|
| Sora Fuzz | Lazaro | Developer, 2026-11-23: usable and close either way. Valeton describes this code three ways (Suite: Sora Fuzz, a Tone Bender Mk II; GP-50 manual: a Fuzz Face, likely copied from Red Haze; GP-200: Lazaro, a Big Muff); the same code is kept | moved: VOL 1->2; paired: Fuzz = Sustain (by position); set to default: Tone 50 |
| EV 4x12 | UK TD | Developer, 2026-11-23: usable and similar either way. Valeton's files disagree on what this code is (GP-50: EV 4x12, a Peavey 6505 4x12 per its manual; GP-200: UK TD, a Marshall basketweave 4x12), but Peavey's EV/6505 4x12 is Marshall-style, so the same code is kept | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| Rev Echo (0x0B000013) | Rev Echo (0x0B000028) | Same name; another code on the GP-200 (reverse delay on both) | moved: Sync 3->4, Trail 4->5; set to default: Level 50 |
| Plate (0x0C00000F) | Plate (0x0C000003) | The GP-200 has one plate reverb | moved: Decay 2->1, Damp 4->2, Trail 6->3; paired: Damp = High Damp |
| Plate L (0x0C000010) | Plate (0x0C000003) | The GP-200 has one plate reverb | moved: Decay 2->1, Trail 6->3; set to default: High Damp 50 |
| Sweet Space (0x0C000015) | Sweet Space (0x0C000008) | Same name; another code on the GP-200 (modulated reverb on both) | moved: Trail 6->5; dropped: Damp, Mod; set to default: Pre Delay 50, Lo End 0, Hi End 0 |

## 3. GP-50 to GP-200: no match

None.

## 4. GP-200 to GP-50: close

| From | To | Why | Settings |
|---|---|---|---|
| S-Comp (0x00000003) | COMP4 (0x00000001) | Developer's rule, 2026-11-23: one compressor is much like another (COMP4: the GP-50's most adjustable) | moved: Attack 3->1; dropped: Threshold, Ratio, Release, Tone, Blend; set to default: Sustain 20, Clip 10 |
| AC Boost (0x0000000A) | B-Boost (0x0000000B) | Developer's rule, 2026-11-23: same kind: Xotic drive/boost (AC Booster / BB Preamp) | nothing |
| P-Boost (0x0000000C) | Boost (0x0000001A) | Both Xotic clean boosts (RC Booster / EP Booster) | dropped: Volume, Bass, Treble; set to default: +3dB 1, Bright 1 |
| 14 Boost (0x0000000E) | Boost (0x0000001A) | Developer's rule, 2026-11-23: same kind: clean boost | set to default: +3dB 1, Bright 1 |
| FAT BB (0x00000019) | Boost (0x0000001A) | Developer's rule, 2026-11-23: same kind: clean boost | dropped: Bass, Treble, Volume, Low Cut; set to default: Gain 20, +3dB 1, Bright 1 |
| Gate 2 (0x0000001D) | Gate (0x0000001B) | The GP-50's only noise gate | dropped: Attack, Release |
| Gate 3 (0x00000021) | Gate (0x0000001B) | The GP-50's only noise gate (Gate 3 is an expander) | dropped: Ratio, Attack, Release, Hold, Hysteresis |
| AC Refiner (0x01000000) | AC Sim (0x01000001) | Developer's rule, 2026-11-23: same kind: acoustic guitar sound | dropped: Shape; set to default: Body 50, Top 50, Volume 50, Mode 2 |
| P-Bend (0x01000024) | Pitch (0x01000023) | Developer's rule, 2026-11-23: same kind: polyphonic pitch shifter | moved: Dry 3->2; dropped: Wet, Range; set to default: H-VOL 50, L-VOL 50 |
| Saturate (0x01000033) | Boost (0x0000001A) | Developer's rule, 2026-11-23: nearest kind: light saturation / boost | paired: Saturation = Gain; dropped: Mix, Volume, High Cut; set to default: +3dB 1, Bright 1 |
| Hyper EQ (0x01000043) | Guitar EQ 1 (0x01000035) | Developer's rule, 2026-11-23: same kind: EQ (the bands differ, so set flat; Volume kept) | moved: 125Hz 2->0, 4kHz 7->4, 16kHz 9->3, Volume 10->5; dropped: 31Hz, 63Hz, 250Hz, 500Hz, 1kHz, 2kHz, 8kHz; set to default: 400Hz 0, 800Hz 0 |
| Hammy (0x01000049) | Pitch (0x01000023) | Developer's rule, 2026-11-23: same kind: pitch shifter | dropped: Range, Harmony, Volume, Position; set to default: High 12, Low -12, Dry 50, H-VOL 50, L-VOL 50 |
| Harmonizer 1 (0x0100004D) | Pitch (0x01000023) | Developer's rule, 2026-11-23: same kind: harmony (fixed intervals on the GP-50) | dropped: Mix, Key, Mode, Interval, Smooth Mode; set to default: High 12, Low -12, Dry 50, H-VOL 50, L-VOL 50 |
| Harmonizer 2 (0x0100004E) | Pitch (0x01000023) | Developer's rule, 2026-11-23: same kind: harmony (fixed intervals on the GP-50) | dropped: Mix, Key, Mode, Interval 1, Interval 2, Smooth Mode; set to default: High 12, Low -12, Dry 50, H-VOL 50, L-VOL 50 |
| OD 9 (0x03000001) | Green OD (0x03000000) | Tube Screamer TS9 / TS808 | nothing |
| Swarm (0x03000004) | Super OD (0x03000006) | Developer's rule, 2026-11-23: same kind: overdrive | nothing |
| Scream OD (0x03000008) | Green OD (0x03000000) | Both Tube Screamer style | dropped: Fat, Air |
| Blues OD (0x03000009) | Super OD (0x03000006) | Developer's rule, 2026-11-23: same kind: overdrive | nothing |
| Force (0x0300000A) | La Charger (0x03000030) | Developer's rule, 2026-11-23: same kind: amp-like overdrive/distortion (OCD / Crunch Box) | dropped: Mode |
| Tube (0x0300000B) | Green OD (0x03000000) | Developer's rule, 2026-11-23: same kind: tube-style overdrive | moved: Volume 1->2; dropped: Bass, Treble; set to default: Tone 70 |
| Blues Master (0x0300000E) | Yellow OD (0x03000002) | Developer's rule, 2026-11-23: same kind: low-gain overdrive (Bluesbreaker / OD-1) | moved: Volume 2->1; dropped: Tone |
| Master OD (0x0300000F) | Super OD (0x03000006) | Developer's rule, 2026-11-23: same kind: overdrive | moved: Volume 1->2; dropped: Bass, Middle, Treble; set to default: Tone 50 |
| TaiChi OD (0x03000010) | Green OD (0x03000000) | Developer's rule, 2026-11-23: same kind: smooth overdrive (Zendrive / TS808) | dropped: Voice |
| Penesas (0x03000014) | Green OD (0x03000000) | Developer's rule, 2026-11-23: same kind: transparent overdrive (Klon / TS808) | nothing |
| Precise OD (0x0300001C) | Green OD (0x03000000) | Developer's rule, 2026-11-23: same kind: tight overdrive | dropped: Attack, Gate |
| Timmy OD (0x0300001E) | Super OD (0x03000006) | Developer's rule, 2026-11-23: same kind: transparent overdrive | moved: Volume 1->2; dropped: Bass, Treble, Mode; set to default: Tone 50 |
| Lazaro | Sora Fuzz | Developer, 2026-11-23: usable and close either way. Valeton describes this code three ways (Suite: Sora Fuzz, a Tone Bender Mk II; GP-50 manual: a Fuzz Face, likely copied from Red Haze; GP-200: Lazaro, a Big Muff); the same code is kept | moved: Volume 2->1; paired: Sustain = Fuzz (by position); dropped: Tone |
| Sora Fuzz (0x03000026) | Sora Fuzz (0x03000022) | Developer's rule, 2026-11-23: same name; germanium fuzz (Tone Bender, per Valeton Suite) | nothing |
| Chief (0x0300002D) | La Charger (0x03000030) | Developer's rule, 2026-11-23: same kind: amp-in-a-box distortion (Guv'nor / Crunch Box) | moved: Volume 1->2; dropped: Bass, Middle, Treble; set to default: Tone 50 |
| Master Dist (0x0300002E) | SM Dist (0x0300002A) | Developer's rule, 2026-11-23: same kind: distortion | moved: Volume 1->2; dropped: Bass, Contour, Treble; set to default: Tone 50 |
| Revolt (0x03000032) | SM Dist (0x0300002A) | Developer's rule, 2026-11-23: same kind: distortion | dropped: Mode |
| Flex OD (0x0300003F) | SM Dist (0x0300002A) | Developer's rule, 2026-11-23: same kind: distortion | dropped: Mode, Blend |
| Black Bass (0x03000044) | Bass OD (0x03000040) | Developer's rule, 2026-11-23: same kind: bass drive | moved: Treble 8->4; paired: Low = Bass; dropped: Lo-mid, Hi-mid, Attack |
| Empire OD (0x03000050) | Yellow OD (0x03000002) | Developer's rule, 2026-11-23: same kind: low-gain overdrive | moved: Volume 2->1; dropped: Tone, Mode |
| Bass Hammer (0x03000051) | Bass OD (0x03000040) | Developer's rule, 2026-11-23: same kind: bass drive | moved: Bass 2->3, Treble 5->4; dropped: Master, Middle, Mid Freq, Drive; set to default: Blend 50, VOL 50 |
| Flagman Dist (0x03000052) | SM Dist (0x0300002A) | Developer's rule, 2026-11-23: same kind: high-gain distortion | moved: Volume 1->2; dropped: Bass, Treble, Presence, Tight; set to default: Tone 50 |
| G-Chorus (0x04000001) | A-Chorus (0x04000000) | Developer's rule, 2026-11-23: one chorus is much like another | dropped: Volume; set to default: Tone 50 |
| C-Chorus (0x04000002) | A-Chorus (0x04000000) | Developer's rule, 2026-11-23: one chorus is much like another | dropped: Mode; set to default: Depth 50, Rate 0.5, Tone 50, Sync 0 |
| M-Chorus (0x0400000F) | A-Chorus (0x04000000) | Developer's rule, 2026-11-23: one chorus is much like another | moved: Sync 6->3; paired: Filter = Tone; dropped: Mix, Depth L, Depth C, Depth R; set to default: Depth 50 |
| B-Jet (0x04000012) | Jet (0x04000011) | Flanger (B-Jet is tuned for bass) | paired: Pre Delay = P.Delay |
| Trem Jet (0x04000014) | Jet (0x04000011) | Developer's rule, 2026-11-23: same kind: flanger (its tremolo is lost) | moved: Feedback 2->3, Flg Sync 5->4; paired: Flg Depth = Depth, Flg Rate = Rate, Flg Sync = Sync; dropped: Trm Depth, Trm Rate, Trm Sync; set to default: P.Delay 50 |
| G-Roto (0x04000016) | V-Roto (0x04000015) | Developer's rule, 2026-11-23: same kind: vibrato | moved: Sync 3->2; dropped: Volume |
| Vibrato T (0x04000018) | Vibrato (0x04000017) | Vibrato. Vibrato T's Sens sets how much playing strength changes the depth (the GP-200 editor's text), not the depth itself: dropped, Depth set to default | paired: Output = VOL; dropped: Sens (not the same setting); set to default: Depth 50 |
| G-Phase (0x0400001A) | O-Phase (0x04000019) | Phaser (a green BBD phaser / MXR Phase 90) | moved: Rate 1->0, Sync 2->1; dropped: Depth |
| S-Phase (0x0400001B) | O-Phase (0x04000019) | Phaser (EHX Small Stone / MXR Phase 90) | moved: Rate 1->0, Sync 2->1; dropped: Color |
| Pan Phase (0x0400001E) | O-Phase (0x04000019) | Developer's rule, 2026-11-23: same kind: phaser (its panning is lost) | moved: Phs Rate 1->0, Phs Sync 4->1; paired: Phs Rate = Rate, Phs Sync = Sync; dropped: Phs Depth, Pan Depth, Pan Rate, Pan Sync |
| Vibe (0x04000020) | M-Vibe (0x0400001F) | Uni-Vibe / Micro-Vibe | moved: Sync 4->2; dropped: Volume, Mode |
| Triangle Trem (0x04000027) | Sine Trem (0x04000026) | Tremolo, triangle / sine wave | nothing |
| V-Wah (0x05000001) | C-Wah (0x05000008) | The GP-50's only wah (Vox V846 / Cry Baby) | nothing |
| S-Wah (0x05000006) | C-Wah (0x05000008) | The GP-50's only wah | nothing |
| B-Wah (0x05000007) | C-Wah (0x05000008) | Developer's rule, 2026-11-23: same kind: wah (the GP-50's only one) | nothing |
| P-Wah (0x0500000A) | C-Wah (0x05000008) | The GP-50's only wah (a Cry Baby setting / Cry Baby) | dropped: EQ |
| Dark DLX (0x07000005) | Dark Twin (0x07000004) | Developer's rule, 2026-11-23: same family: Fender blackface clean | moved: Treble 3->4; set to default: Middle 40, Bright 1 |
| Dark Vibra (0x07000009) | Dark Twin (0x07000004) | Developer's rule, 2026-11-23: same family: Fender blackface clean | moved: Treble 3->4, Bright 4->5; set to default: Middle 40 |
| Silver Twin (0x0700000D) | Dark Twin (0x07000004) | Fender Twin Reverb, Silverface / Blackface | set to default: Bright 1 |
| SUPDual CL (0x0700000F) | SUPDual OD (0x07000028) | Developer's rule, 2026-11-23: same amp, Supro Dual-Tone (CH1 / CH1+2) | moved: Volume 2->4; paired: Gain = Gain 1, Tone = Tone 1; set to default: Gain 2 50, Tone 2 50 |
| Foxy 15TB (0x07000010) | Foxy Bass (0x07000075) | Vox AC-100 bass amp on both | moved: Volume 2->0, Bass 3->1, Treble 4->2; dropped: Gain, Tone Cut |
| BogSV CL (0x0700001A) | Match CL (0x07000015) | Developer's rule, 2026-11-23: same kind: boutique clean | moved: Treble 4->5; dropped: Bright; set to default: Middle 50 |
| Z38 CL (0x0700001B) | Foxy 30N (0x07000011) | Developer's rule, 2026-11-23: same kind: class A clean (Dr. Z / AC30) | dropped: Bass, Middle, Treble; set to default: Bright 0 |
| Knights CL (0x0700001F) | Foxy 30N (0x07000011) | Developer's rule, 2026-11-23: same kind: British class A clean | moved: Volume 1->2; dropped: Bass, Middle, Treble; set to default: Tone Cut 50, Bright 0 |
| Bad-KT CL (0x07000022) | Match CL (0x07000015) | Developer's rule, 2026-11-23: same kind: class A boutique clean | set to default: Bass 45, Middle 50, Treble 65 |
| Solo100 CL (0x07000023) | Dark Twin (0x07000004) | Developer's rule, 2026-11-23: same kind: clean | moved: Volume 2->1, Bass 3->2, Middle 4->3, Treble 5->4; dropped: Presence; set to default: Bright 1 |
| UK 45+ (0x0700002B) | UK 45 (0x0700002A) | Marshall JTM45, another setting | nothing |
| UK 45JP (0x0700002C) | UK 45 (0x0700002A) | Marshall JTM45, jumped / normal input | paired: Gain 1 = Gain; dropped: Gain 2 |
| UK 50 (0x0700002D) | UK 50JP (0x0700002F) | Marshall JMP50, jumped on both | paired: Gain = Gain 1; set to default: Gain 2 50 |
| UK 50+ (0x0700002E) | UK 50JP (0x0700002F) | Marshall JMP50, another setting | paired: Gain = Gain 1; set to default: Gain 2 50 |
| UK SLP (0x07000030) | UK 50JP (0x0700002F) | Developer's rule, 2026-11-23: same family: Marshall Plexi era | paired: Gain = Gain 1; set to default: Gain 2 50 |
| Mess2C+ 1 (0x07000039) | Mess DualV (0x07000068) | Developer's rule, 2026-11-23: high-gain amps are much alike; same maker (Mesa/Boogie) | nothing |
| Mess2C+ 2 (0x0700003A) | Mess DualV (0x07000068) | Developer's rule, 2026-11-23: high-gain amps are much alike; same maker (Mesa/Boogie) | nothing |
| Mess2C+ 3 (0x0700003B) | Mess DualV (0x07000068) | Developer's rule, 2026-11-23: high-gain amps are much alike; same maker (Mesa/Boogie) | nothing |
| BogSV OD (0x0700003D) | Bog RedV (0x0700006D) | Developer's rule, 2026-11-23: same maker: Bogner drive | nothing |
| Juice30 OD (0x0700003E) | Juice R100 (0x07000053) | Developer's rule, 2026-11-23: same maker: Orange | nothing |
| Flagman 1 (0x07000040) | Flagman+ (0x0700005D) | Friedman BE100: BE channel / HBE channel (more gain) | nothing |
| Flagman 2 (0x07000041) | Flagman+ (0x0700005D) | Friedman BE100: BE channel / HBE channel (more gain) | nothing |
| Bog BlueV (0x07000043) | Bog RedV (0x0700006D) | Developer's rule, 2026-11-23: same amp, Bogner XTC (blue / red channel, more gain) | nothing |
| Bog BlueM (0x07000044) | Bog RedV (0x0700006D) | Developer's rule, 2026-11-23: same amp, Bogner XTC (blue / red channel, more gain) | nothing |
| Match OD (0x07000048) | Foxy 30TB (0x07000027) | Developer's rule, 2026-11-23: same kind: class A drive (Matchless / AC30) | moved: Treble 5->4; dropped: Presence, Middle; set to default: Tone Cut 50, Char 0 |
| L-Star OD (0x0700004A) | UK 800 (0x07000035) | Developer's rule, 2026-11-23: same kind: medium-gain drive | moved: Gain 1->0, Presence 2->1, Volume 3->2, Bass 4->3, Middle 5->4, Treble 6->5; dropped: Input |
| UK 900 (0x0700004E) | UK 800 (0x07000035) | Marshall JCM900 / JCM800 | nothing |
| Mess4 LD (0x07000055) | Mess DualV (0x07000068) | Developer's rule, 2026-11-23: high-gain amps are much alike; same maker (Mesa/Boogie) | nothing |
| Mess4 LD 2 (0x07000056) | Mess DualV (0x07000068) | Developer's rule, 2026-11-23: high-gain amps are much alike; same maker (Mesa/Boogie) | nothing |
| Mess4 LD 3 (0x07000057) | Mess DualV (0x07000068) | Developer's rule, 2026-11-23: high-gain amps are much alike; same maker (Mesa/Boogie) | nothing |
| Flagman+ 2 (0x0700005E) | Flagman+ (0x0700005D) | Friedman BE100 HBE channel on both | nothing |
| Eagle 120+ (0x07000060) | Eagle 120 (0x0700005F) | ENGL Savage 120, another setting | nothing |
| Dizz VH S (0x07000066) | Dizz VH (0x07000065) | Diezel VH4, another version | nothing |
| Dizz VH+ S (0x0700006B) | Dizz VH+ (0x0700006A) | Diezel VH4, another version | nothing |
| Bog RedM (0x0700006E) | Bog RedV (0x0700006D) | Bogner XTC red channel, modern / vintage | nothing |
| Knights CL+ (0x0700007B) | Foxy 30N (0x07000011) | Developer's rule, 2026-11-23: same kind: British class A clean | moved: Volume 1->2; dropped: Bass, Middle, Treble; set to default: Tone Cut 50, Bright 0 |
| Knights OD (0x0700007C) | Foxy 30TB (0x07000027) | Developer's rule, 2026-11-23: same kind: British class A drive | moved: Volume 1->2, Bass 2->3; dropped: Middle; set to default: Tone Cut 50, Char 0 |
| Mini Bass (0x08000075) | Classic Bass (0x07000073) | Developer's rule, 2026-11-23: same maker: Ampeg bass amp (B-15 / SVT) | moved: Volume 0->5, Treble 2->4; set to default: Gain 50, Middle 50, MidFreq 1 |
| Bass Pre (0x08000076) | Classic Bass (0x07000073) | Developer's rule, 2026-11-23: same kind: bass amp | moved: Volume 0->5, Bass 2->1, Middle 3->2; dropped: Bright; set to default: Gain 50, MidFreq 1 |
| SUP ZEP (0x0A000000) | TWD CP 1x8 (0x0A000001) | Developer's rule, 2026-11-23: cab by size: one small speaker | moved: Volume 1->0; dropped: Low Cut, High Cut |
| TWD CP, DARK VIT, FOXY 1, D STAR, FOXY 2, J-120, Dark Twin, UK GRN 1, Bellman 1, SUP Star, Dark CS, UK TD, UK GRN 2, Mess, Bog, Eagle, Solo, Juice, Dizz, AMPG 1 | TWD CP 1x8, Dark VIT 1x12, Foxy 1x12, L-Star 1x12, Foxy 2x12, J-120 2x12, Dark Twin 2x12, UK GRN 2x12, Bellman 2x12, SUP Star 2x12, Dark CS 2x12, EV 4x12, UK GRN 4x12, Mess 4x12, Bog 4x12, Eagle 4x12, Solo 4x12, Juice 4x12, Dizz 4x12, AMPG 4x10 | same code | moved: Volume 1->0; dropped: Low Cut, High Cut |
| TWD PRC (0x0A000002) | Dark VIT 1x12 (0x0A000004) | Developer's rule, 2026-11-23: cab by maker and layout: Fender, one speaker | moved: Volume 1->0; dropped: Low Cut, High Cut |
| DARK LUX (0x0A000003) | Dark VIT 1x12 (0x0A000004) | Developer's rule, 2026-11-23: cab by maker and layout: Fender 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| ROUT (0x0A000005) | Dark VIT 1x12 (0x0A000004) | Developer's rule, 2026-11-23: cab by layout: American-style 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| BogSV (0x0A000006) | L-Star 1x12 (0x0A000009) | Developer's rule, 2026-11-23: cab by layout: boutique 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Bad-KT (0x0A000007) | Foxy 1x12 (0x0A000008) | Developer's rule, 2026-11-23: cab by layout: British-voiced class A 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| TOM OPEN (0x0A00000A) | Dark VIT 1x12 (0x0A000004) | Developer's rule, 2026-11-23: cab by layout: American-style 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| TWD LUX (0x0A00000B) | Dark VIT 1x12 (0x0A000004) | Developer's rule, 2026-11-23: cab by maker and layout: Fender 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| US STO (0x0A00000C) | L-Star 1x12 (0x0A000009) | Mesa/Boogie 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| ACE (0x0A00000D) | Foxy 1x12 (0x0A000008) | Developer's rule, 2026-11-23: cab by layout: Vox-style 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK G12 (0x0A00000E) | UK GRN 2x12 (0x0A000013) | Marshall, 1x12 / 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Match (0x0A000010) | Foxy 2x12 (0x0A00000F) | Developer's rule, 2026-11-23: cab by layout: class A 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| TWD SUP (0x0A000014) | Dark CS 2x12 (0x0A00001B) | Developer's rule, 2026-11-23: cab by maker and layout: Fender, two speakers | moved: Volume 1->0; dropped: Low Cut, High Cut |
| BOUTI (0x0A000015) | Dark CS 2x12 (0x0A00001B) | Developer's rule, 2026-11-23: cab by layout: custom 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| SUP (0x0A000017) | Dark CS 2x12 (0x0A00001B) | Developer's rule, 2026-11-23: cab by layout: American 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| MATT TWD (0x0A000018) | Foxy 2x12 (0x0A00000F) | Developer's rule, 2026-11-23: cab by layout: class A 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Freed (0x0A00001A) | SUP Star 2x12 (0x0A000019) | Developer's rule, 2026-11-23: cab by layout: closed 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| DB Rock (0x0A00001C) | Dark CS 2x12 (0x0A00001B) | Developer's rule, 2026-11-23: cab by layout: American 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Blue SK (0x0A00001D) | Foxy 2x12 (0x0A00000F) | Developer's rule, 2026-11-23: cab by layout: 2x12 with Alnico Blue speakers (as an AC30) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Bellman 2 (0x0A00001E) | Bellman 2x12 (0x0A000016) | Fender Bassman, 4x10 / 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK LD (0x0A00001F) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK MD (0x0A000021) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| EV (0x0A000023) | EV 4x12 (0x0A000020) | Peavey 6505 4x12 on both (the GP-50 manual's EV 4x12) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Uban (0x0A000027) | Bog 4x12 (0x0A000025) | Bogner 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| H-WAY (0x0A00002A) | UK GRN 4x12 (0x0A000022) | Developer's rule, 2026-11-23: cab by layout: British 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK Dark (0x0A00002B) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 (1968) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Way (0x0A00002C) | UK GRN 4x12 (0x0A000022) | Developer's rule, 2026-11-23: cab by layout: British 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Dumb (0x0A00002D) | UK GRN 4x12 (0x0A000022) | Developer's rule, 2026-11-23: cab by layout: 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| TRP (0x0A00002F) | Eagle 4x12 (0x0A000026) | Developer's rule, 2026-11-23: cab by layout: German high-gain 4x12 (H&K / ENGL) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK 75 (0x0A000030) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 (G12T-75 / Greenback speakers) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| King (0x0A000031) | Mess 4x12 (0x0A000024) | Mesa/Boogie 4x12 (Road King / Rectifier) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| ADM 1 (0x0A000032) | AMPG 4x10 (0x0A000038) | Developer's rule, 2026-11-23: bass cab | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Workman 1 (0x0A000033) | AMPG 4x10 (0x0A000038) | Developer's rule, 2026-11-23: bass cab | moved: Volume 1->0; dropped: Low Cut, High Cut |
| F-TOP (0x0A000034) | AMPG 4x10 (0x0A000038) | Developer's rule, 2026-11-23: bass cab, same maker (Ampeg) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| US BASS (0x0A000035) | AMPG 4x10 (0x0A000038) | Developer's rule, 2026-11-23: bass cab | moved: Volume 1->0; dropped: Low Cut, High Cut |
| MATT (0x0A000036) | AMPG 4x10 (0x0A000038) | Developer's rule, 2026-11-23: bass cab | moved: Volume 1->0; dropped: Low Cut, High Cut |
| ADM 2 (0x0A000037) | AMPG 4x10 (0x0A000038) | Bass 4x10 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Workman 2 (0x0A000039) | AMPG 4x10 (0x0A000038) | Bass 4x10 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| HACK (0x0A00003A) | AMPG 4x10 (0x0A000038) | Developer's rule, 2026-11-23: bass cab | moved: Volume 1->0; dropped: Low Cut, High Cut |
| AMPG 2 (0x0A00003B) | AMPG 4x10 (0x0A000038) | Ampeg bass cab, 8x10 / 4x10 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| AC | AC | same code | dropped: Low Cut, High Cut |
| AC Dream (0x0A00003D) | AC (0x0A00003C) | Acoustic guitar body (dreadnought 2 / 1) | dropped: Low Cut, High Cut |
| OM (0x0A00003E) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| JUMBO (0x0A00003F) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| Bird (0x0A000040) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| GA (0x0A000041) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| Classic AC (0x0A000042) | AC (0x0A00003C) | Developer's rule, 2026-11-23: acoustic body (the GP-50 has one) | dropped: Low Cut, High Cut |
| Mandolin (0x0A000043) | AC (0x0A00003C) | Developer's rule, 2026-11-23: acoustic body (the GP-50 has one) | dropped: Low Cut, High Cut |
| Fretless Bass (0x0A000044) | AC (0x0A00003C) | Developer's rule, 2026-11-23: acoustic body (the GP-50 has one) | dropped: Low Cut, High Cut |
| Double Bass (0x0A000045) | AC (0x0A00003C) | Developer's rule, 2026-11-23: acoustic body (the GP-50 has one) | dropped: Low Cut, High Cut |
| Pure, Tape, Tube, Sweet Echo | Pure, Tape, Tube, Sweet Echo | same code | limited: Time to 20-1000 |
| Dual Echo (0x0B000003) | Ping Pong (0x0B000004) | Developer's rule, 2026-11-23: same kind: two-sided delay (its A side kept) | moved: Time A 2->1, Feedback A 1->2, Sync A 6->3, Trail 8->4; paired: Mix A = Mix, Time A = Time, Feedback A = F.Back, Sync A = Sync; limited: Time A to 20-500, Feedback A to 0-100; dropped: Mix B, Time B, Feedback B, Sync B |
| Ping Pong | Ping Pong | same code | moved: Time 2->1, Feedback 1->2; limited: Time to 20-500 |
| Slapback | Slapback | same code | dropped: Sync |
| Sweep Echo | Sweep Echo | same code | moved: Time 2->1, Feedback 1->2; paired: Sweep Depth = S-Depth (by position), Sweep Rate = S-Rate (by position), Sweep Sync = S-Sync (by position), Time Sync = D-Sync (by position); limited: Time to 20-1000 |
| Ring Echo | Ring Echo | same code | moved: Time 2->1, Feedback 1->2; paired: Dly Mix = Mix (by position), Ring Mix = R-Mix (by position); limited: Time to 20-1000 |
| M-Echo (0x0B00000C) | Tape (0x0B000002) | Developer's rule, 2026-11-23: same kind: tape echo | moved: Sync 5->3, Trail 6->4; limited: Time to 20-1000; dropped: Tone, Mode |
| 999 Echo (0x0B000012) | Analog (0x0B000001) | Analog delay (Maxon AD900) | nothing |
| Vintage Rack (0x0B000014) | Pure (0x0B000000) | Developer's rule, 2026-11-23: same kind: digital delay | moved: Time 2->1, Feedback 1->2, Sync 5->3, Trail 6->4; limited: Time to 20-1000; dropped: Mod, Tone |
| BBD Delay S (0x0B00001D) | Analog (0x0B000001) | Analog (BBD) delay; stereo on the GP-200 | moved: Sync 6->3, Trail 7->4; limited: Feedback to 0-100; dropped: Time R%, Spread, Level |
| Digital Delay S (0x0B00001F) | Pure (0x0B000000) | Clean digital delay; stereo on the GP-200 | moved: Sync 6->3, Trail 7->4; limited: Time to 20-1000, Feedback to 0-100; dropped: Time R%, Spread, Level |
| Tape Delay S (0x0B000021) | Tape (0x0B000002) | Tape delay; stereo on the GP-200 | moved: Sync 10->3, Trail 11->4; limited: Time to 20-1000, Feedback to 0-100; dropped: Time R%, Spread, Wow &, Age, Scrape, Drive, Level |
| Lofi Echo (0x0B000026) | Analog (0x0B000001) | Developer's rule, 2026-11-23: same kind: dark delay | moved: Sync 6->3, Trail 7->4; limited: Feedback to 0-100; dropped: Crush, Bit |
| Rev Echo (0x0B000028) | Rev Echo (0x0B000013) | Same name; another code on the GP-50 (reverse delay on both) | moved: Sync 4->3, Trail 5->4; limited: Time to 20-780, Feedback to 0-100; dropped: Level |
| Ambience 1 (0x0B00002A) | Pure (0x0B000000) | Developer's rule, 2026-11-23: same kind: delay | moved: Sync 6->3, Trail 7->4; limited: Time to 20-1000; dropped: Level, Mod, Tone |
| Ambience 2 (0x0B00002E) | Pure (0x0B000000) | Developer's rule, 2026-11-23: same kind: delay | moved: Sync 6->3, Trail 7->4; limited: Time to 20-1000; dropped: Level, Mod, Tone |
| Broken Delay (0x0B000032) | Pure (0x0B000000) | Developer's rule, 2026-11-23: same kind: delay | moved: Sync 5->3, Trail 6->4; limited: Time to 20-1000; dropped: Latch, Cut |
| Ice Delay (0x0B000033) | Pure (0x0B000000) | Developer's rule, 2026-11-23: same kind: delay (its pitch slices are lost) | moved: Sync 11->3, Trail 12->4; limited: Time to 20-1000; dropped: Tone, Mod, Pitch, Slice, Direction, Blend, Smooth, Level |
| Room, Hall, Church | Room, Hall, Church | same code | dropped: Pre Delay |
| Plate (0x0C000003) | Plate (0x0C00000F) | Plate reverb (the GP-50's small plate) | moved: Decay 1->2, High Damp 2->4, Trail 3->6; paired: High Damp = Damp |
| Spring | Spring | same code | dropped: Tone |
| Sweet Space (0x0C000008) | Sweet Space (0x0C000015) | Same name; another code on the GP-50 (modulated reverb on both) | moved: Trail 5->6; dropped: Pre Delay, Lo End, Hi End; set to default: Damp 0, Mod 50 |
| Shimmer (0x0C000009) | N-Star (0x0C000006) | Developer's rule, 2026-11-23: same kind: bright, lush reverb (no octave) | moved: Decay 2->1, Trail 5->2; dropped: Pre Delay, Lo End, Hi End |
| Studio | Air | same code | paired: Hi Damp = Damp (by position); dropped: Pre Delay, Low Damp, Mod |
| Club (0x0C00000C) | Room (0x0C000000) | Small room | moved: Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Concert (0x0C00000D) | Hall (0x0C000001) | Hall | moved: Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Arena (0x0C00000E) | Hall (0x0C000001) | The GP-50's biggest room reverb | moved: Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Amp Spring (0x0C000011) | Spring (0x0C000004) | Spring reverb | moved: Decay 2->1, Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Tube Spring (0x0C000012) | Spring (0x0C000004) | Spring reverb | moved: Decay 2->1, Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |

## 5. GP-200 to GP-50: no match

- **PRE** (5): Step Filter; Ring Mod; Auto Swell; Hold; Freeze
- **MOD** (1): Bit Smash
- **VOL** (1): Volume

## 6. Same effect, settings moved or renamed (for information)

| Direction | Effect | Settings |
|---|---|---|
| GP-50 to GP-200 | COMP4 (0x00000001) | paired: Clip = Clipping (by position) |
| GP-50 to GP-200 | Toucher (0x0100000F) = T-Wah | nothing |
| GP-50 to GP-200 | Crier (0x01000015) = A-WAH | nothing |
| GP-50 to GP-200 | OCTA (0x01000021) | paired: Low = Low Oct (by position), High = High Oct (by position) |
| GP-50 to GP-200 | Pitch (0x01000023) | moved: H-VOL 3->4, L-VOL 4->5 |
| GP-50 to GP-200 | Jet (0x04000011) | paired: P.Delay = Pre Delay (by position) |
| GP-50 to GP-200 | N-Jet (0x04000013) | paired: P.Delay = Pre Delay (by position) |
| GP-50 to GP-200 | J-120 CL (0x07000014) | paired: VOL = Gain (by position) |
| GP-50 to GP-200 | Classic Bass (0x07000073) | paired: MidFreq = Midrange (by position) |
| GP-50 to GP-200 | AC Pre1 (0x0800007A) = AC Pre | nothing |
| GP-50 to GP-200 | AC Pre2 (0x0800007B) = AC Pre 2 | nothing |
| GP-50 to GP-200 | TWD CP 1x8 (0x0A000001) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Dark VIT 1x12 (0x0A000004) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Foxy 1x12 (0x0A000008) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | L-Star 1x12 (0x0A000009) = D STAR | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Foxy 2x12 (0x0A00000F) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | J-120 2x12 (0x0A000011) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Dark Twin 2x12 (0x0A000012) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | UK GRN 2x12 (0x0A000013) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Bellman 2x12 (0x0A000016) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | SUP Star 2x12 (0x0A000019) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Dark CS 2x12 (0x0A00001B) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | UK GRN 4x12 (0x0A000022) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Mess 4x12 (0x0A000024) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Bog 4x12 (0x0A000025) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Eagle 4x12 (0x0A000026) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Solo 4x12 (0x0A000028) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Juice 4x12 (0x0A000029) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Dizz 4x12 (0x0A00002E) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | AMPG 4x10 (0x0A000038) | moved: VOL 0->1; set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | AC (0x0A00003C) | set to default: Low Cut 19, High Cut 20001 |
| GP-50 to GP-200 | Ping Pong (0x0B000004) | moved: Time 1->2, F.Back 2->1 |
| GP-50 to GP-200 | Slapback (0x0B000005) | set to default: Sync 0 |
| GP-50 to GP-200 | Sweep Echo (0x0B000006) | moved: Time 1->2, F.Back 2->1; paired: S-Depth = Sweep Depth (by position), S-Rate = Sweep Rate (by position), S-Sync = Sweep Sync (by position), D-Sync = Time Sync (by position) |
| GP-50 to GP-200 | Ring Echo (0x0B000009) | moved: Time 1->2, F.Back 2->1; paired: Mix = Dly Mix (by position), R-Mix = Ring Mix (by position) |
| GP-50 to GP-200 | Room (0x0C000000) | set to default: Pre Delay 50 |
| GP-50 to GP-200 | Hall (0x0C000001) | set to default: Pre Delay 50 |
| GP-50 to GP-200 | Church (0x0C000002) | set to default: Pre Delay 50 |
| GP-50 to GP-200 | Spring (0x0C000004) | set to default: Tone 50 |
| GP-50 to GP-200 | Air (0x0C00000B) = Studio | paired: Damp = Hi Damp (by position); set to default: Pre Delay 0, Low Damp 50, Mod 50 |
| GP-200 to GP-50 | COMP4 (0x00000001) | paired: Clipping = Clip (by position) |
| GP-200 to GP-50 | T-Wah (0x0100000F) = Toucher | nothing |
| GP-200 to GP-50 | A-WAH (0x01000015) = Crier | nothing |
| GP-200 to GP-50 | OCTA (0x01000021) | paired: Low Oct = Low (by position), High Oct = High (by position) |
| GP-200 to GP-50 | Pitch (0x01000023) | moved: Hi Vol 4->3, Low Vol 5->4 |
| GP-200 to GP-50 | Jet (0x04000011) | paired: Pre Delay = P.Delay (by position) |
| GP-200 to GP-50 | N-Jet (0x04000013) | paired: Pre Delay = P.Delay (by position) |
| GP-200 to GP-50 | J-120 CL (0x07000014) | paired: Gain = VOL (by position) |
| GP-200 to GP-50 | Classic Bass (0x07000073) | paired: Midrange = MidFreq (by position) |
| GP-200 to GP-50 | AC Pre (0x0800007A) = AC Pre1 | nothing |
| GP-200 to GP-50 | AC Pre 2 (0x0800007B) = AC Pre2 | nothing |
