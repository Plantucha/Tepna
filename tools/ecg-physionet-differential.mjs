#!/usr/bin/env node
/*
 * tools/ecg-physionet-differential.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * SCORE THE SHIPPED QRS DETECTOR AGAINST INDEPENDENTLY ANNOTATED BEATS.
 *
 * The suite has never had independent ground truth for Pan–Tompkins. What it has is a synthetic
 * harness: `papers/qrs-yield.html` reports ECGDex QRS recall 100.0 % / precision 100.0 % over
 * ~187 768 beats, and says plainly what that is — "This is synthetic ground truth ... not measured
 * human rates", and "a real validation needs simultaneous reference ECG ... which this harness
 * motivates rather than replaces". A generator plants QRS complexes from a model and the detector
 * finds them; agreement is close to a tautology, and the paper does not claim otherwise.
 *
 * MIT-BIH beat annotations are the other thing: placed by human experts on real recordings that
 * contain PVCs, bundle-branch blocks, paced beats, baseline wander and electrode artifact — none of
 * which a generator produces unless someone thought to model them. This tool joins those annotations
 * to the shipped detector's output and reports sensitivity / PPV / RR agreement.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
 * ⚠️ **It is NOT the A/B that would justify replacing the detector.** `VIGIL-DEEP-ANALYSIS` decided
 * that question three times over and decided it the other way: "gate any ECGDex switch on a real
 * tri-device-corpus (20 nights, H10-01) A/B, not MIT-BIH — a corpus win, not a paper win." That
 * ruling stands and this tool does not reopen it.
 *
 * The two questions are genuinely different, which is the only reason this one is worth asking:
 *
 *     "does our Pan–Tompkins find the beats that are really there?"   ← this tool, needs annotated truth
 *     "should ECGDex switch to EngZee / PT++ for OUR hardware?"       ← tri-device A/B, needs OUR nights
 *
 * The tri-device corpus structurally cannot answer the first: it has no annotated truth at all. That
 * is `BEAT-CAPTURE-RECAPTURE`'s finding — a single-source cell mixes a real beat the other detectors
 * missed with a spike this one invented, and no count of cell sizes can separate them, which is why
 * the closed-form estimator returned "48.5 % of beats missed by everything" on a clean night. An
 * annotated record is the instrument that brief says is needed. Conversely MIT-BIH cannot answer the
 * second: 360 Hz two-lead clinical tape is not a 130 Hz single-lead chest strap worn overnight.
 *
 * ── P5 GATES THE NUMBERS, NOT THIS FILE ──────────────────────────────────────────────────────
 * `STRATEGIC-PRIORITIES` §P5 ("PUBLIC-BENCHMARK VALIDATION — GATED") names MIT-BIH (QRS) as
 * credibility currency behind an owner-set gate: "~2 weeks of error-free operation; possibly PAT
 * producing credible output". **Nothing produced here may be published as external validation until
 * the owner opens that gate.**
 *
 * ⚖️ OWNER RULING 2026-09-12 — the gate is on PUBLICATION, not on MEASUREMENT. Running this tool
 * internally and acting on what it finds is PERMITTED NOW: a benchmark that exposes a real DSP
 * defect is an ordinary bug report and an ordinary PR. Only quoting a rate OUTSIDE the repo is
 * gated. And "~2 weeks of error-free operation" is deliberately NOT mechanised — three checkable
 * criteria were offered and all three declined; it stays the owner's judgment call, so ASK, and
 * never read a green proxy (nights folded, CI passing) as the gate having opened. The instrument is not the claim — `tools/nsrr-stage-validate.mjs`
 * covers NSRR/MESA, which sits in the same gated list, and landed on exactly that basis: the work is
 * "blocked on RECORDS, not on code, and the way to keep that true is to build the path and PROVE it,
 * so the day a record arrives the only new variable is the record."
 *
 * ── NO FETCHING, EVER ────────────────────────────────────────────────────────────────────────
 * This tool never downloads anything. The suite is 100 % local by construction and a gitignored
 * corpus is the owner's to place. See `docs/ECG-PHYSIONET-DIFFERENTIAL-README.md` for the one-time
 * download step. Absent records ⇒ an explicit SKIP that prints every path it searched, and NO
 * metrics — an absence spent as a green is the shape CLAUDE.md §4b exists to prevent.
 *
 * ── PRE-STATED BANDS (registered BEFORE the first run; do not tune after seeing a number) ─────
 * Pan & Tompkins (1985) reported 99.3 % sensitivity / 0.675 % total error over the MIT-BIH
 * arrhythmia database; independent reimplementations land ≈99.3–99.8 % Se and PPV on the same
 * 48-record set. Pooled over whatever records are present:
 *
 *     Se ≥ 99.0 % AND PPV ≥ 99.0 %   → CONSISTENT with a correct Pan–Tompkins. No defect.
 *     95.0 % ≤ min(Se, PPV) < 99.0 % → SHORTFALL. Materially below the published envelope; a real
 *                                      finding, and a SEPARATE PR — this tool ships no DSP change.
 *     min(Se, PPV) < 95.0 %          → DEFECT.
 *
 * RR agreement on matched beats, against annotation-derived RR:
 *     |bias| ≤ 5 ms AND 95 % LoA half-width ≤ 25 ms → consistent. At 360 Hz one sample is 2.78 ms and
 *     expert annotation placement is itself ±a few samples, so this band is about fiducial agreement,
 *     not detector jitter alone. A bias far outside it means a systematic placement offset.
 *
 * ⚠️ Per-record rates are reported but are NOT the headline: records 207, 108 and 203 are the
 * database's known-hard cases (ventricular flutter, severe artifact) and a low rate there is expected
 * rather than diagnostic. Judge the pooled number, report the per-record table, and never quote a
 * pooled rate without the record count and beat count beside it.
 *
 * USAGE
 *   node tools/ecg-physionet-differential.mjs --selftest         # prove the path; no records needed
 *   node tools/ecg-physionet-differential.mjs --dir <mitdb-dir>  # score real records
 *   node tools/ecg-physionet-differential.mjs --dir <d> --json
 *   node tools/ecg-physionet-differential.mjs --dir <d> --pin    # record sha256s into the manifest
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const require_ = createRequire(import.meta.url);
const DexBuild = require_('./build-core.js');
const AnalysisStats = require_('../analysis-stats.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'tools', 'physionet-mitdb-manifest.json');

/* The EC57 / WFDB match window. 150 ms is the standard for QRS detector evaluation. */
export const MATCH_MS = 150;

