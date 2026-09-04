#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppi-jitter-vs-ecg.mjs — O2RING-FINGER-HRV-VALIDATION §3, the PRIMARY endpoint
 * ------------------------------------------------------------------------------------------------
 * PPI-jitter sd for the O2Ring FINGER pleth against paired H10 chest ECG, reported as median + IQR
 * across nights so it is directly comparable to the Verity wrist's 5.92 ms.
 *
 * The brief says "adopt the deep-dive's validated apparatus verbatim". That apparatus was never
 * committed — like the two O2Ring sweeps §5b found dead, and like the §3 scratchpad whose numbers can
 * no longer be re-derived. So this is it, committed, with a corpus-free `--selftest`.
 *
 * WHY BEAT MATCHING NEEDS PER-EPOCH ALIGNMENT (§3.3, non-negotiable). The finger pulse arrives
 * ~150-250 ms after the R-peak and that pulse-transit time DRIFTS over a night. A single global lag
 * scores ~F1 0.26 and a nonsense −1 ms PTT. Worse, aligning on the beat trains themselves pins the
 * offset only MODULO one heartbeat — a beat train is periodic, so a whole-RR error is invisible.
 *
 * So the coarse lag is taken on the INSTANTANEOUS-HR ENVELOPE, not the beat times: HR wanders
 * aperiodically over a 5-min epoch (respiratory sinus arrhythmia, arousals), and an aperiodic signal
 * cannot alias by a beat. Only after that envelope lag is removed is ±75 ms one-to-one beat matching
 * meaningful, and only within the epoch it was measured on.
 *
 * WHAT IS REPORTED
 *   PPI-jitter sd  sd of (finger interval − its matched ECG interval), per epoch, median over epochs
 *                  per night, then median + IQR over nights.   PRIMARY.
 *   RMSSD bias %   finger whole-record RMSSD vs ECG, per night.
 *   sdnnRobust %   the jitter-robust family the brief expects to survive where RMSSD does not.
 *   match rate     fraction of finger beats matched within ±75 ms after alignment — a low rate makes
 *                  the jitter figure meaningless and is reported beside it, never folded in.
 *
 * SHIPPED CODE ONLY — PPGDSP/ECGDSP co-loaded in a vm realm mirroring tests/run-tests.mjs. No
 * reimplemented HRV math: RMSSD/SDNN come from the node's own analyze().
 *
 * USAGE
 *   node tools/ppi-jitter-vs-ecg.mjs --dir <captures> [--min-epochs 3] [--max-nights 20]
 *   node tools/ppi-jitter-vs-ecg.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const MIN_EPOCHS = +opt('--min-epochs', 3);
const MAX_NIGHTS = +opt('--max-nights', 20);
/* WHICH PPG DEVICE. The finger is this brief's subject, but the Verity must be runnable through the
   SAME instrument. The deep-dive's 5.92 ms wrist figure is `[CORPUS]`-marked and its §2.2 apparatus was
   never committed — §2.2 describes the method and names no tool — so quoting a finger number against it
   would compare two instruments, only one of which can be re-run. Measuring both here makes the
   comparison same-instrument and turns 5.92 ms into a CHECK ON THIS TOOL rather than a constant. */
/* §4 adjudicates CVHR on SLEEP nights specifically — "n=2 waking is not evidence". The capture corpus
   mixes overnight recordings with daytime segments, so a night is taken as sleep when it STARTS between
   20:00 and 04:00 local and runs ≥ 4 h. Crude, and deliberately so: it is a property of the filename
   stamp and the duration, not a stage call, and over-including a borderline night is safer here than
   silently excluding a real one. Reported alongside the unfiltered figure so the filter's effect is
   visible rather than assumed. */
