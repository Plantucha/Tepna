#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// edge-settle.mjs — where does each sensor's signal settle at the start and the end of a session,
// and where is the one window that every sensor covers with clean signal?
//
// Owner, 2026-10-17: "find floor for start session jitter and end session jitter … start compute on
// exactly same start and end point, that all sensors produce clear signal". The answer is measured,
// never a fixed cut: a fixed 5-min cut throws away minutes on a night that is clean in 10 s and is
// still short on a night that is not. OxyDex's `trimSensorWarmup` already rejects a fixed window for
// the same reason.
//
// INPUT is the trio node exports (`uploads/trio/<night>/<Node>_<night>.node-export.json`), never the
// raw streams. They already carry the per-beat series with a quality flag on every beat:
//   ECGDex `timeseries.rr`   tSec[] · corrected[] · conf[]   (Pan–Tompkins beats, Malik-corrected)
//   PpgDex `timeseries.ppi`  tSec[] · corrected[] · conf[]   (3-LED consensus beats)
//   OxyDex `timeseries.spo2` + `.hr` at 1 Hz, null = no sample
//
// METHOD (every constant pre-stated below, none fitted to the data it judges):
//   1. Cut each sensor's recording into BIN_S bins from its own startEpochMs.
//   2. A beat bin is clean when it holds ≥ BEAT_MIN_PER_BIN beats and ≥ BEAT_CLEAN_SHARE of them are
//      uncorrected with conf ≥ CONF_MIN. An O2Ring bin is clean when ≥ OXY_MIN_PER_BIN seconds carry
//      both SpO₂ and HR.
//   3. The START settle is the first bin that opens a run of CLEAN_RUN_S clean seconds. The END
//      settle is the time from the last bin that closes such a run to the end of the recording.
//   4. An edge longer than LATE_WEAR_S is not settling. It is a sensor put on late or come off, and
//      it is EXCLUDED from the settle distribution with the reason `late-wear` (counted, never hidden).
//   5. The common window of a night is MAX(settled starts) → MIN(settled ends) over the sensors
//      present, on the floating wall clock (Clock Contract §1).
//
// §∅: a sensor with no clean run reads `null` with the reason `never-clean`, never 0. A night
// without a sensor's export has no row for that sensor; it is not a zero-length settle.
//
// POPULATION — the fold's own stamp, read and never inferred. `tools/trio-batch.mjs` writes
// `.trio-stamp` into a night directory only when the fold completed there, and a night the fold
// REJECTS keeps whatever exports it held from whenever it last passed (residue
// `2026-10-12-rejected-trio-nights-keep-exports-no-fold-rewrites`: 57 such nights hold 80 exports
// whose code era is unrecorded). Walking the directory pools the two: measured 2026-10-20, that
// moved two of the six floors this tool feeds — PPG start p95 280 s against 270 s, O2Ring end
// 40 s against 50 s. So the default population is the STAMPED nights, the unstamped ones are
// counted and named rather than dropped silently, and `--all-nights` restores the pooled walk for
// anyone who wants the old number. `tools/tch-multinight.mjs` reads the same stamp for the same
// reason.
//
// The verdict asks one pre-stated question: does the 90th percentile of each sensor's settle, at
// each edge, fit inside ONE 5-min analysis window (BUDGET_S)? That is the owner's "a window or two"
// bound, turned into a test the corpus can fail.
//
//   node tools/edge-settle.mjs                 # report over the corpus (uploads/trio)
//   node tools/edge-settle.mjs --nights        # plus one line per night
//   node tools/edge-settle.mjs --json          # the full report as JSON
//   node tools/edge-settle.mjs --root <dir>    # another export tree
//   node tools/edge-settle.mjs --all-nights    # pool the fold-rejected nights too (not the floor population)
//   node tools/edge-settle.mjs --verdict-sample  # the tepna.verdict/1 object, corpus-free
//   node tools/edge-settle.mjs --selftest

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusSearch } from './regen-goldens-core.mjs';
import { isCliEntry } from './argv-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const Verdict = createRequire(import.meta.url)('../verdict.js');

export const BIN_S = 10;
export const CLEAN_RUN_S = 60;
export const BEAT_MIN_PER_BIN = 4; // 24 bpm over 10 s — below that the bin holds no rhythm to judge
export const BEAT_CLEAN_SHARE = 0.8;
export const CONF_MIN = 0.5;
export const OXY_MIN_PER_BIN = 9;
export const LATE_WEAR_S = 600;
export const BUDGET_S = 300; // one 5-min analysis window
export const MIN_NIGHTS = 20;