/* ── WFDB annotation codes ────────────────────────────────────────────────────────────────────
   From wfdb ecgcodes.h. `BEAT_CODES` is the set for which `isqrs()` is true — the annotations that
   mark an actual heartbeat. Everything else (rhythm changes `+`, noise `~`, artifact `|`, waveform
   boundaries, comments) marks something that is NOT a beat and must not enter the denominator.
   ⚠️ This is an explicit SET, not a range test. A range would quietly admit the next code someone
   adds to the file, and the denominator is the whole measurement. */
export const BEAT_CODES = new Set([
  1, // N  normal
  2, // L  LBBB
  3, // R  RBBB
  4, // a  aberrated atrial premature
  5, // V  PVC
  6, // F  fusion of ventricular and normal
  7, // J  nodal (junctional) premature
  8, // A  atrial premature
  9, // S  supraventricular premature
  10, // E  ventricular escape
  11, // j  nodal (junctional) escape
  12, // /  paced
  13, // Q  unclassifiable
  25, // B  bundle branch block beat (unspecified)
  30, // ?  learning
  31, // !  ventricular flutter wave
  34, // e  atrial escape
  35, // n  supraventricular escape
  38, // f  fusion of paced and normal
  41 // r  R-on-T PVC
]);

const AUX = 63,
  SKIP = 59,
  NUM = 60,
  SUB = 61,
  CHN = 62;

/* ── .hea ─────────────────────────────────────────────────────────────────────────────────────
   Line 1: `<record> <nsig> <fs> <nsamp>`. Then one line per signal:
   `<file> <format> <gain>(<baseline>)/<units> <bitres> <adczero> <initval> <checksum> <blk> <desc>` */
