#!/usr/bin/env node
/*
 * tools/o2ring-dat-timefit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * PIN THE O2RING'S STORED-SESSION CLOCK TO HOST TIME by fitting the onboard .dat against the live
 * SPO2.csv — the SAME 1 Hz session from the SAME ring, one stored, one delivered live and host-stamped.
 *
 * WHY. The live SPO2.csv arrives host-stamped (its rows carry the phone arrival time); the onboard .dat
 * is stamped only by the ring's free-running RTC (measured ~+151 s drift, resets on any battery event —
 * oxyii.set_time_frame). Both record SpO2/pulse/motion at 1 Hz, so the SpO2 series is a shared fingerprint.
 * Cross-correlate → the integer-second offset that aligns them IS `dat_clock − live_clock`; the live side
 * is already host time, so the offset transfers HOST TIME onto every stored session.
 *
 * A RULER at 1 Hz: the ceiling is ±1 s (the .dat is second-quantised), 50x coarser than the tap/buzz
 * marker — but it is AUTOMATIC, RETROSPECTIVE, needs no hardware, and runs on every night on disk. It also
 * VALIDATES the 0xC0 time-push (does the RTC write land? how far does it drift per night?) which nothing
 * else measures.
 *
 * .dat layout (framing per trio-batch.mjs; values decoded here, physiology-verified 2026-08-19):
 *   10-byte header · 3-byte records [spo2, pulse, motion] at 1 Hz · 0xFF 0xFF trailer.
 * SpO2 93-99, pulse 54-82, motion 0-5 on a real night — the byte roles are unambiguous from their ranges.
 *
 * Usage: node tools/o2ring-dat-timefit.mjs --dat <_STORED.dat> --spo2 <_SPO2.csv> [--maxlag 600]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Decode the onboard .dat → per-second [{spo2,pr,motion}]. PURE-ish (reads a path). */
export function readDat(path) {
  const b = fs.readFileSync(path);
  const out = [];
  for (let off = 10; off + 2 < b.length; off += 3) {
    if (b[off] === 0xff && b[off + 1] === 0xff) break;
    out.push({ spo2: b[off], pr: b[off + 1], motion: b[off + 2] });
  }
  return out;
}

/** Parse the ViHealth SPO2.csv → [{tMs, spo2, pr, motion}]. Time col is `HH:MM:SS DD/MM/YYYY` local. */
export function readSpo2Csv(path) {
  const L = fs.readFileSync(path, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const ln = L[i];
    if (!ln || ln.startsWith('Time') || ln[0] === '#') continue;
    const p = ln.split(',');
    if (p.length < 3) continue;
    const m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(p[0]);
    if (!m) continue;
    // Clock Contract §5: components verbatim → Date.UTC (floating wall clock), read back with getUTC*.
    const tMs = Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1], +m[2], +m[3]);
    const spo2 = Number(p[1]);
    out.push({ tMs, spo2: Number.isFinite(spo2) ? spo2 : null, pr: Number(p[2]) });
  }
  return out;
}

/** Integer-second lag that best aligns two 1 Hz series (by minimum SAD over the overlap). Generic over
 *  the matched column — SpO2 OR pulse; both slide the same way. PURE. */
export function bestLag(datSpo2, csvSpo2, maxLag) {
  // both are 1 Hz; index k of each is one second. Slide the .dat against the csv.
  let best = Infinity,
    bestK = 0,
    bestN = 0;
  for (let k = -maxLag; k <= maxLag; k++) {
    let sad = 0,
      n = 0;
    for (let i = 0; i < csvSpo2.length; i++) {
      const j = i + k;
      if (j < 0 || j >= datSpo2.length) continue;
      const a = csvSpo2[i],
        d = datSpo2[j];
      if (a == null || d == null || a <= 0 || d <= 0) continue;
      sad += Math.abs(a - d);
      n++;
    }
    if (n < 60) continue; // need at least a minute of overlap to trust a lag
    const mean = sad / n;
    if (mean < best) {
      best = mean;
      bestK = k;
      bestN = n;
    }
  }
  /* 🔴 A WINNER AT ±maxLag IS AN UNCONVERGED SEARCH, NOT A LAG. The scan reports the argmin over a
     BOUNDED window, so a minimum sitting exactly on an edge means the real one is outside it and the
     number is the window's, not the clock's. This repo has already paid for that shape once:
     EXTERNAL-METHODS-SURVEY §2 diagnosed the aperiodic aligner by exactly this tell — "the peak
     riding the search boundary (3850 ms at ±4 s → 5750 at ±6 s → 9000 at ±9 s), what an argmax of
     noise does". Measured here 2026-08-23 on a real pair: the pulse column returned lagS = 600 with
     maxLag = 600 — reported as a fit, and consumed as one.
     `atBoundary` is returned rather than the fit suppressed, because widening `maxLag` is a
     legitimate response and the caller needs to know that is the remedy. */
  if (!Number.isFinite(best)) return null;
  return { lagS: bestK, meanAbsErr: best, n: bestN, atBoundary: Math.abs(bestK) === maxLag };
}

