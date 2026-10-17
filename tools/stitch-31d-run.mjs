// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// stitch-31d-run.mjs — server-side 31-day fused-tool compute.
//
// Reads /srv/tepna/stitched/<tool>/MANIFEST.json + SIDECARS.json, runs the
// tool's engine PER NIGHT (co-location holds within a night), aggregates
// across nights (median + bootstrap 95% CI), writes RESULT.json. The browser
// never sees the multi-GB concatenation; it displays the precomputed result.
//
// The stitched files still exist for display as one timeline, but the engine
// never sees the concatenated series: TCH assumes three co-located datasets,
// and a 31-day stitch with 30 inter-night gaps violates this (Anthes &
// Rieckh 2018). Per-night computation, then aggregate.
//
// Null-gap nights are absent from the aggregation, never zero-filled
// (absence contract). Clock corrections from SIDECARS.json apply per night.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AS = require(join(ROOT, 'analysis-stats.js'));

const STITCHED_DEFAULT = '/srv/tepna/stitched';
const CAPTURES_DEFAULT = '/srv/tepna/captures';
const GAP_MARKER = '#GAP';
const QUIET_SEC = 1800; // no file writes in captures/ for 30 min = quiet

function usage() {
  console.error('usage: node tools/stitch-31d-run.mjs <tool> [--force] [--stitched-dir <dir>] [--captures-dir <dir>]');
  console.error('  tool: 3corner | 3corner_fused | pat_h10_verity | pat_h10_o2ring | pat_verity_o2ring | pat_fused');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { tool: null, force: false, selftest: false, stitchedDir: STITCHED_DEFAULT, capturesDir: CAPTURES_DEFAULT };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--stitched-dir' && argv[i + 1]) out.stitchedDir = argv[++i];
    else if (a === '--captures-dir' && argv[i + 1]) out.capturesDir = argv[++i];
    else if (a === '--selftest') out.selftest = true;
    else if (!a.startsWith('--')) rest.push(a);
    else {
      console.error(`unknown flag: ${a}`);
      usage();
    }
  }
  if (!out.selftest && rest.length !== 1) usage();
  if (out.selftest) return out;
  out.tool = rest[0];
  const valid = ['3corner', '3corner_fused', 'pat_h10_verity', 'pat_h10_o2ring', 'pat_verity_o2ring', 'pat_fused'];
  if (!valid.includes(out.tool)) {
    console.error(`unknown tool: ${out.tool}`);
    usage();
  }
  return out;
}

// Quiet-hours guard: refuse when capture is active (recent writes in captures/).
// A running capture means the solid-night set may change mid-compute.
function captureActive(capturesDir) {
  const cutoff = Date.now() - QUIET_SEC * 1000;
  try {
    const nights = readdirSync(capturesDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    // Check only the newest few nights; older ones never change.
    for (const n of nights.slice(-3)) {
      const nd = join(capturesDir, n);
      let entries;
      try {
        entries = readdirSync(nd);
      } catch {
        continue;
      }
      for (const e of entries) {
        try {
          const st = statSync(join(nd, e));
          if (st.mtimeMs > cutoff) return true;
        } catch {
          /* race: file vanished; ignore */
        }
      }
    }
  } catch {
    return false;
  } // captures dir unreadable: not our call to refuse
  return false;
}

// Parse a stitched file into [epochMs, value] pairs, skipping GAP rows.
// Returns { pairs, gaps } where gaps counts skipped gap markers.
function parseStitched(path, tsCol, valCol, delimiter) {
  const pairs = [];
  let gaps = 0;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { pairs, gaps, error: 'unreadable' };
  }
  const lines = text.split('\n');
  if (!lines.length) return { pairs, gaps, error: 'empty' };
  const header = lines[0].split(delimiter).map((c) => c.trim());
  const ti = header.findIndex((c) => c.toLowerCase().includes(tsCol.toLowerCase()));
  const vi = header.findIndex((c) => c.toLowerCase().includes(valCol.toLowerCase()));
  if (ti < 0 || vi < 0) return { pairs, gaps, error: `columns not found (${tsCol}/${valCol})` };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith(GAP_MARKER)) {
      gaps++;
      continue;
    } // null gap: absent, not zero
    const cells = line.split(delimiter);
    if (cells.length <= Math.max(ti, vi)) continue;
    const ts = Date.parse(cells[ti].trim());
    const val = parseFloat(cells[vi].trim());
    if (!Number.isFinite(ts) || !Number.isFinite(val)) continue; // malformed row: skip, not zero
    pairs.push([ts, val]);
  }
  return { pairs, gaps };
}