export const SENSORS = [
  { key: 'ecg', node: 'ECGDex', series: 'rr' },
  { key: 'ppg', node: 'PpgDex', series: 'ppi' },
  { key: 'oxy', node: 'OxyDex', series: null }
];

/** Beat series → one clean flag per BIN_S bin over durS. */
export function beatBins(s, durS) {
  const nb = Math.ceil(durS / BIN_S);
  const tot = new Array(nb).fill(0);
  const ok = new Array(nb).fill(0);
  for (let i = 0; i < s.tSec.length; i++) {
    const b = Math.floor(s.tSec[i] / BIN_S);
    if (b < 0 || b >= nb) continue;
    tot[b]++;
    if (!s.corrected[i] && s.conf[i] != null && s.conf[i] >= CONF_MIN) ok[b]++;
  }
  return tot.map((t, b) => t >= BEAT_MIN_PER_BIN && ok[b] / t >= BEAT_CLEAN_SHARE);
}

/** 1 Hz SpO₂ + HR → one clean flag per BIN_S bin. A partial last bin is dropped, not padded. */
export function oxyBins(spo2, hr) {
  const nb = Math.floor(Math.min(spo2.length, hr.length) / BIN_S);
  const out = [];
  for (let b = 0; b < nb; b++) {
    let ok = 0;
    for (let i = b * BIN_S; i < (b + 1) * BIN_S; i++) if (spo2[i] != null && hr[i] != null) ok++;
    out.push(ok >= OXY_MIN_PER_BIN);
  }
  return out;
}

/** Clean flags → { startS, endS } settle seconds, or null when no CLEAN_RUN_S run exists. */
export function settleEdges(clean) {
  const need = CLEAN_RUN_S / BIN_S;
  let run = 0;
  let first = null;
  let last = null;
  for (let i = 0; i < clean.length && first === null; i++) {
    run = clean[i] ? run + 1 : 0;
    if (run === need) first = i - need + 1;
  }
  run = 0;
  for (let i = clean.length - 1; i >= 0 && last === null; i--) {
    run = clean[i] ? run + 1 : 0;
    if (run === need) last = i + need - 1;
  }
  if (first === null) return null;
  return { startS: first * BIN_S, endS: (clean.length - 1 - last) * BIN_S, spanS: clean.length * BIN_S };
}

/** One sensor's export → its row. */
export function sensorRow(sensor, exp) {
  const t0Ms = exp?.recording?.startEpochMs;
  if (!Number.isFinite(t0Ms)) return { sensor: sensor.key, t0Ms: null, reason: 'no-start-stamp' };
  const ts = exp.timeseries || {};
  let clean;
  if (sensor.series) {
    const s = ts[sensor.series];
    const durS = exp.recording.durSec;
    if (!s || !Array.isArray(s.tSec) || !Number.isFinite(durS)) return { sensor: sensor.key, t0Ms, reason: 'no-beat-series' };
    clean = beatBins(s, durS);
  } else {
    if (!ts.spo2?.values || !ts.hr?.values) return { sensor: sensor.key, t0Ms, reason: 'no-1hz-series' };
    clean = oxyBins(ts.spo2.values, ts.hr.values);
  }
  const e = settleEdges(clean);
  const spanS = clean.length * BIN_S;
  if (!e) return { sensor: sensor.key, t0Ms, spanS, startS: null, endS: null, reason: 'never-clean' };
  return {
    sensor: sensor.key,
    t0Ms,
    spanS,
    startS: e.startS,
    endS: e.endS,
    startLate: e.startS > LATE_WEAR_S,
    endLate: e.endS > LATE_WEAR_S,
    settledStartMs: t0Ms + e.startS * 1000,
    settledEndMs: t0Ms + (spanS - e.endS) * 1000,
    reason: null
  };
}

