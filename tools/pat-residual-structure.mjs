/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-residual-structure.mjs — PAT-ROOT-CAUSE-FORENSICS §14: is the leftover 20–40 ms ERROR or SIGNAL?
 *
 * PAT-FORENSICS-WINDOW-ORACLE recovered narrow-window SDs of 15–45 ms out of sample. This campaign
 * has measured the sensor floor at ~11 ms (ECG axis 11.15 within-bin · PPG fractional-subscript bug
 * ~10 · fiducial <=6.3 by two independent routes). So 20–40 ms is unaccounted for, and it is now the
 * largest open term in the budget.
 *
 * ┌─ THE QUESTION IS NOT "HOW BIG" BUT "IS IT STRUCTURED" ───────────────────────────────────────┐
 * │ Those two readings point opposite ways and the charter's §14 turns on which is true:          │
 * │   · UNSTRUCTURED (white) -> it is error nothing has named, and the budget has a hole.         │
 * │   · STRUCTURED (autocorrelated, HR-dependent) -> it is PHYSIOLOGICAL PAT VARIATION, i.e. the   │
 * │     quantity the measurement exists to capture. Then the "gap" is SIGNAL and calling it error  │
 * │     would be the campaign's worst inversion — pathologising the thing we are trying to see.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * TWO STATISTICS, both on the OUT-OF-SAMPLE accepted lags only (never the fitting half):
 *   · rho1  — lag-1 autocorrelation of the lag series in BEAT ORDER. White noise gives ~0;
 *             respiration- and BP-driven PAT gives a positive value.
 *   · rho(RR, lag) — Spearman against the concurrent RR interval. PAT shortening as HR rises is a
 *             well-established physiological dependence, so its presence is positive evidence for
 *             physiology and its absence is evidence against.
 *
 * 🔴 rho1 ALONE CANNOT SEPARATE PHYSIOLOGY FROM SLOW DRIFT, and the first real run proved it. Two
 * nights returned rho1 = 0.981 and 0.966 (shuffles 0.022 / 0.005) — but a 12-beat respiratory
 * sinusoid gives rho1 = cos(2*pi/12) = 0.866, so ~0.98 is SMOOTHER than respiration can be. A slow
 * monotone drift — an uncorrected clock, a warming sensor, a shifting cuff — also produces rho1 near
 * 1. Both readings are "structured", and they mean opposite things for the budget.
 *
 * THE DISCRIMINATOR IS THE SHAPE OF THE AUTOCORRELATION, NOT ITS FIRST VALUE. An oscillation decays
 * and CROSSES ZERO at about a quarter of its period, then rebounds negative; a drift decays slowly
 * and never crosses within the observed span. So the tool reports rho at several lags plus the first
 * zero-crossing beat index:
 *   · crossing within ~2-15 beats, with a negative trough  -> OSCILLATORY (respiration-like)
 *   · no crossing within 40 beats                          -> DRIFT-LIKE (monotone)
 * Reporting rho1 without the shape would have called a drift "physiological", which is precisely the
 * inversion this section exists to prevent.
 *
 * SHUFFLE CONTROL, and it is required: permuting the lag series destroys ordering while preserving
 * every marginal. If rho1 survives a shuffle the statistic is measuring something other than
 * temporal structure and the result is void.
 *
 * PRE-STATED BANDS (closed, declared before the first run):
 *   rho1 >= 0.30              -> STRUCTURED   (physiological; the residual is signal)
 *   0.10 <= rho1 < 0.30       -> PARTIAL
 *   rho1 <  0.10              -> UNSTRUCTURED (error; the budget has a hole)
 *   |rho(RR,lag)| >= 0.20     -> HR-DEPENDENT
 *
 * ⚠️ THE NARROW WINDOW CENSORS, AND CENSORING BIASES BOTH STATISTICS TOWARD ZERO. Beats whose lag
 * falls outside mode±halfWidth are dropped, truncating the distribution and breaking the beat
 * sequence. A dropped beat makes its neighbours non-adjacent, which attenuates rho1. So a LOW rho1
 * is weak evidence for "unstructured" while a HIGH one is strong evidence for "structured" — the
 * test is one-sided in its strength, and that asymmetry is stated rather than discovered later.
 *
 * Usage:
 *   node tools/pat-residual-structure.mjs --selftest
 *   node tools/pat-residual-structure.mjs --dir <captures root> [--half-width 100]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BAND_STRUCTURED = 0.3;