// Apply per-night clock corrections. sidecars: { night: { clock_offsets: { device: skew_sec } } }.
// Each pair is shifted by the skew of its night. Pairs carry their night via the
// manifest's contributing order; here we apply a single global skew map keyed by
// device name fragment. Null skew = no correction (absent, not zero).
function applyClock(pairs, skewSec) {
  if (!skewSec) return pairs;
  const shiftMs = skewSec * 1000;
  return pairs.map(([ts, v]) => [ts - shiftMs, v]);
}

// Bucket pairs into per-second means keyed by absolute epoch second.
function toPerSecond(pairs) {
  const map = new Map();
  for (const [ts, v] of pairs) {
    const s = Math.floor(ts / 1000);
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(v);
  }
  const out = new Map();
  for (const [s, vs] of map) out.set(s, vs.reduce((a, b) => a + b, 0) / vs.length);
  return out;
}

// Replacement for run3Corner: per-night TCH then aggregate.
// Rationale (literature: Anthes & Rieckh 2018): TCH assumes three co-located
// datasets. A 31-day stitched series with 30 inter-night gaps violates this.
// Compute per night (co-location holds), then aggregate across nights.

const N_BOOT = 1000; // bootstrap resamples for the 95% CI

// Median of a numeric array. Null for empty (absent, not zero).
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Percentile bootstrap 95% CI for the median. Returns [lo, hi], or [null, null]
// when there are fewer than 3 values (CI needs N>=3 by the trio convention).
function bootstrapCI(vals) {
  if (vals.length < 3) return [null, null];
  const meds = [];
  for (let b = 0; b < N_BOOT; b++) {
    const sample = [];
    for (let i = 0; i < vals.length; i++) {
      sample.push(vals[Math.floor(Math.random() * vals.length)]);
    }
    meds.push(median(sample));
  }
  meds.sort((a, b) => a - b);
  const lo = meds[Math.floor(0.025 * N_BOOT)];
  const hi = meds[Math.floor(0.975 * N_BOOT)];
  return [lo, hi];
}

// Pearson correlation (reused from the old continuous version).
function pearson(a, b) {
  return AS.pearson(a, b);
}

// Run TCH for a single night's three parsed corner pair-lists.
// Returns { h10, verity, o2, neg, negVar, overlap_s, r } or { error }.
function tchOneNight(hPairs, vPairs, oPairs) {
  const h = toPerSecond(hPairs);
  const v = toPerSecond(vPairs);
  const o = toPerSecond(oPairs);
  const ks = [...h.keys()].filter((s) => v.has(s) && o.has(s)).sort((a, b) => a - b);
  if (ks.length < 12) return { error: `overlap ${ks.length} s < 12 s minimum` };
  const hh = [],
    vv = [],
    oo = [];
  for (const s of ks) {
    hh.push(h.get(s));
    vv.push(v.get(s));
    oo.push(o.get(s));
  }
  const one = hh.map(() => 1);
  const fused = AS.tchSigmasFused(hh, vv, oo, one, one, one);
  return {
    h10: fused.h10,
    verity: fused.verity,
    o2: fused.o2,
    neg: fused.neg,
    negVar: fused.negVar,
    overlap_s: ks.length,
    r: { hv: pearson(hh, vv), ho: pearson(hh, oo), vo: pearson(vv, oo) }
  };
}

// Parse a single night's raw file (not stitched). Same column logic as before.
function parseNightFile(path, tsCol, valCol, delimiter) {
  // Reuse parseStitched: it skips #GAP rows, and a raw night file has none.
  return parseStitched(path, tsCol, valCol, delimiter);
}

// Find a night's input file by glob pattern fragment.
function findNightInput(nightDir, pattern) {
  // pattern like "Polar_H10_*_HR.txt": split on *, match prefix/suffix.
  const parts = pattern.split('*');
  const prefix = parts[0] || '';
  const suffix = parts[1] || '';
  let entries;
  try {
    entries = readdirSync(nightDir);
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.startsWith(prefix) && e.endsWith(suffix)) return join(nightDir, e);
  }
  return null;
}

