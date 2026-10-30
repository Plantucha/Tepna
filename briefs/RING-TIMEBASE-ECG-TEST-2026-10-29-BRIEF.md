<!--
  RING-TIMEBASE-ECG-TEST-2026-10-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-10-29 · **Created:** 2026-10-29 · **Residue:** 2026-10-29-ring-device-crystal-axis-reads-high-against-the-ecg

# The ring's device-crystal timebase against the H10 ECG, over every night

This brief records one measurement and carries no code. The owner asked for it on 2026-10-29: "now test
it for all nights include phone nights". It answers one question. Over the whole corpus, does the ring's
finger PPG agree with the H10 ECG better on the device-crystal timebase or on the timebase it uses today?

🔴 **Result: the device-crystal timebase is worse.** Over 22 nights that passed the box QC, it reads
higher than the ECG on 18 nights and better on none. The median absolute error goes from 0.19 bpm to
0.48 bpm. The verdict is FAIL against the claim in `O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md` §3.

## 1 · Why the question was open

`O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md` §3 validated the device-crystal axis against the ECG on
one hour of one night, 2026-08-08. Both axes matched the ECG to 0.2 bpm there. The later bad-host
acceptance perturbed one real night, 2026-08-01. On that evidence `ppgdex-dsp.js:1404` made
`device-crystal` the default for a finger file with no `# timebase=` stamp.

Heron's #4098 then found two drawn device constants 5869 ppm apart, the second first seen on 2026-08-10.
Both validation nights fall before that date. So no measurement covered the later corpus.

## 2 · Method

1. The baseline is the trio fold of `/srv/data/tepna-corpus/smoketest-captures` at `e7fbdef9a`, run on
   2026-10-29 into a worktree. It admitted 97 of 106 nights and landed all three node-exports on 94.
   Older nights come from the committed `uploads/trio`. The later fold wins where both hold a night.
2. The crystal run is the same fold with one line changed in `tools/trio-batch.mjs:4261`. That line
   passes `{ timebase: 'device-crystal' }` to `PpgDex.parsePPG` for every ring finger file. The fold
   verdict matched the baseline: 94 of 97 nights complete, with the same three nights short.
3. The scorer bins RR intervals by absolute time into 5-minute bins. It drops corrected beats and
   intervals outside 250 ms to 2500 ms. A bin needs 100 intervals. A night needs 6 shared bins.
4. The scorer compares each ring run with the H10 `ECGDex` RR series of the same night. It also scores the Verity `PpgDex`
   series, as a control that the timebase change does not touch.
5. The box QC verdict comes from each night's `QC-VERDICT.json` under the vigil archive. The table shows `—` for a night
   without one. Most of those are phone nights.

The patch and the scorer stay out of the tree. §7 holds the scorer verbatim.

## 3 · Population

| set | nights |
|---|---|
| nights with any ring export | 102 |
| nights in both ring runs | 96 |
| nights scored (ECG present, 6 or more shared bins) | 93 |
| excluded: no ECG export (2026-08-04, 2026-08-29, 2026-09-11) | 3 |

## 4 · Result

| group | nights | median MAE today → crystal (bpm) | median abs bias today → crystal (bpm) | crystal better / worse / same |
|---|---|---|---|---|
| box QC PASS | 22 | 0.19 → 0.48 | 0.00 → 0.24 | 0 / 18 / 4 |
| box QC not PASS | 14 | 0.31 → 0.52 | 0.01 → 0.27 | 0 / 10 / 4 |
| no box QC (phone) | 57 | 0.33 → 0.38 | 0.01 → 0.03 | 1 / 11 / 45 |
| all | 93 | 0.31 → 0.41 | 0.01 → 0.08 | 1 / 39 / 53 |

"Same" means the two MAE values differ by 0.1 bpm or less. A median is the upper middle value of the group.

The host-disciplined axis sits within 0.01 bpm of the ECG on almost every QC PASS night. The crystal axis
reads about 0.24 bpm high, roughly 0.4 %. The worst night is 2026-10-14, at +2.66 bpm.

Phone nights move least. 33 of the 93 baseline exports carry no `timebase` stamp, and 7 already ran on
the crystal default, so the crystal run changes little there. Three nights are poor on both axes:
2026-08-28, 2026-09-04 and 2026-09-05. The Verity reads 1.2 to 2.4 bpm off on the same nights, so the
recording is the cause there, not the timebase.

This study does not name the mechanism. It shows only that the crystal axis reads high against the
ECG on nights where the host axis does not.

