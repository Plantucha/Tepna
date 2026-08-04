#!/usr/bin/env node
/*
 * tools/o2ring-step-imbalance.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS §2 — does the step imbalance track the POLL INTERVAL?
 *
 * §7.2 explains the observed 159/180 split of `duration_s` steps as a beat between the ring's
 * 1.00346 s "second" and the ~1.0028 s poll interval — but only QUALITATIVELY. §2 asks for the
 * prediction: if that model is right, `steps_ahead − steps_flat` must track the poll interval, and the
 * corpus holds sessions at different cadences to test it against. A model that predicted the ratio
 * would turn §7.2 from an explanation into a measurement.
 *
 * It does not. See the header of the brief's §2 entry for the result; this tool is how to re-derive it.
 *
 * ⚠ THE FILTER IS THE WHOLE EXPERIMENT. Most OXYFRAME sessions in the corpus have `duration_s` that
 * NEVER ADVANCES — the ring was idle or disconnected, every step is 0, and the imbalance is a
 * degenerate −1.0. Left in, they swamp the signal and produce a confident correlation of nothing: the
 * first run of this analysis reported r = −0.213 over 164 "sessions", of which 109 were flat lines.
 * A session contributes only if a MAJORITY of its steps are +1, i.e. the counter was actually running.
 *
 * Clock Contract: the phone stamp is parsed by explicit regex → Date.UTC components, never Date.parse.
 *
 * Usage: node tools/o2ring-step-imbalance.mjs <capture-dir> [<capture-dir> ...]
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const DIRS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!DIRS.length) {
  console.error('usage: node tools/o2ring-step-imbalance.mjs <capture-dir> [<capture-dir> ...]');
  process.exit(2);
}

/* The ring's own second, from §7.2. Named so the prediction below is not a magic literal. */
const RING_SECOND_S = 1.00346;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : null;
};

function readSession(file) {
  const ts = [],
    dur = [];
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(';');
    if (p.length < 3) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(p[0]);
    if (!m) continue;
    const d = Number(p[1]);
    if (!Number.isInteger(d)) continue;
    ts.push(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0));
    dur.push(d);
  }
  if (dur.length < 1500) return null; // too short to characterise a cadence
  const steps = [];
  for (let i = 1; i < dur.length; i++) steps.push(dur[i] - dur[i - 1]);
  const one = steps.filter((s) => s === 1).length;
  // THE FILTER — see the header. A counter that never advanced is not a cadence measurement.
  if (one < 0.5 * steps.length) return null;
  const dts = [];
  for (let i = 1; i < ts.length; i++) dts.push((ts[i] - ts[i - 1]) / 1000);
  const ahead = steps.filter((s) => s >= 2).length,
    flat = steps.filter((s) => s === 0).length;
  return { poll: median(dts), imbalance: (ahead - flat) / steps.length, ahead, flat, n: steps.length };
}

const rows = [];
let scanned = 0,
  degenerate = 0;
for (const d of DIRS) {
  let names;
  try {
    names = fs.readdirSync(d);
  } catch {
    continue;
  }
  for (const f of names.filter((x) => /Wellue_O2Ring-S_.*_OXYFRAME\.txt$/.test(x))) {
    scanned++;
    const r = readSession(path.join(d, f));
    if (r) rows.push(r);
    else degenerate++;
  }
}
if (rows.length < 3) {
  console.log(`only ${rows.length} usable session(s) of ${scanned} — need OXYFRAME files whose duration_s actually advances`);
  process.exit(1);
}

const xs = rows.map((r) => r.poll),
  ys = rows.map((r) => r.imbalance);
const mx = mean(xs),
  my = mean(ys);
let num = 0,
  dx = 0,
  dy = 0;
for (let i = 0; i < xs.length; i++) {
  num += (xs[i] - mx) * (ys[i] - my);
  dx += (xs[i] - mx) ** 2;
  dy += (ys[i] - my) ** 2;
}
const r = dx && dy ? num / Math.sqrt(dx * dy) : Number.NaN;

console.log(`▸ O2Ring duration_s step imbalance vs poll interval (§2)\n`);
console.log(`  sessions scanned ${scanned} · usable ${rows.length} · EXCLUDED ${degenerate} (duration_s never advanced)`);
console.log(`  poll range ${Math.min(...xs).toFixed(5)}–${Math.max(...xs).toFixed(5)} s\n`);
const cut = (mean([Math.min(...xs), Math.max(...xs)]) + 0) / 1;
const lo = rows.filter((v) => v.poll < cut),
  hi = rows.filter((v) => v.poll >= cut);
for (const [lab, grp] of [
  ['low ', lo],
  ['high', hi]
]) {
  if (!grp.length) continue;
  const p = mean(grp.map((v) => v.poll));
  console.log(
    `  ${lab} poll ${p.toFixed(5)} s (n=${grp.length}): observed ${mean(grp.map((v) => v.imbalance))
      .toFixed(5)
      .padStart(9)}   model ${(p / RING_SECOND_S - 1).toFixed(5).padStart(9)}`
  );
}
console.log(`\n  Pearson r(poll, imbalance) = ${r.toFixed(3)}`);
console.log('  The §7.2 beat model predicts imbalance = poll/1.00346 − 1, i.e. a SIGN CHANGE across');
console.log('  this poll range. If observed stays one sign and ~10x smaller, the model does not');
console.log('  predict the ratio and §7.2 stays an explanation rather than a measurement.');
