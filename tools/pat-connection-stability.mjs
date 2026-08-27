#!/usr/bin/env node
/*
 * tools/pat-connection-stability.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * IS THE PER-CONNECTION OFFSET ACTUALLY CONSTANT WITHIN A CONNECTION?
 * `PAT-RELATIVE-REFRAME` §5 / `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` — the same done-when in two briefs.
 *
 * `pat-align.js:335` states the assumption the dip path rests on:
 *
 *     "the ~2.2 s per-connection BLE offset is CONSTANT within a connection — a within-connection
 *      difference cancels it exactly, which is why `segments` (connection spans) gate runs"
 *
 * That is an ASSUMPTION, not a measurement, and every dip event inherits it. This tool tests it the
 * way both briefs specify: split each connection in half and compare the two halves' lag.
 *
 * WHERE THE CONNECTION BOUNDARIES COME FROM. `*_LINK.csv`, the capture host's sidecar — a PERIODIC
 * status log (~25 s cadence), not an event log, carrying `device;connected;…;link_epoch`. A connection
 * span is a maximal run of consecutive rows sharing one `link_epoch` with `connected=1`.
 *   ⚠️ Boundaries are therefore resolved to ±1 poll (~25 s). That is immaterial when halving a span of
 *   many minutes and fatal when halving a short one, which is the first reason for `--min-span-sec`.
 *   ⚠️ A `session` is NOT a connection. On 2026-08-14 there are 3 sessions and 3 Verity `_PPG.txt`
 *   files, which invites the substitution — but one session spans 12 h, and a BLE link does not
 *   survive that here. Halving a session measures constancy ACROSS reconnects and reports it as
 *   constancy WITHIN a connection, inverting the result. `link_epoch` is the key; nothing else is.
 *
 * WHAT IS MEASURED, and why a difference rather than a level. The nearest-foot lag is only defined
 * modulo one RR (`beat-trains-align-only-mod-rr`), so its LEVEL cannot recover a 2.2 s offset. Its
 * DIFFERENCE between two halves of ONE connection can: a constant offset cancels exactly, so any
 * residual is drift. That is precisely the quantity the assumption claims is zero.
 *
 * ⚠️ BOTH DEVICES MUST BE INSIDE ONE CONNECTION, and this is not a refinement — without it the tool
 * measures the wrong thing. A PAT lag is ECG-to-PPG, so it inherits BOTH links' offsets. Gating only on
 * the Verity's span while pooling H10 beats across the H10's own reconnects injects an ACROSS-reconnect
 * offset into a WITHIN-connection measurement — the identical error the `sessions` warning above is
 * about, one device over. Measured on this corpus: only **8 of 113** Verity spans >= 300 s sit fully
 * inside a single H10 connection, so the unguarded version scores mostly straddled spans. First run
 * without the guard read median |Δ| 110.3 ms over 9 "connections"; that number is not a measurement of
 * this assumption and is retained only as the reason the guard exists.
 *
 *   node tools/pat-connection-stability.mjs <captures-root> [--min-span-sec 300] [--min-beats 60] [--json]
 */
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDsps, ecgRpeakTimes, ppgFootTimes, median } from './pat-matchrate-strict.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const ROOT = argv.find((a) => !a.startsWith('--') && existsSync(a));
const MIN_SPAN = +opt('--min-span-sec', 300) * 1000;
const MIN_BEATS = +opt('--min-beats', 60);
const AS_JSON = argv.includes('--json');
const DEVICE = opt('--device', 'Polar Verity Sense');
const ECG_DEVICE = opt('--ecg-device', 'Polar H10 02849638');

/* Connection spans from the sidecar. Rows are periodic, so a span is a maximal run sharing one
   link_epoch; the span ends at the LAST row of that epoch, not at the next epoch's first row —
   the gap between them is the disconnect, and attributing it to either side would inflate one. */