const SLEEP_ONLY = has('--sleep-only');
/* SESSION MERGE (default ON; --no-merge reproduces the pre-2026-08-04 single-file behaviour).
   The O2Ring and the Polar loggers split ONE night across many session files — 1632 finger files across
   18 nights, and the early nights are 100-400 fragments with no single continuous recording. Treating
   one FILE as one night therefore made most of the corpus invisible: only the 9 nights that happened to
   contain one long unbroken file ever produced a row, and raising --max-nights from 30 to 120 changed
   nothing because the cap was never the binding constraint. `trio-batch.mjs` already merges concurrent
   sessions per night ("47 concurrent session(s), 12.2 h merged"); this is that idea, applied here.
   NIGHT KEY is trio-batch's: the date of (start - 12 h), so an evening start and the post-midnight hours
   of the same sleep land on one key. */
/* SESSION MERGE, both sides (finger and ECG). The earlier finger-only version is superseded; its
   asymmetry — a merged finger train paired against ONE ECG file — is what made merged jitter read
   worse. Kept in the history, not in the behaviour.
   REMAINING LIMITATION, deliberate: CVHR is still per-session. `cvhrFromNN` / `detectCVHR` live inside
   analyze() and are not exported, so a merged night carries its LARGEST session's cvhrIndex. A
   merged-night CVHR count therefore does NOT satisfy §3.1's ≥10-night bar and must not be read as
   doing so; exporting them is a compute-path change with a re-bundle and verify-fixtures behind it.
   Superseded note (was: ⚠ INCOMPLETE — the FINGER side merges, the ECG side does not yet). */
const MERGE = !has('--no-merge');
const nightKeyOf = (tMs) => new Date(tMs - 12 * 3600 * 1000).toISOString().slice(0, 10);
const isSleepNight = (name, durSec) => {
  const m = /_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name) || /(\d{8})(\d{2})(\d{2})(\d{2})_PPG/.exec(name);
  const hh = m ? +(m.length > 6 ? m[4] : m[2]) : null;
  if (hh == null || !(durSec >= 4 * 3600)) return false;
  return hh >= 20 || hh < 4;
};
const DEVICE = String(opt('--device', 'o2ring')).toLowerCase();
/* ⚠️ THE SAME DEVICE IS NAMED TWO WAYS, and matching only one reports an EMPTY corpus as no data.
   The Verity Sense appears as `Polar_VeritySense_<serial>` when the capture host wrote it and as
   `Polar_Sense_<serial>` when Polar Sensor Logger did — identical serial (`0C301E3F` on this corpus),
   one physical armband. The repo already treats the PSL spelling as the Verity elsewhere: PpgDex's
   equivalence input is `Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt`.
   Measured 2026-08-18 on the PSL tree: the old `/VeritySense/` pattern matched **0 of 1980** files
   while **54** wrist PPG and **50** paired H10 ECG files were present. A `--device verity` run there
   reported nothing to report, which reads as "the corpus cannot answer this" rather than "the tool
   cannot see it" — and that is the reading that kept a settling measurement looking impossible. */
const PPG_RE = DEVICE === 'verity' ? /(?:VeritySense|Polar_Sense).*_PPG\.txt$/i : /O2Ring.*_PPG\.txt$/i;

import { EPOCH_MS, MATCH_MS, HR_BIN_MS, MAX_LAG_MS, mean, sd, quantile, median, hrEnvelope, envelopeLagMs, refineLagByMatch, matchBeats, refinePeaks, ppiJitterMs } from './ppi-match.mjs';
/* Re-exported so the existing import surface of this file is unchanged for any consumer. */
export { hrEnvelope, envelopeLagMs, refineLagByMatch, matchBeats, refinePeaks, ppiJitterMs };

/* ════════════════════════════════════════ SELFTEST ════════════════════════════════════════ */
/* The usage string is a CONSTANT so the selftest can check it against the flags the tool actually
   reads. `--device` shipped undocumented: it exists at the DEVICE line below and selects the Verity
   leg, but `--help` never mentioned it, so a session looking for it found `--dir` only and concluded
   the capability was absent. That is the discoverability failure one level below a missing index —
   the flag is IN the tool and unreachable by anyone who did not read the source. */
