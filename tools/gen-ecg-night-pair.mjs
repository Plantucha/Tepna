#!/usr/bin/env node
/*
 * tools/gen-ecg-night-pair.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Generate the ECG COUNTERPART of the committed synthetic OxyDex night, as a rich ECGDex
 * node-export that OxyDex's fusion path can pair with (residue 2026-10-06-no-committed-fixture-pairs-an-ecg).
 *
 * WHY A TOOL AND NOT A COMMITTED STREAM. The pair needs a NIGHT, not a clip: on the committed 60 s
 * synthetic H10 twin the rich export carries no `apnea` block, no `cardiorespiratory` block and zero
 * ganglior_events, so nothing in OxyDex's fusion can engage. A 2 h stream at 130 Hz is ~936 000 rows
 * (~50 MB of text), which does not belong in the repo — so the stream is built IN MEMORY here and only
 * the node-export (tens of KB) is committed, exactly as a captured export would be.
 *
 * WHY IT PAIRS BY CONSTRUCTION. Both sides come from ONE timeline: the SpO2 night's own t0, its four
 * desaturation onsets and its pulse-rate curve, read from the block that writes
 * `synthetic_oxydex_o2ring.csv` in tools/make-synthetic-inputs.mjs and restated in SPO2_NIGHT below.
 * The ECG's RR series carries the matching cyclic-variation shape — bradycardia through each event,
 * then an arousal surge — so `confirmedApnea`, `desatArousalLatencySec` and the HR cross-check have
 * real signal to read rather than a plant.
 *
 * The export carries NO `code` identity on purpose. It is an INPUT to an OxyDex fixture, so a bundle
 * hash inside it would move its own input hash on every unrelated ECGDex re-bundle and red GATE B.
 *
 * USAGE
 *   node tools/gen-ecg-night-pair.mjs                 # write uploads/synthetic_ecg_night.node-export.json
 *   node tools/gen-ecg-night-pair.mjs --check         # report what would move, write nothing
 *   node tools/gen-ecg-night-pair.mjs --dump-stream <path>   # also write the generated H10 text
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VOLATILE } from './regen-goldens-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'uploads', 'synthetic_ecg_night.node-export.json');
const CHECK = process.argv.includes('--check');
const DUMP = (() => {
  const i = process.argv.indexOf('--dump-stream');
  return i > 0 ? process.argv[i + 1] : null;
})();
const DexBuild = createRequire(import.meta.url)('./build-core.js');
// The realm's module list is single-sourced (residue 2026-10-11-one-module-list-in-six-tool-literals).
const { ECG_REALM } = createRequire(import.meta.url)('./realm-manifest.js');

/* ── the SpO2 night this ECG is the counterpart of (tools/make-synthetic-inputs.mjs §1) ──
   Restated, not imported: that block writes a CSV and exports nothing. A drift between the two
   is caught by the fixture itself — the paired night's confirmations collapse if the onsets move. */
const SPO2_NIGHT = {
  t0Ms: Date.UTC(2026, 5, 13, 23, 0, 16), // 2026-06-13 23:00:16
  durSec: 2 * 3600,
  desatOnsetSec: [1500, 3200, 4800, 6300], // each 45 s long, nadir at ~22 s
  hrAt: (i) => 58 + 5 * Math.sin(i / 300) + 3 * Math.sin(i / 47) // the CSV's pulse-rate curve
};
/* The ECG starts late and stops early, as a second device does. The overlap still covers all four
   desaturations, so partial coverage is exercised without making the pairing degenerate. */
const ECG = { startOffsetSec: 37, durSec: SPO2_NIGHT.durSec - 37 - 55, fs: 130, ns0: 599630059061536896n };