function connectionSpans(dir, device) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => /_LINK\.csv$/i.test(x))) {
    const lines = readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    if (!lines.length) continue;
    const hdr = lines[0].split(';').map((h) => h.trim());
    const iT = hdr.indexOf('Phone timestamp'),
      iD = hdr.indexOf('device'),
      iC = hdr.indexOf('connected'),
      iE = hdr.indexOf('link_epoch');
    if (iT < 0 || iD < 0 || iC < 0 || iE < 0) continue;
    let cur = null;
    for (const line of lines.slice(1)) {
      const p = line.split(';');
      if (p[iD] !== device) continue;
      const ep = (p[iE] || '').trim();
      const on = (p[iC] || '').trim() === '1';
      const ms = Date.parse(p[iT] + 'Z'); // floating wall-clock, Clock Contract §1
      if (!isFinite(ms)) continue;
      if (!on || !ep) {
        cur = null;
        continue;
      }
      if (cur && cur.epoch === ep && cur.file === f) cur.t1 = ms;
      else {
        cur = { file: f, epoch: ep, t0: ms, t1: ms };
        out.push(cur);
      }
    }
  }
  return out;
}

const nearestLags = (R, F) => {
  const out = [];
  let j = 0;
  for (const r of R) {
    while (j < F.length - 1 && Math.abs(F[j + 1] - r) <= Math.abs(F[j] - r)) j++;
    out.push(F[j] - r);
  }
  return out;
};

/* ── EXPOSURE AFTER THE DETECTOR'S OWN BASELINE ────────────────────────────────────────────────
   The half-vs-half delta this tool already reports is a per-CONNECTION drift, and pat-align's dip
   detector never sees it: a dip is read against a CENTERED ROLLING MEDIAN over `baselineWinMs`, so
   the quantity the detector is exposed to is `lag − localBaseline`, not `lag − connectionStart`.
   Classifying the drift as "ramp" or "step" would be a PROXY for that exposure. This measures the
   exposure itself, with the detector's own constants, which is strictly more direct: a ramp is
   tracked out by construction and shows up here as a small residual; a step is not and shows up as a
   sustained run. No model selection, no threshold on a shape statistic.
   Mirrors pat-align's DIP_DEFAULTS: centered median over W, |lag−baseline| > MAXEX excluded from the
   baseline input as an artifact (as the detector does), a fabricated event = >= MINBEATS consecutive
   beats at or below −THETA. */
