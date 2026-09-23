#!/usr/bin/env node
/*
 * tools/buzz-fiducial-correlate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O2RING-BUZZ-FIDUCIAL step 2/3 — correlate a commanded APERIODIC buzz sequence against the ring's own
 * motion channel, and report the host-axis residual.
 *
 * THE IDEA. The box fires 0x83 on an aperiodic schedule (e.g. gaps [1,4,2,6,3] s); each buzz lands a
 * ~1.1 s spike in the ring's motion column (step 1, measured 2026-08-19: peak 22, motion is the detector).
 *
 * ⚠️⚠️ THAT PREMISE HOLDS FOR THE PROBE'S CAPTURE AND NOT FOR THE DAEMON'S — measured 2026-09-21, residue
 * `2026-09-21-buzz-motion-byte-sparse-in-daemon-stream`. The 0 → 22 rise is §3.1's probe with the ring AT
 * REST. In the daemon's `PPG2W` stream — the same `parse_rt_ppg` byte — only **6 of 39** daemon-commanded
 * fires register at all (08-19 3/15 · 08-20 0/12 · 09-05 3/12), at amplitude **1–9**, with the other 33 at
 * exactly 0. Run on the worn 09-05 set this tool found 7 onsets (hand movements) and 0 alignment, while the
 * H10/Verity ACC legs detect 15/15. So: THIS TOOL NEEDS THE PROBE'S CAPTURE (`probe_buzz_fiducial.py`),
 * NOT A DAEMON CAPTURE, and it now says so at runtime rather than reporting a null that reads as "the buzz
 * did not fire" — see `motionSparsity` / the refusal below. Why the byte differs ~10× between rest-on-desk
 * and worn, and whether the 125 Hz pleth path (`0x03` / `pletha`) carries the buzz on a worn finger, is the
 * open question the residue names; it is NOT answered here and this tool cannot answer it.
 * Because the schedule is aperiodic, the alignment between the detected spikes and the commanded gaps is
 * UNIQUE — the mod-one-beat ambiguity that defeats a rhythmic tap cannot occur. Once aligned, the spread
 * of (onset gap − commanded gap) IS the host-axis residual: how faithfully the ring's motion timeline
 * tracks the box's command clock. Small residual → the ring pleth's host-axis placement is validated;
 * a large one localises the error.
 *
 * Input is the buzz capture in PSL/PPG2W column format (probe_buzz_fiducial.py's output): host-stamped
 * rows with a `motion` column. You supply the commanded GAP schedule (relative, seconds) — not absolute
 * command times — because the aperiodic gaps align the sequence on their own.
 *
 * A RULER, not a clock: onset timing is bounded by the ~1 s raw-buffer back-timing (step 1), so the
 * residual it reports is coarse until the 125 Hz pleth path is used. It still separates "the schedule
 * fired and was seen" from "it was not", and quantifies the gap-tracking error either way.
 *
 * Usage: node tools/buzz-fiducial-correlate.mjs --ppg2w <buzz.txt> --gaps 1,4,2,6,3 [--tol 1.5]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import { makeVerdict } from './verdict-emit.mjs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Parse a PPG2W/PSL row's `YYYY-MM-DDThh:mm:ss.mmm` stamp → floating seconds (Clock Contract). PURE. */
export function parseHostS(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) / 1000 : null;
}

/** Read a PPG2W-format capture → [{t, motion}] in host seconds. */
export function readMotion(path) {
  const L = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const out = [];
  for (const ln of L) {
    const p = ln.split(';');
    const t = parseHostS(p[0]);
    const mo = Number(p[4]);
    if (t != null && Number.isFinite(mo)) out.push({ t, motion: mo });
  }
  return out;
}

/** How much of the motion column is non-zero — the discriminator between a PROBE capture (ring at rest,
 *  the buzz is the only motion, so the spikes stand alone above ~0) and a DAEMON capture (worn, the byte
 *  is mostly 0 with occasional 1–9 runs that are hand movements). PURE. Measured basis in the header. */