export function parseHea(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('empty .hea');
  const h = lines[0].split(/\s+/);
  const nsig = Number(h[1]);
  const fs = Number(h[2]);
  const nsamp = Number(h[3]);
  if (!Number.isFinite(nsig) || !Number.isFinite(fs) || nsig < 1) throw new Error('malformed .hea header line: ' + lines[0]);
  const signals = [];
  for (let i = 1; i <= nsig && i < lines.length; i++) {
    const f = lines[i].split(/\s+/);
    /* gain may be `200`, `200(0)/mV`, or `200/mV`. A baseline in parentheses OVERRIDES adczero as the
       physical zero; when it is absent adczero is the zero. Conflating them shifts the whole trace. */
    const gm = /^([0-9.+-]+)(?:\(([0-9.+-]+)\))?/.exec(f[2] || '200');
    const gain = gm && Number(gm[1]) ? Number(gm[1]) : 200;
    const baseline = gm && gm[2] !== undefined ? Number(gm[2]) : null;
    const adczero = Number(f[4]);
    signals.push({
      file: f[0],
      format: String(f[1] || '212'),
      gain,
      zero: baseline !== null && Number.isFinite(baseline) ? baseline : Number.isFinite(adczero) ? adczero : 0,
      desc: f.slice(8).join(' ') || 'sig' + (i - 1)
    });
  }
  return { record: h[0], nsig, fs, nsamp, signals };
}

/* ── .dat format 212 ──────────────────────────────────────────────────────────────────────────
   Two 12-bit two's-complement samples packed into three bytes, channel-interleaved. Format 16 is
   plain little-endian int16. Any other format is REFUSED rather than guessed: a wrong unpack yields
   a plausible-looking waveform, which is the worst possible failure here. */
export function readDat(buf, nsig, format) {
  const out = [];
  for (let c = 0; c < nsig; c++) out.push([]);
  if (format === '212') {
    const nPairs = Math.floor(buf.length / 3);
    let k = 0;
    for (let i = 0; i < nPairs; i++) {
      const b0 = buf[i * 3],
        b1 = buf[i * 3 + 1],
        b2 = buf[i * 3 + 2];
      let s1 = ((b1 & 0x0f) << 8) | b0;
      let s2 = ((b1 & 0xf0) << 4) | b2;
      if (s1 > 2047) s1 -= 4096;
      if (s2 > 2047) s2 -= 4096;
      out[k % nsig].push(s1);
      k++;
      out[k % nsig].push(s2);
      k++;
    }
  } else if (format === '16') {
    const n = Math.floor(buf.length / 2);
    for (let i = 0; i < n; i++) out[i % nsig].push(buf.readInt16LE(i * 2));
  } else {
    throw new Error('unsupported WFDB format "' + format + '" — only 212 and 16 are implemented; refusing to guess');
  }
  return out;
}

/* ── .atr ─────────────────────────────────────────────────────────────────────────────────────
   A stream of little-endian u16 words: `code = word >> 10`, `delta = word & 0x3FF`, time accumulates
   by delta. AUX(63) carries `delta` bytes of payload padded to even; SKIP(59) is followed by a
   32-bit interval; NUM/SUB/CHN annotate the previous annotation and do NOT advance time. */
export function readAtr(buf) {
  const anns = [];
  let t = 0,
    i = 0;
  while (i + 1 < buf.length) {
    const w = buf.readUInt16LE(i);
    i += 2;
    const code = (w >> 10) & 0x3f;
    const delta = w & 0x3ff;
    if (code === 0 && delta === 0) break; // end of file
    if (code === SKIP) {
      if (i + 3 >= buf.length) break;
      const hi = buf.readUInt16LE(i),
        lo = buf.readUInt16LE(i + 2);
      i += 4;
      t += (hi << 16) | lo;
      continue;
    }
    if (code === AUX) {
      i += delta + (delta % 2); // payload, padded to an even byte count
      continue;
    }
    if (code === NUM || code === SUB || code === CHN) continue; // modifiers; no time advance
    t += delta;
    anns.push({ sample: t, code });
  }
  return anns;
}

/* ── the headless realm ───────────────────────────────────────────────────────────────────────
   ECGDex's DSP is a classic browser script. `clock.js` first — `ecgdex-dsp.js` delegates its
   Clock-Contract parsing to `DexClock` and is one of the five bundles that actually inlines it. */
