// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// Known-clock adversarial recovery — post-capture injection layer.
// Preregistered criteria: /tmp/kc/acceptance.json  sha256 b061d2792c1ff8d605ec82ff9fd298d56ca40915877ab274aa1785f2baff1586
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DexClock = require('/run/media/michal/647A504F7A50205A/wt-knownclock/clock.js');

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
function hostMsOf(s) {
  const m = ISO.exec(s.trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
}

function load(file, measFilter) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out = [];
  const measSeen = new Map();
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i];
    if (!L) continue;
    const c = L.split(';');
    if (c.length < 4) continue;
    const meas = c[2];
    measSeen.set(meas, (measSeen.get(meas) || 0) + 1);
    if (measFilter && meas !== measFilter) continue;
    const h = hostMsOf(c[0]);
    const ns = Number(c[3]);
    if (h === null || !isFinite(ns)) continue;
    out.push({ hostMs: h, devMs: ns / 1e6 });
  }
  return { anchors: out, measSeen };
}

// ── perturbations (deterministic; no RNG) ─────────────────────────────────────
const P = {
  'P0-null':         a => a,
  'P1-offset':       a => a.map(x => ({ devMs: x.devMs, hostMs: x.hostMs + 5000 })),
  'P2-freq':         a => { const d0 = a[0].devMs; return a.map(x => ({ hostMs: x.hostMs, devMs: d0 + (x.devMs - d0) * (1 + 100e-6) })); },
  'P2b-freq-small':  a => { const d0 = a[0].devMs; return a.map(x => ({ hostMs: x.hostMs, devMs: d0 + (x.devMs - d0) * (1 + 10e-6) })); },
  'P3-jump':         a => a.map((x, i) => ({ devMs: x.devMs, hostMs: x.hostMs + (i >= a.length / 2 ? 2000 : 0) })),
  'P4-loss':         a => a.filter((_, i) => i % 10 >= 3),          // drop 30%, deterministic stride
  'P5-implausible':  a => { const d0 = a[0].devMs; return a.map(x => ({ hostMs: x.hostMs, devMs: d0 + (x.devMs - d0) * 2.0 })); }
};

function fmt(r) {
  if (!r.ok) return `ok:false  reason=${r.reason}`;
  return `ok:true  n=${r.n}  ppm=${r.ppm.toFixed(3)}  maxStepMs=${r.maxStepMs.toFixed(1)}  spreadMs=${r.spreadMs.toFixed(2)}  independent=${r.independent}`;
}

const TARGETS = [
  ['H10',    '/tmp/kc/Polar_H10_02849638_20260813231740_PMDARRIVAL.csv',            'ecg'],
  ['Verity', '/tmp/kc/Polar_VeritySense_0C301E3F_20260813231725_PMDARRIVAL.csv',    'ppg'],
  ['O2Ring', '/tmp/kc/Wellue_O2Ring-S_S8AW2100_20260813231713_PMDARRIVAL.csv',      null]
];

for (const [name, file, meas] of TARGETS) {
  const { anchors, measSeen } = load(file, meas);
  console.log(`\n${'='.repeat(78)}\n${name}  (meas filter: ${meas || 'ALL'})  anchors=${anchors.length}`);
  console.log('  meas types present:', [...measSeen.entries()].map(([k, v]) => `${k}:${v}`).join(' '));
  if (anchors.length < 3) { console.log('  SKIP — too few anchors'); continue; }

  const results = {};
  for (const [id, fn] of Object.entries(P)) {
    if (name === 'O2Ring' && id !== 'P0-null') continue;   // O2Ring leg = P6, null run only
    const r = DexClock.hostAxis(fn(anchors.map(x => ({ ...x }))));
    results[id] = r;
    console.log(`  ${id.padEnd(17)} ${fmt(r)}`);
  }

  // determinism check for P0
  const again = DexClock.hostAxis(anchors.map(x => ({ ...x })));
  if (results['P0-null'].ok && again.ok) {
    console.log(`  [determinism]     |dppm| = ${Math.abs(again.ppm - results['P0-null'].ppm).toExponential(2)}`);
  }

  // deltas vs null
  const n0 = results['P0-null'];
  if (n0 && n0.ok) {
    console.log('  --- delta vs null ---');
    for (const [id, r] of Object.entries(results)) {
      if (id === 'P0-null' || !r.ok) continue;
      console.log(`  ${id.padEnd(17)} dppm=${(r.ppm - n0.ppm).toFixed(3)}  maxStepRatio=${(r.maxStepMs / (n0.maxStepMs || 1e-9)).toFixed(1)}x`);
    }
  }
}