export function motionSparsity(series) {
  const n = series.length;
  if (!n) return { n: 0, nonZero: 0, nonZeroFrac: null, max: null };
  let nz = 0;
  let max = 0;
  for (const r of series) {
    if (r.motion > 0) nz++;
    if (r.motion > max) max = r.motion;
  }
  return { n, nonZero: nz, nonZeroFrac: nz / n, max };
}

/** The probe-capture cut. PURE, and stated rather than tuned: the two measured populations are the
 *  PROBE's (ring at rest, the buzz peaks ~22) and the DAEMON's (worn, 6 of 39 commanded fires visible
 *  at amplitude 1-9, the other 33 at exactly 0). `PROBE_MIN_PEAK` sits between them. Returns null when
 *  the capture looks like a probe capture, or `{ reason, sparsity }` when it does not.
 *  ⚠️ This is a REFUSAL, not a detector tweak: a null alignment from a daemon capture is
 *  uninformative about whether the schedule fired, so the tool must not report one. */
export const PROBE_MIN_PEAK = 12;
export const REFUSAL_EXPLAIN = [
  'The probe capture this tool needs peaks ~22 with the ring at rest; a DAEMON PPG2W stream carries the',
  'buzz on only 6 of 39 commanded fires at amplitude 1-9 (measured 2026-09-21: 08-19 3/15, 08-20 0/12,',
  '09-05 3/12 — the other 33 at exactly 0), so an absent alignment here would say nothing about whether',
  'the schedule fired. Residue 2026-09-21-buzz-motion-byte-sparse-in-daemon-stream. Re-run against',
  "probe_buzz_fiducial.py's output, or use the H10/Verity ACC legs, which detect 15/15 on the same fires."
];
export function refuseIfNotProbeCapture(series) {
  const sp = motionSparsity(series);
  if (!sp.n) return { reason: 'the capture has no rows', sparsity: sp };
  if (sp.max < PROBE_MIN_PEAK) {
    return {
      reason: `this capture's motion column peaks at ${sp.max} over ${sp.n} samples (${(100 * sp.nonZeroFrac).toFixed(1)} % non-zero) — below the probe capture's ~22`,
      sparsity: sp
    };
  }
  return null;
}

/** Motion-spike onsets: the leading edge of each run where motion rises above `thr` after being quiet
 *  for at least `refractoryS`. Returns onset times (s). PURE. `thr` defaults to a data-driven level:
 *  a fraction of the max above the median (a still baseline is ~0, so this is forgiving). */
export function detectOnsets(series, { thr = null, refractoryS = 0.5 } = {}) {
  if (series.length === 0) return [];
  const mo = series.map((r) => r.motion);
  const sorted = [...mo].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const max = sorted[sorted.length - 1];
  const level = thr != null ? thr : median + 0.35 * (max - median);
  const onsets = [];
  let armed = true; // armed = ready to detect a new rising edge
  let lastOnset = -Infinity;
  for (const r of series) {
    if (armed && r.motion > level && r.t - lastOnset >= refractoryS) {
      onsets.push(r.t);
      lastOnset = r.t;
      armed = false;
    } else if (!armed && r.motion <= level) {
      armed = true; // fell back to quiet → ready for the next spike
    }
  }
  return onsets;
}

/** Align a run of detected onsets to a commanded aperiodic gap schedule. Slides a window of
 *  (gaps.length + 1) consecutive onsets and picks the offset whose inter-onset gaps best match the
 *  commanded gaps (min sum-abs-error). Returns the matched onset times, the per-gap error, and the
 *  residual (RMS of gap errors, ms) — or null if no window is within `tolS` on every gap. PURE. */