export function baselineExposure(times, lags, opts) {
  const W = (opts && opts.winMs) || 60000,
    THETA = (opts && opts.thetaMs) || 10,
    MINBEATS = (opts && opts.minBeats) || 4,
    MAXEX = (opts && opts.maxExcursionMs) || 120;
  const n = times.length;
  if (n < MINBEATS + 1) return null;
  const res = [];
  let lo = 0,
    hi = 0;
  for (let i = 0; i < n; i++) {
    const t = times[i];
    while (lo < n && times[lo] < t - W / 2) lo++;
    while (hi < n && times[hi] <= t + W / 2) hi++;
    const win = [];
    for (let k = lo; k < hi; k++) win.push(lags[k]);
    if (win.length < 3) {
      res.push(null);
      continue;
    }
    win.sort((a, b) => a - b);
    const base = win.length % 2 ? win[win.length >> 1] : (win[(win.length >> 1) - 1] + win[win.length >> 1]) / 2;
    const r = lags[i] - base;
    /* An excursion beyond MAXEX is a slip/artifact by the detector's own rule, not drift exposure. */
    res.push(Math.abs(r) > MAXEX ? null : r);
  }
  const finite = res.filter((x) => x != null);
  if (finite.length < MINBEATS + 1) return null;
  const abs = finite.map(Math.abs).sort((a, b) => a - b);
  const q = (p) => abs[Math.max(0, Math.min(abs.length - 1, Math.floor(p * (abs.length - 1))))];
  /* Fabricated events: runs of >= MINBEATS consecutive beats at or below −THETA, from the OFFSET
     alone. This is the dip detector's own trigger shape applied to a series with no physiology in
     it, so any run it finds is a dip the baseline did NOT track out. */
  /* ⚠ A RUN BELOW −Θ IS NOT EVIDENCE OF DRIFT. The observable is lag = BLE offset + true PAT, so a
     run against a rolling baseline is exactly what the dip detector is BUILT to find — counting them
     counts real arousals, not fabrications. The two sources separate by SHAPE, not by magnitude:
       · a physiological dip RECOVERS — the level returns to its pre-run baseline within seconds;
       · an offset step PERSISTS — the level stays shifted, because the clock moved and stayed moved.
     So each run is classified by what the level does AFTER it, and only the persisting ones are
     attributable to the offset. This is the discrimination the half-vs-half delta cannot make. */
  let runs = 0,
    cur = 0,
    persists = 0,
    recovers = 0;
  const starts = [];
  for (let i = 0; i < res.length; i++) {
    const r = res[i];
    if (r != null && r <= -THETA) {
      cur++;
      if (cur === MINBEATS) {
        runs++;
        starts.push(i - MINBEATS + 1);
      }
    } else cur = 0;
  }
  for (const st of starts) {
    let e = st;
    while (e < res.length && res[e] != null && res[e] <= -THETA) e++;
    /* Level AFTER the run, over one baseline window, compared with the level BEFORE it. */
    const after = [],
      before = [];
    for (let k = e; k < res.length && times[k] <= times[Math.min(e, res.length - 1)] + W; k++) if (res[k] != null) after.push(lags[k]);
    for (let k = st - 1; k >= 0 && times[k] >= times[st] - W; k--) if (res[k] != null) before.push(lags[k]);
    if (after.length < 3 || before.length < 3) continue;
    const med = (a) => {
      const z = a.slice().sort((x, y) => x - y);
      return z.length % 2 ? z[z.length >> 1] : (z[(z.length >> 1) - 1] + z[z.length >> 1]) / 2;
    };
    /* ⚠ PERSISTENCE THRESHOLD — currently reuses Θ, and that reuse is a CHOICE, not a derivation.
       It has not been pre-registered or sensitivity-tested, so `persists`/`recovers` are reported as
       instrumentation, NOT as a fabrication rate. Do not quote a step fraction from them until the
       threshold is fixed in advance and the fraction is shown stable across it. Two confounds are
       also unaddressed: a slow ramp can shift the before/after medians on its own, and a real arousal
       may be followed by a genuine sustained PAT change — both would read as `persists`. */
    if (Math.abs(med(after) - med(before)) >= THETA) persists++;
    else recovers++;
  }
  return { beats: finite.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), maxAbs: +abs[abs.length - 1].toFixed(2), runs, persists, recovers };
}

