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
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { anklePair } from './pat-dip-index.mjs';
import { loadDsps, getDsps } from './pat-matchrate-strict.mjs';

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
  /* Scored at event END, not start — Katz's construction is that events "TERMINATE in a PTT
     arousal": the dip follows the resumption of breathing, so a start-anchored window misses any
     event longer than the window (first run scored starts; every event here carries meta.durSec,
     10-22 s on the anchorable night). durSec 0 or absent degrades to the start honestly. */
  return (cpapNight.ganglior_events || [])
    .filter((e) => /apnea|hypopnea/.test(e.impulse) && e.tMs != null)
    .map((e) => e.tMs + ((e.meta && e.meta.durSec) || 0) * 1000)
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
    /* MOTION GATE — the leading suspect for the first run's SUB-chance Katz (7 % vs 36 %): a dip
       coincident with movement is ambiguous between autonomic response and mechanical artifact, and
       CPAP-scored sleep is exactly the quiet part of the night. The SENSOR'S OWN ACC decides (the
       Verity wears the feet, so its motion is what corrupts them): per-second motion envelope, a
       second is MOVING above mean + 2σ, and a dip is QUIET only if no moving second touches
       [onset − 10 s, onset + dur + 5 s]. Both splits are reported — silently dropping the motion
       dips would hide the very confound being tested. */
    let quietOnsets = onsets,
      nQuiet = onsets.length,
      quietShare = null;
    {
      const { PPGDSP } = getDsps();
      let acc = null;
      for (const f of readdirSync(join(ROOT, night)).filter((x) => /(?:VeritySense|Polar_Sense).*_ACC\.txt$/i.test(x))) {
        try {
          const sArr = PPGDSP.parseSensorXYZ(readFileSync(join(ROOT, night, f), 'utf8'));
          if (!sArr || !sArr.length || sArr[0].tMs == null) continue;
          const ov = Math.min(spanHi, sArr[sArr.length - 1].tMs) - Math.max(spanLo, sArr[0].tMs);
          if (ov > (acc?.ov ?? 0)) acc = { ov, samples: sArr };
        } catch {}
      }
      if (acc && acc.ov > 0) {
        const grid = PATAlign.envelope(acc.samples, spanLo, spanHi, { dtMs: 1000 });
        if (grid) {
          let m = 0;
          for (let i = 0; i < grid.length; i++) m += grid[i];
          m /= grid.length;
          let v = 0;
          for (let i = 0; i < grid.length; i++) v += (grid[i] - m) * (grid[i] - m);
          const thr = m + 2 * Math.sqrt(v / grid.length);
          const moving = (t) => {
            const b = Math.floor((t - spanLo) / 1000);
            return b >= 0 && b < grid.length && grid[b] > thr;
          };
          let movingSecs = 0;
          for (let i = 0; i < grid.length; i++) if (grid[i] > thr) movingSecs++;
          quietShare = 1 - movingSecs / grid.length;
          quietOnsets = real.events
            .filter((e) => {
              for (let t = e.tMs - 10000; t <= e.tMs + e.durMs + 5000; t += 1000) if (moving(t)) return false;
              return true;
            })
            .map((e) => e.tMs);
          nQuiet = quietOnsets.length;
        }
      }
    }
    const katz = frac(coverable, onsets, bestDelta, DIP_WIN);
    const katzQuiet = frac(coverable, quietOnsets, bestDelta, DIP_WIN);
    /* NULL = CIRCULAR SHIFTS OF THE DIP ONSETS within the covered span — not of the foot train. A
       foot shift destroys the R↔F alignment itself, so the surrogate night fails the readability
       gate and the null cannot run (measured: 10/10 surrogates refused — a null that cannot execute
       is not a null). Shifting the ONSETS preserves the dip count and rate exactly and destroys only
       their alignment with CPAP events, which is the thing under test — event-coupling.js's own
       construction. */
    const chanceK = [],
      chanceKq = [];
    const span = spanHi - spanLo;
    for (let k = 1; k <= K_SHIFT; k++) {
      const sh = (k * span) / (K_SHIFT + 1);
      chanceK.push(
        frac(
          coverable,
          onsets.map((t) => spanLo + ((t - spanLo + sh) % span)),
          bestDelta,
          DIP_WIN
        ) || 0
      );
      chanceKq.push(
        frac(
          coverable,
          quietOnsets.map((t) => spanLo + ((t - spanLo + sh) % span)),
          bestDelta,
          DIP_WIN
        ) || 0
      );
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
      nQuiet,
      quietSharePct: quietShare == null ? null : +(100 * quietShare).toFixed(0),
      katzQuietPct: +(100 * katzQuiet).toFixed(0),
      chanceKatzQuietPct: chanceKq.length ? +(100 * med(chanceKq)).toFixed(0) : null,
      nSurrogates: chanceK.length
    });
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ rows }, null, 1));
    return;
  }
  console.log('ΔPAT validation — CPAP clock anchored per night on desats; null = ' + K_SHIFT + ' circular shifts of the dip onsets\n');
  console.log('night        δ(min)  anchor%  events(cov)  dips(quiet)  quietTime%  Katz%/chance  KatzQUIET%/chance');
  for (const r of rows) {
    if (r.skip) {
      console.log(`${r.night}  ⊘ ${r.skip}`);
      continue;
    }
    console.log(
      `${r.night}  ${String(r.deltaMin).padStart(6)}  ${String(r.anchorPct).padStart(6)}  ${String(r.nCpapEvents + '(' + r.nCoverable + ')').padStart(11)}  ${String(r.nDips + '(' + r.nQuiet + ')').padStart(11)}  ${String(r.quietSharePct == null ? '—' : r.quietSharePct).padStart(10)}  ${String(r.katzPct + '/' + (r.chanceKatzPct == null ? '—' : r.chanceKatzPct)).padStart(12)}  ${String(r.katzQuietPct + '/' + (r.chanceKatzQuietPct == null ? '—' : r.chanceKatzQuietPct)).padStart(17)}`
    );
  }
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) main();
export { main };