/* AGREEMENT TOLERANCE — MEASURED, not assumed. The default was 1 s, and 1 s is unreachable: across
   48 real .dat/SPO2 pairs from the corpus (2026-08-23) it accepts only 22 of 37 genuine matches, so
   `converged` failed on 41 % of sessions that plainly ARE the same session.

   Derived from the distribution of |spo2Lag − pulseLag| on pairs that are demonstrably one session.
   The pre-stated rule was "cover ~95 % of same-session pairs" — what changed after the run was the
   OPERATIONAL DEFINITION of same-session, and this file predicted the change before it was made:

     filtering on SPO2 error   — spo2Err < 0.5 (n=19) still admits a 13626 s disagreement, p95 = 173
     filtering on PULSE error  — pulseErr < 1.0 (n=26) admits a maximum of 8 s

   Three orders of magnitude, for the reason the docstring below already gave: SpO2 is a narrow-range
   integer that barely moves overnight, so a low mean-abs-error is cheap at many lags. Pulse is the
   confirming column, and using it as the same-session test is following this file's own reasoning,
   not fitting to the outcome.

   8 s is the OBSERVED CEILING, stable across three independent cutoffs that select different subsets
   (pulseErr < 0.5 / 0.8 / 1.0 all cap at 8), and it covers 95 % at the loosest band. It is not the
   value that maximises convergence — 20 s and 30 s both score higher — which is exactly why it is
   the one to take. */
export const AGREE_TOL_S = 8;

/** Does the FITTED lag disagree with the offset the ring REPORTS? PURE.
 *  FINISHED-WORK §B4's cross-check: `rtclog`'s readback is what the ring SAYS its clock is off by;
 *  the fit is what its stored data SHOWS. Two independent measurements of one quantity, so they can
 *  check each other — and a disagreement is the finding, never something to average away.
 *
 *  The allowance is ±1 s (the .dat is second-quantised, so the fit cannot resolve finer) plus the
 *  drift the readback itself observed across the night — the readback is a point measurement and the
 *  session is not, so the clock legitimately moved between them by about that much.
 *
 *  Returns null when there is nothing to compare, which is NOT agreement: a night with no `_rtclog.csv`
 *  has one measurement, not two, and must never read as corroborated. */
export function timefitDisagrees(lagS, reportedOffsetS, driftS) {
  if (!Number.isFinite(lagS) || !Number.isFinite(reportedOffsetS)) return null;
  const allowance = 1 + (Number.isFinite(driftS) ? Math.abs(driftS) : 0);
  return Math.abs(lagS - reportedOffsetS) > allowance;
}

/** Do two independent fits agree to within `tol` seconds? null if either fit is missing. PURE.
 *  SpO2 is a coarse 1%-integer observable; pulse (bpm) is finer, so an agreeing pulse lag CONFIRMS the
 *  SpO2 lag with a sharper column — and a disagreement means one of the two fits is spurious. */
