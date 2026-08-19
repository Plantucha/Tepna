#!/usr/bin/env node
/*
 * tools/pat-dip-index.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE ΔPAT DIP INDEX PER NIGHT — the relative estimand (PAT-RELATIVE-REFRAME-2026-08-17 §3.1).
 *
 * Runs `PATAlign.patDipEvents` (twin-gated in `tests/dex-tests.js`, `pat-align · dip-detector`) over
 * real nights, using `pat-finger-coupler.mjs`'s own train extraction — the same R-peak and foot
 * trains its absolute-PAT analysis reads, so the two estimands are compared on identical fiducials
 * and neither can blame the other's parsing.
 *
 * WHAT IT PRINTS, per night: the dip index (events/h of covered beat time), the event depths, the
 * artifact share, and `medianAbsDevMs` — the per-beat noise floor Θ competes with. The index is an
 * AUTONOMIC statistic (arousal surrogate); it is not BP and not "vascular" (the brief carries the
 * citations and the restraint argument).
 *
 * ⚠️ NO CHANCE FLOOR YET. Unlike the coupler this does not circular-shift a surrogate; a dip is a
 * within-train excursion, so the honest null is a beat-order shuffle within windows, which is owed
 * before any cross-corpus claim. Until then the numbers are DESCRIPTIVE.
 *
 *   node tools/pat-dip-index.mjs <captures-root> [--theta 10] [--beats 4] [--json]
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { pairsIn } from './pat-finger-coupler.mjs';
import { loadDsps, ecgRpeakTimes, ppgFootTimes } from './pat-matchrate-strict.mjs';
import { readFileSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const PATAlign = require('../pat-align.js');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const ROOT = argv.find((a) => !a.startsWith('--') && existsSync(a));
const THETA = +opt('--theta', 10);
const NBEATS = +opt('--beats', 4);
const AS_JSON = argv.includes('--json');
const LEG = opt('--leg', 'finger'); // finger (O2Ring, via the coupler's own pairing) | ankle (Verity)

/* Overlap-aware ECG×Verity pairing — the coupler's `pairsIn` is deliberately ring-locked (its whole
   point is not falling back to the wrist), so the ankle leg gets its own selector with the SAME
   overlap-max rule. Pairing biggest-with-biggest instead is how this tool's first ankle probe read
   floors of ~1150 ms: two non-overlapping sessions, nearest-lag ≈ uniform mod one RR. */
const RE_VERITY = /(?:VeritySense|Polar_Sense).*_PPG\.txt$/i;
const RE_ECG2 = /_ECG\.txt$/i;
function anklePair(dir) {
  const cand = (re) =>
    readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 4);
  const parse = (list, fn) =>
    list
      .map((c) => {
        try {
          const r = fn(readFileSync(c.f, 'utf8'));
          return r.t0Ms == null ? null : { rec: r };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  const E = parse(cand(RE_ECG2), ecgRpeakTimes);
  const P = parse(cand(RE_VERITY), ppgFootTimes);
  let best = null;
  for (const e of E)
    for (const p of P) {
      const s0 = Math.max(e.rec.t0Ms, p.rec.t0Ms);
      const e0 = Math.min(e.rec.t0Ms + e.rec.durSec * 1000, p.rec.t0Ms + p.rec.durSec * 1000);
      const min = (e0 - s0) / 60000;
      if (min > (best?.overlapMin ?? 0)) best = { ecg: e, ppg: p, overlapMin: min };
    }
  return best ? [best] : [];
}

function main() {
  /* Without this, pairsIn's per-file try/catch converts "DSPs not loaded" into "no ECG+ring pair" —
     a wrong diagnosis wearing an honest skip's clothes (it cost this tool its first run). */
  loadDsps();
  if (!ROOT) {
    console.error('usage: node tools/pat-dip-index.mjs <captures-root> [--theta 10] [--beats 4] [--json]');
    process.exit(2);
  }
  const nights = readdirSync(ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const rows = [];
  for (const night of nights) {
    const pair = (LEG === 'ankle' ? anklePair(join(ROOT, night)) : pairsIn(join(ROOT, night)))[0];
    if (!pair) {
      rows.push({ night, skip: 'no overlapping ECG+' + (LEG === 'ankle' ? 'Verity' : 'ring') + ' pair' });
      continue;
    }
    const R = pair.ecg.rec.times,
      F = pair.ppg.rec.times;
    const r = PATAlign.patDipEvents(R, F, { minDipMs: THETA, minBeats: NBEATS });
    if (!r.ok) {
      rows.push({
        night,
        skip: r.reason,
        noiseFloorMs: r.medianAbsDevMs != null ? +r.medianAbsDevMs.toFixed(1) : undefined,
        artifactPct: r.artifactShare != null ? +(100 * r.artifactShare).toFixed(1) : undefined
      });
      continue;
    }
    rows.push({
      night,
      overlapMin: +pair.overlapMin.toFixed(0),
      nPairs: r.nPairs,
      coveredHr: +r.coveredHr.toFixed(2),
      dipIndexPerHr: +r.dipIndexPerHr.toFixed(2),
      chancePerHr: +r.chanceIndexPerHr.toFixed(2),
      lift: r.liftVsChance == null ? null : +r.liftVsChance.toFixed(1),
      nEvents: r.nEvents,
      medianDepthMs: r.nEvents
        ? +r.events
            .map((e) => e.medianDepthMs)
            .sort((a, b) => a - b)
            [r.nEvents >> 1].toFixed(1)
        : null,
      artifactPct: +(100 * r.artifactShare).toFixed(1),
      noiseFloorMs: +r.medianAbsDevMs.toFixed(1)
    });
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ theta: THETA, minBeats: NBEATS, rows }, null, 1));
    return;
  }
  console.log(`ΔPAT dip index — Θ=${THETA} ms, ≥${NBEATS} core beats (descriptive; no chance floor yet)\n`);
  console.log('night        overlap  pairs  covered  dips/h  chance/h  lift  medDepth  artifact%  noiseFloor');
  for (const r of rows) {
    if (r.skip) {
      console.log(`${r.night}  ⊘ ${r.skip}`);
      continue;
    }
    console.log(
      `${r.night}  ${String(r.overlapMin + 'm').padStart(6)}  ${String(r.nPairs).padStart(5)}  ` +
        `${String(r.coveredHr + 'h').padStart(7)}  ${String(r.dipIndexPerHr).padStart(6)}  ${String(r.chancePerHr).padStart(8)}  ${String(r.lift == null ? '∞' : r.lift).padStart(4)}  ` +
        `${String(r.medianDepthMs == null ? '—' : r.medianDepthMs + 'ms').padStart(8)}  ${String(r.artifactPct).padStart(8)}  ${String(r.noiseFloorMs + 'ms').padStart(9)}`
    );
  }
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) main();
export { main, anklePair };