const USAGE = 'usage: node tools/ppi-jitter-vs-ecg.mjs --dir <captures> [--device o2ring|verity] ' + '[--min-epochs N] [--max-nights N] [--sleep-only] [--no-merge]  |  --selftest';

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  /* ⚠️ EVERY FLAG THE TOOL READS MUST APPEAR IN ITS USAGE STRING. Read from the source rather than a
     hand-list, so a flag added tomorrow is covered without anyone remembering to update this. Derived,
     not asserted: `--device` was undocumented for weeks and a session concluded the capability was
     missing because `--help` did not name it. */
  {
    const src = readFileSync(new URL(import.meta.url).pathname, 'utf8');
    const flags = [...src.matchAll(/(?:opt|has)\('(--[a-z-]+)'/g)].map((m) => m[1]);
    const undocumented = [...new Set(flags)].filter((f) => USAGE.indexOf(f) < 0);
    ok('every flag the tool reads is named in USAGE', undocumented.length === 0, undocumented.join(', ') || '');
    ok('…and the flag scan actually found flags (anti-vacuity)', flags.length >= 3, flags.length + ' flag(s) scanned');
  }
  // A synthetic beat train with an APERIODIC HR wander, a known PTT lag, and known jitter.
  const mk = (lagMs, jitterSd, seed) => {
    let s = seed || 1;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff - 0.5;
    };
    const ecg = [],
      finger = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      // aperiodic wander: two incommensurate slow components, so the envelope cannot alias
      const rr = 900 + 60 * Math.sin(i / 17.3) + 40 * Math.sin(i / 7.1 + 1.3);
      t += rr;
      ecg.push(t);
      finger.push(t + lagMs + (jitterSd ? rnd() * jitterSd * 3.46 : 0)); // uniform → sd ≈ jitterSd
    }
    return { ecg, finger };
  };
  const A = mk(200, 0, 7);
  const t0 = 0,
    t1 = A.ecg[A.ecg.length - 1];
  const lag = envelopeLagMs(hrEnvelope(A.finger, t0, t1), hrEnvelope(A.ecg, t0, t1));
  ok('an envelope lag is recovered at all', lag != null, JSON.stringify(lag));
  /* THE POINT of using the HR envelope: it is aperiodic, so the recovered lag is NOT ambiguous modulo
     one RR (~900 ms here). A beat-train correlation would be. */
  ok('the recovered lag is within one HR bin of the planted 200 ms — not a whole-RR alias', lag && Math.abs(lag.lagMs - 200) <= HR_BIN_MS, 'lag=' + (lag && lag.lagMs));
  ok('…and the envelope correlation is strong on identical wander', lag && lag.r > 0.9, 'r=' + (lag && lag.r));

  /* THE LEG THAT WOULD HAVE CAUGHT THE FIRST RUN. The coarse envelope argmax is on a 1 s grid, so on a
     200 ms lag it reports 0 — and ±75 ms matching against a 200 ms error matches almost nothing. §3.3's
     local refinement is what recovers it. Asserting the COARSE stage is wrong is as important as
     asserting the refined stage is right: without this, a tool that skipped refinement still passed. */
  ok('the COARSE envelope lag is grid-quantised and cannot serve ±75 ms matching on its own', lag && Math.abs(lag.coarseMs - 200) >= 75, 'coarse=' + (lag && lag.coarseMs) + ' vs true 200');
  const seeded = refineLagByMatch(A.finger, A.ecg, lag.coarseMs);
  ok('…and the local refinement recovers the true lag to within the matching tolerance', Math.abs(seeded.lagMs - 200) <= MATCH_MS, 'refined=' + seeded.lagMs);
  ok(
    '…which is what makes the match rate usable (coarse would strand it)',
    seeded.matched >= A.finger.length - 5 && matchBeats(A.finger, A.ecg, lag.coarseMs).length < seeded.matched,
    'refined ' + seeded.matched + ' vs coarse ' + matchBeats(A.finger, A.ecg, lag.coarseMs).length
  );
  const pairs = matchBeats(A.finger, A.ecg, 200);
  ok('a zero-jitter train matches one-to-one, essentially completely', pairs.length >= A.finger.length - 2, pairs.length + '/' + A.finger.length);
  const j0 = ppiJitterMs(A.finger, A.ecg, pairs);
  ok('zero planted jitter ⇒ ~0 ms measured', j0 && j0.sd < 0.5, 'sd=' + (j0 && j0.sd));

  const B = mk(200, 6, 11);
  const pb = matchBeats(B.finger, B.ecg, 200);
  const j6 = ppiJitterMs(B.finger, B.ecg, pb);
  /* Interval jitter is the DIFFERENCE of two independent beat jitters, so sd scales by √2. A 6 ms beat
     jitter must read ~8.5 ms of interval jitter — asserting the raw 6 would silently accept a tool that
     measured beat error instead of interval error. */
  ok('6 ms beat jitter reads ~8.5 ms INTERVAL jitter (√2 — the difference of two jitters)', j6 && j6.sd > 6 && j6.sd < 11, 'sd=' + (j6 && j6.sd));

  // one-to-one: an ECG beat may not be consumed twice
  const dup = matchBeats([1000, 1010], [1005], 0);
  ok('one ECG beat cannot match two finger beats', dup.length === 1, JSON.stringify(dup));
  // a gap must not become a jitter sample
  const gj = ppiJitterMs(
    [0, 900, 5000, 5900],
    [0, 900, 5000, 5900],
    [
      { fi: 0, ei: 0 },
      { fi: 1, ei: 1 },
      { fi: 3, ei: 3 }
    ]
  );
  ok('a non-consecutive pair contributes no jitter sample (too few ⇒ null)', gj === null, JSON.stringify(gj));
  ok('sd is the SAMPLE sd (÷ n−1)', Math.abs(sd([800, 900]) - Math.sqrt(5000)) < 1e-9);
  ok('quantile interpolates — IQR is not a nearest-rank approximation', quantile([1, 2, 3, 4], 0.25) === 1.75, String(quantile([1, 2, 3, 4], 0.25)));
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}
if (SELFTEST) process.exit(selftest());

