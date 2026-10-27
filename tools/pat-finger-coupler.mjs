#!/usr/bin/env node
/*
 * tools/pat-finger-coupler.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DOES THE O2RING FINGER PPG COUPLE TO H10 ECG? — the leg `pat-matchrate-strict.mjs` cannot run.
 *
 * That tool aligns two devices through shared mechanical motion in BOTH ACC streams. The ring emits
 * SPO2 / PPG / OXYFRAME and no ACC at all (O2RING-RAW-STREAMS-ABSENT §6, hardware-validated), so the
 * finger leg has no alignment path there and the tool silently falls back to the Verity — measuring
 * the WRIST while appearing to answer the finger question. This runs the finger.
 *
 * WHY NO ALIGNMENT IS THE RIGHT CALL HERE, not a shortcut (O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §5.3):
 * ACC anchors exist to track a DRIFTING offset between two independent device clocks. A box-captured
 * pair shares ONE NTP-disciplined daemon, and the ring has no device clock at all — its axis is pure
 * host-arrival back-timing. What remains is a CONSTANT δ (differential BLE delivery latency), and the
 * strict statistic's leave-one-block-out centre absorbs a constant by construction. So COUPLING is
 * answerable without knowing δ. ABSOLUTE PAT is not, and this tool does not claim it.
 *
 * THE STATISTIC IS IMPORTED, NOT REIMPLEMENTED. `strictMatchRate` and the circular-shift surrogate
 * are the load-bearing parts and they live in the sibling tool; a second copy would be a second thing
 * to keep true. Beat derivation is imported for the same reason — if the two legs derived beats
 * differently their numbers could not be compared.
 *
 * WHAT A RESULT MEANS. The legacy matchRate has a ~60 % chance floor and is not evidence either way
 * (see the sibling's header). Only `strict` vs its own surrogate null counts: ratio ≈ 1 with a high
 * p means NO detectable coupling, however large the raw percentage looks.
 *
 *   node tools/pat-finger-coupler.mjs --dir /path/to/captures            # every night found
 *   node tools/pat-finger-coupler.mjs --dir <d> --night 2026-08-03 --surrogates 200
 *   node tools/pat-finger-coupler.mjs --dir <d> --json
 *
 * Adds no signal processing of its own — it orchestrates already-committed DSP surfaces — so it moves
 * no bundle and no manifestHash (same rationale as tools/trio-batch.mjs).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadDsps, getDsps, ecgRpeakTimes, ppgFootTimes, legacyMatchRate, strictMatchRate, circShift, rawLags, median, STRICT_W_MS } from './pat-matchrate-strict.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { notANight, populationVerdict, snapshotNights } from './corpus-scope-core.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DIR = arg('--dir', null);
const ONLY = arg('--night', null);
const N_SURR = +arg('--surrogates', 100);
const JSON_OUT = argv.includes('--json');
/* FIDUCIAL — foot | peak. PAT is defined against a fiducial and the choice is load-bearing, so a null
   under one is NOT a null under the other. The foot is classical but sits at the trough where the
   ring's single channel has its worst SNR; the systolic peak detects far more reliably and adds only a
   near-constant ejection interval, which the leave-one-block-out centre absorbs like any constant. */
const FIDUCIAL = arg('--fiducial', 'foot');
const MIN_OVERLAP_MIN = 20;
/* PLAUSIBILITY GATE on the detected pulse rate. A night whose PPG detector fires at 696/min is not
   reporting beats, it is reporting noise — and dense candidates make a match near ANY target likely,
   so the statistic saturates upward. Measured: the three largest coupling ratios in the first peak
   run (11.25, 6.77, 3.91) were exactly the three nights at 696/595/233 per min. A rate outside a
   generous human band is a DETECTOR fault and the night must be excluded, not scored. */
const RATE_LO = 30,
  RATE_HI = 120;