const p2 = (n) => (n < 10 ? '0' : '') + n;
const p3 = (n) => (n < 100 ? (n < 10 ? '00' : '0') : '') + n;
const isoMs = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T` + `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(Math.floor(ms % 1000))}`;
};

/* ── the RR series: the SpO2 night's pulse curve + RSA + one cyclic variation per desaturation ──
   CVHR is the shape ECGDex's apnea detector reads: the rate falls through the event and overshoots on
   the arousal. The surge peaks ~8 s after the SpO2 nadir, which is the latency fusion reports. */
function beatTimes() {
  const beats = [];
  const relOf = (tSec) => tSec + ECG.startOffsetSec; // seconds into the SpO2 night
  for (let t = 0.4; t < ECG.durSec; ) {
    beats.push(t);
    const i = relOf(t);
    let hr = SPO2_NIGHT.hrAt(i);
    for (const s of SPO2_NIGHT.desatOnsetSec) {
      const dt = i - s;
      if (dt >= 0 && dt < 22)
        hr -= 7 * Math.sin((Math.PI * dt) / 44); // bradycardia through the fall
      else if (dt >= 22 && dt < 52) hr += 13 * Math.sin((Math.PI * (dt - 22)) / 30); // arousal surge
    }
    const rsa = 38 * Math.sin((2 * Math.PI * i) / 4); // 15 br/min respiratory modulation
    t += (60000 / hr + rsa) / 1000;
  }
  return beats;
}

/* ── the waveform: the same five-gaussian QRST template the committed twin uses ── */
function stream() {
  const beats = beatTimes();
  const N = Math.round(ECG.durSec * ECG.fs);
  const t0 = SPO2_NIGHT.t0Ms + ECG.startOffsetSec * 1000;
  const g = (x, mu, s, a) => a * Math.exp(-((x - mu) * (x - mu)) / (2 * s * s));
  const rows = ['Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]'];
  let lo = 0;
  for (let i = 0; i < N; i++) {
    const t = i / ECG.fs;
    while (lo < beats.length && beats[lo] < t - 0.45) lo++;
    let v = 12 * Math.sin(2 * Math.PI * 0.25 * t); // baseline wander
    for (let b = lo; b < beats.length && beats[b] <= t + 0.25; b++) {
      const d = t - beats[b];
      v += g(d, -0.16, 0.025, 90); // P
      v += g(d, -0.02, 0.008, -110); // Q
      v += g(d, 0.0, 0.01, 1150); // R
      v += g(d, 0.025, 0.011, -230); // S
      v += g(d, 0.22, 0.045, 260); // T
    }
    const ns = ECG.ns0 + BigInt(Math.round((i / ECG.fs) * 1e9));
    rows.push(`${isoMs(t0 + (i / ECG.fs) * 1000)};${ns};${((i / ECG.fs) * 1000).toFixed(6)};${Math.round(v)}`);
  }
  return { text: rows.join('\n') + '\n', beats: beats.length, samples: N };
}

/* ── the ECGDex.src.html script order (headless subset — no render/app/DOM shell) ── */
function realm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = {
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    },
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      }
    },
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  // clock.js BEFORE ecgdex-dsp.js — the DSP aliases DexClock.parseTimestamp at load.
  for (const f of ECG_REALM) vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const s = stream();
if (DUMP) fs.writeFileSync(DUMP, s.text);
const { ECGDex } = realm();
const exp = ECGDex.compute({ text: s.text }, { rich: true });
if (!exp) throw new Error('ECGDex.compute returned nothing for the generated stream');

/* Compare on the SAME projection the regen core diffs on: `generated` is a mint stamp, so a rerun
   that moves nothing else must read as unchanged rather than churning a committed input. */
const stripVolatile = (o) => {
  if (Array.isArray(o)) return o.map(stripVolatile);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const k of Object.keys(o)) if (!VOLATILE.has(k)) out[k] = stripVolatile(o[k]);
  return out;
};
const oldText = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const oldJson = oldText ? JSON.parse(oldText) : null;
const same = oldJson ? JSON.stringify(stripVolatile(oldJson)) === JSON.stringify(stripVolatile(exp)) : false;
// keep the committed mint stamp when nothing else moved
if (same && oldJson && oldJson.generated) exp.generated = oldJson.generated;
const json = JSON.stringify(exp, null, 2) + '\n';
const old = same ? json : oldText;
console.log(`▸ generated ${s.samples} samples over ${ECG.durSec} s · ${s.beats} beats`);
console.log(
  `  export: startEpochMs ${exp.recording && exp.recording.startEpochMs} · durSec ${exp.recording && exp.recording.durSec} · ` +
    `events ${(exp.ganglior_events || []).length} · apnea ${exp.apnea ? 'present' : 'ABSENT'} · ` +
    `cardiorespiratory ${exp.cardiorespiratory ? 'present' : 'ABSENT'} · sleepStages ${exp.timeseries && exp.timeseries.sleepStages ? 'present' : 'ABSENT'}`
);
if (CHECK) {
  console.log(same ? '✓ check — the committed export matches this run' : oldText === null ? '▸ check — no committed export yet' : '✗ check — the committed export would MOVE');
  process.exit(same || oldText === null ? 0 : 1);
}
fs.writeFileSync(OUT, json);
console.log(`${old === json ? '=' : '▸'} wrote ${path.relative(REPO, OUT)} (${json.length} bytes)`);
