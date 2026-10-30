<!--
  PPGDEX-SUBFLOOR-RATE-TEST-2026-10-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-10-29 · **Created:** 2026-10-29

# The sub-floor rate correction in PpgDex, against the H10 ECG

This brief records one measurement and carries no code. It answers the debt
`RING-TIMEBASE-ECG-TEST-2026-10-29-BRIEF.md` §5.3 names. That study scored whole nights. It does not
show that the `fs` correction at `ppgdex-dsp.js:1253` helps a fragment under `PPG_RATE_MIN_SPAN_S`.

🔴 **Result: the ECG cannot referee the question.** Of 288 ring fragments that build a host axis under
the span floor, 11 share a scorable 5-minute bin with an H10 ECG. Over those 26 bins the two arms sit
0.013 bpm apart, against a 0.861 bpm pooled error. So no `fs` change wins, and the remedy stays the
annotation the owner decided on (board #2180).

## 1 · The three arms

Arm A is the tree as it stands. `ppgdex-dsp.js:1253` divides `fs` by the whole-file `ppm`, with no span
test. Arm B guards that line on `hostAx.spanMs >= PPG_RATE_MIN_SPAN_S * 1000`, which is the floor the
per-segment publication already applies. The order named arm C as a per-beat mapping in place of one rate.

**Arm C is not a distinct arm, because the per-beat mapping already ships.** `ppgdex-dsp.js:1288` reads
`relSec[i] = (devMs + correctionAt(devMs)) / 1000` for every sample. The 2026-09-05 measurement through
`pat-matchrate-strict.mjs` found 72514 of 72514 consensus feet resolving through `relSec`. A per-segment
variant is also untestable on this population: 286 of the 288 fragments carry no resync.

So one free choice remains, and it is what `fs` the detector sees. `fs` sets the bandpass design, the
cadence and upstroke windows, the refractory floor, the gap threshold and `durSec`. It does not set a
beat time.

## 2 · Method

1. A Node realm loads `clock.js` and the twelve `PPG_REALM` modules, as the analysis tools do. Arm B
   replaces the `:1253` text in memory and throws when that text has moved.
2. Each arm runs `parsePPG` and `compute({ rich: true })` on one fragment file. The arms differ in no
   other respect, and they read the same bytes.
3. The scorer is `RING-TIMEBASE-ECG-TEST-2026-10-29-BRIEF.md` §7, applied per fragment. It bins RR by
   absolute time into 5-minute bins. It drops corrected beats and intervals outside 250 ms to 2500 ms.
   A bin needs 100 intervals.
4. The ECG reference is each night's committed `ECGDex` node-export. The scorer compares each arm with
   that reference over the bins the two share.
5. §6 holds the harness and the scorer verbatim. Neither enters the tree.

## 3 · Population

| set | fragments |
|---|---|
| ring `_PPG.txt` fragments in the archive, over 72 nights | 717 |
| embed `host-disciplined` — the only ones `:1253` reaches | 516 |
| of those, under 12 MB, which is the 2400 s floor at 125 Hz | 446 |
| of those, building a host axis | 288 |
| of those, spanning at or above the floor | 0 |
| sharing a scorable bin with an ECG export | 13 |
| scoring a shared bin in both arms | 11 |

`:1403` defaults an unstamped finger file to `device-crystal`, and `:1446` then overwrites `fs` with
`O2_ADC_HZ`. So the 196 unstamped and 5 crystal-stamped fragments never reach the line under test. The
61 fragments over 30 MB hold 7.11 GB and all span above the floor, where the arms agree by construction.

**Why the overlap is thin.** 189 of the 288 fragments sit on six nights with no ECG export. The rest are
mostly evening reconnect sessions. The ring writes one file per BLE session, so a short fragment is
usually an early one, recorded before the chest strap was on. One 1382 s fragment starts 38 bins before
its night's first ECG bin.

## 4 · Result

| fragment span (s) | `ppm` | bins | MAE A | MAE B | bias A | bias B |
|---|---|---|---|---|---|---|
| 375 | -2678 | 1 | 1.137 | 1.115 | 1.137 | 1.115 |
| 909 | -1178 | 3 | 0.663 | 0.663 | 0.919 | 0.919 |
| 1330 | -559 | 5 | 0.431 | 0.431 | -0.223 | -0.223 |
| 603 | -923 | 2 | 0.143 | 0.195 | 0.022 | 0.073 |
| 147 | -3586 | 1 | 0.580 | 0.580 | 0.580 | 0.580 |
| 124 | -2526 | 1 | 2.538 | 2.539 | -2.538 | -2.539 |
| 786 | -557 | 2 | 0.369 | 0.369 | -0.151 | -0.151 |
| 1021 | -4980 | 4 | 0.773 | 0.716 | 0.216 | 0.217 |
| 855 | -4310 | 3 | 0.800 | 0.812 | -0.084 | 0.008 |
| 554 | -7338 | 1 | 1.062 | 1.528 | -1.062 | -1.528 |
| 1070 | -834 | 3 | 2.132 | 2.132 | -1.693 | -1.693 |

Pooled over the 26 bins, arm A reads 0.861 bpm from the ECG and arm B reads 0.874 bpm. Median bias is
-0.103 bpm and -0.098 bpm. Both arms hold 88.5 % of bins within 2 bpm. Arm B sits closer on 12 bins,
arm A on 11, and three bins are equal. That is a coin flip, and the 0.013 bpm separation sits two
orders below the pooled error.

```json
{ "schema": "tepna.verdict/1", "gate": "ppgdex-subfloor-rate-vs-ecg", "status": "UNDERPOWERED",
  "population": { "checked": 11, "eligible": 288, "excluded": 277 },
  "criterion": { "name": "pooled_mae_delta_gated_minus_today", "threshold": -0.1, "unit": "bpm", "direction": "lte" },
  "result": { "bins": 26, "pooledMaeToday": 0.861, "pooledMaeGated": 0.874, "delta": 0.013,
              "gatedCloserBins": 12, "todayCloserBins": 11, "equalBins": 3 },
  "evidence": ["briefs/PPGDEX-SUBFLOOR-RATE-TEST-2026-10-29-BRIEF.md"],
  "reason": "277 of 288 sub-floor fragments share no scorable ECG bin, and the 26 bins that remain separate the arms by 0.013 bpm against a 0.861 bpm pooled error",
  "producedBy": { "tool": "briefs/PPGDEX-SUBFLOOR-RATE-TEST-2026-10-29-BRIEF.md#6", "commit": "f74094549" }, "at": "2026-10-29T22:30:00Z" }
```

## 5 · What the arms do move, and what this changes

The gate changes `fs` on 134 of the 288 fragments. 125 of those 134 carry a `ppm` over the 50 the
census tool calls implausible, and every fragment above that bound moves. The other 9 sit inside the
plausible band. Median `|ppm|` over the 288 is 33 and the worst is 30681, off a 13 s span.

| field | fragments moved, of 288 | median change | worst change |
|---|---|---|---|
| `fs` | 134 | 0.17 Hz | 3.96 Hz |
| `durSec` | 134 | 0.31 s | 10.41 s |
| beat count | 22 | 4 beats | 30 beats |
| mean HR | 78 | 0.017 bpm | 48.09 bpm, on a 25 s fragment |
| corrected-beat count | 0 | — | — |

1. **No `fs` change lands.** The owner's order was to land code only if it wins, and neither arm wins.
2. **The annotation lands instead** (board #2179, #2180). A consumer must be able to see that a
   published rate rests on a span the node's own floor refuses. The per-segment path already names such
   a refusal in `rateReason`, and the whole-file block names nothing.
3. The 2 dp rounding at `:1254` is what makes the gate nearly equivalent to a plausibility bound. One
   step is 80 ppm at 125 Hz, so a real crystal error of 25 ppm never survives it, while a fabricated
   -7338 ppm does. The line keeps the implausible correction and discards the legitimate one.
4. Two findings owe residue rows. The export carries no `fs` anywhere, so a consumer cannot see the
   number this line produces. And `:1253` applies a rate from a host column that is no second clock,
   which `independent` already reports in the same block.
5. **`rateApplied` cannot be a constant.** The first draft of the annotation hardcoded `true`, because
   the division runs whatever the span says. The `device-crystal` branch then overwrites `fs` with the
   125.000 ADC constant, so on the DEFAULT finger path that division reaches nothing. The field now
   reads a flag set where `fs` actually moves. The committed finger twin pins both answers: `true`
   under `host-disciplined`, `false` under the crystal default.
6. **The export reshapes the host-axis block a second time, and renames it field by field.** The
   export drops any key the parse layer adds and that list omits. All three new fields read green at
   the parse layer and absent over an artifact, until a leg read them back through `buildNodeExport`.

## 6 · Harness and scorer

The harness builds both realms, runs both arms on one fragment and records `fs`, `durSec`, `ppm`,
`spanMs`, anchors, beat count, usable intervals and mean HR. The scorer is §7 of
`RING-TIMEBASE-ECG-TEST-2026-10-29-BRIEF.md`, with the night loop replaced by a fragment loop and the
ring series read from the fragment's own export. Both live in the measuring session's scratchpad.

```js
const TODAY = 'if (hostAx.ok && isFinite(hostAx.ppm)) fs = fs / (1 + hostAx.ppm / 1e6);';
const GATED =
  'if (hostAx.ok && isFinite(hostAx.ppm) && hostAx.spanMs >= PPG_RATE_MIN_SPAN_S * 1000) fs = fs / (1 + hostAx.ppm / 1e6);';
// one realm per arm; PPG_REALM carries no clock.js, so the spine is prepended in both
for (const f of PPG_REALM.includes('clock.js') ? PPG_REALM : ['clock.js', ...PPG_REALM]) {
  let t = readFileSync(join(REPO, f), 'utf8');
  if (patch && f === 'ppgdex-dsp.js') {
    if (!t.includes(TODAY)) throw new Error('the patch target moved');
    t = t.replace(TODAY, GATED);
  }
  vm.runInContext(DexBuild.classicify(t), ctx, { filename: f });
}
if (!ctx.DexClock) throw new Error('no DexClock in the realm');
```

Every `:1253` and `:1254` reference above is the tree at `57c6bb415`. The division now also records
whether it reached `fs`, so it sits a few lines lower.

**The first run of this harness measured nothing.** `PPG_REALM` carries no `clock.js`, so `hostAxis`
refused in both arms and the two agreed on every field. The tell was `ppm`, `spanMs` and `anchors`
printed as null, not the agreement itself. A harness that compares two arms must print the field the
patch acts on.