export function matchSchedule(onsets, gaps, tolS = 1.5) {
  const need = gaps.length + 1;
  if (onsets.length < need) return null;
  let best = null;
  for (let i = 0; i + need <= onsets.length; i++) {
    const win = onsets.slice(i, i + need);
    const errs = [];
    let ok = true;
    for (let k = 0; k < gaps.length; k++) {
      const e = win[k + 1] - win[k] - gaps[k];
      errs.push(e);
      if (Math.abs(e) > tolS) ok = false;
    }
    if (!ok) continue;
    const sae = errs.reduce((p, c) => p + Math.abs(c), 0);
    if (best === null || sae < best.sae) {
      const rms = Math.sqrt(errs.reduce((p, c) => p + c * c, 0) / errs.length);
      best = { sae, onsets: win, gapErrorsMs: errs.map((e) => e * 1000), residualMs: rms * 1000, startIndex: i };
    }
  }
  return best;
}

function selftest() {
  // (plants for motionSparsity + the daemon refusal are at the end of this function)
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${nm}`)) : (fail++, console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`));
  };

  ok('parseHostS is floating seconds', Math.abs(parseHostS('2026-08-19T23:39:09.065') - Date.UTC(2026, 7, 19, 23, 39, 9, 65) / 1000) < 1e-9);
  ok('parseHostS rejects junk', parseHostS('nope') === null);

  // synthesise a still capture (motion 0) at 100 Hz with a ~1.1 s spike at each commanded instant
  const gaps = [2, 4, 3, 6]; // all > the 1.1 s buzz width, else adjacent spikes merge
  const cmd = [10.0]; // first buzz at t=10s
  for (const g of gaps) cmd.push(cmd[cmd.length - 1] + g);
  const LAT = 0.4; // the measured ~419 ms onset latency
  const series = [];
  for (let t = 0; t < 40; t += 0.01) {
    let m = 0;
    for (const c of cmd) if (t >= c + LAT && t < c + LAT + 1.1) m = 20;
    series.push({ t, motion: m });
  }
  const onsets = detectOnsets(series);
  ok('detects one onset per commanded buzz', onsets.length === cmd.length, `got ${onsets.length}`);
  ok('onsets sit ~LAT after the commands', Math.abs(onsets[0] - (cmd[0] + LAT)) < 0.05, `${onsets[0]}`);

  const m = matchSchedule(onsets, gaps, 1.5);
  ok('the aperiodic schedule aligns', m !== null && m.onsets.length === gaps.length + 1);
  ok('gap-tracking residual is tiny (constant latency cancels in the gaps)', m.residualMs < 30, `${m.residualMs?.toFixed(1)}ms`);

  // CONTROL 1: flat motion → no onsets → no match (the detector does not invent buzzes)
  const flat = series.map((r) => ({ t: r.t, motion: 0 }));
  ok('a still capture yields no onsets', detectOnsets(flat).length === 0);
  ok('no onsets → no schedule match', matchSchedule(detectOnsets(flat), gaps) === null);

  // CONTROL 2: a WRONG schedule does not spuriously match this run
  ok('a mismatched schedule is rejected', matchSchedule(onsets, [5, 5, 5, 5, 5], 1.5) === null);

  // CONTROL 3: real gap jitter is measured, not hidden — perturb one gap by 300 ms
  const jittered = onsets.slice();
  jittered[2] += 0.3;
  const mj = matchSchedule(jittered, gaps, 1.5);
  ok('a 300 ms gap perturbation shows in the residual', mj !== null && mj.residualMs > 80, `${mj?.residualMs?.toFixed(0)}ms`);

  // too few onsets → null, never a partial claim
  ok('fewer onsets than the schedule → null', matchSchedule([1, 2], [1, 1, 1]) === null);

  // ── The probe-vs-daemon refusal (residue 2026-09-21-buzz-motion-byte-sparse-in-daemon-stream) ──
  // PLANT 1: the probe capture synthesised above — ring at rest, peak 20 — must pass.
  ok('probe capture: peak is the buzz amplitude', motionSparsity(series).max >= PROBE_MIN_PEAK);
  ok('probe capture is NOT refused', refuseIfNotProbeCapture(series) === null);

  // PLANT 2: a daemon-shaped capture of the SAME commanded schedule — 3 of the 5 fires register, at
  // amplitude 9, and the other 2 sit at exactly 0 (the measured 6-of-39 / 1-9 shape).
  const visible = new Set([cmd[0], cmd[2], cmd[4]]);
  const daemon = [];
  for (let t = 0; t < 40; t += 0.01) {
    let m = 0;
    for (const c of cmd) if (visible.has(c) && t >= c + LAT && t < c + LAT + 1.1) m = 9;
    daemon.push({ t, motion: m });
  }
  const spD = motionSparsity(daemon);
  ok('daemon-shaped capture peaks in 1-9', spD.max > 0 && spD.max <= 9, `max=${spD.max}`);
  const rd = refuseIfNotProbeCapture(daemon);
  ok('daemon-shaped capture IS refused', rd !== null && /peaks at 9/.test(rd.reason), rd ? rd.reason : 'not refused');

  // PLANT 3: the refusal is load-bearing — unrefused, this capture reports a bare null, which is
  // exactly the uninformative answer the residue is about (3 onsets for a 5-fire schedule).
  ok('…and unrefused it would report a bare null', matchSchedule(detectOnsets(daemon), gaps, 1.5) === null);

  // PLANT 4: an empty capture is refused, never scored.
  ok('empty capture is refused', refuseIfNotProbeCapture([]) !== null);

  /* ── the verdict, all four reachable statuses ───────────────────────────────── */
  const VAT = { at: '2026-09-22T00:00:00Z', commit: null, commitReason: 'selftest' };
  const G = [1, 4, 2, 6, 3];
  const V = (on, ref) => buzzVerdict({ status: 'RUN', tolS: 1.5, gaps: G, series: 1200, onsets: on, match: ref ? null : matchSchedule(on, G, 1.5), refusal: ref, ...VAT });
  const vPass = V([0, 1, 5, 7, 13, 16]);
  const vFail = V([0, 9, 9.5, 10, 11, 12, 14]);
  const vUnder = V([1, 2]);
  const vNA = V([], { reason: 'daemon capture: peak motion 9 (probe captures peak ~22)' });
  ok('verdict: an aligned schedule PASSES and carries the host-axis residual', vPass.status === 'PASS' && typeof vPass.result.residualMs === 'number', vPass.status);
  ok('verdict: windows existed and none matched ⇒ FAIL', vFail.status === 'FAIL' && vFail.result.windowsTried > 0, `${vFail.status}/${vFail.result && vFail.result.windowsTried}`);
  /* The distinction Kestrel's review forced, and it was FAIL before the split: too few onsets is not
     a failed alignment, because FAIL asserts the schedule was LOOKED FOR and not seen. */
  ok('verdict: fewer onsets than one window ⇒ UNDERPOWERED, not FAIL', vUnder.status === 'UNDERPOWERED' && vUnder.result === null, vUnder.status);
  ok('verdict: …and it says how many onsets a window needs', /6 are needed/.test(vUnder.reason || ''), JSON.stringify(vUnder.reason));
  ok('verdict: a daemon capture is NOT_APPLICABLE — the stream cannot carry the fiducial', vNA.status === 'NOT_APPLICABLE' && vNA.result === null, vNA.status);
  ok("verdict: the threshold IS the tool's own --tol, not a new bar", vPass.criterion.threshold === 1.5 && vPass.criterion.direction === 'lte' && vPass.criterion.unit === 's');
  for (const [l, v] of [
    ['PASS', vPass],
    ['FAIL', vFail],
    ['UNDERPOWERED', vUnder],
    ['NOT_APPLICABLE', vNA]
  ])
    ok(`verdict: ${l} population is an equality`, v.population.eligible === v.population.checked + v.population.excluded, JSON.stringify(v.population));

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