/* ════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
if (!DIR) {
  console.error(USAGE);
  process.exit(2);
}
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;

const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, o);
      else o.push({ p, size: st.size });
    }
  } catch (_e) {}
  return o;
};
const all = walk(DIR);
const _ppgMatched = all.filter((f) => PPG_RE.test(f.p));
const fingerFiles = _ppgMatched.sort((a, b) => b.size - a.size).slice(0, MAX_NIGHTS);
/* PRINT THE DENOMINATOR. A pattern that matches nothing and a corpus that holds nothing produce the
   same silence, and only one of them is a fact about the data. Stating files-walked beside
   files-matched makes a naming mismatch visible in the output instead of leaving it to be inferred
   from an empty table. */
console.log(`corpus: ${all.length} file(s) walked · ${_ppgMatched.length} matched ${DEVICE} PPG · ${all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p)).length} paired H10 ECG`);
if (!_ppgMatched.length) {
  console.error(`\n⊘ NO ${DEVICE.toUpperCase()} PPG FILE MATCHED under ${DIR}.`);
  console.error('  This is a statement about the PATTERN, not about the corpus. Check the vendor naming:');
  console.error('  the Verity is `Polar_VeritySense_*` from the capture host and `Polar_Sense_*` from');
  console.error('  Polar Sensor Logger — the same armband, two spellings.');
  process.exit(2);
}
const ecgs = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));

console.log('O2RING-FINGER-HRV-VALIDATION §3 — PPI-jitter sd vs paired H10 ECG (per-epoch alignment)');
console.log('device: ' + (DEVICE === 'verity' ? 'Polar Verity Sense (WRIST — the deep-dive reference leg)' : "Wellue O2Ring (FINGER — this brief's subject)") + '\n');
console.log('night                                        eps  jitter_sd  match%   lag_ms   RMSSD_f  RMSSD_e  bias%   sdnnRob%');

/* Build the UNITS to score. Merged: one unit per NIGHT, its beat train the union of every session's
   beats on the shared absolute (floating) clock. Unmerged: one unit per file, the legacy behaviour.
   Each session is parsed and analysed INDEPENDENTLY — detection stays per-recording, which is correct,
   since a fragment boundary is real time in which no signal arrived. Only the resulting beat TIMES are
   pooled, and an interval spanning a boundary is dropped downstream by ppiJitterMs' own 300-2000 ms
   window rather than being bridged (the same discipline ppgdex-dsp applies to a gap). */
