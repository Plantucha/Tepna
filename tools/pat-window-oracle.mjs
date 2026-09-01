/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-window-oracle.mjs — PAT-ROOT-CAUSE-FORENSICS §11/§13: is there signal under the window?
 *
 * PAT-FORENSICS-WINDOW-REGIMES measured that on 37 % of channel-nights the accepted-lag distribution
 * is indistinguishable from UNIFORM over the acceptance window `[PHYS_LO, PHYS_HI] = [200, 650]` —
 * SD matches 450/√12 = 129.9, the median sits on the window midpoint, and a channel broken by two
 * orders of magnitude reports the same SD as a healthy one. That says the reported SD is a constant
 * of the estimator. It does NOT say whether a real, narrow lag exists underneath it.
 *
 * ┌─ THE CIRCULARITY THIS DESIGN EXISTS TO AVOID ────────────────────────────────────────────────┐
 * │ The tempting experiment — find each night's lag mode, put a narrow window round it, report the │
 * │ resulting SD — is RIGGED. Fitting a window to the data's own mode and then measuring spread    │
 * │ inside that window guarantees a smaller number whether or not any signal exists. It would      │
 * │ "recover" a lag from pure noise.                                                              │
 * │                                                                                              │
 * │ So the window is chosen OUT OF SAMPLE: the mode is estimated on the night's FIRST half and     │
 * │ applied, untouched, to the SECOND half. A narrow SD in the second half is then earned rather   │
 * │ than fitted — no beat used to place the window contributes to the statistic scoring it.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * TWO CONTROLS, both required for the result to mean anything:
 *   · FULL-WINDOW on the SAME second half — the status quo, so the comparison is within-night.
 *   · CIRCULAR-SHIFT NULL — the PPG train rotated by a large offset destroys any true R↔foot
 *     correspondence while preserving every marginal (beat rate, foot density, artefact structure).
 *     If the narrow window "recovers" a tight lag from the shifted train too, it is fitting noise
 *     and the whole design is refuted. THIS IS THE ASSERTION THAT MATTERS.
 *
 *     ⚠️ THE SHIFT NULL RELIES ON BEAT-INTERVAL IRREGULARITY, and the selftest found this the hard
 *     way. Against a PERFECTLY PERIODIC beat train a rotation is not a null at all: with RR = 900 ms
 *     and a 37000 ms shift, 37000 mod 900 = 100, so every foot lands a constant 100 ms from its R and
 *     the "destroyed" correspondence is perfectly intact. The first version of this selftest planted
 *     a metronome and the null beat the real arm. Real HRV supplies the irregularity that makes the
 *     rotation valid — but the assumption is load-bearing, so it is stated rather than assumed, and
 *     the selftest now plants an irregular train on purpose.
 *
 * PRE-STATED BANDS (closed, declared before the first run):
 *   out-of-sample SD <= 20 ms  -> SIGNAL RECOVERED (above the ~11 ms sensor floor this campaign
 *                                 measured, and well under the 60 ms bar)
 *              20 < SD < 60    -> PARTIAL
 *                   SD >= 60   -> NO RECOVERY
 *   AND the null must be beaten: a night counts as recovered only if its real SD is lower than its
 *   own shifted-null SD. A band pass with no null separation is reported as NOT recovered.
 *
 * MODE SEARCH IS DELIBERATELY WIDER THAN THE PHYS WINDOW (0–2000 ms). Searching inside [200, 650]
 * would inherit the very censoring under test — the mode has to be free to land outside it, which is
 * the case PAT-WINDOW-CENSORING records (one night at a median lag of 831 ms, 95.9 % above PHYS_HI).
 *
 * Usage:
 *   node tools/pat-window-oracle.mjs --selftest
 *   node tools/pat-window-oracle.mjs --dir <captures root> [--half-width 100] [--fiducial foot|cfd|half]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PHYS_LO = 200;
