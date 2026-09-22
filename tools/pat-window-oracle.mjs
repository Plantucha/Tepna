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
 *   node tools/pat-window-oracle.mjs --dir <captures root> [--half-width 100] [--fiducial foot|cfd|half] [--ecg-axis linear|piecewise] [--no-ecg-refine]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
export function rawLags(rTimes, fTimes, maxMs = MODE_SEARCH_MAX) {
  const out = [];
  let j = 0;
  for (const r of rTimes) {
    while (j < fTimes.length && fTimes[j] < r) j++;
    if (j < fTimes.length) {
      const lag = fTimes[j] - r;
      if (lag >= 0 && lag <= maxMs) out.push(lag);
    }
  }
  return out;
}

/* Histogram mode over BIN_MS bins, smoothed by a 3-bin box so a single spike cannot win. */
export function lagMode(lags, maxMs = MODE_SEARCH_MAX) {
  if (lags.length < 30) return null;
  const nb = Math.ceil(maxMs / BIN_MS);
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

/* One channel-night. Refuses — never throws — so a bad night cannot kill a corpus run.
   ⚠️ A refusal is NAMED: `{ refusal: '<reason>' }`, never a bare null. The bare-null era printed one
   fixed message ("too few beats") for five different causes, and the catch-swallowed variant of the
   same defect ate 2026-08-18's 8.6 s mid-file step on H_axis P2's first run (#2047) — a refusal
   eaten by a catch, in the tool whose #2044 verdict layer exists to stop exactly that class. The
   success shape is unchanged; a caller that must skip checks `res.refusal` (truthy object!). */
/* THE OVERLAP SPLIT, EXPORTED — residue `2026-09-02-oracle-split-duplicated`.
   `oracleNight` computed lo/mid/hi inline and did not export it, so `pat-ecg-axis-residual.mjs`
   re-stated the rule and said so in its own comment: "pat-window-oracle.mjs oracleNight does not
   export its split". That is the absent abstraction written down in the codebase's own hand.

   ⚠ THIS IS THE SPLIT ALONE, NOT A CALL INTO `oracleNight`. A consumer that only needs lo/mid/hi
   must not pay for mode-finding and the circular-shift null — that cost is exactly why the copy was
   made, and routing consumers through `oracleNight` would earn a fifth copy rather than remove one.

   Returns `{ lo, mid, hi, rIn, rA, rB }` or `{ refusal }`. The refusals travel with it, so both
   callers inherit the self-evidencing message rather than one of them degrading to a bare null. */
export function overlapSplit(rTimes, fTimes) {
  const lo = Math.max(rTimes[0], fTimes[0]);
  const hi = Math.min(rTimes[rTimes.length - 1], fTimes[fTimes.length - 1]);
  if (!(hi > lo)) {
    /* SELF-EVIDENCING REFUSAL (FOLLOWUPS §5). "no overlap" used to be the bare phrase, and it was
       read as a capture-session fact when it was in fact the tool pairing the LARGEST fragment of
       each stream instead of the most-overlapping pair. This line carries the measurement that
       distinguishes the two, so nobody has to re-derive it: the two trains' own extents and the gap
       between them. */
    const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
    const gapMin = Math.round((lo - hi) / 60000);
    return {
      refusal: `no overlap between the two trains (R ${hhmm(rTimes[0])}–${hhmm(rTimes[rTimes.length - 1])} vs feet ${hhmm(fTimes[0])}–${hhmm(fTimes[fTimes.length - 1])}; disjoint by ${gapMin} min)`
    };
  }
  const rIn = rTimes.filter((t) => t >= lo && t <= hi);
  if (rIn.length < 200) return { refusal: `too few R beats in the overlap (${rIn.length}; need 200)` };
  const mid = rIn[Math.floor(rIn.length / 2)];
  const rA = rIn.filter((t) => t < mid);
  const rB = rIn.filter((t) => t >= mid);
  if (rA.length < 100 || rB.length < 100) return { refusal: `too few beats per half (A=${rA.length}, B=${rB.length}; need 100 each)` };
  return { lo, mid, hi, rIn, rA, rB };
}

/* `searchMax` exists to ASK A QUESTION, not to tune anything: does the returned mode depend on the
   interval it is searched in? `PPG-FOOT-PLACEMENT` §4a's invariance evidence sweeps `--half-width`,
   the band drawn AROUND the mode — a different parameter, never this one. Defaults to
   `MODE_SEARCH_MAX`, so every committed number reproduces byte-for-byte. */
export function oracleNight(rTimes, fTimes, halfWidth, searchMax = MODE_SEARCH_MAX) {
  if (rTimes.length < 200 || fTimes.length < 200) return { refusal: `too few beats (r=${rTimes.length}, f=${fTimes.length}; need 200 each)` };
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
  const _split = overlapSplit(rTimes, fTimes);
  if (_split.refusal) return { refusal: _split.refusal };
  const { lo, hi, rIn, mid, rA, rB } = _split;

  const mode = lagMode(rawLags(rA, fTimes, searchMax), searchMax); // FIRST half only — out of sample
  if (mode == null) return { refusal: 'no mode — fewer than 30 first-half lags in the search range' };

  const lagsB = rawLags(rB, fTimes, searchMax);
  const narrow = acceptWithin(lagsB, mode - halfWidth, mode + halfWidth);
  const full = acceptWithin(lagsB, PHYS_LO, PHYS_HI);

  /* NULL: same procedure end to end on a rotated foot train — mode re-estimated on its first half
     too, so the null gets exactly the advantages the real arm gets. */
  const shifted = circShift(fTimes, 37000);
  const modeN = lagMode(rawLags(rA, shifted, searchMax), searchMax);
  const narrowN = modeN == null ? [] : acceptWithin(rawLags(rB, shifted, searchMax), modeN - halfWidth, modeN + halfWidth);

  /* SECOND-half mode, diagnostic only (scores nothing): the out-of-sample invariance check a
     consumer can read off the verdict line. The mode itself is w-INVARIANT by construction — it is
     estimated from raw lags before any window is applied — which is exactly why it, and not the
     w-dependent band label, is the quotable location statistic (#2029's consumer hazard: 2026-08-17
     read NO RECOVERY at w=300 while recovering the identical 215 ms). */
  const modeB = lagMode(lagsB, searchMax);

  return {
    /* THE SPLIT TRAVELS WITH THE RESULT (2026-09-02). #2034 moved this split onto the OVERLAP of the
       two trains, but only inside this function — it was not returned, so every sibling tool kept
       computing the pre-fix `R[floor(R.length/2)]` on the ECG's extent alone and silently diverged
       from the oracle it was reading `mode` from. Returning the split is the repair; a consumer
       recomputing it is the defect, because the next fix here would desynchronise them again. */
    lo,
    mid,
    hi,
    mode,
    modeB,
    nB: rB.length,
    narrowN: narrow.length,
    narrowSd: sd(narrow),
    fullN: full.length,
    fullSd: sd(full),
    nullN: narrowN.length,
    nullSd: sd(narrowN),
    modeN,
    modeNInPhys: modeN != null && modeN >= PHYS_LO && modeN <= PHYS_HI,
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
  /* A named refusal propagates AS its name — the whole point. It gets its own tally bucket so a
     corpus report says how many nights refused and why, instead of folding them into a data verdict
     or (worse) into silence. */
  if (res.refusal) return { refused: true, label: `⊘ REFUSED — ${res.refusal}`, tallyKey: 'REFUSED', halves: null };
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
  /* ── THE SPLIT HAS ONE DEFINITION ────────────────────────────────────────────────────────────
     Residue `2026-09-02-oracle-split-duplicated`: `pat-ecg-axis-residual.mjs` carried its own copy
     of this rule because the oracle did not export it. It does now, and these two assertions are
     what keep the copy from coming back.

     ASYMMETRIC ON PURPOSE — the feet train starts LATER than the R train and ends LATER, so `lo`
     comes from the feet and `hi` from the R beats. An implementation that took both endpoints from
     one train would agree with a symmetric plant and disagree here, so the asymmetry is the whole
     test. lo/mid/hi are asserted DISTINCT first: if the plant ever degenerated so two of them
     coincided, the equality below could pass while comparing nothing. */
  const Fasym = F.slice(200);
  const sp = overlapSplit(R, Fasym);
  ok(!sp.refusal, `asymmetric plant must split, got refusal: ${sp.refusal}`);
  ok(sp.lo === Fasym[0], `lo must come from the FEET train (${sp.lo} vs ${Fasym[0]})`);
  ok(sp.hi === R[R.length - 1], `hi must come from the R train (${sp.hi} vs ${R[R.length - 1]})`);
  ok(sp.lo !== sp.mid && sp.mid !== sp.hi && sp.lo !== sp.hi, `lo/mid/hi must be DISTINCT, got ${sp.lo}/${sp.mid}/${sp.hi}`);
  const resAsym = oracleNight(R, Fasym, 100);
  ok(!resAsym.refusal, `asymmetric plant must yield an oracle result, got: ${resAsym.refusal}`);
  ok(
    resAsym.lo === sp.lo && resAsym.mid === sp.mid && resAsym.hi === sp.hi,
    `the exported split must equal oracleNight's own: ${sp.lo}/${sp.mid}/${sp.hi} vs ${resAsym.lo}/${resAsym.mid}/${resAsym.hi}`
  );
  /* ⚠ THE MIRROR PLANT, AND IT IS NOT OPTIONAL. The plant above has the feet ending AFTER the R
     beats, so `min(R.last, F.last)` IS `R.last` — a mutation that takes `hi` from the R train alone
     is behaviour-preserving there and passes every assertion above. Measured: planting exactly that
     left the selftest at 27/27. One asymmetric case constrains ONE endpoint; catching both needs
     both directions. Here the feet start BEFORE and end BEFORE, so `lo` comes from the R train and
     `hi` from the feet — the exact mirror. */
  const Rmirror = R.slice(100);
  const Fmirror = F.slice(0, 1000);
  const spM = overlapSplit(Rmirror, Fmirror);
  ok(!spM.refusal, `mirror plant must split, got refusal: ${spM.refusal}`);
  ok(spM.lo === Rmirror[0], `mirror lo must come from the R train (${spM.lo} vs ${Rmirror[0]})`);
  ok(spM.hi === Fmirror[Fmirror.length - 1], `mirror hi must come from the FEET train (${spM.hi} vs ${Fmirror[Fmirror.length - 1]})`);
  ok(spM.lo !== spM.mid && spM.mid !== spM.hi && spM.lo !== spM.hi, `mirror lo/mid/hi must be DISTINCT, got ${spM.lo}/${spM.mid}/${spM.hi}`);
  const resM = oracleNight(Rmirror, Fmirror, 100);
  ok(!resM.refusal, `mirror plant must yield an oracle result, got: ${resM.refusal}`);
  ok(resM.lo === spM.lo && resM.mid === spM.mid && resM.hi === spM.hi, `mirror: exported split must equal oracleNight's own: ${spM.lo}/${spM.mid}/${spM.hi} vs ${resM.lo}/${resM.mid}/${resM.hi}`);

  /* AND THE COPY IS GONE. Source-scanned rather than trusted: the consumer must not re-state the
     rule. `overlapSplit` appearing there is the import; `Math.max(rTimes[0]` would be a second
     definition. */
  {
    const consumer = join(HERE, 'pat-ecg-axis-residual.mjs');
    const src = existsSync(consumer) ? readFileSync(consumer, 'utf8') : '';
    ok(src.length > 0, 'the consumer file is readable (a missing file would vacuously pass the next two)');
    ok(!/const lo = Math\.max\(rTimes\[0\]/.test(src), 'pat-ecg-axis-residual.mjs must NOT re-define the split rule');
    ok(/overlapSplit/.test(src), 'pat-ecg-axis-residual.mjs must consume the exported overlapSplit');
  }

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

  /* ── THE DRIFTING PLANT: the halves check must FIRE, not merely be printed ────────────────────
     The assertion above is the only test of `modeB` in the tree, and it runs on a lag that is
     CONSTANT by construction (`r + 700 + rnd()*14`). `papers/null-calibration.html`'s addendum names
     that exact failure — *"a known-answer planted under the model's own assumptions is guaranteed to
     pass, however wrong the model is"* — and prescribes *"plant your known-answer under a model you
     are not assuming."* So a constant plant can tell us the diagnostic AGREES when the lag is fixed;
     it cannot tell us the diagnostic can SEE the lag move, which is the only thing it is for.

     That distinction stopped being academic on 2026-09-14: measured over both capture trees,
     `halves ≡` holds on 3/30 and 5/35 nights, median |modeB−mode| 130 / 120 ms, and EVERY
     SIGNAL RECOVERED night disagrees by 80–160 ms. The corpus says this quantity moves on ~90 % of
     nights while the one test of the machinery that reports it could not see movement at all.

     The plant drifts 300 → 620 ms over 900 beats — both endpoints inside PHYS, so the night is not
     refused for an unrelated reason, and the observed corpus magnitude is reproduced rather than an
     arbitrary one. Because the two half-modes sit near the centroids of their halves (~beat 225 and
     ~675), the expected separation is roughly half the total drift, ~160 ms. */
  const Fdrift = R2.map((r, i) => r + 300 + (i * 320) / 900 + rnd() * 14).sort((a, b) => a - b);
  const resDrift = oracleNight(R2, Fdrift, 100);
  ok(resDrift != null && !resDrift.refusal, `drifting plant yields a scored night, got ${resDrift?.refusal}`);
  ok(resDrift?.modeB != null, 'drifting plant yields a second-half mode');
  const dDrift = resDrift && resDrift.modeB != null ? Math.abs(resDrift.modeB - resDrift.mode) : 0;
  ok(dDrift > BIN_MS, `a DRIFTING lag must break halves-invariance — got ${resDrift?.mode}→${resDrift?.modeB} (Δ${dDrift})`);
  /* Magnitude, not merely direction: a check that fired on any 11 ms wobble would pass here by luck
     and still be blind to the 80–160 ms the corpus actually shows. */
  ok(dDrift >= 80, `…and by the planted magnitude, not a wobble — expected ~160 ms, got Δ${dDrift}`);
  /* The verdict LABEL is what a consumer reads, so assert the escalation reaches it. */
  const vDrift = oracleVerdict(resDrift);
  ok(vDrift != null && /halves \d+→\d+ ⚠/.test(vDrift.label), `the drift must reach the verdict label, got ${vDrift?.label}`);
  /* ANTI-VACUITY: the constant plant above must still read ≡, or this pair proves nothing — a
     `halves` field stuck on ⚠ would satisfy the three assertions above and be just as useless. */
  ok(oracleVerdict(res)?.label.includes('halves ≡'), 'the CONSTANT plant must still read halves ≡ (else the check is stuck on)');

  /* ── NAMED REFUSALS: a refusing night must propagate its NAME, not a generic skip. ──
     The planted refusal is disjoint trains (feet 10^8 ms after the last R): structurally
     unscoreable, and the assertion is on the REASON STRING reaching the verdict layer — the
     silent-swallow class (#2047's 08-18) is precisely a real reason dying before the report. */
  const Ffar = R.map((r) => r + 1e8);
  const resFar = oracleNight(R, Ffar, 100);
  ok(
    resFar !== null && /^no overlap between the two trains \(R .* vs feet .*; disjoint by \d+ min\)$/.test(resFar.refusal || ''),
    `disjoint trains refuse BY NAME **with both extents and the gap**, got ${JSON.stringify(resFar)}`
  );
  const vFar = oracleVerdict(resFar);
  ok(
    vFar !== null && vFar.refused === true && vFar.tallyKey === 'REFUSED' && vFar.label.includes('no overlap between the two trains'),
    `the refusal NAME survives to the verdict line, got ${vFar?.label}`
  );
  const resShort = oracleNight(R.slice(0, 50), F.slice(0, 50), 100);
  ok(resShort !== null && /^too few beats \(r=50, f=50/.test(resShort.refusal || ''), `a short night names its counts, got ${JSON.stringify(resShort)}`);
  ok(resShort.mode === undefined && resShort.narrowSd === undefined, 'a refusal carries NO score fields a caller could mistakenly consume');

  /* ── Root-layout refusals (2026-09-02). Anti-vacuity: these four assertions cannot pass against
     the pre-fix tool, which exports no `rootLayoutVerdict` at all — verified by running this exact
     selftest against origin/main's copy before the fix landed. */
  /* 2026-09-22: a flat root is ACCEPTED AS SESSIONS, not refused. The assertion below used to
     require `ok === false`; it was changed deliberately with the decision (residue
     `2026-09-02-oracle-flat-root-policy`), not edited to match a regression. What must NOT weaken
     is the part #2106 bought: the mode says `sessions`, never `nights`, so no caller can tally a
     flat root as nights. */
  const vFlat = rootLayoutVerdict([], ['Polar_H10_02849638_20260627_235834_ECG.txt']);
  ok(
    vFlat.ok === true && vFlat.mode === 'sessions' && /NEVER[\s\S]*as nights/.test(vFlat.note) && /_ECG\.txt/.test(vFlat.note),
    `a flat root is accepted AS SESSIONS and says so, got ${JSON.stringify(vFlat)}`
  );
  ok(rootLayoutVerdict([], ['x_ECG.txt']).mode !== 'nights', 'PLANT: a flat root is never scored as nights');
  const vMixed = rootLayoutVerdict(['2026-07-24'], ['a_ECG.txt', 'b_PPG.txt']);
  ok(vMixed.ok === false && /MIXED layout/.test(vMixed.reason) && /silently drop/.test(vMixed.reason), `a MIXED root refuses rather than scoring the dirs, got ${JSON.stringify(vMixed)}`);
  ok(rootLayoutVerdict(['2026-07-24', '2026-08-17'], []).ok === true, 'a well-formed root passes');
  ok(rootLayoutVerdict([], []).ok === true, 'a genuinely empty root is NOT a layout refusal');
  ok(rootLayoutVerdict(['2026-07-24'], []).mode === 'nights', 'a root with night dirs and nothing loose stays in NIGHTS mode');

  /* ── sessionUnits: the flat-root grouper (2026-09-22) ─────────────────────────────────────────
     The session key is the recording's OWN token. The census in rootLayoutVerdict is why it cannot
     be a date: on the measured tree a raw-date key fuses 06-16's 01:06 tail with 06-17's 22:23
     start, and a noon-shift fuses six evening recordings with daytime ones. These plants pin the
     key at full YYYYMMDD_HHMMSS so a later reader cannot quietly truncate it to a date. */
  const flatFiles = [
    'Polar_H10_02849638_20260616_223000_ECG.txt',
    'Polar_Sense_0C301E3F_20260616_223004_PPG.txt',
    'Polar_H10_02849638_20260617_010615_ECG.txt',
    'Polar_Sense_0C301E3F_20260617_010620_PPG.txt',
    'Polar_H10_02849638_20260617_222300_ECG.txt',
    'README.txt'
  ];
  const su = sessionUnits(flatFiles);
  ok(su.units.length === 3 && su.unkeyed.length === 0, `one unit per keyed _ECG.txt, got ${su.units.length}/${su.unkeyed.length}`);
  ok(su.units.map((u) => u.key).join(',') === '20260616_223000,20260617_010615,20260617_222300', `keys are the full YYYYMMDD_HHMMSS token, in order, got ${su.units.map((u) => u.key).join(',')}`);
  /* PLANT — the whole point of the decision: the 01:06 tail of the 06-16 night and the 22:23 start
     of the 06-17 night share a DATE and must remain two units. A date key would fuse them. */
  const sameDate = su.units.filter((u) => u.key.startsWith('20260617'));
  ok(sameDate.length === 2, `two recordings on one calendar date stay two sessions, got ${sameDate.length}`);
  ok(
    su.units.every((u) => u.files.filter((f) => /_PPG\.txt$/.test(f)).length === 2),
    'every unit is offered EVERY loose PPG — pairing is pickPair\u2019s measured overlap, not a token join'
  );
  /* PLANT — an ECG whose name carries no token is reported, never dropped. */
  const noTok = sessionUnits(['weird_ECG.txt', 'a_20260617_010620_PPG.txt']);
  ok(noTok.units.length === 0 && noTok.unkeyed.length === 1, `an unkeyed _ECG.txt is reported, got ${JSON.stringify(noTok)}`);

  /* The SPLIT must travel with the result (2026-09-02). Without this, a consumer has no way to score
     the same half the mode was fitted against except by recomputing it — which is the defect that
     survived #2034 in two sibling tools for a week. Asserted on the success object AND on a refusal,
     because the consumers' guard is `orc.refusal` and a refusal carrying score-shaped fields would
     let a caller read a split that was never computed. */
  ok(
    Number.isFinite(res.lo) && Number.isFinite(res.mid) && Number.isFinite(res.hi) && res.lo <= res.mid && res.mid <= res.hi,
    `the overlap split travels with the result, got lo=${res?.lo} mid=${res?.mid} hi=${res?.hi}`
  );
  ok(resShort.lo === undefined && resShort.mid === undefined && resShort.hi === undefined, 'a refusal carries NO split fields — the refusal object stays field-free');

  /* pickPair is the SINGLE picker (2026-09-02). Four tools were choosing input files four ways;
     these assert the contract the callers rely on, since the failure mode of a shared helper is a
     caller quietly re-implementing it. The `missing` shape is asserted because it is the one thing
     that differed between the copies — each reported absence its own way, so the helper must RETURN
     the reason and never print it. */
  const vMissing = pickPair('/nowhere', ['only_ECG.txt']);
  ok(vMissing.missing !== undefined && /_PPG\.txt/.test(vMissing.missing) && vMissing.eF === undefined, `pickPair NAMES the absent stream and returns no pair, got ${JSON.stringify(vMissing)}`);
  const vNone = pickPair('/nowhere', []);
  ok(vNone.missing !== undefined && /_ECG\.txt/.test(vNone.missing), 'an empty directory names the ECG too');

  /* ── the run as ONE tepna.verdict/1 object (2026-09-22) ──────────────────────────────────────
     Every arm, because a status nobody has seen emitted is a status nobody has checked. The
     criterion is the tool's own BAND_RECOVERED, so these pin a mapping, never a new threshold. */
  {
    const V = createRequire(import.meta.url)(join(HERE, '..', 'verdict.js'));
    const arm = (t) => runVerdict(t);
    ok(arm({ 'SIGNAL RECOVERED': 3 }).status === 'PASS', 'every scored unit inside the band → PASS');
    ok(arm({ 'SIGNAL RECOVERED': 3 }).reason === null, 'a PASS carries no reason — a PASS that needs explaining is not one');
    ok(arm({ PARTIAL: 2 }).status === 'FAIL', 'no unit inside the band → FAIL');
    const sh = arm(sampleTally());
    ok(sh.status === 'SHORTFALL' && /2 of 3/.test(sh.reason), `a mixed corpus → SHORTFALL naming the sub-population, got ${sh.status}: ${sh.reason}`);
    ok(sh.population.checked + sh.population.excluded === sh.population.eligible, 'population is an EQUALITY, refusals excluded not averaged');
    ok(sh.population.excluded === 1, 'a named refusal is EXCLUDED, never folded into the data verdict');
    ok(arm({ REFUSED: 4 }).status === 'UNDERPOWERED', 'units offered and none scorable → UNDERPOWERED, not FAIL');
    ok(arm({}).status === 'NOT_RUN', 'no units at all → NOT_RUN, not an empty PASS');
    /* PLANT — the validator caught this on the NOT_RUN arm's first run, and it is pinned so the
       next edit cannot quietly attach a result to a verdict that examined nothing. */
    ok(arm({}).result === null, 'PLANT: NOT_RUN carries result null — nothing examined, nothing measured');
    ok(arm({ UNDEFINED: 1, 'SIGNAL RECOVERED': 1 }).status === 'UNKNOWN', 'an UNDEFINED band → UNKNOWN, never a quotable band');
    ok(V.validate(sh).ok && V.validate(arm({})).ok, 'every emitted arm validates under verdict.js');
  }

  const TOTAL = 45;
  console.log(fails.length ? `SELFTEST FAIL (${fails.length}/${TOTAL})\n  ${fails.join('\n  ')}` : `SELFTEST PASS (${TOTAL}/${TOTAL})`);
  return fails.length === 0;
}

/* ── Root layout: a root holding RECORDINGS but no night directories must REFUSE ──────────────
   `nights` below filters `readdirSync(DIR)` on /^2026-/, so a root whose recordings sit FLAT
   (`Polar_H10_<serial>_YYYYMMDD_HHMMSS_ECG.txt`) yields an empty night list, an empty TALLY and
   **exit 0** — the tool reporting success about a tree it never examined. Measured 2026-09-02 on
   `uploads/Ecg nightly`: 50 `_ECG.txt` present, `TALLY: {}`, exit 0. This brief's own status header
   already documented the identical shape one directory level up (`uploads/trio` -> `TALLY: {}`), so
   the warning existed as prose and the failure recurred anyway; hence a refusal in the tool.

   ⚠️ The MIXED case (loose recordings BESIDE night dirs) refuses too, and that is the more dangerous
   half: scoring the dirs and dropping the files yields a PLAUSIBLE tally over part of the tree,
   where the flat case at least yields an obviously empty one. Green-and-wrong beats red-and-blind
   only in the wrong direction. `uploads/Ecg nightly` is in fact mixed (3 subdirectories beside its
   flat files), so this is the live case, not a hypothetical.

   DECIDED 2026-09-22 (residue `2026-09-02-oracle-flat-root-policy`), by census rather than by
   argument: a flat root is ACCEPTED as **SESSIONS, and refused as nights**. Two measurements, both
   on the root this tool refuses (`.../uploads/Ecg nightly`, 50 flat `_ECG.txt`, 33 distinct date
   tokens; filename token vs each file's FIRST data row, `head -2` per file):

   (1) **The filename stamp is FAITHFUL here** — first row minus filename stamp: min 1 s, median
   2 s, **max 2 s**; 0 of 50 over 60 s; 0 whose filename date differs from its first-row date. The
   sibling finding on the BOX tree (`2026-09-22-capture-filename-stamp-disagrees-with-content`:
   39 files on 14 nights up to **18.7 h** out, 8 far enough to move the night key) therefore does
   NOT transfer — same token, opposite reliability, because PSL names the file at recording start
   on the same device that writes the timestamps and the capture daemon does not. This author came
   in carrying that box-tree objection; the census inverted it.

   (2) **But no DATE-derived key is a NIGHT key on this tree**, which is the real obstacle and the
   reason a later reader must not "improve" sessions into nights. 42 of 50 recordings are nocturnal
   (4 of them starting after midnight) and **8 are daytime** (08, 09, 09, 11, 12, 17, 18, 19 h).
     · raw date fuses TWO different nights under one key, twice:
       `2026-06-17` = 01:06 (tail of the 06-16 night) + 22:23 (start of the 06-17 night);
       `2026-06-20` = 02:52 + 03:08 + 03:16 (tail of 06-19) + 18:13 (daytime) + 22:44 + 22:55.
     · a noon-shift (start − 12 h) fixes those two and fuses an evening recording with a DAYTIME
       one in **six** other keys (06-11, 06-12, 06-13, 06-20, 07-04, 07-10).
   Each rule mis-assigns a different set; the night-DIRECTORY layout carries the grouping as data
   and a filename cannot reconstruct it.

   So the session key is the recording's own full `YYYYMMDD_HHMMSS` token — an IDENTIFIER, not a
   night — and the pairing stays `pickPair`'s measured temporal overlap. Nothing is fused, no
   cross-night overlap is manufactured, and 50 scorable recordings stop being refused for a
   grouping the filenames were never able to carry. The MIXED case still refuses: two conventions
   in one tree means a recording may be reachable twice, and a plausible partial tally is the more
   dangerous half. */
export function rootLayoutVerdict(nightDirs, looseRecordings) {
  if (looseRecordings.length === 0) return { ok: true, mode: 'nights' };
  const shown = looseRecordings.slice(0, 3).join(', ');
  const more = looseRecordings.length > 3 ? `, +${looseRecordings.length - 3} more` : '';
  if (nightDirs.length === 0)
    return {
      ok: true,
      mode: 'sessions',
      note:
        `flat root — ${looseRecordings.length} recording file(s) at depth 1, ZERO night directories ` +
        `(/^2026-/). Scored as SESSIONS keyed on each recording's own YYYYMMDD_HHMMSS token, NEVER ` +
        `as nights. Found loose: ${shown}${more}.`
    };
  return {
    ok: false,
    reason:
      `MIXED layout — ${nightDirs.length} night director(ies) BESIDE ${looseRecordings.length} ` +
      `recording file(s) at depth 1. Scoring the directories would silently drop the loose files ` +
      `and report a plausible tally over part of the tree. Found loose: ${shown}${more}.`
  };
}

/* ── THE RUN AS ONE tepna.verdict/1 OBJECT (docs/VERDICT-CONTRACT.md) ─────────────────────────
   The table above is the prose; this is the API. Nothing here invents a threshold: the criterion
   is the tool's OWN pre-stated band (`BAND_RECOVERED`, printed in the header of every run), and the
   status comes from how the checked population sits against it.

     PASS          every checked unit meets SD <= BAND_RECOVERED
     SHORTFALL     some meet it, some do not — the reason names the sub-population that missed
     FAIL          none meet it
     UNDERPOWERED  units were offered and NONE could be scored (all refused)
     NOT_RUN       no units at all — an empty root, not an empty result
     UNKNOWN       a unit scored to an UNDEFINED band: the instrument could not decide

   `population` is UNITS: `excluded` are the named refusals (`REFUSED`, `ARTIFACT REFUSAL`), which
   is why they have their own tally buckets in the first place — a refusal is not a data verdict and
   must not be averaged into one. PURE. */
export function runVerdict(tally, { commit = null, evidence = [] } = {}) {
  const Verdict = createRequire(import.meta.url)(join(HERE, '..', 'verdict.js'));
  const n = (k) => tally[k] || 0;
  const excluded = n('REFUSED') + n('ARTIFACT REFUSAL');
  const recovered = n('SIGNAL RECOVERED');
  const undef = n('UNDEFINED');
  const eligible = Object.values(tally).reduce((a, b) => a + b, 0);
  const checked = eligible - excluded;
  const missed = checked - recovered;
  let status;
  let reason;
  if (eligible === 0) {
    status = 'NOT_RUN';
    reason = 'no units — the root offered nothing to score';
  } else if (checked === 0) {
    status = 'UNDERPOWERED';
    reason = `all ${eligible} unit(s) refused before scoring (minimum to decide: 1 scored unit) — ${JSON.stringify(tally)}`;
  } else if (undef > 0) {
    status = 'UNKNOWN';
    reason = `${undef} of ${checked} scored unit(s) landed in the UNDEFINED band — the instrument could not decide`;
  } else if (missed === 0) {
    status = 'PASS';
    reason = null;
  } else if (recovered === 0) {
    status = 'FAIL';
    reason = `0 of ${checked} scored unit(s) reach SD <= ${BAND_RECOVERED} ms — ${JSON.stringify(tally)}`;
  } else {
    status = 'SHORTFALL';
    reason = `${recovered} of ${checked} scored unit(s) reach SD <= ${BAND_RECOVERED} ms; ${missed} did not — ${JSON.stringify(tally)}`;
  }
  const v = Verdict.make({
    gate: 'pat-window-oracle',
    status,
    scope: 'internal',
    population: { checked, eligible, excluded },
    criterion: { name: 'narrow_out_of_sample_sd_ms', threshold: BAND_RECOVERED, unit: 'ms', direction: 'lte' },
    /* NOT_RUN carries result: null by contract — nothing was examined, so nothing was measured.
       The validator caught this on the first run of the NOT_RUN arm; it is not a style choice. */
    result: status === 'NOT_RUN' ? null : { tally, recovered, scored: checked, refused: excluded },
    evidence: ['tools/pat-window-oracle.mjs', ...evidence],
    reason,
    producedBy: { tool: 'tools/pat-window-oracle.mjs', commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`pat-window-oracle: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
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
    return null; // \u00a7\u2205: not in a git tree is an ABSENCE; the verdict says so in commitReason
  }
}

/** The corpus-free sample the adoption gate runs: a mixed corpus — two recovered, one partial, one
 *  refused — which is the SHORTFALL arm, the one a real run most often lands in. */
export function sampleTally() {
  return { 'SIGNAL RECOVERED': 2, PARTIAL: 1, REFUSED: 1 };
}

/** Group a FLAT root's loose recordings into SESSIONS. PURE (names only, no fs).
 *  One unit per `_ECG.txt` carrying a `YYYYMMDD_HHMMSS` token, keyed on that token and offered
 *  EVERY loose `_PPG.txt` as a candidate — `pickPair` then chooses by measured temporal overlap,
 *  because the PPG's own token trails the ECG's by seconds (the streams start separately inside one
 *  PSL session: 4 s on 2026-06-10, 4 s on 06-11, 3 s on 06-12), so an exact-token join would pair
 *  nothing. An ECG with no token is REPORTED, never silently dropped — an unparseable name is an
 *  absence of a key, not an absence of a recording. */
export function sessionUnits(looseFiles) {
  const tok = (f) => (/_(\d{8}_\d{6})_(?:ECG|PPG)\.txt$/i.exec(f) || [])[1] || null;
  const ppg = looseFiles.filter((f) => /_PPG\.txt$/i.test(f)).sort();
  const units = [];
  const unkeyed = [];
  for (const f of looseFiles.filter((x) => /_ECG\.txt$/i.test(x)).sort()) {
    const k = tok(f);
    if (k === null) unkeyed.push(f);
    else units.push({ key: k, ecg: f, files: [f, ...ppg] });
  }
  units.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { units, unkeyed };
}

/* ── ONE PICKER, EXPORTED — three tools were choosing their input files three ways ────────────
   #2082 fixed this pairing inside `main()` and left `pat-residual-structure.mjs` and
   `pat-drift-attribution.mjs` each carrying their OWN copy of the pre-fix version: two independent
   size-sorts plus a `readFileSync(b).length` comparator that fully re-read every candidate
   O(n log n) times. Both copies were still live on main after #2082 and after #2111.

   **Three instances in one family is not three bugs, it is one absent abstraction.** Fixing the two
   copies would have been the THIRD correct fix of one defect while leaving the mechanism that
   produced copies 2 and 3 fully intact — the next tool needing a picker writes a fourth. So the
   picker is exported and imported; the pairing behaviour is merely what it carries.

   Returns `{ eF, pF }`, or `{ missing }` naming which stream is absent so the CALLER decides how to
   report it (the oracle tallies a named refusal, the analysis tools skip) — the one thing that
   differed between the copies, and the reason a shared helper must not report for its callers. */
export function pickPair(dir, files) {
  /* ── PAIR THE FRAGMENTS BY TIME, NOT BY SIZE (FOLLOWUPS §5 lead, inverted) ──────────────────
     This used to take the LARGEST `_ECG.txt` and the LARGEST Verity `_PPG.txt` in two INDEPENDENT
     size-sorts. On a fragmented night the two winners are from different hours, so the trains do
     not overlap and `oracleNight` refuses "no overlap between the two trains" — a TOOL artifact
     reported as a data verdict. Measured on the 48-night box tree: 15 nights refused that way, and
     EVERY one has an overlapping pair available (2026-08-28: largest-pair 0.00 h, best-pair
     6.31 h; 08-16: 0.00 vs 6.02 across 237 PPG fragments). #2052 made those refusals visible and I
     then filed them as a capture-session fact; they were this function.

     So: choose the (ECG, PPG) pair with the greatest temporal OVERLAP. Spans come from the first
     and last timestamp in each file — an 8 KB read at each end, never a parse.

     ⚠️ NOT concatenating fragments per stream: a concatenated train spans the inter-fragment gaps
     and a lag computed across a gap is meaningless. Per-pair scoring is the honest shape;
     gap-aware segmentation would be its own unit.
     ⚠️ A night whose best pair is genuinely 0 still refuses by the same name — the fix removes the
     artifact, not the refusal. And it cannot manufacture beats: 2026-08-20's best pair is 0.04 h
     (~140 R at 60 bpm) and is expected to refuse on the ≥200-in-overlap bar instead, which is a
     different and defensible reason. */
  const fragSpan = (p) => {
    try {
      const sz = statSync(p).size;
      if (!sz) return null;
      const fd = openSync(p, 'r');
      const CH = 8192;
      const head = Buffer.alloc(Math.min(CH, sz));
      readSync(fd, head, 0, head.length, 0);
      const tail = Buffer.alloc(Math.min(CH, sz));
      readSync(fd, tail, 0, tail.length, Math.max(0, sz - tail.length));
      closeSync(fd);
      const stamp = (s) => {
        const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
      };
      const hs = head
        .toString('latin1')
        .split('\n')
        .filter((l) => /\d{4}-\d{2}-\d{2}/.test(l));
      const ts = tail
        .toString('latin1')
        .split('\n')
        .filter((l) => /\d{4}-\d{2}-\d{2}/.test(l));
      if (!hs.length || !ts.length) return null;
      const a = stamp(hs[0]);
      const b = stamp(ts[ts.length - 1]);
      return a != null && b != null && b >= a ? { path: p, a, b, size: sz } : null;
    } catch {
      return null;
    }
  };
  /* `statSync(p).size`, not `readFileSync(p).length`: the old comparator FULLY READ every candidate
     O(n log n) times just to learn its length — 237 PPG fragments on 2026-08-16, read repeatedly. */
  const cands = (re) =>
    files
      .filter((f) => re.test(f))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(b).size - statSync(a).size);
  const eC = cands(/_ECG\.txt$/);
  // Verity-first preference preserved exactly: fall back to any _PPG.txt only when no Verity exists.
  const pC = cands(/Verity.*_PPG\.txt$/i).length ? cands(/Verity.*_PPG\.txt$/i) : cands(/_PPG\.txt$/);
  if (!eC.length || !pC.length)
    return {
      missing: `missing ${eC.length ? '' : '_ECG.txt'}${!eC.length && !pC.length ? ' and ' : ''}${pC.length ? '' : '_PPG.txt'}`
    };
  /* Default: the largest of each, i.e. exactly today's choice — so a single-fragment night, and a
     night whose spans cannot be read, are byte-identical to the old behaviour. */
  let eF = eC[0];
  let pF = pC[0];
  if (eC.length > 1 || pC.length > 1) {
    const eS = eC.map(fragSpan).filter(Boolean);
    const pS = pC.map(fragSpan).filter(Boolean);
    let bestOv = 0; // only a POSITIVE overlap displaces the default
    let bestSize = -1;
    for (const e of eS) {
      for (const p of pS) {
        const ov = Math.min(e.b, p.b) - Math.max(e.a, p.a);
        const size = e.size + p.size;
        // strictly greater overlap wins; equal overlap breaks on combined size, so the pick is
        // deterministic across runs and independent of readdir order
        if (ov > bestOv || (ov === bestOv && ov > 0 && size > bestSize)) {
          bestOv = ov;
          bestSize = size;
          eF = e.path;
          pF = p.path;
        }
      }
    }
  }
  return { eF, pF };
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
  /* Sub-sample R times (`ECGDSP.refinePeaks`) on the ECG leg — ON by default since 2026-09-21, to match
     the shipped `pat-feasibility-worker.js` (#2487). Measured paired over 58 scored box nights: 20 modes
     move (18 by exactly one 10-ms bin, the 7.7 ms whole-sample quantisation), 2 verdicts flip, and the
     two pre-registered invariant nights hold (07-24 405→405, 08-17 215→215). `--no-ecg-refine`
     reproduces every number published before that date. PAT-FORENSICS-AXIS-LEG-ASYMMETRY, last box. */
  const REFINE = !argv.includes('--no-ecg-refine');
  /* `--search-max` varies the interval the MODE IS SEARCHED IN — not `--half-width`, which is the band
     drawn AROUND the mode and is what §4a already swept. The two are independent and only the second
     has ever been varied. `--json` emits the per-night record including `modeN`, the null's own mode,
     which the human table does not print and which is the only way to ask whether a circularly-shifted
     train reaches PHYS as readily as a real one. */
  const SMAX = Number(argv.includes('--search-max') ? argv[argv.indexOf('--search-max') + 1] : MODE_SEARCH_MAX);
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(runVerdict(sampleTally(), { commit: gitCommitShort(), evidence: ['<sample>'] }), null, 2));
    return;
  }
  const JSON_OUT = argv.includes('--json');
  const jsonRows = [];
  if (!DIR || !existsSync(DIR) || !['foot', 'cfd', 'half'].includes(FID) || !['linear', 'piecewise'].includes(AXIS)) {
    console.error('usage: node tools/pat-window-oracle.mjs --selftest | --dir <captures root> [--half-width 100] [--fiducial foot|cfd|half] [--ecg-axis linear|piecewise] [--no-ecg-refine]');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  getDsps();
  const entries = readdirSync(DIR);
  const nights = entries.filter((n) => /^2026-/.test(n)).sort();
  /* Refuse a root whose recordings sit outside night directories — see rootLayoutVerdict. */
  const loose = entries.filter((e) => /_(ECG|PPG)\.txt$/i.test(e) && statSync(join(DIR, e)).isFile());
  const layout = rootLayoutVerdict(nights, loose);
  if (!layout.ok) {
    console.error(`\u26d4 REFUSED (${DIR}): ${layout.reason}`);
    process.exit(3);
  }
  console.log(
    `half-width ±${HW} ms · fiducial ${FID} · ecg-axis ${AXIS}${REFINE ? '+refine' : ' (whole-sample R)'} · mode search 0–${MODE_SEARCH_MAX} ms · bands: <=${BAND_RECOVERED} RECOVERED, <${BAND_PARTIAL} PARTIAL, else NO RECOVERY; null must be beaten\n`
  );
  /* A SESSION IS NOT A NIGHT, and the output must not let a reader spend it as one: the banner
     says so, the column is headed `session`, and the JSON row carries `session` instead of
     `night`. See rootLayoutVerdict's census for why no date-derived night key exists here. */
  const SESSIONS = layout.mode === 'sessions';
  if (SESSIONS) console.log(`\u26a0 SESSIONS MODE \u2014 ${layout.note}`);
  console.log(`${SESSIONS ? 'session' : 'night  '}      mode    n     narrowSD    fullSD     nullSD   verdict`);
  const tally = {};
  /* EVERY skip path is NAMED and TALLIED. The bare `continue`s this replaces are the silent-swallow
     class in this tool's own report: a refusal eaten by a catch (2026-08-18's 8.6 s mid-file step
     vanished from H_axis P2's first run, #2047), a missing-file night that never printed at all, and
     one fixed "too few beats" line covering five different oracleNight causes. A corpus line count
     that doesn't reconcile with the directory count is a filter nobody stated. */
  const refuse = (n, reason) => {
    console.log(`${n}  ⊘ REFUSED — ${reason}`);
    tally.REFUSED = (tally.REFUSED || 0) + 1;
  };
  /* One iteration list for both layouts: a night unit reads its directory, a session unit carries
     its own file list (its ECG plus every loose PPG, paired by overlap below). */
  let units;
  if (SESSIONS) {
    const g = sessionUnits(loose);
    for (const f of g.unkeyed) refuse(f, 'loose _ECG.txt with no YYYYMMDD_HHMMSS token \u2014 no session key');
    units = g.units.map((u) => ({ label: u.key, dir: DIR, files: u.files }));
  } else {
    units = nights.map((n) => ({ label: n, dir: join(DIR, n), files: null }));
  }
  for (const u of units) {
    const n = u.label;
    const dir = u.dir;
    let files = u.files;
    if (files === null) {
      try {
        files = readdirSync(dir);
      } catch (e) {
        refuse(n, `unreadable night dir (${String(e.message).slice(0, 60)})`);
        continue;
      }
    }
    const paired = pickPair(dir, files);
    if (paired.missing) {
      refuse(n, paired.missing);
      continue;
    }
    const { eF, pF } = paired;
    let E;
    let P;
    try {
      E = ecgRpeakTimes(readFileSync(eF, 'utf8'), { axis: AXIS === 'piecewise' ? 'piecewise' : undefined, refine: REFINE });
      P = ppgFootTimes(readFileSync(pF, 'utf8'));
    } catch (e) {
      /* The catch cannot narrow WHAT the parse/transform layer throws (it is another module's
         surface), so it narrows what it is allowed to DO with it: name the night, quote the message,
         count it. Under --ecg-axis piecewise this is additionally a P2 denominator exclusion (e.g.
         the sortedness assertion on a large mid-file step), which the wording preserves. */
      refuse(n, `${AXIS === 'piecewise' ? 'piecewise-axis exclusion: ' : ''}${String(e.message).slice(0, 70)}`);
      continue;
    }
    if (AXIS === 'piecewise' && !E.tMsCorrected) {
      refuse(n, `piecewise axis refused (tMsCorrected=false, independent=${E.independent}) — excluded from the P2 denominator`);
      continue;
    }
    const train = FID === 'foot' ? P.times : FID === 'cfd' ? P.cfdTimes : P.halfTimes;
    const fTimes = Array.from(train).filter(Number.isFinite);
    const res = oracleNight(Array.from(E.times), fTimes, HW, SMAX);
    const v = oracleVerdict(res);
    if (v.refused && v.tallyKey === 'REFUSED') {
      refuse(n, res.refusal);
      continue;
    }
    tally[v.tallyKey] = (tally[v.tallyKey] || 0) + 1;
    if (JSON_OUT)
      jsonRows.push({
        [SESSIONS ? 'session' : 'night']: n,
        searchMax: SMAX,
        mode: res.mode ?? null,
        modeB: res.modeB ?? null,
        modeN: res.modeN ?? null,
        modeInPhys: res.modeInPhys ?? null,
        modeNInPhys: res.modeNInPhys ?? null,
        narrowSd: res.narrowSd ?? null,
        nullSd: res.nullSd ?? null,
        verdict: v.tallyKey,
        refused: v.refused
      });
    /* maxStepMs beside every piecewise row (frozen condition c): a mid-file step smears across one
       anchor gap under piecewise and can itself move a half-mode — discovered here, not post-hoc. */
    const axisNote = AXIS === 'piecewise' ? `  [maxStep ${E.maxStepMs == null ? 'n/a' : E.maxStepMs.toFixed(0) + ' ms'}]` : '';
    console.log(
      `${n}  ${res.mode.toFixed(0).padStart(5)}  ${String(res.narrowN).padStart(5)}  ${res.narrowSd.toFixed(1).padStart(8)}  ${res.fullSd.toFixed(1).padStart(8)}  ${res.nullSd.toFixed(1).padStart(8)}   ${v.label}${axisNote}`
    );
  }
  console.log('\nTALLY:', JSON.stringify(tally));
  /* One object beside the prose — the reader above is a human, this one is a machine. */
  console.log('VERDICT ' + JSON.stringify(runVerdict(tally, { commit: gitCommitShort(), evidence: [DIR] })));
  if (JSON_OUT) console.log('JSONROWS ' + JSON.stringify({ searchMax: SMAX, rows: jsonRows }));
}

if (process.argv[1]?.endsWith('pat-window-oracle.mjs')) await main();
