#!/usr/bin/env node
/*
 * tools/pat-dip-validate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DOES THE ΔPAT DIP INDEX POINT AT THE EVENTS THE CPAP SAW? — the Katz test + the empirical null
 * (PAT-RELATIVE-REFRAME §3.2 / §5, wired 2026-08-17).
 *
 * Two questions, answered together because they share one machinery:
 *   1. EMPIRICAL NULL — the analytic chance line assumes independence, which autocorrelated lag
 *      series violate (true chance is HIGHER, so analytic lifts are upper bounds). Here the null is
 *      K circular foot-train shifts run through the IDENTICAL detector path (`shiftFeetMs` lives
 *      inside `patDipEvents`), giving each night its own measured chance index.
 *   2. KATZ FRACTION — what share of device-scored respiratory events is followed by a dip
 *      (their figure: 80-91 % for PTT arousals vs 43-55 % for EEG). Scored at event start against a
 *      [-10 s, +45 s] dip-onset window, and the SAME fraction under each foot shift is the chance.
 *
 * ⚠️ THE CPAP CLOCK IS NOT TRUSTED — it has run ~38-42 min slow in this corpus, which is exactly why
 * every earlier event-by-event comparison was void (`pb-agreement.mjs` header). The offset is
 * anchored PER NIGHT from an INDEPENDENT pair: CPAP events → OxyDex desats (a desaturation follows
 * an apnea physiologically). A δ sweep over ±70 min scores that coupling; the night is REFUSED when
 * the peak does not clearly beat the sweep's own background — an unanchorable clock must not be
 * "corrected" by the most flattering offset. Anchoring on desats rather than dips is what keeps the
 * Katz fraction out of its own anchor (no tuning-to-the-answer).
 *
 *   node tools/pat-dip-validate.mjs <captures-root> --cpap <cpap-exports.json> --trio <trio-root> [--json]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { anklePair } from './pat-dip-index.mjs';
import { loadDsps } from './pat-matchrate-strict.mjs';

const require = createRequire(import.meta.url);
const PATAlign = require('../pat-align.js');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const ROOT = argv.find((a) => !a.startsWith('--') && existsSync(a));
const CPAP = opt('--cpap', null);
const TRIO = opt('--trio', null);
const AS_JSON = argv.includes('--json');
const K_SHIFT = 10; // surrogates per night
const DIP_WIN = [-10000, 45000]; // dip onset relative to (clock-corrected) event start
const DESAT_WIN = [0, 90000]; // desat onset after event start, for the δ anchor
const SWEEP = { loMs: -70 * 60000, hiMs: 70 * 60000, stepMs: 30000 };

function respEvents(cpapNight) {
  return (cpapNight.ganglior_events || [])
    .filter((e) => /apnea|hypopnea/.test(e.impulse) && e.tMs != null)
    .map((e) => e.tMs)
    .sort((a, b) => a - b);
}
function frac(events, onsets, delta, win) {
  if (!events.length) return null;
  let hit = 0;
  for (const t of events) {
    const lo = t + delta + win[0],
      hi = t + delta + win[1];
    // binary-search-free: onsets sorted, events few
    if (onsets.some((o) => o >= lo && o <= hi)) hit++;
  }
  return hit / events.length;
}

function main() {
  loadDsps();
  if (!ROOT || !CPAP || !TRIO) {
    console.error('usage: node tools/pat-dip-validate.mjs <captures-root> --cpap <exports.json> --trio <trio-root>');
    process.exit(2);
  }
  const cpapAll = JSON.parse(readFileSync(CPAP, 'utf8'));
  const cpapByDay = new Map((cpapAll.exports || []).map((e) => [e._day, e]));
  const rows = [];
  for (const night of readdirSync(ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()) {
    const day = night.replace(/-/g, '');
    const cp = cpapByDay.get(day);
    if (!cp) {
      rows.push({ night, skip: 'no CPAP export for this day' });
      continue;
    }
    const events = respEvents(cp);
    if (events.length < 5) {
      rows.push({ night, skip: 'only ' + events.length + ' CPAP respiratory events — too few to score a fraction' });
      continue;
    }
    // desat anchor
    const oxyPath = join(TRIO, night, `OxyDex_${night}.node-export.json`);
    if (!existsSync(oxyPath)) {
      rows.push({ night, skip: 'no OxyDex trio export (desat anchor unavailable)' });
      continue;
    }
    const desats = (JSON.parse(readFileSync(oxyPath, 'utf8')).ganglior_events || [])
      .filter((e) => e.impulse === 'desat_event' && e.tMs != null)
      .map((e) => e.tMs)
      .sort((a, b) => a - b);
    if (desats.length < 3) {
      rows.push({ night, skip: 'only ' + desats.length + ' desats — CPAP clock unanchorable' });
      continue;
    }
    /* ANCHOR DIRECTION MATTERS. Scoring "share of CPAP events followed by a desat" is structurally
       unreachable on a TREATED night — 3-4 desats against 17-23 events caps the fraction at ~20 %,
       so the bar could never pass: a criterion that cannot succeed, the mirror image of one that
       cannot fail (first run: three honest-looking "unanchorable" refusals that were really the
       scorer's own ceiling). Flipped: share of DESATS explained by a preceding event — a night where
       every desat lines up under one δ is anchored, however few desats CPAP therapy left. */
    let bestDelta = null,
      bestScore = -1;
    const scores = [];
    for (let d = SWEEP.loMs; d <= SWEEP.hiMs; d += SWEEP.stepMs) {
      const f = frac(desats, events, -d, [-DESAT_WIN[1], -DESAT_WIN[0]]) || 0; // event precedes desat under +δ
      scores.push(f);
      if (f > bestScore) {
        bestScore = f;
        bestDelta = d;
      }
    }
    const bg = scores.slice().sort((a, b) => a - b)[scores.length >> 1];
    if (!(bestScore >= 0.75 && bestScore >= 3 * Math.max(bg, 0.05))) {
      rows.push({
        night,
        skip: `CPAP clock unanchorable (best: ${(100 * bestScore).toFixed(0)} % of desats explained at δ ${(bestDelta / 60000).toFixed(1)} min vs background ${(100 * bg).toFixed(0)} %)`
      });
      continue;
    }
    // dips, real + surrogates — identical path
    const pair = anklePair(join(ROOT, night))[0];
    if (!pair) {
      rows.push({ night, skip: 'no overlapping ECG+Verity pair' });
      continue;
    }
    const R = pair.ecg.rec.times,
      F = pair.ppg.rec.times;
    const real = PATAlign.patDipEvents(R, F, { minDipMs: 10, minBeats: 4 });
    if (!real.ok) {
      rows.push({ night, skip: 'dip detector refused: ' + real.reason });
      continue;
    }
    const onsets = real.events.map((e) => e.tMs);
    /* DENOMINATOR = COVERABLE EVENTS ONLY — the coupleRtoFoot lesson re-applied: a CPAP event whose
       corrected time falls outside the ECG∩PPG overlap cannot host a dip, and counting it measures
       RECORDING OVERLAP, not coupling (first run: a Katz 4 % that was mostly events outside the
       4.2 h dip-covered window of an 8 h CPAP session). */
    const spanLo = Math.max(R[0], F[0]),
      spanHi = Math.min(R[R.length - 1], F[F.length - 1]);
    const coverable = events.filter((t) => t + bestDelta >= spanLo - DIP_WIN[0] && t + bestDelta <= spanHi - DIP_WIN[1]);
    if (coverable.length < 5) {
      rows.push({ night, skip: `only ${coverable.length}/${events.length} CPAP events fall inside the dip-covered span` });
      continue;
    }
    const katz = frac(coverable, onsets, bestDelta, DIP_WIN);
    /* NULL = CIRCULAR SHIFTS OF THE DIP ONSETS within the covered span — not of the foot train. A
       foot shift destroys the R↔F alignment itself, so the surrogate night fails the readability
       gate and the null cannot run (measured: 10/10 surrogates refused — a null that cannot execute
       is not a null). Shifting the ONSETS preserves the dip count and rate exactly and destroys only
       their alignment with CPAP events, which is the thing under test — event-coupling.js's own
       construction. */
    const chanceK = [];
    const span = spanHi - spanLo;
    for (let k = 1; k <= K_SHIFT; k++) {
      const sh = (k * span) / (K_SHIFT + 1);
      const shifted = onsets.map((t) => spanLo + ((t - spanLo + sh) % span));
      chanceK.push(frac(coverable, shifted, bestDelta, DIP_WIN) || 0);
    }
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null);
    rows.push({
      night,
      deltaMin: +(bestDelta / 60000).toFixed(1),
      anchorPct: +(100 * bestScore).toFixed(0),
      nCpapEvents: events.length,
      nCoverable: coverable.length,
      nDips: real.nEvents,
      dipIdx: +real.dipIndexPerHr.toFixed(1),
      katzPct: +(100 * katz).toFixed(0),
      chanceKatzPct: chanceK.length ? +(100 * med(chanceK)).toFixed(0) : null,
      nSurrogates: chanceK.length
    });
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ rows }, null, 1));
    return;
  }
  console.log('ΔPAT validation — CPAP clock anchored per night on desats; null = ' + K_SHIFT + ' circular shifts of the dip onsets\n');
  console.log('night        δ(min)  anchor%  events(coverable)  dips  dips/h  Katz%  chanceKatz%');
  for (const r of rows) {
    if (r.skip) {
      console.log(`${r.night}  ⊘ ${r.skip}`);
      continue;
    }
    console.log(
      `${r.night}  ${String(r.deltaMin).padStart(6)}  ${String(r.anchorPct).padStart(6)}  ${String(r.nCpapEvents + '(' + r.nCoverable + ')').padStart(17)}  ${String(r.nDips).padStart(4)}  ${String(r.dipIdx).padStart(6)}  ${String(r.katzPct).padStart(5)}  ${String(r.chanceKatzPct == null ? '—' : r.chanceKatzPct).padStart(11)}`
    );
  }
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) main();
export { main };