export const PHYS_HI = 650;
export const MODE_SEARCH_MAX = 2000; // wider than the PHYS window ON PURPOSE — see header
export const BIN_MS = 10;
export const BAND_RECOVERED = 20;
export const BAND_PARTIAL = 60;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export function sd(a) {
  if (a.length < 2) return Number.NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/* All R→foot lags in [0, MODE_SEARCH_MAX], nearest-forward foot only (no window applied). */
export function rawLags(rTimes, fTimes) {
  const out = [];
  let j = 0;
  for (const r of rTimes) {
    while (j < fTimes.length && fTimes[j] < r) j++;
    if (j < fTimes.length) {
      const lag = fTimes[j] - r;
      if (lag >= 0 && lag <= MODE_SEARCH_MAX) out.push(lag);
    }
  }
  return out;
}

/* Histogram mode over BIN_MS bins, smoothed by a 3-bin box so a single spike cannot win. */
export function lagMode(lags) {
  if (lags.length < 30) return null;
  const nb = Math.ceil(MODE_SEARCH_MAX / BIN_MS);
  const h = new Float64Array(nb);
  for (const l of lags) h[Math.min(nb - 1, Math.floor(l / BIN_MS))]++;
  let best = -1;
  let bestI = -1;
  for (let i = 1; i < nb - 1; i++) {
    const v = h[i - 1] + h[i] + h[i + 1];
    if (v > best) {
      best = v;
      bestI = i;
    }
  }
  return bestI < 0 ? null : (bestI + 0.5) * BIN_MS;
}

export function acceptWithin(lags, lo, hi) {
  return lags.filter((l) => l >= lo && l <= hi);
}

/* Rotate the foot train by `shiftMs`, wrapping within its own span: destroys R<->foot
   correspondence while preserving every marginal. */
export function circShift(fTimes, shiftMs) {
  if (!fTimes.length) return [];
  const t0 = fTimes[0];
  const span = fTimes[fTimes.length - 1] - t0 || 1;
  return fTimes.map((t) => t0 + ((((t - t0 + shiftMs) % span) + span) % span)).sort((a, b) => a - b);
}

export function band(x, nullSd) {
  if (!(x >= 0)) return 'UNDEFINED';
  const beatsNull = Number.isFinite(nullSd) ? x < nullSd : false;
  if (!beatsNull) return 'NO RECOVERY (null not beaten)';
  if (x <= BAND_RECOVERED) return 'SIGNAL RECOVERED';
  if (x < BAND_PARTIAL) return 'PARTIAL';
  return 'NO RECOVERY';
}

/* One channel-night. Returns nulls rather than throwing so a bad night cannot kill a corpus run. */
export function oracleNight(rTimes, fTimes, halfWidth) {
  if (rTimes.length < 200 || fTimes.length < 200) return null;
  /* 🔴 SPLIT ON THE OVERLAP, NOT ON THE ECG'S OWN EXTENT.
     This used to take `mid` from the middle of `rTimes` and score out-of-sample on everything after it.
     Out-of-sample scoring is right; splitting on ONE stream's extent while scoring against the OTHER is
     not — the quantity this tool measures is a cross-device relationship, and that exists only where
     both streams exist.
     Measured 2026-09-01, and it silently zeroed six corpus nights: where the PPG covers only the early
     part of a long ECG record, the entire scored half lands AFTER the PPG ended.
       2026-08-12  split@00:39:56  PPG ends@23:40:24  rB=12967 beats, 0 inside the PPG span
       2026-08-15  split@02:25:35  PPG ends@00:14:40  rB=12513 beats, 0 inside the PPG span
       2026-08-13  split@01:48:08  PPG ends@04:03:26  rB= 7844 beats, 7794 inside  (this one worked)
     Those six reported `UNDEFINED (n=0)`, which reads as a data verdict and was a TOOL REFUSAL. The
     discriminator was the span ratio: ~1.0 keeps the scored half inside, 0.25–0.45 puts it wholly
     outside. */
  const lo = Math.max(rTimes[0], fTimes[0]);
  const hi = Math.min(rTimes[rTimes.length - 1], fTimes[fTimes.length - 1]);
  if (!(hi > lo)) return null;
  const rIn = rTimes.filter((t) => t >= lo && t <= hi);
  if (rIn.length < 200) return null;
  const mid = rIn[Math.floor(rIn.length / 2)];
  const rA = rIn.filter((t) => t < mid);
  const rB = rIn.filter((t) => t >= mid);
  if (rA.length < 100 || rB.length < 100) return null;

  const mode = lagMode(rawLags(rA, fTimes)); // FIRST half only — out of sample
  if (mode == null) return null;

  const lagsB = rawLags(rB, fTimes);
  const narrow = acceptWithin(lagsB, mode - halfWidth, mode + halfWidth);
  const full = acceptWithin(lagsB, PHYS_LO, PHYS_HI);

  /* NULL: same procedure end to end on a rotated foot train — mode re-estimated on its first half
     too, so the null gets exactly the advantages the real arm gets. */
  const shifted = circShift(fTimes, 37000);
  const modeN = lagMode(rawLags(rA, shifted));
  const narrowN = modeN == null ? [] : acceptWithin(rawLags(rB, shifted), modeN - halfWidth, modeN + halfWidth);

  /* SECOND-half mode, diagnostic only (scores nothing): the out-of-sample invariance check a
     consumer can read off the verdict line. The mode itself is w-INVARIANT by construction — it is
     estimated from raw lags before any window is applied — which is exactly why it, and not the
     w-dependent band label, is the quotable location statistic (#2029's consumer hazard: 2026-08-17
     read NO RECOVERY at w=300 while recovering the identical 215 ms). */
  const modeB = lagMode(lagsB);

  return {
    mode,
    modeB,
    nB: rB.length,
    narrowN: narrow.length,
    narrowSd: sd(narrow),
    fullN: full.length,
    fullSd: sd(full),
    nullN: narrowN.length,
    nullSd: sd(narrowN),
    modeInPhys: mode >= PHYS_LO && mode <= PHYS_HI
  };
}

/* ── THE VERDICT LAYER — a recovered mode outside PHYS is REFUSED, not scored ─────────────────────
   PAT-FORENSICS-WINDOW-ORACLE §"The 5 out-of-window modes" recorded the class as a candidate and
   left refuse-vs-flag to the owner-decision layer; decided 2026-09-01 (owner's deputy): REFUSE.
   A 25 ms or 1245 ms "PAT" is not a transit time — chest-ECG→arm transit cannot physically sit
   outside [PHYS_LO, PHYS_HI] — so whatever the narrow window recovered there is an ALIGNMENT
   artifact, and handing it a band verdict is fabricated authority: the same discipline `hostAxis`
   applies when CK_AXIS_MAX_PPM is exceeded. The mode is still QUOTED in the refusal (diagnostic —
   the number a debugger needs), it just cannot be consumed as a PAT verdict. The refusal keys on the
   PHYS band [200, 650], NOT the ratified 200–500 acceptance rail: the rail is the acceptance layer's
   sanity band for signal nights, while this refusal is about physical impossibility — a mode in
   (500, 650] is suspect but arguable, and stays the acceptance layer's call. */
export function oracleVerdict(res) {
  if (!res) return null;
  const halves = res.modeB == null ? 'halves: B-mode n/a' : Math.abs(res.modeB - res.mode) <= BIN_MS ? 'halves ≡' : `halves ${res.mode.toFixed(0)}→${res.modeB.toFixed(0)} ⚠`;
  if (!res.modeInPhys)
    return {
      refused: true,
      label: `ARTIFACT REFUSAL — mode ${res.mode.toFixed(0)} ms outside PHYS ${PHYS_LO}–${PHYS_HI} (alignment artifact; mode diagnostic only, not a PAT)`,
      tallyKey: 'ARTIFACT REFUSAL',
      halves
    };
  const b = band(res.narrowSd, res.nullSd);
  return { refused: false, label: `${b} · mode ${res.mode.toFixed(0)} ms (w-invariant, ${halves}); band label is w-dependent`, tallyKey: b, halves };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  /* A PLANTED TRUE LAG of 300 ms with 8 ms jitter must be recovered. */
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
  /* IRREGULAR on purpose — a metronome defeats the circular-shift null (see header). */
  const R = [];
  let t = 0;
  for (let i = 0; i < 1200; i++) {
    t += 900 + rnd() * 260;
    R.push(t);
  }
  const F = R.map((r) => r + 300 + rnd() * 14).sort((a, b) => a - b);
  const res = oracleNight(R, F, 100);
  ok(res !== null, 'planted night yields a result');
  ok(Math.abs(res.mode - 300) <= 15, `mode found near 300, got ${res?.mode}`);
  ok(res.narrowSd < 20, `planted 8 ms jitter must recover under 20 ms, got ${res?.narrowSd?.toFixed(2)}`);
  ok(band(res.narrowSd, res.nullSd) === 'SIGNAL RECOVERED', `planted signal must read RECOVERED, got ${band(res.narrowSd, res.nullSd)}`);

  /* THE CONTROL THAT MATTERS: feet with NO relation to R must NOT be recovered. */
  const Fnoise = R.map((r, i) => r + ((i * 6151) % 1900)).sort((a, b) => a - b);
  const res2 = oracleNight(R, Fnoise, 100);
  ok(res2 !== null, 'noise night yields a result');
  ok(
    band(res2.narrowSd, res2.nullSd) !== 'SIGNAL RECOVERED',
    `pure noise must NOT read RECOVERED, got ${band(res2.narrowSd, res2.nullSd)} (sd ${res2?.narrowSd?.toFixed(1)} vs null ${res2?.nullSd?.toFixed(1)})`
  );

  /* Uniform fill over the full window must reproduce 450/sqrt12, or the comparison arm is broken. */
  const u = [];
  for (let i = 0; i < 20000; i++) u.push(200 + (450 * i) / 20000);
  ok(Math.abs(sd(u) - 450 / Math.sqrt(12)) < 1.0, `uniform fill SD must be ~129.9, got ${sd(u).toFixed(2)}`);

  /* circShift preserves count and ordering. */
  const s = circShift([0, 100, 200, 300], 150);
  ok(s.length === 4 && s.every((x, i) => i === 0 || x >= s[i - 1]), 'circShift keeps count and sort order');

  /* ── ARTIFACT REFUSAL: a TIGHT lag outside PHYS must refuse, not read as a quotable verdict. ──
     The low plant is the load-bearing control, and it is asserted from BOTH sides: the band layer
     WOULD have said SIGNAL RECOVERED (proving the plant is tight enough that only the refusal — not
     an incidental score failure — is what catches it), and the verdict layer refuses it anyway. */
  const Flow = R.map((r) => r + 100 + rnd() * 14).sort((a, b) => a - b); // 100 ms < PHYS_LO
  const resLow = oracleNight(R, Flow, 100);
  ok(resLow !== null, 'low-plant night yields a result');
  ok(
    resLow !== null && band(resLow.narrowSd, resLow.nullSd) === 'SIGNAL RECOVERED',
    `low plant must be tight enough that the BAND layer alone would quote it (plant is seen), got ${resLow && band(resLow.narrowSd, resLow.nullSd)}`
  );
  const vLow = oracleVerdict(resLow);
  ok(vLow !== null && vLow.refused === true && /ARTIFACT REFUSAL/.test(vLow.label), `mode ${resLow?.mode?.toFixed(0)} < PHYS_LO must REFUSE, got ${vLow?.label}`);
  ok(vLow !== null && vLow.label.includes(`${resLow.mode.toFixed(0)} ms`), 'the refusal quotes the mode as diagnostic');
  /* The high plant needs lag < min RR or nearest-forward matching aliases it mod RR (beat trains
     align only mod one heartbeat): lag 1240 against RR 900±260 modes at ~285, not 1240. A slower
     train (RR 1500±300) makes a 700 ms lag — outside PHYS_HI, inside every interval — reachable. */
  const R2 = [];
  let t2 = 0;
  for (let i = 0; i < 900; i++) {
    t2 += 1500 + rnd() * 300;
    R2.push(t2);
  }
  const Fhigh = R2.map((r) => r + 700 + rnd() * 14).sort((a, b) => a - b); // 700 ms > PHYS_HI
  const resHigh = oracleNight(R2, Fhigh, 100);
  const vHigh = oracleVerdict(resHigh);
  ok(vHigh !== null && vHigh.refused === true, `mode ${resHigh?.mode?.toFixed(0)} > PHYS_HI must REFUSE, got ${vHigh?.label}`);
  /* In-band verdicts carry the mode + halves-invariance, and are NOT refused. */
  const vGood = oracleVerdict(res);
  ok(vGood !== null && vGood.refused === false && vGood.label.includes('mode') && vGood.label.includes('halves'), `in-PHYS verdict carries mode + invariance status, got ${vGood?.label}`);
  ok(res.modeB != null && Math.abs(res.modeB - res.mode) <= BIN_MS, `planted night's halves agree within one bin, got ${res.mode}→${res.modeB}`);

  const TOTAL = 15;
  console.log(fails.length ? `SELFTEST FAIL (${fails.length}/${TOTAL})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${TOTAL}/${TOTAL})`);
  return fails.length === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const DIR = argv[argv.indexOf('--dir') + 1];
  const HW = Number(argv.includes('--half-width') ? argv[argv.indexOf('--half-width') + 1] : 100);
  /* --fiducial: which PPG train the oracle scores. `foot` (default) is byte-identical to the
     pre-flag tool; `cfd` / `half` are the alternative fiducials `ppgFootTimes` computes on the
     same beats (PPG-FOOT-PLACEMENT §3 / EXTERNAL-METHODS-SURVEY §1). The alternatives are
     index-parallel-with-NaN by contract; the oracle scores a train of event TIMES, so the NaNs
     (edge-unusable beats) are dropped here — order is preserved, no correspondence is consumed. */
  const FID = argv.includes('--fiducial') ? argv[argv.indexOf('--fiducial') + 1] : 'foot';
  /* --ecg-axis: which time axis the ECG train rides (H_axis P2, PPG-FOOT-PLACEMENT-FOLLOWUPS §1
     frozen pre-registration). `linear` (default) is byte-identical to the pre-flag tool; `piecewise`
     asks ecgRpeakTimes for the DSP's host-disciplined tMsAt map. Per the frozen conditions the
     correction is consumed ONLY when the DSP reports it live (`tMsCorrected` — which already
     requires an independent second clock); otherwise the night is ANNOTATED and skipped, never
     scored on a silent zero-correction axis wearing the piecewise label. */
  const AXIS = argv.includes('--ecg-axis') ? argv[argv.indexOf('--ecg-axis') + 1] : 'linear';
  if (!DIR || !existsSync(DIR) || !['foot', 'cfd', 'half'].includes(FID) || !['linear', 'piecewise'].includes(AXIS)) {
    console.error('usage: node tools/pat-window-oracle.mjs --selftest | --dir <captures root> [--half-width 100] [--fiducial foot|cfd|half] [--ecg-axis linear|piecewise]');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  getDsps();
  const nights = readdirSync(DIR)
    .filter((n) => /^2026-/.test(n))
    .sort();
  console.log(
    `half-width ±${HW} ms · fiducial ${FID} · ecg-axis ${AXIS} · mode search 0–${MODE_SEARCH_MAX} ms · bands: <=${BAND_RECOVERED} RECOVERED, <${BAND_PARTIAL} PARTIAL, else NO RECOVERY; null must be beaten\n`
  );
  console.log('night        mode    n     narrowSD    fullSD     nullSD   verdict');
  const tally = {};
  for (const n of nights) {
    const dir = join(DIR, n);
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    const pick = (re) => {
      const c = files.filter((f) => re.test(f)).map((f) => join(dir, f));
      if (!c.length) return null;
      return c.sort((a, b) => readFileSync(b).length - readFileSync(a).length)[0];
    };
    const eF = pick(/_ECG\.txt$/);
    const pF = pick(/Verity.*_PPG\.txt$/i) || pick(/_PPG\.txt$/);
    if (!eF || !pF) continue;
    let E;
    let P;
    try {
      E = ecgRpeakTimes(readFileSync(eF, 'utf8'), AXIS === 'piecewise' ? { axis: 'piecewise' } : undefined);
      P = ppgFootTimes(readFileSync(pF, 'utf8'));
    } catch (e) {
      /* Under --ecg-axis piecewise a parse/transform refusal (e.g. the sortedness assertion on a
         large mid-file step) is a P2 EXCLUSION and must say so — the first run swallowed 2026-08-18
         (maxStep 8654 ms) right here, a silent filter inside the very design whose frozen
         conditions demand annotate-and-exclude. Linear mode keeps the historical silent skip. */
      if (AXIS === 'piecewise') console.log(`${n}  ⊘ excluded (${String(e.message).slice(0, 70)})`);
      continue;
    }
    if (AXIS === 'piecewise' && !E.tMsCorrected) {
      console.log(`${n}  ⊘ piecewise axis refused (tMsCorrected=false, independent=${E.independent}) — excluded from the P2 denominator`);
      continue;
    }
    const train = FID === 'foot' ? P.times : FID === 'cfd' ? P.cfdTimes : P.halfTimes;
    const fTimes = Array.from(train).filter(Number.isFinite);
    const res = oracleNight(Array.from(E.times), fTimes, HW);
    if (!res) {
      console.log(`${n}  ⊘ too few beats`);
      continue;
    }
    const v = oracleVerdict(res);
    tally[v.tallyKey] = (tally[v.tallyKey] || 0) + 1;
    /* maxStepMs beside every piecewise row (frozen condition c): a mid-file step smears across one
       anchor gap under piecewise and can itself move a half-mode — discovered here, not post-hoc. */
    const axisNote = AXIS === 'piecewise' ? `  [maxStep ${E.maxStepMs == null ? 'n/a' : E.maxStepMs.toFixed(0) + ' ms'}]` : '';
    console.log(
      `${n}  ${res.mode.toFixed(0).padStart(5)}  ${String(res.narrowN).padStart(5)}  ${res.narrowSd.toFixed(1).padStart(8)}  ${res.fullSd.toFixed(1).padStart(8)}  ${res.nullSd.toFixed(1).padStart(8)}   ${v.label}${axisNote}`
    );
  }
  console.log('\nTALLY:', JSON.stringify(tally));
}

if (process.argv[1]?.endsWith('pat-window-oracle.mjs')) await main();