/** The rows of one night → its common window, or null with a reason. */
export function commonWindow(rows) {
  const ok = rows.filter((r) => r.settledStartMs != null);
  if (ok.length < 2) return { startMs: null, endMs: null, reason: ok.length ? 'one-sensor' : 'no-clean-sensor' };
  const s = ok.reduce((a, r) => (r.settledStartMs > a.settledStartMs ? r : a));
  const e = ok.reduce((a, r) => (r.settledEndMs < a.settledEndMs ? r : a));
  const t0 = rows.filter((r) => Number.isFinite(r.t0Ms)).map((r) => r.t0Ms);
  const base = {
    sensors: ok.map((r) => r.sensor),
    startBoundBy: s.sensor,
    endBoundBy: e.sensor,
    deviceStartSpreadS: t0.length > 1 ? (Math.max(...t0) - Math.min(...t0)) / 1000 : null
  };
  if (e.settledEndMs <= s.settledStartMs) return { ...base, startMs: null, endMs: null, reason: 'no-overlap' };
  return { ...base, startMs: s.settledStartMs, endMs: e.settledEndMs, spanS: (e.settledEndMs - s.settledStartMs) / 1000, reason: null };
}

const quantile = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const dist = (a) => ({ n: a.length, p50: quantile(a, 0.5), p90: quantile(a, 0.9), p95: quantile(a, 0.95), max: a.length ? Math.max(...a) : null });

/** Night rows → per-sensor, per-edge distributions with the exclusions counted. */
export function summarize(nights) {
  const out = {};
  for (const { key } of SENSORS) {
    const rows = nights.map((n) => n.rows.find((r) => r.sensor === key)).filter(Boolean);
    const edge = (name, late) => {
      const settle = rows.filter((r) => r[name] != null && !r[late]).map((r) => r[name]);
      return {
        eligible: rows.length,
        neverClean: rows.filter((r) => r.reason === 'never-clean').length,
        noSeries: rows.filter((r) => r.reason && r.reason !== 'never-clean').length,
        lateWear: rows.filter((r) => r[late]).length,
        settle: dist(settle)
      };
    };
    out[key] = { start: edge('startS', 'startLate'), end: edge('endS', 'endLate') };
  }
  const cw = nights.map((n) => n.common).filter((c) => c.sensors && c.sensors.length >= 2);
  const spread = cw.map((c) => c.deviceStartSpreadS).filter((v) => v != null);
  const tally = (k) => {
    const a = {};
    for (const c of cw) a[c[k]] = (a[c[k]] || 0) + 1;
    return a;
  };
  out.common = {
    nights: cw.length,
    withWindow: cw.filter((c) => c.startMs != null).length,
    noOverlap: cw.filter((c) => c.reason === 'no-overlap').length,
    deviceStartSpreadS: dist(spread),
    startBoundBy: tally('startBoundBy'),
    endBoundBy: tally('endBoundBy')
  };
  return out;
}

/** Summary → one tepna.verdict/1. Pre-stated: p90 settle ≤ BUDGET_S at both edges of every sensor.
    `excludedLegs` carries the legs this run refused to measure — one per (sensor row, edge) on a
    night the fold never folded — so `checked + excluded = eligible` still describes the whole tree
    and an unstamped night is counted rather than vanishing from the population. */
export function verdictOf(summary, evidence, at, excludedLegs = 0) {
  const legs = [];
  for (const { key } of SENSORS) for (const edge of ['start', 'end']) legs.push({ key, edge, ...summary[key][edge] });
  const powered = legs.filter((l) => l.settle.n >= MIN_NIGHTS);
  const over = powered.filter((l) => l.settle.p90 > BUDGET_S);
  const eligible = legs.reduce((a, l) => a + l.eligible, 0) + excludedLegs;
  const checked = legs.reduce((a, l) => a + l.settle.n, 0);
  let status = 'PASS';
  let reason = null;
  if (!checked) {
    status = 'NOT_RUN';
    reason = 'no sensor export was found under the root';
  } else if (over.length) {
    status = 'FAIL';
    reason = over.map((l) => `${l.key} ${l.edge} p90 ${l.settle.p90} s > ${BUDGET_S} s`).join('; ');
  } else if (powered.length < legs.length) {
    status = 'UNDERPOWERED';
    reason = legs
      .filter((l) => l.settle.n < MIN_NIGHTS)
      .map((l) => `${l.key} ${l.edge} n=${l.settle.n} < ${MIN_NIGHTS}`)
      .join('; ');
  }
  return Verdict.make({
    gate: 'edge-settle',
    status,
    population: { checked, eligible, excluded: eligible - checked },
    criterion: { name: 'edge_settle_p90_s', threshold: BUDGET_S, unit: 's', direction: 'lte' },
    result: { legs: legs.map((l) => ({ sensor: l.key, edge: l.edge, ...l.settle, lateWear: l.lateWear, neverClean: l.neverClean })), common: summary.common, nights: summary.nights },
    evidence,
    reason,
    producedBy: { tool: 'tools/edge-settle.mjs', commit: null, commitReason: 'not stamped by this tool' },
    at
  });
}