export function makeRealm() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.__DEX_NAMESPACED__ = true;
  const ctx = vm.createContext(sandbox);
  for (const f of ['clock.js', 'kernel-constants.js', 'ecgdex-dsp.js']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('module not found: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  if (!ctx.ECGDSP) throw new Error('ecg-physionet-differential: ECGDSP did not load');
  return ctx;
}

/* ── the join ─────────────────────────────────────────────────────────────────────────────────
   One-to-one nearest-neighbour matching inside ±MATCH_MS, walking both sorted trains once. A
   reference beat may be claimed by at most one detection and vice versa — without that, one noisy
   burst of detections can "match" the same beat repeatedly and inflate sensitivity.

   Returns index pairs, so the caller can derive RR agreement from the SAME matching rather than
   re-deriving it with a second, silently different rule. */
export function matchBeats(refMs, detMs, windowMs = MATCH_MS) {
  const pairs = [];
  const detUsed = new Uint8Array(detMs.length);
  let d = 0;
  for (let r = 0; r < refMs.length; r++) {
    while (d < detMs.length && detMs[d] < refMs[r] - windowMs) d++;
    let best = -1,
      bestErr = Infinity;
    for (let k = d; k < detMs.length && detMs[k] <= refMs[r] + windowMs; k++) {
      if (detUsed[k]) continue;
      const e = Math.abs(detMs[k] - refMs[r]);
      if (e < bestErr) {
        bestErr = e;
        best = k;
      }
    }
    if (best >= 0) {
      detUsed[best] = 1;
      pairs.push({ ref: r, det: best, errMs: detMs[best] - refMs[r] });
    }
  }
  const tp = pairs.length;
  return {
    pairs,
    tp,
    fn: refMs.length - tp,
    fp: detMs.length - tp,
    se: refMs.length ? (100 * tp) / refMs.length : null,
    ppv: detMs.length ? (100 * tp) / detMs.length : null
  };
}

/* RR agreement over CONSECUTIVE matched pairs only. A pair whose reference neighbour was missed does
   not yield an RR — splicing across a miss would manufacture a double-length interval and charge the
   fiducial placement for a detection failure that `fn` already counts. */
export function rrAgreement(refMs, detMs, pairs) {
  const diffs = [];
  for (let i = 1; i < pairs.length; i++) {
    const a = pairs[i - 1],
      b = pairs[i];
    if (b.ref !== a.ref + 1) continue; // a reference beat was missed between them
    diffs.push(detMs[b.det] - detMs[a.det] - (refMs[b.ref] - refMs[a.ref]));
  }
  return diffs.length ? AnalysisStats.blandAltman(diffs) : { n: 0, bias: null, sd: null, loa: null, arms: null };
}

export function verdict(se, ppv) {
  if (se == null || ppv == null) return 'NO DATA';
  const m = Math.min(se, ppv);
  if (m >= 99) return 'CONSISTENT';
  if (m >= 95) return 'SHORTFALL';
  return 'DEFECT';
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/* ── one record ───────────────────────────────────────────────────────────────────────────────
   Runs the detector NATIVELY at the record's own sampling rate. Resampling to the H10's 130 Hz was
   considered and rejected: a resampler injects its own fiducial error, so a shortfall would no longer
   be attributable to the detector. Running native also exercises the detector's fs-generality, which
   is a property the shipped code claims by taking fs as a parameter. */
export function scoreRecord(ctx, rec) {
  const { hea, dat, atr } = rec;
  const head = parseHea(hea);
  const chans = readDat(dat, head.nsig, head.signals[0].format);
  const sig = chans[0];
  const s0 = head.signals[0];
  // physical µV — Pan–Tompkins is adaptive and largely scale-free, but a consistent unit keeps the
  // amplitude in the range the shipped thresholds were written against.
  const int16 = new Int16Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    const uv = ((sig[i] - s0.zero) / s0.gain) * 1000;
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(uv)));
  }
  const anns = readAtr(atr).filter((a) => BEAT_CODES.has(a.code));
  const msPerSample = 1000 / head.fs;
  const refMs = anns.map((a) => a.sample * msPerSample);

  const out = ctx.ECGDSP.analyze({ int16, fs: head.fs, t0Ms: 0, durSec: sig.length / head.fs, gaps: [] });
  /* ⚠️ `analyze().times` is in SECONDS (sub-sample-refined, relative to t0Ms). The reference train is
     built in milliseconds from annotation sample indices, so this conversion is load-bearing: without
     it every comparison is off by 1000× and the matcher returns tp=0 while both trains look healthy.
     That is exactly how it was written the first time, and the end-to-end selftest did not catch it
     because it asserted only that both trains were NON-EMPTY. `alignmentSpanCheck` below now asserts
     the two trains occupy the same timebase, which is the assertion that would have caught it. */
  if (!Array.isArray(out.times)) throw new Error('ECGDSP.analyze returned no `times` array — the beat-time field moved; refusing to guess');
  const detMs = out.times.map((s) => s * 1000);

  const m = matchBeats(refMs, detMs);
  return {
    record: head.record,
    fs: head.fs,
    lead: s0.desc,
    refBeats: refMs.length,
    detBeats: detMs.length,
    /* published so a unit or timebase mismatch is visible in the output rather than only in a rate */
    detSpanMs: detMs.length > 1 ? detMs[detMs.length - 1] - detMs[0] : null,
    refSpanMs: refMs.length > 1 ? refMs[refMs.length - 1] - refMs[0] : null,
    tp: m.tp,
    fp: m.fp,
    fn: m.fn,
    se: m.se,
    ppv: m.ppv,
    rr: rrAgreement(refMs, detMs, m.pairs)
  };
}