export const BAND_PARTIAL = 0.1;
export const BAND_HR = 0.2;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function autocorr1(xs) {
  if (xs.length < 20) return Number.NaN;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    den += (xs[i] - m) * (xs[i] - m);
    if (i > 0) num += (xs[i] - m) * (xs[i - 1] - m);
  }
  return den > 0 ? num / den : Number.NaN;
}

function rank(xs) {
  const order = [...xs.keys()].sort((a, b) => xs[a] - xs[b]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : Number.NaN;
}
export function spearman(a, b) {
  return a.length < 20 ? Number.NaN : pearson(rank(a), rank(b));
}

/* Deterministic shuffle — a control whose value changes run to run is not a control. */
export function shuffled(xs, seed = 12345) {
  const a = xs.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Autocorrelation at an arbitrary lag — the shape, not just the first value. */
export function autocorrK(xs, k) {
  if (xs.length < k + 20) return Number.NaN;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    den += (xs[i] - m) * (xs[i] - m);
    if (i >= k) num += (xs[i] - m) * (xs[i - k] - m);
  }
  return den > 0 ? num / den : Number.NaN;
}

/* First lag at which the autocorrelation goes non-positive. null => no crossing in `maxK`. */
export function firstZeroCrossing(xs, maxK = 40) {
  for (let k = 1; k <= maxK; k++) {
    const r = autocorrK(xs, k);
    if (Number.isFinite(r) && r <= 0) return k;
  }
  return null;
}

export function shapeVerdict(xs) {
  const zc = firstZeroCrossing(xs);
  if (zc == null) return { zc: null, shape: 'DRIFT-LIKE' };
  if (zc >= 2 && zc <= 15) return { zc, shape: 'OSCILLATORY' };
  return { zc, shape: zc < 2 ? 'FAST/NOISY' : 'SLOW-OSC' };
}

/* ── THE RUN AS ONE tepna.verdict/1 OBJECT ───────────────────────────────────────────────────
   The criterion is this tool's OWN pre-stated band, printed in the header of every run:
   `rho1 >= BAND_STRUCTURED` (0.30). Nothing new is invented here.

   ⚠️ PASS/FAIL NAME CRITERION SATISFACTION, NOT GOODNESS, and in this tool they point the
   OPPOSITE way to instinct: a STRUCTURED residual means the leftover 20–40 ms is PHYSIOLOGICAL PAT
   VARIATION — the quantity the measurement exists to capture — while UNSTRUCTURED means the budget
   has a hole nothing has named. A reader who spends `FAIL` as "the tool failed" has inverted the
   campaign's §14 question. The `reason` says which way it went; the status only says whether the
   band was met.

     PASS          every checked night at or above the band
     SHORTFALL     some at or above it, some not — the reason names the split
     FAIL          none reach it
     UNDERPOWERED  nights were eligible and NONE could be scored
     NOT_RUN       no nights at all
     UNKNOWN       a night scored to an UNDEFINED band

   `population` is NIGHTS, and `excluded` is the NAMED skip census — the five bare `continue`s this
   replaces made the denominator an unstated filter. PURE. */
export function runVerdict(tally, excludedBy, eligible, { commit = null, evidence = [] } = {}) {
  const Verdict = createRequire(import.meta.url)(join(HERE, '..', 'verdict.js'));
  const n = (k) => tally[k] || 0;
  const excluded = Object.values(excludedBy).reduce((a, b) => a + b, 0);
  const structured = n('STRUCTURED');
  const undef = n('UNDEFINED');
  const checked = Object.values(tally).reduce((a, b) => a + b, 0);
  let status;
  let reason;
  if (eligible === 0) {
    status = 'NOT_RUN';
    reason = 'no night directories under the root';
  } else if (checked === 0) {
    status = 'UNDERPOWERED';
    reason = `all ${eligible} eligible night(s) were skipped before scoring (minimum to decide: 1) — ${JSON.stringify(excludedBy)}`;
  } else if (undef > 0) {
    status = 'UNKNOWN';
    reason = `${undef} of ${checked} scored night(s) landed in the UNDEFINED band — rho1 was not finite`;
  } else if (structured === checked) {
    status = 'PASS';
    reason = null;
  } else if (structured === 0) {
    status = 'FAIL';
    reason = `0 of ${checked} scored night(s) reach rho1 >= ${BAND_STRUCTURED} — the residual is not autocorrelated at lag 1 on any of them: ${JSON.stringify(tally)}`;
  } else {
    status = 'SHORTFALL';
    reason = `${structured} of ${checked} scored night(s) reach rho1 >= ${BAND_STRUCTURED}; ${checked - structured} did not: ${JSON.stringify(tally)}`;
  }
  const v = Verdict.make({
    gate: 'pat-residual-structure',
    status,
    scope: 'internal',
    population: { checked, eligible, excluded },
    criterion: { name: 'residual_lag1_autocorrelation', threshold: BAND_STRUCTURED, unit: '', direction: 'gte' },
    /* NOT_RUN carries result null by contract — nothing examined, nothing measured. */
    result: status === 'NOT_RUN' ? null : { tally, structured, scored: checked, excludedBy },
    evidence: ['tools/pat-residual-structure.mjs', ...evidence],
    reason,
    producedBy: { tool: 'tools/pat-residual-structure.mjs', commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`pat-residual-structure: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

function gitCommitShort() {
  try {
    return (
      execSync('git rev-parse --short HEAD', { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch {
    return null; // §∅: not in a git tree is an ABSENCE; the verdict says so in commitReason
  }
}

/** The corpus-free sample the adoption gate runs: a mixed corpus with a named skip census, which is
 *  the SHORTFALL arm and the shape a real run most often lands in. */
export function sampleRun() {
  return { tally: { STRUCTURED: 3, PARTIAL: 1, UNSTRUCTURED: 1 }, excludedBy: { 'oracle-refused': 2, 'fewer-than-50-accepted-lags': 1 }, eligible: 8 };
}

export function band(r) {
  if (!Number.isFinite(r)) return 'UNDEFINED';
  if (r >= BAND_STRUCTURED) return 'STRUCTURED';
  if (r >= BAND_PARTIAL) return 'PARTIAL';
  return 'UNSTRUCTURED';
}

/* Accepted out-of-sample lags, with the concurrent RR interval for each. */
export function acceptedSeries(rTimes, fTimes, mode, halfWidth) {
  const lags = [];
  const rrs = [];
  let j = 0;
  for (let i = 1; i < rTimes.length; i++) {
    const r = rTimes[i];
    while (j < fTimes.length && fTimes[j] < r) j++;
    if (j >= fTimes.length) break;
    const lag = fTimes[j] - r;
    if (lag >= mode - halfWidth && lag <= mode + halfWidth) {
      lags.push(lag);
      rrs.push(rTimes[i] - rTimes[i - 1]);
    }
  }
  return { lags, rrs };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  /* WHITE series -> rho1 ~ 0. */
  let s = 3;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
  const white = Array.from({ length: 2000 }, () => rnd() * 30);
  ok(Math.abs(autocorr1(white)) < 0.1, `white series rho1 ~ 0, got ${autocorr1(white).toFixed(3)}`);
  ok(band(autocorr1(white)) === 'UNSTRUCTURED', 'white reads UNSTRUCTURED');

  /* A SLOW OSCILLATION (respiration-like, ~12 beats/cycle) -> strongly autocorrelated. */
  const resp = Array.from({ length: 2000 }, (_, i) => 25 * Math.sin((2 * Math.PI * i) / 12) + rnd() * 4);
  ok(autocorr1(resp) >= 0.3, `respiration-like series must read STRUCTURED, got ${autocorr1(resp).toFixed(3)}`);
  ok(band(autocorr1(resp)) === 'STRUCTURED', 'oscillation reads STRUCTURED');

  /* THE CONTROL: shuffling must destroy the structure, or the statistic is not measuring order. */
  ok(Math.abs(autocorr1(shuffled(resp))) < 0.1, `shuffled oscillation rho1 must collapse, got ${autocorr1(shuffled(resp)).toFixed(3)}`);

  /* Spearman recovers a planted monotone relation and rejects an unrelated one. */
  const x = Array.from({ length: 500 }, (_, i) => i + rnd());
  const y = x.map((v) => 2 * v + rnd() * 3);
  ok(spearman(x, y) > 0.9, `planted monotone pair rho > 0.9, got ${spearman(x, y).toFixed(3)}`);
  ok(Math.abs(spearman(x, shuffled(y))) < 0.2, 'shuffled pair loses the relation');

  /* acceptedSeries applies the window and pairs RR correctly. */
  const R = [0, 900, 1800, 2700, 3600];
  const F = [300, 1200, 5000, 3000, 3900].sort((a, b) => a - b);
  const got = acceptedSeries(R, F, 300, 100);
  ok(got.lags.length === got.rrs.length, 'lags and RRs stay aligned');
  ok(
    got.lags.every((l) => Math.abs(l - 300) <= 100),
    'only in-window lags are kept'
  );

  /* THE DISCRIMINATOR: an oscillation must cross zero early; a drift must not cross at all. */
  const osc = Array.from({ length: 2000 }, (_, i) => 25 * Math.sin((2 * Math.PI * i) / 12));
  const so = shapeVerdict(osc);
  ok(so.shape === 'OSCILLATORY', `a 12-beat oscillation must read OSCILLATORY, got ${so.shape} (zc ${so.zc})`);
  const drift = Array.from({ length: 2000 }, (_, i) => i * 0.05);
  const sd2 = shapeVerdict(drift);
  ok(sd2.shape === 'DRIFT-LIKE', `a monotone ramp must read DRIFT-LIKE, got ${sd2.shape} (zc ${sd2.zc})`);
  ok(autocorr1(drift) > 0.95 && autocorr1(osc) > 0.8, 'both give a high rho1 — which is exactly why rho1 alone is insufficient');

  /* ── the run as ONE tepna.verdict/1 object, every arm ────────────────────────────────────────
     The criterion is this tool's own BAND_STRUCTURED, so these pin a MAPPING, never a threshold. */
  {
    const V = createRequire(import.meta.url)(join(HERE, '..', 'verdict.js'));
    const s = sampleRun();
    const sh = runVerdict(s.tally, s.excludedBy, s.eligible);
    ok(sh.status === 'SHORTFALL' && /3 of 5/.test(sh.reason), `a mixed corpus → SHORTFALL naming the split, got ${sh.status}: ${sh.reason}`);
    /* PLANT — the population is an EQUALITY, and it is what forces the five formerly-bare
       `continue`s to be counted: a skipped night must land in `excluded`, not vanish. */
    ok(sh.population.checked + sh.population.excluded === sh.population.eligible, 'checked + excluded = eligible, so a skipped night cannot vanish');
    ok(sh.population.excluded === 3 && sh.result.excludedBy['oracle-refused'] === 2, 'the skip census travels WITH the verdict, by name');
    ok(runVerdict({ STRUCTURED: 2 }, {}, 2).status === 'PASS', 'every scored night at or above the band → PASS');
    ok(runVerdict({ STRUCTURED: 2 }, {}, 2).reason === null, 'a PASS carries no reason');
    ok(runVerdict({ PARTIAL: 2 }, {}, 2).status === 'FAIL', 'no night reaching the band → FAIL');
    ok(runVerdict({}, { 'oracle-refused': 3 }, 3).status === 'UNDERPOWERED', 'nights eligible and none scorable → UNDERPOWERED, not FAIL');
    ok(runVerdict({}, {}, 0).status === 'NOT_RUN', 'no nights at all → NOT_RUN, not an empty PASS');
    ok(runVerdict({}, {}, 0).result === null, 'PLANT: NOT_RUN carries result null — nothing examined, nothing measured');
    ok(runVerdict({ UNDEFINED: 1, STRUCTURED: 1 }, {}, 2).status === 'UNKNOWN', 'an UNDEFINED band → UNKNOWN, never a quotable band');
    ok(V.validate(sh).ok && V.validate(runVerdict({}, {}, 0)).ok, 'every emitted arm validates under verdict.js');
  }

  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${23 - fails.length}/23)`);
  return fails.length === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  if (argv.includes('--verdict-sample')) {
    const s = sampleRun();
    console.log(JSON.stringify(runVerdict(s.tally, s.excludedBy, s.eligible, { commit: gitCommitShort(), evidence: ['<sample>'] }), null, 2));
    return;
  }
  const DIR = argv[argv.indexOf('--dir') + 1];
  const HW = Number(argv.includes('--half-width') ? argv[argv.indexOf('--half-width') + 1] : 100);
  if (!DIR || !existsSync(DIR)) {
    console.error('usage: node tools/pat-residual-structure.mjs --selftest | --dir <captures root>');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { oracleNight, pickPair } = await import(join(HERE, 'pat-window-oracle.mjs'));
  getDsps();
  console.log(`bands: rho1 >= ${BAND_STRUCTURED} STRUCTURED, >= ${BAND_PARTIAL} PARTIAL, else UNSTRUCTURED; |rho(RR,lag)| >= ${BAND_HR} HR-DEPENDENT`);
  console.log('⚠️ censoring biases both statistics TOWARD zero — a high value is strong, a low one is weak.\n');
  console.log('night          n     SD    rho1   rho5  rho20  shuffled  zeroX  shape         rho(RR,lag)  verdict');
  const tally = {};
  /* ⚠️ EVERY SKIP IS NAMED AND COUNTED. Five bare `continue`s used to drop a night out of the TALLY
     with no record, so the denominator was an unstated filter: a corpus line count that does not
     reconcile with the directory count is a filter nobody stated. The verdict's population is an
     EQUALITY (checked + excluded = eligible), which is what forces this to be true rather than
     merely intended. */
  const excludedBy = {};
  let eligible = 0;
  const skip = (why) => {
    excludedBy[why] = (excludedBy[why] || 0) + 1;
  };
  const ONLY = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
  for (const n of readdirSync(DIR)
    .filter((x) => /^2026-/.test(x) && (!ONLY || ONLY.has(x)))
    .sort()) {
    const dir = join(DIR, n);
    eligible++;
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      skip('unreadable-night-dir');
      continue;
    }
    /* The oracle's picker, imported — NOT a third local copy. This file used to carry its own
       pre-#2082 version (two independent size-sorts, `readFileSync` in the comparator), so on a
       fragmented night it paired the largest ECG with the largest PPG from a different hour and
       then scored the result. See `pickPair`'s header. */
    const paired = pickPair(dir, files);
    if (paired.missing) {
      skip('missing-stream');
      continue;
    }
    const { eF, pF } = paired;
    let E;
    let P;
    try {
      E = ecgRpeakTimes(readFileSync(eF, 'utf8'));
      P = ppgFootTimes(readFileSync(pF, 'utf8'));
    } catch {
      skip('parse-error');
      continue;
    }
    const R = Array.from(E.times);
    const F = Array.from(P.times);
    const orc = oracleNight(R, F, HW);
    if (!orc || orc.refusal || !Number.isFinite(orc.narrowSd)) {
      skip('oracle-refused'); // a named refusal is a truthy object
      continue;
    }
    /* The oracle's OWN split, not a recomputed one — it derives `mid` from the two trains' overlap
       and its second half is bounded by `hi`, so scoring `t >= mid` over all of R would re-admit the
       beats after the PPG ends that #2034 removed. */
    const rB = R.filter((t) => t >= orc.mid && t <= orc.hi);
    const { lags, rrs } = acceptedSeries(rB, F, orc.mode, HW);
    if (lags.length < 50) {
      skip('fewer-than-50-accepted-lags');
      continue;
    }
    const r1 = autocorr1(lags);
    const r1s = autocorr1(shuffled(lags));
    const rhr = spearman(rrs, lags);
    const v = band(r1);
    tally[v] = (tally[v] || 0) + 1;
    const hr = Math.abs(rhr) >= BAND_HR ? ' HR-DEP' : '';
    const sh = shapeVerdict(lags);
    console.log(
      `${n}  ${String(lags.length).padStart(5)}  ${orc.narrowSd.toFixed(1).padStart(5)}  ${r1.toFixed(3).padStart(6)} ${autocorrK(lags, 5).toFixed(3).padStart(6)} ${autocorrK(lags, 20).toFixed(3).padStart(6)}  ${r1s.toFixed(3).padStart(7)}  ${String(sh.zc ?? '-').padStart(5)}  ${sh.shape.padEnd(12)}  ${rhr.toFixed(3).padStart(10)}  ${v}${hr}`
    );
  }
  console.log('\nTALLY:', JSON.stringify(tally));
  console.log('SKIPPED:', JSON.stringify(excludedBy));
  console.log('VERDICT ' + JSON.stringify(runVerdict(tally, excludedBy, eligible, { commit: gitCommitShort(), evidence: [DIR] })));
}

if (process.argv[1]?.endsWith('pat-residual-structure.mjs')) await main();