function main() {
  loadDsps();
  if (!ROOT) {
    console.error('usage: node tools/pat-connection-stability.mjs <captures-root> [--min-span-sec 300] [--min-beats 60] [--json]');
    process.exit(2);
  }
  const rows = [];
  for (const night of readdirSync(ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()) {
    const dir = join(ROOT, night);
    const ecgSpans = connectionSpans(dir, ECG_DEVICE);
    const spans = connectionSpans(dir, DEVICE)
      .filter((s) => s.t1 - s.t0 >= MIN_SPAN)
      // BOTH links unbroken across the span — see the header note.
      .filter((s) => ecgSpans.some((h) => h.t0 <= s.t0 && h.t1 >= s.t1));
    if (!spans.length) {
      rows.push({ night, skip: `no ${DEVICE} connection >= ${MIN_SPAN / 1000}s that also sits inside ONE ${ECG_DEVICE} connection` });
      continue;
    }
    const big = (re) =>
      readdirSync(dir)
        .filter((f) => re.test(f))
        .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 6);
    const parse = (list, fn) =>
      list
        .map((c) => {
          try {
            const r = fn(readFileSync(c.f, 'utf8'));
            return r && r.t0Ms != null ? r : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    const E = parse(big(/_ECG\.txt$/i), ecgRpeakTimes);
    const P = parse(big(/(?:VeritySense|Polar_Sense).*_PPG\.txt$/i), ppgFootTimes);
    if (!E.length || !P.length) {
      rows.push({ night, skip: `no parseable ECG (${E.length}) / Verity PPG (${P.length})` });
      continue;
    }
    const R = E.flatMap((r) => Array.from(r.times)).sort((a, b) => a - b);
    const F = P.flatMap((r) => Array.from(r.times)).sort((a, b) => a - b);
    const per = [];
    for (const s of spans) {
      const Rs = R.filter((t) => t >= s.t0 && t <= s.t1);
      const Fs = F.filter((t) => t >= s.t0 && t <= s.t1);
      if (Rs.length < MIN_BEATS || Fs.length < MIN_BEATS) continue;
      const mid = s.t0 + (s.t1 - s.t0) / 2;
      const a = nearestLags(
        Rs.filter((t) => t < mid),
        Fs
      );
      const b = nearestLags(
        Rs.filter((t) => t >= mid),
        Fs
      );
      if (a.length < MIN_BEATS / 2 || b.length < MIN_BEATS / 2) continue;
      const ma = median(a),
        mb = median(b);
      /* Exposure the DETECTOR actually sees: whole-connection lags against a centered rolling median,
         not the half-vs-half delta — a ramp is tracked out by construction, a step is not. */
      per.push({
        epoch: s.epoch,
        spanSec: +((s.t1 - s.t0) / 1000).toFixed(0),
        firstMs: +ma.toFixed(1),
        secondMs: +mb.toFixed(1),
        deltaMs: +(mb - ma).toFixed(1),
        nBeats: Rs.length,
        exposure: baselineExposure(Rs, nearestLags(Rs, Fs), {})
      });
    }
    if (!per.length) {
      rows.push({ night, skip: `${spans.length} span(s) >= ${MIN_SPAN / 1000}s but none with >= ${MIN_BEATS} beats of BOTH signals` });
      continue;
    }
    const d = per.map((x) => Math.abs(x.deltaMs)).sort((x, y) => x - y);
    rows.push({ night, nSpans: spans.length, nScored: per.length, medAbsDeltaMs: +median(d).toFixed(1), maxAbsDeltaMs: +d[d.length - 1].toFixed(1), per });
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ minSpanSec: MIN_SPAN / 1000, minBeats: MIN_BEATS, device: DEVICE, rows }, null, 1));
    return;
  }
  console.log(`Within-connection offset constancy — ${DEVICE}, spans >= ${MIN_SPAN / 1000} s, >= ${MIN_BEATS} beats/half`);
  console.log('The claim under test (pat-align.js:335): the per-connection offset is CONSTANT within a connection.\n');
  console.log('night        spans  scored  med|Δ|   max|Δ|');
  for (const r of rows) {
    if (r.skip) {
      console.log(`${r.night}  ⊘ ${r.skip}`);
      continue;
    }
    console.log(`${r.night}  ${String(r.nSpans).padStart(5)}  ${String(r.nScored).padStart(6)}  ${String(r.medAbsDeltaMs + 'ms').padStart(7)}  ${String(r.maxAbsDeltaMs + 'ms').padStart(7)}`);
  }
  const all = rows.filter((r) => !r.skip).flatMap((r) => r.per.map((p) => Math.abs(p.deltaMs)));
  if (all.length) {
    all.sort((a, b) => a - b);
    /* A p90 over a handful of points is DEFINED and not informative — at n=2 `all[floor(0.9*1)]` is
       the SMALLER of the two, so it prints BELOW the median and reads as reassurance. Withheld rather
       than shown with a caveat: a number on the line gets quoted, a missing one gets questioned. */
    const p90 = all.length >= 10 ? ` · p90 ${all[Math.floor(0.9 * (all.length - 1))].toFixed(1)} ms` : ' · p90 withheld (n < 10)';
    console.log(`\nPOOLED: ${all.length} connection(s) scored · median |Δ| ${median(all).toFixed(1)} ms${p90} · max ${all[all.length - 1].toFixed(1)} ms`);
    if (all.length < 5) {
      console.log(`\n⚠️  n = ${all.length}. This does NOT answer the constancy question — both briefs' done-when asks`);
      console.log('   for >= 5 NIGHTS, and the both-links guard leaves far fewer scorable connections than');
      console.log('   spans. Report the shortfall, not the median.');
    } else {
      console.log('Read |Δ| against the ±90 ms PAT tolerance: a drift comparable to it means the constancy');
      console.log('assumption is doing real work and is wrong; well under it means the assumption holds.');
    }
  } else console.log('\nno connection scored — nothing measured, and that is not a pass.');
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) main();
export { connectionSpans, nearestLags, main };