/* ── corpus discovery ─────────────────────────────────────────────────────────────────────────
   Absent records is a SKIP that prints every path it looked at, never a pass. */
function searchPaths(dirArg) {
  const p = [];
  if (dirArg) p.push(dirArg);
  if (process.env.DEX_PHYSIONET) p.push(process.env.DEX_PHYSIONET);
  p.push(join(ROOT, 'uploads', 'physionet', 'mitdb'));
  p.push(join(ROOT, '..', 'physionet', 'mitdb'));
  return p;
}

function findRecords(dir) {
  if (!dir || !existsSync(dir)) return [];
  const heas = readdirSync(dir).filter((f) => f.endsWith('.hea'));
  const recs = [];
  for (const h of heas) {
    const id = basename(h, '.hea');
    const dat = join(dir, id + '.dat'),
      atr = join(dir, id + '.atr');
    if (existsSync(dat) && existsSync(atr)) recs.push({ id, hea: join(dir, h), dat, atr });
  }
  return recs.sort((a, b) => a.id.localeCompare(b.id));
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return { records: {} };
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { records: {} };
  }
}

/* ══ SELFTEST ═════════════════════════════════════════════════════════════════════════════════
   Proves the PATH, never the DETECTOR. It builds a WFDB record in memory, reads it back, and checks
   the join arithmetic against PLANTED truth.

   ⚠️ It deliberately does NOT report Se/PPV for the shipped detector on synthetic input. That number
   would be scored by the same assumptions the detector holds — the circular oracle this whole file
   exists to escape — and printing it would be indistinguishable, in a log, from a real result. */
function pack212(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(Math.ceil(n / 2) * 3);
  for (let i = 0; i < n; i += 2) {
    const a = samples[i] & 0xfff,
      b = (samples[i + 1] || 0) & 0xfff;
    buf[(i / 2) * 3] = a & 0xff;
    buf[(i / 2) * 3 + 1] = ((a >> 8) & 0x0f) | ((b >> 4) & 0xf0);
    buf[(i / 2) * 3 + 2] = b & 0xff;
  }
  return buf;
}