/** Scanned nights → the measured population, the nights left out, and the legs that leaves
    unmeasured. The fold's stamp decides it: a night `tools/trio-batch.mjs` never folded keeps the
    exports of whenever it last passed, so measuring it pools two code eras. `pooled` restores the
    old walk over every directory and then excludes nothing, because nothing was left out. */
export function partition(scanned, pooled) {
  const unstamped = scanned.filter((n) => !n.hasStamp);
  return {
    nights: pooled ? scanned : scanned.filter((n) => n.hasStamp),
    unstamped,
    /* Two legs per sensor row — a start and an end — so the count stays in the verdict's units. */
    excludedLegs: pooled ? 0 : unstamped.reduce((a, n) => a + n.rows.length, 0) * 2
  };
}

/** One night directory → { night, rows, common, hasStamp }. Reads one export at a time (lazy-load rule). */
export function readNight(dir, night) {
  const rows = [];
  for (const s of SENSORS) {
    const p = join(dir, `${s.node}_${night}.node-export.json`);
    if (!existsSync(p)) continue;
    let exp;
    try {
      exp = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      rows.push({ sensor: s.key, t0Ms: null, reason: 'unreadable-export' });
      continue;
    }
    rows.push(sensorRow(s, exp));
  }
  /* Read, not inferred: the fold's own completion stamp, exactly as `tools/tch-multinight.mjs`
     reads it. `.trio-stamp` is deliberately not `*.json`, so no export glob can pick it up. */
  return { night, rows, common: commonWindow(rows), hasStamp: existsSync(join(dir, '.trio-stamp')) };
}