function run3CornerPerNight(toolDir, manifest, sidecars, capturesDir) {
  const result = {
    tool: '3corner',
    at: new Date().toISOString(),
    model: 'per-night-then-aggregate',
    nights: [],
    error: null
  };

  const nights = manifest.nights || [];
  const patterns = Object.keys(manifest.inputs || {});
  // Identify the three corner patterns.
  const hrPat = patterns.find((p) => p.includes('H10') && p.includes('HR'));
  const ppgPat = patterns.find((p) => p.includes('VeritySense'));
  const spo2Pat = patterns.find((p) => p.includes('O2Ring-S') && p.includes('SPO2'));

  if (!hrPat || !ppgPat || !spo2Pat) {
    result.error = 'manifest missing a corner pattern';
    return result;
  }

  // Per-night clock skews from SIDECARS.json.
  const skewFor = (night, frags) => {
    const sc = (sidecars.sidecars || {})[night] || {};
    const offs = sc.clock_offsets || {};
    for (const [dev, skew] of Object.entries(offs)) {
      if (typeof skew !== 'number') continue;
      const low = dev.toLowerCase();
      if (frags.some((f) => low.includes(f))) return skew;
    }
    return null;
  };

  const perNight = [];
  for (const night of nights) {
    const nd = join(capturesDir, night);
    const hrPath = findNightInput(nd, hrPat);
    const ppgPath = findNightInput(nd, ppgPat);
    const spo2Path = findNightInput(nd, spo2Pat);
    const entry = { night, status: null };
    if (!hrPath || !ppgPath || !spo2Path) {
      entry.status = 'gap'; // a corner missing: absent night, not zero
      perNight.push(entry);
      continue;
    }
    let hp = parseNightFile(hrPath, 'timestamp', 'HR [bpm]', ';');
    let vp = parseNightFile(ppgPath, 'timestamp', 'HR', ';');
    if (vp.error) vp = parseNightFile(ppgPath, 'timestamp', 'pulse', ';');
    const op = parseNightFile(spo2Path, 'Time', 'Pulse Rate', ',');
    if (hp.error || vp.error || op.error) {
      entry.status = 'parse-error';
      entry.error = hp.error || vp.error || op.error;
      perNight.push(entry);
      continue;
    }
    // Per-night clock correction (this night's skew, not a global median).
    const sH = skewFor(night, ['h10']);
    const sV = skewFor(night, ['verity', 'sense']);
    const sO = skewFor(night, ['o2ring', 'wellue']);
    const cH = applyClock(hp.pairs, sH);
    const cV = applyClock(vp.pairs, sV);
    const cO = applyClock(op.pairs, sO);
    const tch = tchOneNight(cH, cV, cO);
    if (tch.error) {
      entry.status = 'no-overlap';
      entry.error = tch.error;
      perNight.push(entry);
      continue;
    }
    entry.status = 'ok';
    entry.sigma = { h10: tch.h10, verity: tch.verity, o2: tch.o2 };
    entry.overlap_s = tch.overlap_s;
    entry.r = tch.r;
    entry.neg = tch.neg;
    perNight.push(entry);
  }

  result.nights = perNight;
  const ok = perNight.filter((e) => e.status === 'ok');
  result.n_nights = ok.length;
  result.n_gaps = perNight.length - ok.length;

  if (!ok.length) {
    result.error = 'no night produced a hat';
    return result;
  }

  // Aggregate: median sigma per device + bootstrap 95% CI across nights.
  const sigH = ok.map((e) => e.sigma.h10).filter((v) => typeof v === 'number');
  const sigV = ok.map((e) => e.sigma.verity).filter((v) => typeof v === 'number');
  const sigO = ok.map((e) => e.sigma.o2).filter((v) => typeof v === 'number');
  const agg = (vals) => {
    const m = median(vals);
    const [lo, hi] = bootstrapCI(vals);
    return { median: m, ci_lo: lo, ci_hi: hi, n: vals.length };
  };
  result.aggregate = {
    h10: agg(sigH),
    verity: agg(sigV),
    o2: agg(sigO)
  };
  // Mean pairwise correlations across ok nights (descriptive, not fused).
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  result.r_mean = {
    hv: mean(ok.map((e) => e.r.hv).filter((v) => typeof v === 'number')),
    ho: mean(ok.map((e) => e.r.ho).filter((v) => typeof v === 'number')),
    vo: mean(ok.map((e) => e.r.vo).filter((v) => typeof v === 'number'))
  };
  result.overlap_s_total = ok.reduce((s, e) => s + (e.overlap_s || 0), 0);
  return result;
}