function buildUnits(files) {
  const parsed = [];
  for (const f of files) {
    try {
      const rec = P.parsePPG(readFileSync(f.p, 'utf8'));
      if (rec.t0Ms == null) continue;
      const res = P.analyze(rec);
      if (!res || !res.beatTimes) continue;
      parsed.push({ f, rec, res, beats: (res.footSec || []).map((x) => rec.t0Ms + x * 1000) });
    } catch (_e) {}
  }
  if (!MERGE) {
    return parsed.map((u) => ({
      name: u.f.p.split('/').pop(),
      t0: u.rec.t0Ms,
      t1: u.rec.t0Ms + (u.rec.durSec || 0) * 1000,
      beats: u.beats,
      res: u.res,
      nSess: 1
    }));
  }
  const byNight = new Map();
  for (const u of parsed) {
    const k = nightKeyOf(u.rec.t0Ms);
    if (!byNight.has(k)) byNight.set(k, []);
    byNight.get(k).push(u);
  }
  const out = [];
  for (const [k, us] of byNight) {
    const beats = [];
    for (const u of us) beats.push(...u.beats);
    beats.sort((a, b) => a - b);
    // representative analyse result = the LARGEST session, used only for the per-node HRV columns
    // (RMSSD / sdnnRobust / cvhrIndex live inside analyze() and cannot be recomputed from beat times
    // without exporting cvhrFromNN/detectCVHR — see the follow-up note in the brief).
    const rep = us.slice().sort((a, b) => b.f.size - a.f.size)[0];
    out.push({
      name: k + ' (' + us.length + ' sess)',
      t0: Math.min(...us.map((u) => u.rec.t0Ms)),
      t1: Math.max(...us.map((u) => u.rec.t0Ms + (u.rec.durSec || 0) * 1000)),
      beats,
      res: rep.res,
      nSess: us.length,
      repName: rep.f.p.split('/').pop()
    });
  }
  return out.sort((a, b) => b.beats.length - a.beats.length);
}

/* MERGED ECG NIGHTS, built ONCE. Two things were wrong with searching the raw file list inside the
   finger loop. Correctness: a merged finger train was paired against a SINGLE best-overlapping ECG
   file, so finger beats outside that one file's window had nothing to match and the rate collapsed on
   fragmented nights (80.6 % on 2026-07-24's 45 sessions, 65.2 % on 07-31's 8) — the jitter median then
   read worse under merge purely as an artifact of the asymmetry. Cost: the search re-parsed EVERY ECG
   file for EVERY candidate night, so a 400-file run did ~400x419 parses and took hours.
   Both go away by grouping the reference the same way the finger side is grouped. int16 is dropped
   after refinement — only beat TIMES are retained, so holding every night at once stays cheap. */
function buildEcgNights(files) {
  const parsed = [];
  for (const e of files) {
    try {
      const er = E.parseECG(readFileSync(e.p, 'utf8'));
      if (er.t0Ms == null) continue;
      const eres = E.analyze(er);
      if (!eres || !eres.peaks) continue;
      const bp = E.bandpass(er.int16, er.fs);
      parsed.push({
        e,
        t0: er.t0Ms,
        t1: er.t0Ms + (er.durSec || 0) * 1000,
        durMs: (er.durSec || 0) * 1000,
        beats: refinePeaks(bp, eres.peaks).map((q) => er.t0Ms + (q / er.fs) * 1000),
        beatsRaw: eres.peaks.map((q) => er.t0Ms + (q / er.fs) * 1000),
        res: eres
      });
    } catch (_x) {}
  }
  if (!MERGE) return parsed.map((u) => ({ ...u, nSess: 1 }));
  const by = new Map();
  for (const u of parsed) {
    const k = nightKeyOf(u.t0);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(u);
  }
  const out = [];
  for (const [k, us] of by) {
    const beats = [];
    const beatsRaw = [];
    for (const u of us) {
      beats.push(...u.beats);
      beatsRaw.push(...u.beatsRaw);
    }
    beats.sort((a, b) => a - b);
    beatsRaw.sort((a, b) => a - b);
    const rep = us.slice().sort((a, b) => b.e.size - a.e.size)[0];
    out.push({
      key: k,
      t0: Math.min(...us.map((u) => u.t0)),
      t1: Math.max(...us.map((u) => u.t1)),
      // COVERED duration, not span: a merged night with holes must not claim the holes as reference.
      durMs: us.reduce((a, u) => a + u.durMs, 0),
      beats,
      beatsRaw,
      res: rep.res,
      nSess: us.length
    });
  }
  return out;
}
const ecgNights = buildEcgNights(ecgs);

