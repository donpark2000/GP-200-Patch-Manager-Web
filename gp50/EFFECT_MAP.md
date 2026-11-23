# Effect map: review

Made by `tools/make-effect-map.js` from Valeton's own files (the GP-200 editor's
`algorithm.xml`, Valeton Suite's `module50_data.json`) and `gp50/effect-map-choices.json`.
Don't edit by hand: change the choices file and run the tool.

| | same | rename | close | conflict | none | out of scope |
|---|---|---|---|---|---|---|
| GP-50 to GP-200 | 100 | 6 | 6 | 0 | 0 | 100 |
| GP-200 to GP-50 | 69 | 4 | 93 | 0 | 109 | 30 |

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
| P-Boost (0x0000000C) | Boost (0x0000001A) | Both Xotic clean boosts (RC Booster / EP Booster) | dropped: Volume, Bass, Treble; set to default: +3dB 1, Bright 1 |
| Gate 2 (0x0000001D) | Gate (0x0000001B) | The GP-50's only noise gate | dropped: Attack, Release |
| Gate 3 (0x00000021) | Gate (0x0000001B) | The GP-50's only noise gate (Gate 3 is an expander) | dropped: Ratio, Attack, Release, Hold, Hysteresis |
| OD 9 (0x03000001) | Green OD (0x03000000) | Tube Screamer TS9 / TS808 | nothing |
| Scream OD (0x03000008) | Green OD (0x03000000) | Both Tube Screamer style | dropped: Fat, Air |
| Lazaro | Sora Fuzz | Developer, 2026-11-23: usable and close either way. Valeton describes this code three ways (Suite: Sora Fuzz, a Tone Bender Mk II; GP-50 manual: a Fuzz Face, likely copied from Red Haze; GP-200: Lazaro, a Big Muff); the same code is kept | moved: Volume 2->1; paired: Sustain = Fuzz (by position); dropped: Tone |
| B-Jet (0x04000012) | Jet (0x04000011) | Flanger (B-Jet is tuned for bass) | paired: Pre Delay = P.Delay (by position) |
| Vibrato T (0x04000018) | Vibrato (0x04000017) | Vibrato. Vibrato T's Sens sets how much playing strength changes the depth (the GP-200 editor's text), not the depth itself: dropped, Depth set to default | paired: Output = VOL (by position); dropped: Sens (not the same setting); set to default: Depth 50 |
| G-Phase (0x0400001A) | O-Phase (0x04000019) | Phaser (a green BBD phaser / MXR Phase 90) | moved: Rate 1->0, Sync 2->1; dropped: Depth |
| S-Phase (0x0400001B) | O-Phase (0x04000019) | Phaser (EHX Small Stone / MXR Phase 90) | moved: Rate 1->0, Sync 2->1; dropped: Color |
| Vibe (0x04000020) | M-Vibe (0x0400001F) | Uni-Vibe / Micro-Vibe | moved: Sync 4->2; dropped: Volume, Mode |
| Triangle Trem (0x04000027) | Sine Trem (0x04000026) | Tremolo, triangle / sine wave | nothing |
| V-Wah (0x05000001) | C-Wah (0x05000008) | The GP-50's only wah (Vox V846 / Cry Baby) | nothing |
| S-Wah (0x05000006) | C-Wah (0x05000008) | The GP-50's only wah | nothing |
| P-Wah (0x0500000A) | C-Wah (0x05000008) | The GP-50's only wah (a Cry Baby setting / Cry Baby) | dropped: EQ |
| Silver Twin (0x0700000D) | Dark Twin (0x07000004) | Fender Twin Reverb, Silverface / Blackface | set to default: Bright 1 |
| Foxy 15TB (0x07000010) | Foxy Bass (0x07000075) | Vox AC-100 bass amp on both | moved: Volume 2->0, Bass 3->1, Treble 4->2; dropped: Gain, Tone Cut |
| UK 45+ (0x0700002B) | UK 45 (0x0700002A) | Marshall JTM45, another setting | nothing |
| UK 45JP (0x0700002C) | UK 45 (0x0700002A) | Marshall JTM45, jumped / normal input | paired: Gain 1 = Gain (by position); dropped: Gain 2 |
| UK 50 (0x0700002D) | UK 50JP (0x0700002F) | Marshall JMP50, jumped on both | paired: Gain = Gain 1 (by position); set to default: Gain 2 50 |
| UK 50+ (0x0700002E) | UK 50JP (0x0700002F) | Marshall JMP50, another setting | paired: Gain = Gain 1 (by position); set to default: Gain 2 50 |
| Flagman 1 (0x07000040) | Flagman+ (0x0700005D) | Friedman BE100: BE channel / HBE channel (more gain) | nothing |
| Flagman 2 (0x07000041) | Flagman+ (0x0700005D) | Friedman BE100: BE channel / HBE channel (more gain) | nothing |
| UK 900 (0x0700004E) | UK 800 (0x07000035) | Marshall JCM900 / JCM800 | nothing |
| Flagman+ 2 (0x0700005E) | Flagman+ (0x0700005D) | Friedman BE100 HBE channel on both | nothing |
| Eagle 120+ (0x07000060) | Eagle 120 (0x0700005F) | ENGL Savage 120, another setting | nothing |
| Dizz VH S (0x07000066) | Dizz VH (0x07000065) | Diezel VH4, another version | nothing |
| Dizz VH+ S (0x0700006B) | Dizz VH+ (0x0700006A) | Diezel VH4, another version | nothing |
| Bog RedM (0x0700006E) | Bog RedV (0x0700006D) | Bogner XTC red channel, modern / vintage | nothing |
| TWD CP, DARK VIT, FOXY 1, D STAR, FOXY 2, J-120, Dark Twin, UK GRN 1, Bellman 1, SUP Star, Dark CS, UK TD, UK GRN 2, Mess, Bog, Eagle, Solo, Juice, Dizz, AMPG 1 | TWD CP 1x8, Dark VIT 1x12, Foxy 1x12, L-Star 1x12, Foxy 2x12, J-120 2x12, Dark Twin 2x12, UK GRN 2x12, Bellman 2x12, SUP Star 2x12, Dark CS 2x12, EV 4x12, UK GRN 4x12, Mess 4x12, Bog 4x12, Eagle 4x12, Solo 4x12, Juice 4x12, Dizz 4x12, AMPG 4x10 | same code | moved: Volume 1->0; dropped: Low Cut, High Cut |
| US STO (0x0A00000C) | L-Star 1x12 (0x0A000009) | Mesa/Boogie 1x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK G12 (0x0A00000E) | UK GRN 2x12 (0x0A000013) | Marshall, 1x12 / 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Bellman 2 (0x0A00001E) | Bellman 2x12 (0x0A000016) | Fender Bassman, 4x10 / 2x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK LD (0x0A00001F) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK MD (0x0A000021) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| EV (0x0A000023) | EV 4x12 (0x0A000020) | Peavey 6505 4x12 on both (the GP-50 manual's EV 4x12) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Uban (0x0A000027) | Bog 4x12 (0x0A000025) | Bogner 4x12 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK Dark (0x0A00002B) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 (1968) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| UK 75 (0x0A000030) | UK GRN 4x12 (0x0A000022) | Marshall 4x12 (G12T-75 / Greenback speakers) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| King (0x0A000031) | Mess 4x12 (0x0A000024) | Mesa/Boogie 4x12 (Road King / Rectifier) | moved: Volume 1->0; dropped: Low Cut, High Cut |
| ADM 2 (0x0A000037) | AMPG 4x10 (0x0A000038) | Bass 4x10 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| Workman 2 (0x0A000039) | AMPG 4x10 (0x0A000038) | Bass 4x10 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| AMPG 2 (0x0A00003B) | AMPG 4x10 (0x0A000038) | Ampeg bass cab, 8x10 / 4x10 | moved: Volume 1->0; dropped: Low Cut, High Cut |
| AC | AC | same code | dropped: Low Cut, High Cut |
| AC Dream (0x0A00003D) | AC (0x0A00003C) | Acoustic guitar body (dreadnought 2 / 1) | dropped: Low Cut, High Cut |
| OM (0x0A00003E) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| JUMBO (0x0A00003F) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| Bird (0x0A000040) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| GA (0x0A000041) | AC (0x0A00003C) | Acoustic guitar body (the GP-50 has one, a dreadnought) | dropped: Low Cut, High Cut |
| Pure, Tape, Tube, Sweet Echo | Pure, Tape, Tube, Sweet Echo | same code | limited: Time to 20-1000 |
| Ping Pong | Ping Pong | same code | moved: Time 2->1, Feedback 1->2; limited: Time to 20-500 |
| Slapback | Slapback | same code | dropped: Sync |
| Sweep Echo | Sweep Echo | same code | moved: Time 2->1, Feedback 1->2; paired: Sweep Depth = S-Depth (by position), Sweep Rate = S-Rate (by position), Sweep Sync = S-Sync (by position), Time Sync = D-Sync (by position); limited: Time to 20-1000 |
| Ring Echo | Ring Echo | same code | moved: Time 2->1, Feedback 1->2; paired: Dly Mix = Mix (by position), Ring Mix = R-Mix (by position); limited: Time to 20-1000 |
| 999 Echo (0x0B000012) | Analog (0x0B000001) | Analog delay (Maxon AD900) | nothing |
| BBD Delay S (0x0B00001D) | Analog (0x0B000001) | Analog (BBD) delay; stereo on the GP-200 | moved: Sync 6->3, Trail 7->4; limited: Feedback to 0-100; dropped: Time R%, Spread, Level |
| Digital Delay S (0x0B00001F) | Pure (0x0B000000) | Clean digital delay; stereo on the GP-200 | moved: Sync 6->3, Trail 7->4; limited: Time to 20-1000, Feedback to 0-100; dropped: Time R%, Spread, Level |
| Tape Delay S (0x0B000021) | Tape (0x0B000002) | Tape delay; stereo on the GP-200 | moved: Sync 10->3, Trail 11->4; limited: Time to 20-1000, Feedback to 0-100; dropped: Time R%, Spread, Wow &, Age, Scrape, Drive, Level |
| Rev Echo (0x0B000028) | Rev Echo (0x0B000013) | Same name; another code on the GP-50 (reverse delay on both) | moved: Sync 4->3, Trail 5->4; limited: Time to 20-780, Feedback to 0-100; dropped: Level |
| Room, Hall, Church | Room, Hall, Church | same code | dropped: Pre Delay |
| Plate (0x0C000003) | Plate (0x0C00000F) | Plate reverb (the GP-50's small plate) | moved: Decay 1->2, High Damp 2->4, Trail 3->6; paired: High Damp = Damp |
| Spring | Spring | same code | dropped: Tone |
| Sweet Space (0x0C000008) | Sweet Space (0x0C000015) | Same name; another code on the GP-50 (modulated reverb on both) | moved: Trail 5->6; dropped: Pre Delay, Lo End, Hi End; set to default: Damp 0, Mod 50 |
| Studio | Air | same code | paired: Hi Damp = Damp (by position); dropped: Pre Delay, Low Damp, Mod |
| Club (0x0C00000C) | Room (0x0C000000) | Small room | moved: Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Concert (0x0C00000D) | Hall (0x0C000001) | Hall | moved: Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Arena (0x0C00000E) | Hall (0x0C000001) | The GP-50's biggest room reverb | moved: Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Amp Spring (0x0C000011) | Spring (0x0C000004) | Spring reverb | moved: Decay 2->1, Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |
| Tube Spring (0x0C000012) | Spring (0x0C000004) | Spring reverb | moved: Decay 2->1, Trail 6->3; dropped: Pre Delay, Low Damp, Hi Damp, Mod |

## 5. GP-200 to GP-50: no match

- **PRE** (17): S-Comp; AC Boost (Xotic AC Booster pedal); 14 Boost (FortinGrind); FAT BB; AC Refiner; Step Filter; P-Bend; Ring Mod; Saturate; Hammy (Whammy monophonic pitch shifter pedal); Harmonizer 1; Harmonizer 2; Blues OD; Penesas (Klon Centaur); Auto Swell; Hold; Freeze
- **MOD** (7): Bit Smash; G-Chorus; C-Chorus (4-button purple stereo chorus pedal); M-Chorus; Trem Jet; G-Roto (huge ensemble chorus pedal born in late 1970s (vibrato mode)); Pan Phase
- **EQ** (1): Hyper EQ
- **DST** (17): Swarm; Force; Tube (B); Blues Master; Master OD; TaiChi OD; Precise OD; Timmy OD; Sora Fuzz; Chief; Master Dist; Revolt (Suhr Riot Distortion pedal,Three knobs and a tone...); Flex OD; Black Bass (Darkglass Microtubes B7K); Empire OD (Analog.Man Prince of Tone Overload effect); Bass Hammer (Aguilar Tone Hammer Front effect); Flagman Dist
- **WAH** (1): B-Wah
- **VOL** (1): Volume
- **AMP** (25): Dark DLX; Dark Vibra; SUPDual CL (SuproDual-Tone 1624T (CH1，clean tone)); BogSV CL (Bogner Shiva (20th Anniversary version); Z38 CL (Dr); Knights CL (Grindrod Pendragon PG20C (Normal channel); Bad-KT CL (Bad Cat Hot Cat 30 (clean channel)); Solo100 CL (Soldano SLO100 (clean channel)); UK SLP; Mess2C+ 1 (Mesa/Boogie Mark II C+ (Lead channel) with 3 different...); Mess2C+ 2 (Mesa/Boogie Mark II C+ (Lead channel) with 3 different...); Mess2C+ 3 (Mesa/Boogie Mark II C+ (Lead channel) with 3 different...); BogSV OD (Bogner Shiva (20th Anniversary version); Juice30 OD; Bog BlueV; Bog BlueM; Match OD; L-Star OD (Mesa/Boogie Lone Star(CH2).); Mess4 LD (Mesa/Boogie Mark IV (Lead channel)); Mess4 LD 2 (Mesa/Boogie Mark IV (Lead 2 channel).); Mess4 LD 3 (Mesa/Boogie Mark IV (Lead 3 channel).); Knights CL+ (Grindrod Pendragon PG20C (Normal channel); Knights OD (Grindrod Pendragon PG20C (Drive channel)); Mini Bass (Ampeg B-15 "Flip Top" bass amp); Bass Pre (Alembic F-2B preamp.In the 1960s)
- **CAB** (31): SUP ZEP; TWD PRC; DARK LUX; ROUT; BogSV; Bad-KT; TOM OPEN; TWD LUX; ACE; Match; TWD SUP; BOUTI; SUP; MATT TWD; Freed; DB Rock; Blue SK; H-WAY; Way; Dumb; TRP; ADM 1; Workman 1; F-TOP; US BASS; MATT; HACK; Classic AC; Mandolin; Fretless Bass; Double Bass
- **DLY** (8): Dual Echo; M-Echo; Vintage Rack; Lofi Echo; Ambience 1; Ambience 2; Broken Delay; Ice Delay
- **RVB** (1): Shimmer

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