function packAtr(anns) {
  const words = [];
  let prev = 0;
  for (const a of anns) {
    const d = a.sample - prev;
    prev = a.sample;
    words.push(((a.code & 0x3f) << 10) | (d & 0x3ff));
  }
  words.push(0);
  const buf = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => buf.writeUInt16LE(w, i * 2));
  return buf;
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log('  ✓ ' + name);
    } else {
      fail++;
      console.log('  ✕ ' + name + (detail ? '  — ' + detail : ''));
    }
  };
  console.log('▸ ecg-physionet-differential --selftest');

  // 1 · 212 round-trip, including negative values and the 12-bit sign boundary
  const samples = [0, 1, -1, 2047, -2048, 100, -100, 7];
  const back = readDat(pack212(samples), 1, '212')[0].slice(0, samples.length);
  ok('212 pack/unpack round-trips, sign boundary included', JSON.stringify(back) === JSON.stringify(samples), JSON.stringify(back));

  // 2 · two interleaved channels stay separated
  const two = readDat(pack212([10, 20, 11, 21]), 2, '212');
  ok('212 de-interleaves 2 channels', JSON.stringify(two[0]) === '[10,11]' && JSON.stringify(two[1]) === '[20,21]', JSON.stringify(two));

  // 3 · an unsupported format REFUSES rather than guessing
  let refused = false;
  try {
    readDat(Buffer.alloc(6), 1, '80');
  } catch {
    refused = true;
  }
  ok('an unsupported WFDB format is refused, not guessed', refused);

  // 4 · .hea baseline in parentheses overrides adczero
  const hd = parseHea('t 2 360 100\nt.dat 212 200(50)/mV 11 1024 0 0 0 MLII\nt.dat 212 200 11 1024 0 0 0 V5');
  ok('.hea parses fs and nsig', hd.fs === 360 && hd.nsig === 2);
  ok('.hea baseline in parens overrides adczero', hd.signals[0].zero === 50, String(hd.signals[0].zero));
  ok('.hea falls back to adczero when no baseline', hd.signals[1].zero === 1024, String(hd.signals[1].zero));

  // 5 · .atr time accumulation, non-beat exclusion, AUX payload skipping
  const atr = readAtr(
    packAtr([
      { sample: 100, code: 1 },
      { sample: 400, code: 5 },
      { sample: 700, code: 28 },
      { sample: 1000, code: 1 }
    ])
  );
  ok('.atr accumulates time deltas', JSON.stringify(atr.map((a) => a.sample)) === '[100,400,700,1000]', JSON.stringify(atr.map((a) => a.sample)));
  const beats = atr.filter((a) => BEAT_CODES.has(a.code));
  ok('a rhythm marker (+, code 28) is NOT counted as a beat', beats.length === 3, String(beats.length));

  // 6 · the matcher's arithmetic, against PLANTED truth — one miss, one extra, one just outside window
  const ref = [1000, 2000, 3000, 4000];
  const det = [1010, 3020, 3500, 4000 + MATCH_MS + 10];
  const m = matchBeats(ref, det);
  ok('matcher: TP counts only beats inside the window', m.tp === 2, 'tp=' + m.tp);
  ok('matcher: a reference beat with no detection is FN', m.fn === 2, 'fn=' + m.fn);
  ok('matcher: a detection matching nothing is FP', m.fp === 2, 'fp=' + m.fp);
  ok('matcher: a detection just OUTSIDE the window does not match', Math.abs(m.se - 50) < 1e-9, 'se=' + m.se);

  // 7 · one-to-one — a burst of detections cannot claim the same beat twice
  const burst = matchBeats([1000], [990, 1000, 1010]);
  ok('matcher is one-to-one: 3 detections on 1 beat give tp=1, fp=2', burst.tp === 1 && burst.fp === 2, 'tp=' + burst.tp + ' fp=' + burst.fp);

  // 8 · RR agreement skips intervals that span a missed reference beat
  const rrPairs = matchBeats([1000, 2000, 3000], [1000, 3000]);
  const rr = rrAgreement([1000, 2000, 3000], [1000, 3000], rrPairs.pairs);
  ok('RR agreement excludes an interval spanning a missed beat', rr.n === 0, 'n=' + rr.n);
  const rrClean = matchBeats([1000, 2000, 3000], [1004, 2004, 3004]);
  const rr2 = rrAgreement([1000, 2000, 3000], [1004, 2004, 3004], rrClean.pairs);
  ok('RR agreement on a constant offset gives ~0 bias', rr2.n === 2 && Math.abs(rr2.bias) < 1e-9, 'n=' + rr2.n + ' bias=' + rr2.bias);

  // 9 · the verdict bands are the PRE-STATED ones
  ok('band: 99.5/99.5 is CONSISTENT', verdict(99.5, 99.5) === 'CONSISTENT');
  ok('band: 98.0/99.9 is SHORTFALL (min governs)', verdict(98.0, 99.9) === 'SHORTFALL');
  ok('band: 94.9 is DEFECT', verdict(94.9, 99.9) === 'DEFECT');

  // 10 · end-to-end: a synthetic record drives the REAL detector through the real reader.
  //      Asserts the CHAIN runs and produces beats. Deliberately asserts NO rate.
  let chain = 'not run';
  try {
    const fs = 360,
      secs = 30,
      n = fs * secs;
    const sig = new Array(n).fill(0);
    const annList = [];
    for (let b = 0; b < secs; b++) {
      const c = Math.round((b + 0.5) * fs);
      // a crude QRS: sharp positive deflection over ~10 samples
      for (let k = -5; k <= 5; k++) if (c + k >= 0 && c + k < n) sig[c + k] = Math.round(600 * Math.exp(-(k * k) / 2));
      annList.push({ sample: c, code: 1 });
    }
    const dir = mkdtempSync(join(tmpdir(), 'physionet-self-'));
    const hea = 'selftest 1 360 ' + n + '\nselftest.dat 212 200 11 0 0 0 0 MLII\n';
    writeFileSync(join(dir, 'selftest.hea'), hea);
    writeFileSync(join(dir, 'selftest.dat'), pack212(sig));
    writeFileSync(join(dir, 'selftest.atr'), packAtr(annList));
    const ctx = makeRealm();
    const r = scoreRecord(ctx, {
      hea: readFileSync(join(dir, 'selftest.hea'), 'utf8'),
      dat: readFileSync(join(dir, 'selftest.dat')),
      atr: readFileSync(join(dir, 'selftest.atr'))
    });
    rmSync(dir, { recursive: true, force: true });
    chain = 'ref=' + r.refBeats + ' det=' + r.detBeats + ' tp=' + r.tp;
    ok('end-to-end: reader → ECGDSP.analyze → matcher runs and both trains are non-empty', r.refBeats > 0 && r.detBeats > 0, chain);
    ok('end-to-end: the planted annotation count is recovered by the reader', r.refBeats === annList.length, 'ref=' + r.refBeats);
    /* ⚠️ THE UNIT / ALIGNMENT ASSERTIONS. These are NOT a detector rate and must not be read as one —
       they check that the two trains live on the SAME timebase. Without them a seconds-vs-milliseconds
       error (which this tool shipped in its first draft) leaves both trains non-empty, both plausible,
       and every match missing. The first version of this selftest asserted only non-emptiness and
       passed with the bug in place. */
    ok(
      'end-to-end: the detected train spans the record, not 1/1000th of it — unit check, NOT a rate',
      r.detSpanMs > 0.5 * (secs * 1000) && r.detSpanMs <= secs * 1000,
      'detSpanMs=' + (r.detSpanMs == null ? 'null' : r.detSpanMs.toFixed(1)) + ' recordMs=' + secs * 1000
    );
    ok('end-to-end: the join actually aligns — a unit-mismatched train matches nothing', r.tp > 0, chain);
  } catch (e) {
    ok('end-to-end: reader → ECGDSP.analyze → matcher runs', false, String((e && e.message) || e));
  }

  console.log("\n  ⚠️ NO Se/PPV is reported here by design — synthetic input scored by the detector's own");
  console.log('     assumptions is a circular oracle. Only --dir over real annotated records yields a rate.');
  console.log('\n' + (fail ? '✕ ' + fail + ' failed, ' : '✓ ') + pass + ' assertions passed');
  return fail ? 1 : 0;
}