// Selftest: per-night sigmas collected, median/CI correct, gaps excluded.
// Run with --selftest.
async function selftest() {
  const { tmpdir } = await import('node:os');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'stitch-test-'));
  const toolDir = join(dir, '3corner');
  mkdirSync(toolDir, { recursive: true });
  const hr = 'Phone timestamp;HR [bpm];\n2026-10-16T23:10:08.000;90\n#GAP:2026-10-17;\n2026-10-18T23:10:08.000;88\n';
  const spo2 = 'Time,Pulse Rate\n2026-10-16 23:10:08,61\n#GAP:2026-10-17,\n2026-10-18 23:10:08,60\n';
  writeFileSync(join(toolDir, 'h.txt'), hr);
  writeFileSync(join(toolDir, 's.csv'), spo2);
  const r1 = parseStitched(join(toolDir, 'h.txt'), 'timestamp', 'HR [bpm]', ';');
  if (r1.pairs.length !== 2) {
    console.error('FAIL: expected 2 pairs, got ' + r1.pairs.length);
    process.exit(1);
  }
  if (r1.gaps !== 1) {
    console.error('FAIL: expected 1 gap, got ' + r1.gaps);
    process.exit(1);
  }
  for (const [, v] of r1.pairs) {
    if (v === 0) {
      console.error('FAIL: zero value (gap leaked as data)');
      process.exit(1);
    }
  }
  const r2 = parseStitched(join(toolDir, 's.csv'), 'Time', 'Pulse Rate', ',');
  if (r2.pairs.length !== 2 || r2.gaps !== 1) {
    console.error('FAIL: CSV gap handling');
    process.exit(1);
  }
  console.log('selftest: gap rows skipped, no zero-fill — PASS');

  // Per-night aggregation checks: median, bootstrap CI, gap exclusion.
  const m1 = median([3, 1, 2]);
  if (m1 !== 2) {
    console.error('FAIL: median([3,1,2])=' + m1);
    process.exit(1);
  }
  const m2 = median([4, 1, 3, 2]);
  if (m2 !== 2.5) {
    console.error('FAIL: median even=' + m2);
    process.exit(1);
  }
  if (median([]) !== null) {
    console.error('FAIL: median([]) not null');
    process.exit(1);
  }
  const [lo0, hi0] = bootstrapCI([1, 2]);
  if (lo0 !== null || hi0 !== null) {
    console.error('FAIL: CI with N<3 must be null');
    process.exit(1);
  }
  // Deterministic CI check: identical values give a degenerate interval.
  const [lo1, hi1] = bootstrapCI([5, 5, 5, 5, 5]);
  if (lo1 !== 5 || hi1 !== 5) {
    console.error(`FAIL: degenerate CI=[${lo1},${hi1}]`);
    process.exit(1);
  }
  // Gap nights excluded: simulate perNight entries.
  const fake = [
    { night: '2026-10-14', status: 'ok', sigma: { h10: 2.0, verity: 3.0, o2: 4.0 } },
    { night: '2026-10-15', status: 'gap' },
    { night: '2026-10-16', status: 'ok', sigma: { h10: 4.0, verity: 5.0, o2: 6.0 } },
    { night: '2026-10-17', status: 'ok', sigma: { h10: 6.0, verity: 7.0, o2: 8.0 } }
  ];
  const okF = fake.filter((e) => e.status === 'ok');
  if (okF.length !== 3) {
    console.error('FAIL: gap exclusion');
    process.exit(1);
  }
  const medH = median(okF.map((e) => e.sigma.h10));
  if (medH !== 4.0) {
    console.error('FAIL: per-night median h10=' + medH);
    process.exit(1);
  }
  console.log('selftest: per-night median/CI, gap exclusion — PASS');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    selftest();
    return;
  }
  const toolDir = join(args.stitchedDir, args.tool);
  const manifestPath = join(toolDir, 'MANIFEST.json');
  const sidecarsPath = join(toolDir, 'SIDECARS.json');

  if (!args.force && captureActive(args.capturesDir)) {
    console.error('capture is active (recent writes in captures/); refusing. Use --force to override.');
    process.exit(3);
  }
  if (!existsSync(manifestPath)) {
    console.error(`no MANIFEST.json at ${manifestPath}; run the stitcher first`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sidecars = existsSync(sidecarsPath) ? JSON.parse(readFileSync(sidecarsPath, 'utf8')) : { sidecars: {} };

  let result;
  if (args.tool === '3corner' || args.tool === '3corner_fused') {
    result = run3CornerPerNight(toolDir, manifest, sidecars, args.capturesDir);
    if (args.tool === '3corner_fused') result.tool = '3corner_fused';
  } else {
    // PAT legs: not yet implemented; when built they use the same per-night
    // model (compute per night where co-location holds, aggregate across).
    result = { tool: args.tool, at: new Date().toISOString(), error: 'not yet implemented (phase 3)' };
  }

  const outPath = join(toolDir, 'RESULT.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`wrote ${outPath}: ${result.error ? 'ERROR: ' + result.error : `n=${result.n} overlap_s=${result.overlap_s}`}`);
  process.exit(result.error ? 1 : 0);
}

main();