const nights = [];
for (const unit of buildUnits(fingerFiles)) {
  const fres = unit.res;
  const frec = { t0Ms: unit.t0, durSec: (unit.t1 - unit.t0) / 1000 };
  const f = { p: unit.name };
  /* Sleep filter on the MERGED window, not on a filename stamp: a merged night starts at its earliest
     session, which is not necessarily the largest file. Read with getUTC* because tMs is floating
     wall-clock (CLAUDE.md §5) — using local getters would make the filter depend on the reader's zone. */
  if (SLEEP_ONLY) {
    const hh = new Date(unit.t0).getUTCHours();
    const okHour = hh >= 20 || hh < 4;
    if (!(okHour && (frec.durSec || 0) >= 4 * 3600)) continue; // §4: sleep nights only
  }
  const fBeats = unit.beats;
  if (fBeats.length < 100) continue;
  const fw = [unit.t0, unit.t1];
  /* Pair against the merged ECG NIGHT with the greatest overlap. Still an overlap search rather than a
     key lookup, so a finger night straddling the 12 h boundary still finds its reference. §3.2's
     sub-sample refinement already happened in buildEcgNights — unrefined, the H10's integer grid
     injects 3.14 ms of interval quantization into the finger's measured jitter. */
  let best = null;
  for (const u of ecgNights) {
    const ov = Math.min(fw[1], u.t1) - Math.max(fw[0], u.t0);
    if (ov > EPOCH_MS && (!best || ov > best.ov)) best = { ov, u };
  }
  if (!best) continue;
  const eBeats = best.u.beats;
  const eBeatsRaw = best.u.beatsRaw;

  const jit = [],
    rawJit = [],
    lags = [],
    rates = [];
  const lo = Math.max(fw[0], best.u.t0),
    hi = Math.min(fw[1], best.u.t1);
  for (let t = lo; t + EPOCH_MS <= hi; t += EPOCH_MS) {
    const fe = fBeats.filter((x) => x >= t && x < t + EPOCH_MS);
    const ee = eBeats.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    if (fe.length < 60 || ee.length < 60) continue;
    const coarse = envelopeLagMs(hrEnvelope(fe, t, t + EPOCH_MS), hrEnvelope(ee, t, t + EPOCH_MS));
    if (!coarse) continue;
    const lag = refineLagByMatch(fe, ee, coarse.lagMs); // §3.3 stage (b)
    const pairs = matchBeats(fe, ee, lag.lagMs);
    const rate = pairs.length / fe.length;
    const j = ppiJitterMs(fe, ee, pairs);
    if (!j) continue;
    jit.push(j.sd);
    /* The SAME epoch scored against the UNREFINED reference, so §3.2's refinement is measured rather
       than assumed. Measured on this corpus it removes ~0.08 ms at the finger's ~26 ms jitter (they add
       in quadrature, so 3.14 ms against 26 ms is invisible) — but it would be ~13 % at the Verity's
       ~6 ms. Reported, because "negligible" is a claim about a specific device's noise floor, not a
       property of the method. */
    const eeRaw = eBeatsRaw.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    const jr = ppiJitterMs(fe, eeRaw, matchBeats(fe, eeRaw, lag.lagMs));
    if (jr) rawJit.push(jr.sd);
    lags.push(lag.lagMs);
    rates.push(rate);
  }
  if (jit.length < MIN_EPOCHS) continue;
  /* CVHR AGREEMENT (§4's third criterion, never previously measured). Both nodes run the SAME detector
     — PpgDex's `cvhrFromNN` is a faithful port of `ECGDSP.detectCVHR`, deliberately, so the Integrator
     corroborates like against like. That makes this a comparison of the DEVICES, not of two methods.
     The Integrator's band is |Δ| ≤ 5.0 events/h (`CVHR_AGREE_PER_H`).

     Both indices are events per HOUR over each node's own record, and the two records do not cover the
     same window — so the OVERLAP FRACTION is reported beside the gap. A pair that overlaps 40 % is not
     evidence of disagreement; it is two different nights being compared, and folding it in silently is
     how a rate comparison fabricates a discrepancy. */
  const cvF = fres.cvhrIndex,
    cvE = best.u.res.cvhr ? best.u.res.cvhr.index : null;
  const fDur = (frec.durSec || 0) * 1000,
    eDur = best.u.durMs;
  const ovFrac = fDur > 0 && eDur > 0 ? best.ov / (Math.max(fDur, eDur) / 1000) : null;
  const rf = fres.rmssd,
    re = best.u.res.rmssd;
  /* READ `dispSd`, NOT `sdnn`. This is the field that makes §4's sdnnRobust criterion measurable, and
     getting it wrong produced a confident −29 % that was an artifact of pairing.

       ECGDex `sdnn`    whole-record SDNN — carries the between-epoch (SDANN) variance
       ECGDex `dispSd`  MEDIAN of per-5-min epoch SDNN — and it is what the EXPORT publishes as
                        `hrv.time.sdnn` for a long record
       PpgDex `sdnnRobust`  quality-gated MEDIAN of per-5-min epoch SDNN

     So `dispSd` is `sdnnRobust`'s like-for-like counterpart and always was; ECGDex simply names it
     differently. Verified rather than assumed: `dispSd` === median(epochs[].sdnn) to the reported
     decimal. On one night the wrong pair reads −35.0 % and the right pair +13.7 %; the wrong pair also
     read −29 % on BOTH devices, which was the tell — a constant offset of construction. */
  const sf = fres.sdnnRobust,
    se = best.u.res.dispSd != null ? best.u.res.dispSd : best.u.res.sdnn;
  nights.push({
    name: f.p.split('/').pop(),
    eps: jit.length,
    jitter: median(jit),
    rate: median(rates),
    lag: median(lags),
    refGain: rawJit.length ? median(rawJit) - median(jit) : null,
    cvF,
    cvE,
    cvGap: cvF != null && cvE != null ? Math.abs(cvF - cvE) : null,
    ovFrac,
    rf,
    re,
    bias: rf != null && re ? ((rf - re) / re) * 100 : null,
    sdnnBias: sf != null && se ? ((sf - se) / se) * 100 : null
  });
  const n = nights[nights.length - 1];
  console.log(
    `${n.name.slice(0, 42).padEnd(42)} ${String(n.eps).padStart(4)} ${n.jitter.toFixed(2).padStart(10)} ${(n.rate * 100).toFixed(1).padStart(7)} ${n.lag.toFixed(0).padStart(8)} ${String(n.rf ?? '—').padStart(9)} ${String(n.re ?? '—').padStart(8)} ${(n.bias == null ? '—' : n.bias.toFixed(1)).padStart(7)} ${(n.sdnnBias == null ? '—' : n.sdnnBias.toFixed(1)).padStart(9)}`
  );
}