/* ══ MAIN ═════════════════════════════════════════════════════════════════════════════════════ */
function main(argv) {
  const has = (f) => argv.includes(f);
  if (has('--selftest')) return selftest();
  const json = has('--json');
  const pin = has('--pin');
  const di = argv.indexOf('--dir');
  const dirArg = di >= 0 ? argv[di + 1] : null;

  const paths = searchPaths(dirArg);
  let dir = null,
    recs = [];
  for (const p of paths) {
    const r = findRecords(p);
    if (r.length) {
      dir = p;
      recs = r;
      break;
    }
  }

  if (!recs.length) {
    const payload = { status: 'skipped', reason: 'no MIT-BIH records found', searched: paths };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log('⊘ SKIP — no MIT-BIH records found. NO METRICS PRODUCED.\n');
      console.log('  Searched, in order:');
      for (const p of paths) console.log('    · ' + p + (existsSync(p) ? '  (exists, no .hea/.dat/.atr triples)' : '  (absent)'));
      console.log('\n  This tool never downloads anything — the corpus is gitignored and placing it is the');
      console.log("  owner's act. See docs/ECG-PHYSIONET-DIFFERENTIAL-README.md for the one-time step,");
      console.log('  or set DEX_PHYSIONET=<dir>.');
      console.log('\n  ⚠️ A skip is not a pass: nothing here says the detector is correct.');
    }
    return 0;
  }

  const man = loadManifest();
  const ctx = makeRealm();
  const rows = [];
  const pins = {};
  for (const r of recs) {
    const hea = readFileSync(r.hea, 'utf8'),
      dat = readFileSync(r.dat),
      atr = readFileSync(r.atr);
    const h = sha256(dat);
    pins[r.id] = h;
    const expect = man.records && man.records[r.id] ? man.records[r.id].sha256 : undefined;
    /* null means "not yet pinned" — §∅: an unmeasured value is null, never a fabricated match. It is
       reported as unpinned rather than silently treated as verified. A MISMATCH is refused outright. */
    let pinState = 'unpinned';
    if (expect) {
      if (expect !== h) {
        rows.push({ record: r.id, error: 'sha256 mismatch — refusing', expected: expect, got: h });
        continue;
      }
      pinState = 'pinned';
    }
    try {
      const row = scoreRecord(ctx, { hea, dat, atr });
      row.pin = pinState;
      rows.push(row);
    } catch (e) {
      rows.push({ record: r.id, error: String((e && e.message) || e) });
    }
  }

  if (pin) {
    const out = { note: 'sha256 of each .dat. null = not yet pinned (§∅ absence is null).', records: {} };
    for (const [k, v] of Object.entries(pins)) out.records[k] = { sha256: v };
    writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n');
    console.log('pinned ' + Object.keys(pins).length + ' record hashes into ' + MANIFEST);
  }

  const scored = rows.filter((r) => !r.error);
  const tp = scored.reduce((s, r) => s + r.tp, 0),
    fp = scored.reduce((s, r) => s + r.fp, 0),
    fn = scored.reduce((s, r) => s + r.fn, 0);
  const se = tp + fn ? (100 * tp) / (tp + fn) : null;
  const ppv = tp + fp ? (100 * tp) / (tp + fp) : null;
  /* The DENOMINATOR is published, not implied. A pooled rate over 3 of 48 records is a different claim
     from one over 48, and a summary that omits the expected set lets the two read alike — CLAUDE.md's
     "a floor cannot detect exclusion". */
  const expected = Object.keys((man && man.records) || {}).length;
  const summary = {
    status: 'scored',
    dir,
    records: scored.length,
    recordsExpected: expected || null,
    partialCorpus: expected ? scored.length < expected : null,
    refBeats: tp + fn,
    tp,
    fp,
    fn,
    sensitivityPct: se,
    ppvPct: ppv,
    verdict: verdict(se, ppv),
    bands: { consistent: '>=99.0 both', shortfall: '95.0-99.0', defect: '<95.0' }
  };

  if (json) {
    console.log(JSON.stringify({ summary, records: rows }, null, 2));
    return 0;
  }
  console.log('▸ ECGDex Pan–Tompkins vs annotated beats — ' + dir + '\n');
  console.log('  record   lead        ref     det      TP    FP    FN      Se%      PPV%   pin');
  for (const r of rows) {
    if (r.error) {
      console.log('  ' + r.record.padEnd(8) + ' ERROR — ' + r.error);
      continue;
    }
    console.log(
      '  ' +
        String(r.record).padEnd(8) +
        String(r.lead).slice(0, 10).padEnd(11) +
        String(r.refBeats).padStart(6) +
        String(r.detBeats).padStart(8) +
        String(r.tp).padStart(6) +
        String(r.fp).padStart(6) +
        String(r.fn).padStart(6) +
        (r.se == null ? '     —' : r.se.toFixed(2).padStart(9)) +
        (r.ppv == null ? '     —' : r.ppv.toFixed(2).padStart(10)) +
        '   ' +
        r.pin
    );
  }
  console.log(
    '\n  POOLED over ' + scored.length + ' records / ' + (tp + fn) + ' annotated beats:  ' + 'Se ' + (se == null ? '—' : se.toFixed(3) + ' %') + '   PPV ' + (ppv == null ? '—' : ppv.toFixed(3) + ' %')
  );
  console.log('  Records scored: ' + scored.length + (expected ? ' of ' + expected + ' in the manifest' : ' (no manifest)'));
  if (expected && scored.length < expected) console.log('  ⚠️ PARTIAL CORPUS — this pooled rate is not the published 48-record figure and must not be compared to it.');
  console.log('  Verdict against the pre-stated bands: ' + summary.verdict);
  console.log('\n  ⚠️ P5 gates PUBLICATION of these numbers, not their measurement. Do not quote a pooled');
  console.log('     rate without the record count and beat count beside it.');
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('ecg-physionet-differential.mjs')) process.exit(main(process.argv.slice(2)));