function selftest() {
  let ran = 0;
  const eq = (a, b, m) => {
    ran++;
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`selftest assertion broke: ${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  // a clean run of exactly 60 s from bin 3 → start 30 s; the tail is clean to the end → end 0 s
  eq(settleEdges([0, 0, 0, 1, 1, 1, 1, 1, 1, 1].map(Boolean)), { startS: 30, endS: 0, spanS: 100 }, 'start edge');
  eq(settleEdges([1, 1, 1, 1, 1, 1, 0, 0].map(Boolean)), { startS: 0, endS: 20, spanS: 80 }, 'end edge');
  eq(settleEdges([1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1].map(Boolean)), null, 'no 60 s run is never-clean, not 0');
  // beats: 60 bpm, the first 20 s corrected → bins 0 and 1 dirty
  const tSec = Array.from({ length: 120 }, (_, i) => i + 0.5);
  const s = { tSec, corrected: tSec.map((t) => (t < 20 ? 1 : 0)), conf: tSec.map(() => 1) };
  eq(settleEdges(beatBins(s, 120)).startS, 20, 'corrected beats delay the start');
  const sparse = { tSec: [1, 5, 9, 15], corrected: [0, 0, 0, 0], conf: [1, 1, 1, 1] };
  eq(beatBins(sparse, 20), [false, false], 'a bin under BEAT_MIN_PER_BIN beats is not clean');
  // O2Ring: nulls in the first 10 s, a null HR alone also counts
  const sp = Array.from({ length: 90 }, (_, i) => (i < 10 ? null : 97));
  const hr = Array.from({ length: 90 }, (_, i) => (i === 85 ? null : 60));
  eq(oxyBins(sp, hr), [false, true, true, true, true, true, true, true, true], 'one null second keeps a bin clean, ten do not');
  // common window: the later settled start and the earlier settled end bind
  const a = { sensor: 'ecg', t0Ms: 0, settledStartMs: 10_000, settledEndMs: 900_000 };
  const b = { sensor: 'oxy', t0Ms: 120_000, settledStartMs: 150_000, settledEndMs: 1_000_000 };
  const c = commonWindow([a, b]);
  eq([c.startMs, c.endMs, c.startBoundBy, c.endBoundBy, c.deviceStartSpreadS], [150_000, 900_000, 'oxy', 'ecg', 120], 'common window');
  eq(commonWindow([a]).reason, 'one-sensor', 'one sensor has no common window');
  eq(commonWindow([a, { ...b, settledStartMs: 950_000 }]).reason, 'no-overlap', 'disjoint sensors');
  // late wear is excluded from the settle distribution, and counted
  const night = (st, en) => ({ rows: [{ sensor: 'ecg', startS: st, endS: en, startLate: st > LATE_WEAR_S, endLate: en > LATE_WEAR_S, settledStartMs: 0 }], common: {} });
  const sm = summarize([night(10, 0), night(700, 0), night(20, 900)]);
  eq([sm.ecg.start.settle.n, sm.ecg.start.lateWear, sm.ecg.end.lateWear], [2, 1, 1], 'late wear excluded and counted');
  // the verdict: an empty corpus examined nothing; one leg over budget fails and is named
  eq(verdictOf(summarize([]), ['x'], undefined).status, 'NOT_RUN', 'empty corpus');
  const many = Array.from({ length: MIN_NIGHTS }, (_, i) => night(i < 18 ? 0 : 400, 0));
  const v = verdictOf(summarize(many), ['x'], undefined);
  eq([v.status, /ecg start p90 400/.test(v.reason)], ['FAIL', true], 'a leg over budget is named');
  eq(Verdict.validate(v).ok, true, 'the verdict validates');
  /* The fold's stamp decides the population (residue 2026-10-20-edge-settle-floors-pool-fold-
     rejected-nights). Real directories, because the claim IS that the file on disk is read. */
  const tmp = mkdtempSync(join(tmpdir(), 'edge-settle-'));
  try {
    const mk = (name, stamped) => {
      const d = join(tmp, name);
      mkdirSync(d);
      writeFileSync(join(d, `OxyDex_${name}.node-export.json`), '{}');
      if (stamped) writeFileSync(join(d, '.trio-stamp'), 'folded\n');
      return d;
    };
    eq(readNight(mk('2026-01-01', true), '2026-01-01').hasStamp, true, 'a folded night reports its stamp');
    eq(readNight(mk('2026-01-02', false), '2026-01-02').hasStamp, false, 'a night the fold rejected reports none');
    /* An unreadable export still yields a row, so the stamp is read for its own sake and never
       inferred from whether the night happened to parse. */
    eq(readNight(join(tmp, '2026-01-02'), '2026-01-02').rows.length, 1, 'the rejected night still has a row to exclude');
    /* The partition itself, over the two real directories just written. */
    const scan = ['2026-01-01', '2026-01-02'].map((d) => readNight(join(tmp, d), d));
    const kept = partition(scan, false);
    eq([kept.nights.map((n) => n.night), kept.unstamped.length, kept.excludedLegs], [['2026-01-01'], 1, 2], 'the default measures the folded night and counts the other');
    const all = partition(scan, true);
    eq([all.nights.length, all.excludedLegs], [2, 0], '--all-nights pools both and then excludes nothing');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  /* `checked + excluded = eligible` must still describe the WHOLE tree: a night left out of the
     measurement is counted, never dropped from the population. One excluded sensor row is two
     legs, a start and an end. */
  const vx = verdictOf(summarize([night(10, 0), night(20, 0)]), ['x'], undefined, 6);
  eq([vx.population.checked + vx.population.excluded === vx.population.eligible, vx.population.eligible], [true, 10], 'excluded legs stay inside eligible');
  eq(verdictOf(summarize([night(10, 0)]), ['x'], undefined).population.eligible, 2, 'the default excludes nothing, so an old caller is unchanged');
  console.log(`selftest: all ${ran} selftests passed`);
}

function sampleNights() {
  // corpus-free: twenty synthetic three-sensor nights, settled inside the budget
  const exp = (t0Ms, durSec, dirtyS, key) =>
    key === 'oxy'
      ? {
          recording: { startEpochMs: t0Ms },
          timeseries: { spo2: { values: Array.from({ length: durSec }, (_, i) => (i < dirtyS ? null : 97)) }, hr: { values: Array.from({ length: durSec }, () => 60) } }
        }
      : (() => {
          const tSec = Array.from({ length: durSec }, (_, i) => i + 0.5);
          return { recording: { startEpochMs: t0Ms, durSec }, timeseries: { [key === 'ecg' ? 'rr' : 'ppi']: { tSec, corrected: tSec.map((t) => (t < dirtyS ? 1 : 0)), conf: tSec.map(() => 1) } } };
        })();
  return Array.from({ length: MIN_NIGHTS }, (_, i) => {
    const t0 = Date.UTC(2026, 5, 1 + i, 22, 0, 0);
    const rows = SENSORS.map((s, k) => sensorRow(s, exp(t0 + k * 30_000, 1800, 10 * (i % 4), s.key)));
    return { night: `sample-${i}`, rows, common: commonWindow(rows) };
  });
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    const sample = summarize(sampleNights());
    sample.nights = { scanned: MIN_NIGHTS, folded: MIN_NIGHTS, unstamped: 0, measured: MIN_NIGHTS, pooled: false };
    console.log(JSON.stringify(verdictOf(sample, ['tools/edge-settle.mjs --verdict-sample (synthetic nights)'], undefined, 0), null, 2));
    return;
  }
  const at = argv.indexOf('--root');
  const root = at >= 0 ? resolve(argv[at + 1]) : join(corpusSearch(ROOT).dir, 'trio');
  if (!existsSync(root)) {
    console.error(`edge-settle: no export tree at ${root} — pass --root <dir>`);
    process.exit(2);
  }
  const pooled = argv.includes('--all-nights');
  const scanned = [];
  for (const night of readdirSync(root)
    .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
    .sort()) {
    const n = readNight(join(root, night), night);
    if (n.rows.length) scanned.push(n);
  }
  const { nights, unstamped, excludedLegs } = partition(scanned, pooled);
  if (!nights.length && unstamped.length) {
    console.error(`edge-settle: ${unstamped.length} night(s) under ${root} and not one carries a .trio-stamp, so the fold completed on none of them.`);
    console.error('Pass --all-nights to measure them anyway; the result then pools nights the fold rejects and is not the floor population.');
    process.exit(2);
  }
  const summary = summarize(nights);
  summary.nights = { scanned: scanned.length, folded: scanned.length - unstamped.length, unstamped: unstamped.length, measured: nights.length, pooled };
  const verdict = verdictOf(summary, nights.length ? [root] : [], undefined, excludedLegs);
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify({ constants: { BIN_S, CLEAN_RUN_S, BEAT_MIN_PER_BIN, BEAT_CLEAN_SHARE, CONF_MIN, OXY_MIN_PER_BIN, LATE_WEAR_S, BUDGET_S, MIN_NIGHTS }, nights, summary, verdict }, null, 2)
    );
    return;
  }
  const fmt = (v) => (v == null ? '—' : String(v));
  if (argv.includes('--nights')) {
    for (const n of nights) {
      const cells = n.rows.map((r) => `${r.sensor} ${r.reason || `${r.startS}/${r.endS}`}`);
      const c = n.common;
      console.log(`${n.night}  ${cells.join('  ')}  common ${c.reason || `${Math.round(c.spanS / 60)} min, start←${c.startBoundBy}, end←${c.endBoundBy}`}`);
    }
  }
  console.log(`edge-settle over ${nights.length} nights in ${root}`);
  console.log(
    pooled
      ? `POOLED by --all-nights: ${summary.nights.folded} folded + ${summary.nights.unstamped} with no .trio-stamp. The fold rejected those, so this is NOT the floor population.`
      : `population: ${summary.nights.folded} folded (.trio-stamp present) · ${summary.nights.unstamped} excluded, the fold never folded them (--all-nights to pool them)`
  );
  console.log(`settle seconds (late wear > ${LATE_WEAR_S} s excluded and counted; never-clean is null, not 0)`);
  console.log('sensor edge    n   p50   p90   p95   max   late  never');
  for (const { key } of SENSORS)
    for (const edge of ['start', 'end']) {
      const l = summary[key][edge];
      const d = l.settle;
      console.log(
        `${key.padEnd(6)} ${edge.padEnd(5)} ${String(d.n).padStart(4)} ${[d.p50, d.p90, d.p95, d.max].map((v) => fmt(v).padStart(5)).join(' ')} ${String(l.lateWear).padStart(6)} ${String(l.neverClean).padStart(6)}`
      );
    }
  const c = summary.common;
  const sp = c.deviceStartSpreadS;
  console.log(`common window: ${c.withWindow} of ${c.nights} multi-sensor nights (${c.noOverlap} with no overlap)`);
  console.log(`device start spread s: p50 ${fmt(sp.p50)} · p90 ${fmt(sp.p90)} · max ${fmt(sp.max)}`);
  console.log(`start bound by ${JSON.stringify(c.startBoundBy)} · end bound by ${JSON.stringify(c.endBoundBy)}`);
  console.log(`status ${verdict.status}${verdict.reason ? ' — ' + verdict.reason : ''}`);
}

if (isCliEntry(import.meta.url)) main(process.argv.slice(2));