/* The ring writes `Wellue_O2Ring-S_<sn>_<stamp>_PPG.txt`; the Verity writes `Polar_VeritySense_…_PPG.txt`.
   Matching on the O2Ring name is what keeps this tool on the FINGER — the sibling's fallback to any
   `_PPG.txt` is exactly how the wrist got measured while the finger question was being asked. */
const RE_RING = /o2ring.*_PPG\.txt$/i;
const RE_ECG = /_ECG\.txt$/i;

function biggest(dir, re, n) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

/* Feet or peaks from the SAME committed detector, so the two fiducials differ in nothing else. */
function ppgFiducialTimes(text, which) {
  if (which === 'foot') return ppgFootTimes(text);
  const { PPGDSP } = getDsps();
  const rec = PPGDSP.parsePPG(text);
  if (rec.t0Ms == null) throw new Error('PPG file carried no phone timestamp.');
  const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
  let refIdx = 0,
    best = -1;
  per.forEach((p, i) => {
    if (p.peaks.length > best) {
      best = p.peaks.length;
      refIdx = i;
    }
  });
  const cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);
  const src = cons.peaks;
  const t = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    t[i] = rec.relSec && rec.relSec.length > s ? rec.t0Ms + rec.relSec[s] * 1000 : rec.t0Ms + (s / rec.fs) * 1000;
  }
  return { t0Ms: rec.t0Ms, fs: rec.fs, durSec: rec.durSec, times: t, n: src.length };
}