/* ── THE VERDICT ────────────────────────────────────────────────────────────────
   The criterion is NOT invented here: `matchSchedule` already returns null unless a window aligns
   EVERY commanded gap within `tolS`, defaulted to 1.5 s at the CLI. The adoption reports the bar the
   tool already applies — an adoption must not change what a tool decides.

   ⚠ THE REFUSAL IS `NOT_APPLICABLE`, NOT `FAIL`, and the distinction is the reason the refusal was
   built. A daemon PPG2W stream carries the buzz on 6 of 39 fires at amplitude 1-9 (residue
   2026-09-21-buzz-motion-byte-sparse-in-daemon-stream), so a null from such a file says nothing about
   whether the schedule fired: the stream cannot carry the fiducial. FAIL would convict the schedule
   on a capture that could never have shown it. The tool arrived at that distinction independently of
   the verdict contract; this maps it onto the contract's own word for it. */
export function buzzVerdict({ status, tolS, gaps, series, onsets, match, refusal, at, commit, commitReason }) {
  const base = {
    tool: 'tools/buzz-fiducial-correlate.mjs',
    gate: 'buzz-fiducial-correlate',
    scope: 'internal',
    criterion: {
      name: 'every commanded buzz gap aligns to a detected motion onset within --tol (the whole schedule, not a best subset): matchSchedule returns null unless EVERY gap is within tolerance',
      direction: 'lte',
      threshold: tolS,
      unit: 's'
    },
    evidence: ['tools/buzz-fiducial-correlate.mjs'],
    at,
    commit,
    commitReason
  };
  const nGaps = Array.isArray(gaps) ? gaps.length : 0;
  if (status === 'NOT_RUN') {
    return makeVerdict({ ...base, status: 'NOT_RUN', population: { eligible: 0, checked: 0, excluded: 0 }, result: null, reason: 'no capture given: --ppg2w and --gaps are both required' });
  }
  if (refusal) {
    return makeVerdict({
      ...base,
      status: 'NOT_APPLICABLE',
      population: { eligible: nGaps, checked: 0, excluded: nGaps },
      result: null,
      reason: refusal.reason + ' — the stream cannot carry the fiducial, so a null alignment is not evidence the schedule did not fire'
    });
  }
  /* ⚠ TWO DIFFERENT NULLS, AND ONLY ONE IS A FAILURE. `matchSchedule` returns null both when no
     window aligned AND, by an explicit early return, when there are fewer than `gaps.length + 1`
     onsets — too few to form a single candidate window. FAIL asserts *the commanded schedule was not
     seen*, a claim you can only make if the detector had enough onsets to look. The second is
     UNDERPOWERED: the criterion would bind, there is simply not enough data to evaluate it. */
  const need = nGaps + 1;
  if (onsets.length < need) {
    return makeVerdict({
      ...base,
      status: 'UNDERPOWERED',
      population: { eligible: nGaps, checked: 0, excluded: nGaps },
      result: null,
      reason: `${onsets.length} onset(s) detected but ${need} are needed to form one candidate window for a ${nGaps}-gap schedule — too few to evaluate the alignment either way`
    });
  }
  if (!match) {
    return makeVerdict({
      ...base,
      status: 'FAIL',
      population: { eligible: nGaps, checked: nGaps, excluded: 0 },
      result: { motionSamples: series, onsets: onsets.length, windowsTried: onsets.length - need + 1, alignedGaps: 0, commandedGaps: nGaps, tolS },
      reason: `the commanded schedule [${(gaps || []).join(',')}] aligned to none of the ${onsets.length - need + 1} candidate window(s) over ${onsets.length} detected onset(s) within ${tolS}s — wrong file, buzz too weak, or the schedule differs`
    });
  }
  return makeVerdict({
    ...base,
    status: 'PASS',
    population: { eligible: nGaps, checked: nGaps, excluded: 0 },
    result: { motionSamples: series, onsets: onsets.length, startIndex: match.startIndex, gapErrorsMs: match.gapErrorsMs, residualMs: match.residualMs, commandedGaps: nGaps, tolS }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  if (process.argv.includes('--verdict-sample')) {
    /* The PASS shape, from an aligned synthetic schedule. No capture is read and none is claimed. */
    const g = [1, 4, 2, 6, 3];
    const on = [0, 1, 5, 7, 13, 16];
    console.log(
      JSON.stringify(
        buzzVerdict({
          status: 'RUN',
          tolS: 1.5,
          gaps: g,
          series: 1200,
          onsets: on,
          match: matchSchedule(on, g, 1.5),
          refusal: null,
          at: '2026-09-22T00:00:00Z',
          commit: null,
          commitReason: '--verdict-sample: a synthetic aligned schedule, no capture read'
        }),
        null,
        2
      )
    );
    process.exit(0);
  }
  const p = arg('--ppg2w');
  const gapsRaw = arg('--gaps');
  if (!p || !gapsRaw) {
    console.log('usage: --ppg2w <buzz.txt> --gaps 1,4,2,6,3 [--tol 1.5]');
    process.exit(2);
  }
  const gaps = gapsRaw.split(',').map(Number);
  const tol = Number(arg('--tol') || 1.5);
  const series = readMotion(p);
  /* ⚠️ REFUSE A DAEMON CAPTURE RATHER THAN REPORT ITS NULL. A daemon PPG2W stream carries the buzz on 6 of
     39 fires at amplitude 1-9 (residue 2026-09-21-buzz-motion-byte-sparse-in-daemon-stream), so "no
     alignment" from such a file says nothing about whether the schedule fired — and a reader cannot tell
     that refusal apart from a real null unless the tool names it. The probe's capture has the ring at rest
     and a peak of ~22; the cut is on the MAXIMUM, which separates the two populations measured so far
     (probe 22 vs daemon 1-9) and is stated rather than tuned. */
  const refusal = refuseIfNotProbeCapture(series);
  if (refusal) {
    console.log(`  ✗ REFUSED — ${refusal.reason}`);
    for (const l of REFUSAL_EXPLAIN) console.log(`    ${l}`);
    console.log(JSON.stringify(buzzVerdict({ status: 'RUN', tolS: tol, gaps, series: series.length, onsets: [], match: null, refusal })));
    process.exit(2);
  }
  const onsets = detectOnsets(series);
  console.log(`  ${series.length} motion samples, ${onsets.length} spike onset(s) detected`);
  const m = matchSchedule(onsets, gaps, tol);
  const V = buzzVerdict({ status: 'RUN', tolS: tol, gaps, series: series.length, onsets, match: m, refusal: null });
  if (!m) {
    /* The human line says "did NOT align"; the verdict distinguishes WHY — UNDERPOWERED when there
       were too few onsets to form a window, FAIL when windows existed and none matched. The exit
       code cannot carry that distinction, which is why the object is printed beside it. */
    if (V.status === 'UNDERPOWERED') console.log(`  ⊘ ${V.reason}`);
    else {
      console.log(`  ✗ the commanded schedule [${gaps.join(',')}] did NOT align to the detected onsets — the`);
      console.log(`    aperiodic buzz was not seen (wrong file, buzz too weak, or the schedule differs).`);
    }
    console.log(JSON.stringify(V));
    process.exit(1);
  }
  console.log(`  ✓ schedule aligned at onset #${m.startIndex} — the aperiodic pattern is present in the motion channel`);
  console.log(`  per-gap error (ms): ${m.gapErrorsMs.map((e) => e.toFixed(0)).join(', ')}`);
  console.log(`  HOST-AXIS RESIDUAL: ${m.residualMs.toFixed(1)} ms RMS  (bounded by the ~1 s raw-buffer back-timing)`);
  console.log(JSON.stringify(V));
}