export function lagsAgree(a, b, tol = AGREE_TOL_S) {
  if (!a || !b) return null;
  return Math.abs(a.lagS - b.lagS) <= tol;
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    if (c) {
      pass++;
      console.log(`  ok   ${nm}`);
    } else {
      fail++;
      console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`);
    }
  };
  // a synthetic SpO2 walk, then the "dat" is the same series shifted by a KNOWN lag → recover it.
  const base = [];
  let v = 97;
  for (let i = 0; i < 1200; i++) {
    v += i % 7 === 0 ? -1 : i % 11 === 0 ? 1 : 0;
    v = Math.max(90, Math.min(99, v));
    base.push(v);
  }
  const LAG = 37;
  const dat = new Array(LAG).fill(97).concat(base); // dat leads csv by 37 s
  const r = bestLag(dat, base, 120);
  ok('recovers a planted +37 s lag', r.lagS === LAG, `got ${r.lagS}`);
  ok('a perfect match has ~0 error', r.meanAbsErr < 0.01, `err ${r.meanAbsErr}`);
  // a DIFFERENT lag is recovered (not hard-coded)
  const dat2 = new Array(10).fill(97).concat(base);
  ok('recovers a different lag (+10)', bestLag(dat2, base, 120).lagS === 10);
  // no overlap → refuse
  ok('too little overlap refuses', bestLag([97, 97], base, 5) === null);
  // dropouts (0/null) are skipped, not matched as equal
  const withGap = base.slice();
  for (let i = 100; i < 300; i++) withGap[i] = 0;
  ok('zero-SpO2 dropouts do not fake a match', bestLag(new Array(LAG).fill(97).concat(withGap), base, 120).lagS === LAG);
  // the SAME machinery on a PULSE-like series (50–80 bpm) recovers a planted lag — pulse is a valid column
  const pbase = [];
  let pr = 62;
  for (let i = 0; i < 1200; i++) {
    pr += i % 5 === 0 ? -1 : i % 8 === 0 ? 2 : 0;
    pr = Math.max(50, Math.min(80, pr));
    pbase.push(pr);
  }
  const pdat = new Array(23).fill(62).concat(pbase);
  ok('pulse series recovers a planted +23 s lag', bestLag(pdat, pbase, 120)?.lagS === 23);
  // the SpO2↔pulse cross-check
  ok('agreeing lags → true', lagsAgree({ lagS: 37 }, { lagS: 37 }) === true);
  ok('lags within tol agree', lagsAgree({ lagS: 37 }, { lagS: 38 }) === true);
  ok('disagreeing lags → false', lagsAgree({ lagS: 37 }, { lagS: 50 }) === false);
  ok('a missing fit → null (not a false agreement)', lagsAgree(null, { lagS: 37 }) === null);
  /* FINISHED-WORK-IMPROVEMENTS §B4 (2026-08-23) — machine-readable summary. */
  const fakeDat = new Array(37).fill({ spo2: 97, pr: 62, motion: 0 }).concat(Array.from({ length: 600 }, (_, i) => ({ spo2: 95 + ((i * 7) % 5), pr: 60 + ((i * 3) % 8), motion: 0 })));
  const fakeCsv = Array.from({ length: 600 }, (_, i) => ({ tMs: 1000000 + i * 1000, spo2: 95 + ((i * 7) % 5), pr: 60 + ((i * 3) % 8) }));
  const jf = fitDatToSpo2Csv({ dat: fakeDat, csv: fakeCsv, maxLag: 120 });
  ok('fitDatToSpo2Csv returns ok=true on a fittable pair', jf.ok === true, JSON.stringify(jf));
  ok('…and recovers the planted lag on the chosen column', jf.chosen && jf.chosen.lagS === 37, 'chosen.lagS=' + (jf.chosen && jf.chosen.lagS));
  ok('…and datStartHostMs = anchor − chosenLag·1000', jf.datStartHostMs === 1000000 - 37 * 1000, 'got ' + jf.datStartHostMs);
  ok('…and the two-column agree flag is honoured on a real match', jf.agree === true);
  const empty = fitDatToSpo2Csv({ dat: [], csv: [], maxLag: 120 });
  ok('an empty pair returns ok=false with a reason', empty.ok === false && typeof empty.reason === 'string', JSON.stringify(empty));
  ok('…and no fabricated chosen/anchor', empty.chosen == null && empty.anchorMs == null && empty.datStartHostMs == null);

  /* ── THE BOUNDARY GUARD ─────────────────────────────────────────────────────────────────────
     Two ramps that share no common lag inside the window: the minimum is forced to an edge, which
     is the shape a bounded argmin produces when the answer is not in range. Without the guard this
     returned lagS = ±maxLag and was consumed as a measured lag. */
  /* ⚠️ APERIODIC ON PURPOSE. A repeating series has MANY equal minima, so the scan returns whichever
     it meets first and the interior control fails for a reason that has nothing to do with the guard
     — measured while writing this: a period-7 ramp put the "interior" answer at lagS = −196. That is
     the comb degeneracy `PAT-NO-VALID-ANCHOR` §10 recorded, reproduced in miniature. */
  const wobble = (n, phase) => Array.from({ length: n }, (_, i) => 90 + Math.round(4 * Math.sin((i + phase) / 13) + 3 * Math.sin((i + phase) / 41)));
  const farA = wobble(400, 0);
  const farB = wobble(400, 137);
  const pinned = bestLag(farA, farB, 2);
  ok('a lag pinned to the window edge is FLAGGED, not reported as a fit', pinned == null || pinned.atBoundary === true, `lagS=${pinned && pinned.lagS} maxLag=2`);
  const interior = bestLag(farA, farA, 200);
  ok('…while a genuine interior minimum is not flagged', interior && interior.atBoundary === false && interior.lagS === 0, `lagS=${interior && interior.lagS}`);
  /* Both columns pinned ⇒ the fit REFUSES rather than handing back an edge value, and says that
     widening the window is the remedy. A caller that received lagS=±maxLag could not tell the
     difference between "the clocks are that far apart" and "the search ran out of room". */
  const bothPinned = fitDatToSpo2Csv({
    dat: farA.map((v, i) => ({ spo2: v, pr: v - 30, motion: 0 })),
    csv: farB.map((v, i) => ({ spo2: v, pr: v - 30, tMs: 1e12 + i * 1000 })),
    maxLag: 2
  });
  ok('both columns pinned ⇒ ok=false, with widening named as the remedy', bothPinned.ok === false && /maxlag/i.test(bothPinned.reason || ''), bothPinned.reason);
  ok('…and nothing is fabricated on that refusal', bothPinned.chosen == null && bothPinned.datStartHostMs == null);
  /* `ok` and `converged` must be able to DISAGREE, or the new flag carries no information. One leg
     pinned, the other interior: a fit is still chosen (ok) but it is single-legged (not converged). */
  const oneLeg = fitDatToSpo2Csv({
    dat: farA.map((v) => ({ spo2: v, pr: 60, motion: 0 })),
    csv: farA.map((v, i) => ({ spo2: v, pr: 60, tMs: 1e12 + i * 1000 })),
    maxLag: 200
  });
  ok('a flat pulse column cannot confirm ⇒ ok without converged', oneLeg.ok === true && oneLeg.converged === false, `ok=${oneLeg.ok} converged=${oneLeg.converged}`);
  const twoLeg = fitDatToSpo2Csv({
    dat: farA.map((v) => ({ spo2: v, pr: v - 30, motion: 0 })),
    csv: farA.map((v, i) => ({ spo2: v, pr: v - 30, tMs: 1e12 + i * 1000 })),
    maxLag: 200
  });
  ok('two independent interior legs that agree ⇒ CONVERGED', twoLeg.ok === true && twoLeg.converged === true, `converged=${twoLeg.converged} agree=${twoLeg.agree}`);
  /* The tolerance must still be able to REJECT, or `converged` becomes a synonym for `ok`. 8 s was
     measured as the ceiling of genuine same-session disagreement; a lag off by more than that is a
     different session, and must not be confirmed. */
  ok('the agreement tolerance is the measured 8 s', AGREE_TOL_S === 8);
  ok('…and a disagreement beyond it is REJECTED', lagsAgree({ lagS: 100 }, { lagS: 100 + AGREE_TOL_S + 1 }) === false);
  ok('…while one at the ceiling is accepted', lagsAgree({ lagS: 100 }, { lagS: 100 + AGREE_TOL_S }) === true);
  /* The old default of 1 s is what this replaced: it rejected 15 of 37 real same-session pairs. Pin
     that the new default is genuinely looser, so a silent revert to 1 fails here rather than in a
     downstream hook that quietly stops recording fits. */
  ok('the 6 s real-corpus pair (2026-07-19) now agrees, and would NOT have at tol 1', lagsAgree({ lagS: 6758 }, { lagS: 6764 }) === true && lagsAgree({ lagS: 6758 }, { lagS: 6764 }, 1) === false);

  /* ── THE §B4 CROSS-CHECK ─────────────────────────────────────────────────────────────────────
     Gated HERE because it cannot be exercised where it is consumed: no night in the local corpus
     carries a `_rtclog.csv`, so `trio-batch`'s `reportedOffsetS` is null on every night on this
     machine and the comparison branch never runs. Those sidecars live on the capture box. Untested
     arithmetic behind an unreachable branch is exactly what this repo keeps finding, so the logic is
     pure, exported, and asserted against planted values instead. */
  ok('a fitted lag matching the readback does NOT disagree', timefitDisagrees(-9, -9, 0) === false);
  ok('…and one 2 s off with no drift DOES', timefitDisagrees(-9, -11, 0) === true);
  ok('the observed drift widens the allowance', timefitDisagrees(-9, -11, 5) === false, 'allowance 1+5 = 6 s');
  ok('…but not without limit', timefitDisagrees(-9, -30, 5) === true);
  /* NULL IS NOT AGREEMENT. A night with no readback has ONE measurement, not two corroborating
     ones, and a consumer that renders `disagrees === false` as "confirmed" would be inventing a
     second opinion out of an absence — the fabricated-green shape §B1 was raised for. */
  ok('no readback ⇒ null, never false', timefitDisagrees(-9, null, 0) === null);
  ok('no fit ⇒ null, never false', timefitDisagrees(null, -9, 0) === null);

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

/* FINISHED-WORK-IMPROVEMENTS §B4 (2026-08-23) — the tool's HEADER claimed it *"runs on every night on
   disk"* while nothing invoked it; downstream hooks (`nightqc` beside the RTC digest, trio-batch beside
   the arrival sidecar) need a machine-readable summary, not the human-readable console dump.
   `fitDatToSpo2Csv({dat, csv, maxLag}) → { spo2, pulse, agree, chosen, anchorMs, datStartHostMs, ok, reason }`
   is a PURE-ish function over parsed inputs (paths are handled by callers via readDat/readSpo2Csv, so this
   sits atop the same primitives without new I/O). `ok` is true only when a fit was recovered; on refusal
   `reason` names why. `--json` on the CLI serialises this shape and skips the human render. */
export function fitDatToSpo2Csv({ dat, csv, maxLag = 600 }) {
  const spo2 = bestLag(
    dat.map((x) => x.spo2),
    csv.map((x) => x.spo2),
    maxLag
  );
  const pulse = bestLag(
    dat.map((x) => x.pr),
    csv.map((x) => x.pr),
    maxLag
  );
  if (!spo2 && !pulse) {
    return { ok: false, converged: false, reason: 'no lag with enough overlap — same session?', spo2: null, pulse: null, agree: null, chosen: null, anchorMs: null, datStartHostMs: null };
  }
  /* An unconverged leg must not be SELECTED, and must not be allowed to cast an agreement vote —
     two legs both pinned to the same boundary would "agree" to 0 s and read as a confirmed fit.
     A boundary leg is therefore dropped from selection entirely; if both are pinned there is no fit
     to report and the caller is told to widen the window rather than handed the edge value. */
  const okSpo2 = spo2 && !spo2.atBoundary ? spo2 : null;
  const okPulse = pulse && !pulse.atBoundary ? pulse : null;
  if (!okSpo2 && !okPulse) {
    return {
      ok: false,
      converged: false,
      reason: `both columns' best lag sits at ±maxLag (${maxLag} s) — the search did not converge; widen --maxlag or the sessions do not overlap`,
      spo2,
      pulse,
      agree: null,
      chosen: null,
      anchorMs: null,
      datStartHostMs: null
    };
  }
  const agree = lagsAgree(okSpo2, okPulse);
  const chosen = okPulse && (agree === true || !okSpo2) ? okPulse : okSpo2;
  const anchorMs = csv.length ? csv[0].tMs : null;
  const datStartHostMs = anchorMs != null && chosen ? anchorMs - chosen.lagS * 1000 : null;
  /* 🔴 `ok` IS NOT `converged`, AND A CONSUMER MUST BRANCH ON THE SECOND ONE. Dropping a boundary
     leg stops a fabricated value being selected; it does NOT establish that the surviving leg found
     the right minimum. Measured 2026-08-23 on a real pair: at maxLag 600 the pulse leg is pinned and
     SpO2 survives at 400 s; widen to 3600 and SpO2 is pinned while pulse survives at 3581 s. Both
     pass `ok`, and they disagree by 3181 s — the answer tracking the search width, which is the tell
     EXTERNAL-METHODS-SURVEY §2 used to void an entire alignment result.
     CONVERGED therefore demands what a single leg cannot supply: two independent columns, both
     strictly inside the window, agreeing. That is the condition a downstream hook should require
     before recording a fit as a clock measurement. */
  const converged = !!(okSpo2 && okPulse && agree === true);
  return {
    ok: !!chosen,
    converged,
    reason: chosen ? null : 'neither column yielded a fit',
    spo2,
    pulse,
    agree,
    chosen,
    anchorMs,
    datStartHostMs
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const datP = arg('--dat'),
    csvP = arg('--spo2');
  if (!datP || !csvP) {
    console.log('usage: --dat <_STORED.dat> --spo2 <_SPO2.csv>');
    process.exit(2);
  }
  const maxLag = Number(arg('--maxlag') || 600);
  const dat = readDat(datP),
    csv = readSpo2Csv(csvP);
  const fit = fitDatToSpo2Csv({ dat, csv, maxLag });
  if (process.argv.includes('--json')) {
    // Callers (nightqc's RTC digest hook, a trio-batch enrichment pass) parse this shape directly.
    // The two input sizes travel too so a caller can flag "session too short" without re-decoding.
    process.stdout.write(
      JSON.stringify({
        ok: fit.ok,
        converged: fit.converged,
        reason: fit.reason,
        datSec: dat.length,
        csvSec: csv.length,
        spo2: fit.spo2,
        pulse: fit.pulse,
        agree: fit.agree,
        chosenLagS: fit.chosen ? fit.chosen.lagS : null,
        anchorMs: fit.anchorMs,
        datStartHostMs: fit.datStartHostMs
      }) + '\n'
    );
    process.exit(fit.ok ? 0 : 1);
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`  dat : ${dat.length} s   spo2 median ${med(dat.map((r) => r.spo2))}  pulse median ${med(dat.map((r) => r.pr))}`);
  console.log(`  csv : ${csv.length} s   host-stamped ${new Date(csv[0]?.tMs).toISOString().slice(11, 19)}–${new Date(csv[csv.length - 1]?.tMs).toISOString().slice(11, 19)} (floating)`);
  if (!fit.ok && !fit.spo2 && !fit.pulse) {
    console.log('  no lag with enough overlap — is this the same session?');
    process.exit(1);
  }
  const report = (nm, r, unit) => console.log(r ? `  ${nm} lag: dat leads csv by ${r.lagS} s   (mean |Δ${unit}| ${r.meanAbsErr.toFixed(3)} over ${r.n} s)` : `  ${nm} lag: no fit`);
  console.log('');
  report('SpO₂ ', fit.spo2, 'SpO₂');
  report('pulse', fit.pulse, 'bpm');
  if (fit.agree === true) console.log(`  ✓ the two columns AGREE — the lag is confirmed by an independent, finer observable`);
  else if (fit.agree === false)
    console.log(`  ⚠ SpO₂ ${fit.spo2.lagS}s vs pulse ${fit.pulse.lagS}s DISAGREE by ${Math.abs(fit.spo2.lagS - fit.pulse.lagS)}s — one fit is spurious; treat as unconfirmed`);
  if (fit.spo2 && fit.spo2.meanAbsErr > 1.5) console.log('  ⚠ SpO₂ mean error > 1.5 % — that fit is weak on its own');
  if (fit.datStartHostMs != null) {
    console.log(`  ⇒ .dat sample 0 sits at host ${new Date(fit.datStartHostMs).toISOString().slice(11, 19)} (floating) — its RTC stamp can now be checked against this`);
  }
}