function pairsIn(dir) {
  const ecgs = biggest(dir, RE_ECG, 4);
  const ppgs = biggest(dir, RE_RING, 4);
  if (!ecgs.length || !ppgs.length) return [];
  const parse = (list, fn) =>
    list
      .map((c) => {
        try {
          const r = fn(readFileSync(c.f, 'utf8'));
          return r.t0Ms == null ? null : { file: basename(c.f), rec: r };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  const E = parse(ecgs, ecgRpeakTimes);
  const P = parse(ppgs, (txt) => ppgFiducialTimes(txt, FIDUCIAL));
  let best = null;
  for (const e of E)
    for (const p of P) {
      const s = Math.max(e.rec.t0Ms, p.rec.t0Ms);
      const end = Math.min(e.rec.t0Ms + e.rec.durSec * 1000, p.rec.t0Ms + p.rec.durSec * 1000);
      const min = (end - s) / 60000;
      if (min > (best?.overlapMin ?? 0)) best = { ecg: e, ppg: p, overlapMin: min };
    }
  return best ? [best] : [];
}

function analyse(night, pair) {
  const { ecg, ppg, overlapMin } = pair;
  if (overlapMin < MIN_OVERLAP_MIN) return { night, skip: `overlap ${overlapMin.toFixed(0)} min < ${MIN_OVERLAP_MIN}` };
  const R = ecg.rec.times,
    F = ppg.rec.times;
  const ppgRate = F.length / (overlapMin || 1);
  const ecgRate = R.length / (overlapMin || 1);
  if (ppgRate < RATE_LO || ppgRate > RATE_HI) return { night, skip: `PPG detector at ${ppgRate.toFixed(0)}/min — outside ${RATE_LO}-${RATE_HI}, not beats` };
  if (ecgRate < RATE_LO || ecgRate > RATE_HI) return { night, skip: `ECG detector at ${ecgRate.toFixed(0)}/min — outside ${RATE_LO}-${RATE_HI}` };
  const span = Math.max(R[R.length - 1], F[F.length - 1]) - Math.min(R[0], F[0]);
  const obsLags = rawLags(R, F); // NO ACC alignment — constant δ, see header
  const nR = R.length;
  /* Both statistics return an OBJECT {matchRate, residIQR}, and rawLags returns {t, lag} entries.
     Taking either for a scalar yields NaN through every downstream arithmetic op — and a NaN ratio
     still prints a confident verdict, which is how the first run of this tool reported "NOT
     demonstrated" on all 16 nights from nothing at all. Unwrap at the boundary, once. */
  const obs = { legacy: legacyMatchRate(obsLags, nR).matchRate, strict: strictMatchRate(obsLags, nR).matchRate };
  const residIQR = strictMatchRate(obsLags, nR).residIQR;

  const chance = { legacy: [], strict: [] };
  for (let i = 0; i < N_SURR; i++) {
    const frac = (i + 1) / (N_SURR + 1);
    const sh = circShift(F, span, frac);
    const l = rawLags(R, sh);
    chance.legacy.push(legacyMatchRate(l, nR).matchRate);
    chance.strict.push(strictMatchRate(l, nR).matchRate);
  }
  const summarise = (o, ch) => {
    const clean = ch.filter((x) => isFinite(x));
    const m = clean.length ? median(clean) : NaN;
    const p = (clean.filter((x) => x >= o).length + 1) / (clean.length + 1);
    return { rate: o, chance: m, ratio: m > 0 ? o / m : NaN, p };
  };
  const lagsOnly = obsLags.map((e) => e.lag).filter((x) => isFinite(x));
  return {
    night,
    beats: nR,
    feet: F.length,
    overlapMin,
    medLagMs: lagsOnly.length ? median(lagsOnly) : null,
    ppgRate,
    ecgRate,
    pairs: lagsOnly.length,
    residIQR: residIQR,
    legacy: summarise(obs.legacy, chance.legacy),
    strict: summarise(obs.strict, chance.strict),
    files: { ecg: ecg.file, ppg: ppg.file }
  };
}

function main() {
  if (!DIR || !existsSync(DIR)) {
    console.error('pat-finger-coupler: --dir <captures root> is required (the raw corpus is gitignored).');
    process.exit(2);
  }
  loadDsps();
  /* THE SCORED SET IS THE SNAPSHOT THIS RUN REPORTS, never a second walk. The night-shaped test was
     `NIGHT_RE` spelled out, so the walk takes the primitive's default rule and nothing is declared
     here; `--night` is a SELECTION over that offer, so it stays below and is named by the count it
     left unread. The pairing and plausibility gates inside the loop are COVERAGE rules over the
     offer, not night rules, so they ride `notANight` at the end. */
  const popBefore = snapshotNights(DIR);
  const nights = popBefore.nights.filter((d) => !ONLY || d === ONLY);
  const rows = [];
  for (const n of nights) {
    for (const p of pairsIn(join(DIR, n))) {
      try {
        rows.push(analyse(n, p));
      } catch (e) {
        rows.push({ night: n, skip: e.message.slice(0, 60) });
      }
    }
  }
  /* THE POPULATION TRAVELS WITH THE ROWS. The status labels MOVEMENT, not coverage: `checked` is the
     intersection of the two snapshots, and reading it as a scored count would publish the whole
     offer as scored. The rows move under an `rows` key so stdout stays ONE JSON document — nothing
     in the tree reads this array, and a reader that only wants the rows now gets the offer with
     them. */
  const population = populationVerdict(popBefore, snapshotNights(DIR), {
    tool: 'tools/pat-finger-coupler.mjs',
    evidence: ['tools/pat-finger-coupler.mjs']
  });
  /* Named against the SELECTED set: under `--night` the rest of the offer was never a candidate. A
     night with several pairs counts as scored when ANY of its rows scored. */
  const unscored = notANight(
    { n: nights.length, nights },
    rows.map((r) => ({ night: r.night, ok: !r.skip }))
  );
  if (JSON_OUT) {
    console.log(JSON.stringify({ offered: popBefore.n, selected: nights.length, population, rows }, null, 1));
    return;
  }
  console.log(`O2Ring FINGER PPG <-> H10 ECG coupling — fiducial=${FIDUCIAL} — no ACC alignment (constant delta)`);
  console.log(`strict window +-${STRICT_W_MS} ms - ${N_SURR} surrogates/night - only STRICT vs its own null is evidence\n`);
  console.log('night         beats   feet   ovl   medLag |  legacy  chance ratio    p   |  strict chance ratio    p');
  console.log('-'.repeat(112));
  const scored = rows.filter((r) => !r.skip);
  for (const r of rows) {
    if (r.skip) {
      console.log(`${r.night}  skipped - ${r.skip}`);
      continue;
    }
    const pc = (x) => (x * 100).toFixed(0).padStart(4) + '%';
    console.log(
      `${r.night} ${String(r.beats).padStart(7)} ${String(r.feet).padStart(6)} ${r.overlapMin.toFixed(0).padStart(5)} ` +
        `${(r.medLagMs == null ? '-' : r.medLagMs.toFixed(0)).padStart(7)} | ${pc(r.legacy.rate)} ${pc(r.legacy.chance)} ` +
        `${r.legacy.ratio.toFixed(2).padStart(5)} ${r.legacy.p.toFixed(3)} | ${pc(r.strict.rate)} ${pc(r.strict.chance)} ` +
        `${r.strict.ratio.toFixed(2).padStart(5)} ${r.strict.p.toFixed(3)}`
    );
  }
  if (scored.length) {
    console.log('-'.repeat(112));
    const usable = scored.filter((r) => isFinite(r.strict.ratio));
    if (usable.length < scored.length)
      console.log(`WARNING: ${scored.length - usable.length}/${scored.length} night(s) produced a non-finite ` + `statistic and are EXCLUDED - a NaN ratio is not a null result.`);
    const sig = usable.filter((r) => r.strict.p < 0.05 && r.strict.ratio > 1);
    console.log(
      `${usable.length} night(s) usable - strict ratio median ` +
        `${usable.length ? median(usable.map((r) => r.strict.ratio)).toFixed(2) : 'n/a'} - ` +
        `${sig.length}/${usable.length} with p<0.05 AND ratio>1`
    );
    console.log(
      !usable.length
        ? 'NO usable night - the tool produced no valid statistic, which is NOT evidence either way.'
        : sig.length
          ? `COUPLED on ${sig.length} night(s): ${sig.map((r) => r.night).join(', ')}`
          : 'NO usable night shows coupling above its own chance floor.'
    );
  }
  console.log(
    `population: ${popBefore.n} offered under ${DIR} · ${nights.length} selected · ${scored.length} scored · movement ${population.status}${ONLY ? ` · --night left ${popBefore.n - nights.length} offered night(s) unread` : ''}${population.reason ? ' — ' + population.reason : ''}`
  );
  console.log(`selected but not scored: ${unscored.length ? unscored.join(', ') : 'none'}`);
  console.log('POPULATION ' + JSON.stringify(population));
}

/* The sample the adoption gate reads: two identical fabricated snapshots, so the object is complete
   and no corpus is touched. The rule is the primitive's own, which is what this tool walks under. */
function verdictSample() {
  const at = '2026-10-22T00:00:00Z';
  const nights = ['2026-08-03', '2026-08-04'];
  const snap = {
    ok: true,
    root: 'uploads/trio',
    reason: null,
    n: nights.length,
    nights,
    digest: null,
    maxCtimeMs: null,
    at,
    rule: String(/^\d{4}-\d{2}-\d{2}$/),
    ruleIsDefault: true,
    rejectedNightShaped: [],
    admittedNonNight: []
  };
  return populationVerdict(snap, snap, { tool: 'tools/pat-finger-coupler.mjs', at, evidence: ['tools/pat-finger-coupler.mjs'] });
}

const IS_CLI = isCliEntry(import.meta.url);
/* The sample dispatch sits ABOVE `main`, which refuses without a readable `--dir`: the adoption gate
   reads the object on a box holding no nights. */
if (IS_CLI && argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample(), null, 2));
} else if (IS_CLI) main();
export { pairsIn, analyse, RE_RING, verdictSample };