if (!nights.length) {
  console.log('\nno night produced ≥' + MIN_EPOCHS + ' comparable epochs — nothing to report.');
  process.exit(0);
}
const J = nights.map((n) => n.jitter);
const Bs = nights.filter((n) => n.bias != null).map((n) => n.bias);
const S = nights.filter((n) => n.sdnnBias != null).map((n) => n.sdnnBias);
const R = nights.map((n) => n.rate * 100);
const fmt = (a) => (a.length ? `median ${median(a).toFixed(2)}  IQR ${quantile(a, 0.25).toFixed(2)}–${quantile(a, 0.75).toFixed(2)}` : 'n/a');
console.log(`\n${nights.length} night(s) with ≥${MIN_EPOCHS} comparable epochs\n`);
/* The reference is DEVICE-KEYED and repeats the device name on the line. It used to print
   "[Verity wrist reference: 5.92 ms]" beside whatever `--device` selected — and `--device` defaults to
   o2ring, so a finger median printed next to a wrist reference as if the two were a matched pair.
   The header at the top of this output DOES name the device correctly, which is exactly why the
   failure survives: anyone reading the summary through `| tail` (CLAUDE.md §👥.4b) keeps the unkeyed
   reference and discards the label. Measured 2026-08-17 — a finger 7.74 read as a +31 % miss against
   5.92 when the Verity leg on the same nights read 4.98, i.e. BETTER than the reference. A label must
   travel with the number it labels, not sit at the top of the page. */