```json
{ "schema": "tepna.verdict/1", "gate": "ring-device-crystal-vs-ecg", "status": "FAIL",
  "population": { "checked": 22, "eligible": 22, "excluded": 0 },
  "criterion": { "name": "median_abs_bias_crystal_vs_ecg_qc_pass", "threshold": 0.2, "unit": "bpm", "direction": "lte" },
  "result": { "medianAbsBiasCrystal": 0.24, "medianAbsBiasToday": 0.0, "medianMaeCrystal": 0.48, "medianMaeToday": 0.19, "crystalWorse": 18, "crystalBetter": 0 },
  "evidence": ["briefs/RING-TIMEBASE-ECG-TEST-2026-10-29-BRIEF.md"],
  "reason": "the device-crystal axis reads 0.24 bpm high against the H10 ECG over 22 QC PASS nights; the 0.2 bpm bound is the 2026-08-08 brief's own section 3 claim",
  "producedBy": { "tool": "briefs/RING-TIMEBASE-ECG-TEST-2026-10-29-BRIEF.md#7", "commit": "e7fbdef9a" }, "at": "2026-10-30T00:30:00Z" }
```

## 5 · What this changes

1. The host-disciplined axis stays the analysis axis. The owner does not need to switch the ring to its
   own clock.
2. The span floor planned for `ppgdex-dsp.js:1253` annotates and never refuses (board #2179, #2180). A
   refusal leaves `fs` uncorrected, which hands a short fragment to the axis this study rates worse.
3. That fix still owes its own test. This study scored whole nights. It does not show that the
   correction helps a fragment under `PPG_RATE_MIN_SPAN_S`.
4. The crystal default for an unstamped finger file is now unsupported. Residue row
   `2026-10-29-ring-device-crystal-axis-reads-high-against-the-ecg` holds it.

## 6 · Per-night table

Sorted with QC PASS nights first, then by night. Bias and MAE are in bpm against the H10 ECG.

| night | box QC | timebase today | 5-min bins | bias today | bias crystal | MAE today | MAE crystal | Verity MAE |
|---|---|---|---|---|---|---|---|---|
| 2026-09-22 | PASS | host-disciplined | 69 | -0.02 | -0.02 | 0.28 | 0.28 | 0.05 |
| 2026-09-23 | PASS | host-disciplined | 61 | 0 | -0.1 | 0.14 | 0.3 | 0.03 |
| 2026-09-25 | PASS | host-disciplined | 86 | 0 | -0.01 | 0.18 | 0.17 | 0.06 |
| 2026-09-28 | PASS | host-disciplined | 81 | -0.01 | 0.04 | 0.22 | 0.21 | 0.08 |
| 2026-09-30 | PASS | host-disciplined | 80 | -0.01 | 0.3 | 0.11 | 0.53 | 0.07 |
| 2026-10-01 | PASS | host-disciplined | 95 | 0 | 0.16 | 0.18 | 0.31 | 0.13 |
| 2026-10-02 | PASS | host-disciplined | 78 | -0.01 | 0.24 | 0.16 | 0.5 | 0.08 |
| 2026-10-06 | PASS | host-disciplined | 93 | 0 | 0.24 | 0.52 | 0.68 | 0.27 |
| 2026-10-07 | PASS | host-disciplined | 107 | -0.08 | 0.32 | 0.31 | 0.75 | 0.04 |
| 2026-10-08 | PASS | host-disciplined | 80 | 0 | 0.16 | 0.15 | 0.34 | 0.15 |
| 2026-10-12 | PASS | host-disciplined | 70 | 0 | 0.78 | 0.22 | 0.91 | 0.29 |
| 2026-10-13 | PASS | host-disciplined | 79 | 0 | 0.11 | 0.17 | 0.29 | 0.22 |
| 2026-10-14 | PASS | host-disciplined | 81 | 0.02 | 2.66 | 0.34 | 2.91 | 0.36 |
| 2026-10-15 | PASS | host-disciplined | 72 | 0 | 0.18 | 0.19 | 0.34 | 0.29 |
| 2026-10-16 | PASS | device-crystal | 72 | 0.36 | 0.36 | 0.62 | 0.62 | 0.29 |
| 2026-10-19 | PASS | host-disciplined | 78 | 0 | 0.24 | 0.21 | 0.43 | 0.28 |
| 2026-10-20 | PASS | host-disciplined | 81 | 0 | 0.46 | 0.16 | 0.7 | 0.21 |
| 2026-10-21 | PASS | host-disciplined | 74 | 0.01 | 0.2 | 0.22 | 0.42 | 0.32 |
| 2026-10-25 | PASS | host-disciplined | 93 | 0 | 0.24 | 0.15 | 0.48 | 0.18 |
| 2026-10-26 | PASS | host-disciplined | 72 | -0.01 | 0.31 | 0.17 | 0.5 | 0.14 |
| 2026-10-27 | PASS | host-disciplined | 83 | 0 | 0.36 | 0.17 | 0.72 | 0.21 |
| 2026-10-28 | PASS | host-disciplined | 92 | 0 | 0.11 | 0.19 | 0.35 | 0.08 |
| 2026-09-24 | SHORTFALL | host-disciplined | 77 | -0.1 | -0.01 | 0.32 | 0.35 | 0.07 |
| 2026-09-26 | SHORTFALL | host-disciplined | 99 | -0.01 | 0.47 | 0.43 | 0.82 | 0.03 |
| 2026-09-27 | SHORTFALL | host-disciplined | 74 | 0 | 0.15 | 0.15 | 0.36 | 0.07 |
| 2026-10-04 | SHORTFALL | host-disciplined | 75 | -0.01 | -0.52 | 0.39 | 0.86 | 0.15 |
| 2026-10-05 | SHORTFALL | host-disciplined | 72 | -0.02 | 0.09 | 0.22 | 0.35 | 0.19 |
| 2026-10-10 | SHORTFALL | device-crystal | 121 | -0.87 | -0.87 | 1.38 | 1.38 | 0.29 |
| 2026-10-11 | SHORTFALL | host-disciplined | 75 | 0 | 0.27 | 0.27 | 0.52 | 0.35 |
| 2026-10-03 | UNDERPOWERED | host-disciplined | 79 | -0.01 | 0.41 | 0.21 | 0.67 | 0.2 |
| 2026-09-21 | FAIL | host-disciplined | 54 | -0.13 | -0.01 | 0.46 | 0.45 | 0.4 |
| 2026-10-09 | FAIL | host-disciplined | 69 | 0 | 0.31 | 0.31 | 0.84 | 0.32 |
| 2026-10-17 | FAIL | host-disciplined | 78 | 0.01 | 0.51 | 0.31 | 0.88 | 0.34 |
| 2026-10-18 | FAIL | not stamped | 73 | 0 | 0.04 | 0.25 | 0.4 | 0.36 |
| 2026-10-22 | FAIL | device-crystal | 88 | 0.22 | 0.22 | 0.39 | 0.39 | 0.21 |
| 2026-10-24 | FAIL | host-disciplined | 77 | 0 | 0.08 | 0.21 | 0.45 | 0.11 |
| 2026-07-17 | — | not stamped | 43 | -0.03 | -0.03 | 0.33 | 0.33 | 0.12 |
| 2026-07-18 | — | not stamped | 105 | 0 | 0 | 0.38 | 0.38 | 0.28 |
| 2026-07-19 | — | not stamped | 77 | 0 | 0 | 0.35 | 0.35 | 0.16 |
| 2026-07-20 | — | not stamped | 61 | -0.01 | -0.01 | 0.39 | 0.39 | 0.2 |
| 2026-07-21 | — | not stamped | 72 | 0 | 0 | 0.41 | 0.41 | 0.2 |
| 2026-07-22 | — | not stamped | 79 | -0.66 | -0.66 | 0.77 | 0.77 | 0.11 |
| 2026-07-23 | — | not stamped | 25 | -0.74 | -0.74 | 0.93 | 0.93 | 0.17 |
| 2026-07-24 | — | not stamped | 56 | -0.74 | -0.74 | 0.91 | 0.91 | 0.25 |
| 2026-07-25 | — | not stamped | 95 | -0.06 | -0.06 | 0.47 | 0.47 | 0.17 |
| 2026-07-26 | — | not stamped | 89 | 0 | 0 | 0.19 | 0.19 | 0.07 |
| 2026-07-27 | — | not stamped | 85 | -0.91 | -0.91 | 1.15 | 1.15 | 0.06 |
| 2026-07-28 | — | not stamped | 87 | -0.01 | -0.01 | 0.23 | 0.23 | 0.24 |
| 2026-07-29 | — | not stamped | 34 | -0.02 | -0.02 | 0.62 | 0.62 | 0.2 |
| 2026-07-30 | — | not stamped | 83 | -0.03 | -0.03 | 0.24 | 0.24 | 0.16 |
| 2026-08-01 | — | device-crystal | 111 | 0 | 0 | 0.27 | 0.27 | 0.06 |
| 2026-08-02 | — | not stamped | 127 | -0.02 | -0.02 | 0.49 | 0.49 | 0.2 |
| 2026-08-03 | — | device-crystal | 95 | 0 | 0 | 0.25 | 0.25 | 0.09 |
| 2026-08-05 | — | not stamped | 125 | -0.04 | -0.04 | 0.44 | 0.44 | 0.16 |
| 2026-08-06 | — | device-crystal | 113 | -0.04 | -0.04 | 0.25 | 0.25 | 0.05 |
| 2026-08-07 | — | not stamped | 109 | -0.49 | -0.49 | 0.77 | 0.77 | 0.08 |
| 2026-08-08 | — | not stamped | 75 | -0.01 | -0.01 | 0.32 | 0.32 | 0.1 |
| 2026-08-09 | — | not stamped | 83 | -0.01 | -0.01 | 0.33 | 0.34 | 0.06 |
| 2026-08-10 | — | not stamped | 86 | -0.02 | -0.01 | 0.26 | 0.3 | 0.12 |
| 2026-08-11 | — | host-disciplined | 81 | 0 | 0 | 0.24 | 0.33 | 0.09 |
| 2026-08-12 | — | host-disciplined | 91 | 0 | -0.03 | 0.29 | 0.32 | 0.08 |
| 2026-08-13 | — | not stamped | 90 | 0 | -0.01 | 0.25 | 0.26 | 0.08 |
| 2026-08-14 | — | not stamped | 90 | -0.06 | -0.06 | 0.25 | 0.27 | 0.08 |
| 2026-08-15 | — | not stamped | 98 | -0.01 | -0.07 | 0.23 | 0.34 | 0.11 |
| 2026-08-16 | — | host-disciplined | 73 | 0 | -0.01 | 0.14 | 0.22 | 0.07 |
| 2026-08-17 | — | host-disciplined | 86 | 0 | -0.05 | 0.28 | 0.33 | 0.32 |
| 2026-08-18 | — | not stamped | 92 | -0.01 | -0.02 | 0.31 | 0.41 | 0.29 |
| 2026-08-19 | — | not stamped | 73 | 0 | -0.03 | 0.33 | 0.4 | 0.08 |
| 2026-08-20 | — | not stamped | 48 | 0 | -0.01 | 0.36 | 0.37 | 0.62 |
| 2026-08-21 | — | host-disciplined | 94 | 0 | -0.02 | 0.25 | 0.29 | 0.2 |
| 2026-08-23 | — | not stamped | 61 | -0.03 | -0.09 | 0.42 | 0.47 | 0.69 |
| 2026-08-24 | — | host-disciplined | 73 | 0 | 0 | 0.16 | 0.17 | 0.16 |
| 2026-08-25 | — | not stamped | 113 | -0.27 | -0.01 | 0.68 | 0.81 | 0.12 |
| 2026-08-26 | — | device-crystal | 105 | -0.08 | -0.08 | 0.52 | 0.52 | 0.25 |
| 2026-08-27 | — | host-disciplined | 86 | -0.02 | 0.02 | 0.66 | 0.73 | 0.67 |
| 2026-08-28 | — | not stamped | 23 | 0.1 | -0.87 | 3.55 | 3.01 | 2.37 |
| 2026-08-30 | — | host-disciplined | 68 | 0.1 | -1.39 | 0.44 | 1.74 | 0.12 |
| 2026-08-31 | — | host-disciplined | 62 | -0.02 | -0.68 | 0.37 | 1.16 | 0.23 |
| 2026-09-03 | — | host-disciplined | 70 | -0.31 | -0.03 | 0.47 | 0.62 | 0.24 |
| 2026-09-04 | — | not stamped | 77 | -0.01 | -1.77 | 1.52 | 2.39 | 1.69 |
| 2026-09-05 | — | host-disciplined | 115 | 0 | -0.75 | 1.08 | 1.42 | 1.16 |
| 2026-09-06 | — | not stamped | 75 | 0 | 0.1 | 0.36 | 0.44 | 0.22 |
| 2026-09-07 | — | not stamped | 74 | -0.01 | 0.46 | 0.3 | 0.74 | 0.09 |
| 2026-09-08 | — | host-disciplined | 64 | -0.01 | 0.13 | 0.22 | 0.35 | 0.08 |
| 2026-09-09 | — | host-disciplined | 84 | 0.01 | -0.03 | 0.29 | 0.67 | 0.21 |
| 2026-09-10 | — | host-disciplined | 81 | -0.19 | -0.18 | 0.91 | 0.91 | 0.85 |
| 2026-09-12 | — | host-disciplined | 109 | -0.01 | -1.13 | 0.45 | 1.49 | 0.28 |
| 2026-09-13 | — | host-disciplined | 81 | 0 | -0.02 | 0.31 | 0.31 | 0.13 |
| 2026-09-14 | — | host-disciplined | 47 | 0 | -0.03 | 0.19 | 0.24 | 0.06 |
| 2026-09-15 | — | host-disciplined | 78 | -0.07 | -0.02 | 0.33 | 0.27 | 0.13 |
| 2026-09-16 | — | host-disciplined | 70 | -0.05 | -0.03 | 0.2 | 0.18 | 0.12 |
| 2026-09-17 | — | host-disciplined | 74 | -0.01 | -0.05 | 0.16 | 0.19 | 0.09 |
| 2026-09-20 | — | host-disciplined | 36 | -0.05 | -0.05 | 0.35 | 0.33 | 0.38 |

## 7 · Scorer

Run as `node ringtb-compare.mjs <baselineRoot,...> <crystalRoot> <qcRoot>`. Later baseline roots win.

```js
// Scores ring (PpgDexFinger, both timebases) and Verity (PpgDex) RR against the H10 ECGDex RR per 5-min bin.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [baseRoots, crysRoot, qcRoot] = process.argv.slice(2);
const BIN = 300000;
const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const find = (dir, pre) => { try { const f = readdirSync(dir).find((x) => x.startsWith(pre + '_') && x.endsWith('.node-export.json')); return f ? join(dir, f) : null; } catch { return null; } };

function bins(ex, key) {
  if (!ex) return null;
  const s = ex.timeseries && ex.timeseries[key];
  const t0 = ex.recording && ex.recording.startEpochMs;
  if (!s || !Array.isArray(s.tSec) || t0 == null) return null;
  const m = new Map();
  for (let i = 0; i < s.tSec.length; i++) {
    if (s.corrected && s.corrected[i]) continue;
    const ms = s.ms[i];
    if (!(ms > 250 && ms < 2500)) continue;
    const b = Math.floor((t0 + s.tSec[i] * 1000) / BIN);
    const a = m.get(b) || [0, 0];
    a[0] += ms; a[1]++;
    m.set(b, a);
  }
  const out = new Map();
  for (const [b, [sum, n]] of m) if (n >= 100) out.set(b, 60000 / (sum / n));
  return out;
}
function score(test, ref) {
  if (!test || !ref) return null;
  const d = [];
  for (const [b, hr] of test) if (ref.has(b)) d.push(hr - ref.get(b));
  if (d.length < 6) return { bins: d.length };
  d.sort((a, b) => a - b);
  const med = d[d.length >> 1];
  const mae = d.reduce((s, x) => s + Math.abs(x), 0) / d.length;
  const w2 = d.filter((x) => Math.abs(x) <= 2).length / d.length;
  return { bins: d.length, biasBpm: +med.toFixed(2), maeBpm: +mae.toFixed(2), within2: +(w2 * 100).toFixed(1) };
}
const qc = (n) => { const v = read(join(qcRoot, n, 'QC-VERDICT.json')); return v ? v.status : null; };

const roots = baseRoots.split(',');
const nights = new Set();
for (const r of [...roots, crysRoot]) { try { for (const n of readdirSync(r)) if (/^\d{4}-\d\d-\d\d$/.test(n)) nights.add(n); } catch {} }
const rows = [];
for (const n of [...nights].sort()) {
  // the LAST root holding the night wins (later roots are fresher folds)
  let bdir = null;
  for (const r of roots) if (existsSync(join(r, n))) bdir = join(r, n);
  const ecgEx = bdir && read(find(bdir, 'ECGDex'));
  const ecg = bins(ecgEx, 'rr');
  const fBase = bdir && read(find(bdir, 'PpgDexFinger'));
  const fCrys = read(find(join(crysRoot, n), 'PpgDexFinger'));
  const vBase = bdir && read(find(bdir, 'PpgDex'));
  const q = (ex) => ex && { fs: ex.quality && ex.quality.fs != null ? ex.quality.fs : (ex.recording && ex.recording.fs), timebase: ex.quality && ex.quality.timebase, hours: ex.recording && +(ex.recording.durSec / 3600).toFixed(2), ppm: ex.quality && ex.quality.hostAxis ? ex.quality.hostAxis.ppm : undefined };
  rows.push({
    night: n, qc: qc(n), ecg: !!ecg,
    ringToday: fBase ? { ...q(fBase), ...score(bins(fBase, 'ppi'), ecg) } : null,
    ringCrystal: fCrys ? { ...q(fCrys), ...score(bins(fCrys, 'ppi'), ecg) } : null,
    verityToday: vBase ? { ...q(vBase), ...score(bins(vBase, 'ppi'), ecg) } : null,
  });
}
process.stdout.write(JSON.stringify(rows, null, 1));
```