console.log(
  `  PPI-jitter sd (PRIMARY)   ${fmt(J)} ms      [${DEVICE === 'verity' ? 'Verity WRIST reference: 5.92 ms — like-for-like' : 'no published reference for the O2Ring FINGER; 5.92 ms is the VERITY WRIST figure and is NOT comparable'}]`
);
console.log(`  beat match rate           ${fmt(R)} %`);
console.log(`  RMSSD bias vs ECG         ${fmt(Bs)} %`);
/* §4: CVHR promotes only if the finger agrees with ECGDex within the Integrator's band on SLEEP nights.
   Scored only where BOTH nodes produced an index and the records genuinely overlap — a thin overlap makes
   the per-hour rates describe different nights. */
const CVHR_BAND = 5.0;
const cvPairs = nights.filter((n) => n.cvGap != null && n.ovFrac != null && n.ovFrac >= 0.5);
if (cvPairs.length) {
  const gaps = cvPairs.map((n) => n.cvGap);
  const agree = gaps.filter((g) => g <= CVHR_BAND).length;
  console.log(`  CVHR |Δ| events/h         ${fmt(gaps)}   ${agree}/${cvPairs.length} within the Integrator band (±${CVHR_BAND})`);
  console.log(`                            finger median ${median(cvPairs.map((n) => n.cvF)).toFixed(2)} /h · ECG median ${median(cvPairs.map((n) => n.cvE)).toFixed(2)} /h · overlap ≥50 %`);
} else {
  console.log('  CVHR |Δ| events/h         no pair with ≥50 % record overlap AND an index from both nodes');
}
/* §4's `sdnnRobust → validated` bar is ±3.5 %, and THIS TOOL CANNOT ADJUDICATE IT — so the number is
   withheld rather than printed with a caveat nobody reads. `sdnnRobust` is a quality-gated MEDIAN of
   per-5-min SDNN; ECGDex publishes only whole-record `sdnn`, which structurally includes the
   between-epoch (SDANN) variance the per-5-min median excludes. Comparing them is comparing two
   different quantities, and the measurement says so plainly: it read −29 % on the FINGER and −29 % on
   the WRIST, i.e. a constant offset of construction, not a property of either device. PpgDex's own
   export note puts sdnnRobust at ~+3.5 % vs "ECG truth" — meaning the ECG's per-5-min equivalent, which
   nothing currently computes. Constructing that reference here would be reimplemented HRV math (§3.5
   forbids it) and would be approximate exactly where the bar is ±3.5 %. */
console.log(`  sdnnRobust vs ECG dispSd  ${fmt(S)} %      [§4 promotion bar: within ~±3.5 %]`);
console.log(`  ^ dispSd is ECGDex's MEDIAN of per-5-min epoch SDNN — sdnnRobust's like-for-like counterpart.
    Pairing it against whole-record \`sdnn\` instead reads ~−29 % on BOTH devices: an offset of construction.`);
console.log(
  '\nThe match rate is reported BESIDE the jitter, never folded into it: a low rate means the jitter\n' +
    'figure describes whichever beats happened to pair, not the night. Read them together or not at all.'
);
