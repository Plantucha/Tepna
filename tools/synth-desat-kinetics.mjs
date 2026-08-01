#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * synth-desat-kinetics.mjs — measure whether a synthetic SpO₂ corpus desaturates
 * at a PHYSIOLOGICAL rate, and how much of it OxyDex's artifact self-gate rejects.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS. `papers/odi4-ahi-bias.html` Table 1 stopped reproducing, and
 * PAPER-ODI4-REPRODUCIBILITY-2026-07-31 traced it to the INPUTS, not the detector
 * (the 2026-07-01 initial-commit detector run on today's corpus gives today's
 * numbers exactly). The mechanism is here: the synthetic corpus desaturates far
 * faster than a real one can, so `selfGateDesat` correctly rejects most of it as
 * probe artifact — 232 of 242 events on the severe night.
 *
 * `SELFGATE.FALL_RATE_MAX` is 1.5 %/s because a real systemic desaturation is
 * limited by circulation and lung O₂ stores; it falls over TENS of seconds. A
 * 4 %/s edge is a probe squeeze or a finger-off, and the gate is right to drop it.
 * So the defect is in the FIXTURE, not the detector — and a pilot computed on a
 * fixture the detector rejects measures the gate, not the metric.
 *
 * This tool is the acceptance test for fixing the generator: run it before and
 * after. It reads raw CSVs only — no DSP, no bundle — so it cannot itself drift
 * with the code it is judging.
 *
 * USAGE
 *   node tools/synth-desat-kinetics.mjs <dir-or-csv>...
 *   node tools/synth-desat-kinetics.mjs --selftest
 *
 * Exit code 1 if any file exceeds the physiological ceiling, so CI can gate it.
 * ════════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

/* The gate this tool mirrors. Kept as a LITERAL rather than imported from
   oxydex-dsp: if the DSP's constant is ever loosened to make a bad fixture pass,
   this tool must still fail — a judge that moves with the thing it judges is not
   a judge. Divergence is itself the finding, so the value is asserted in --selftest. */
const FALL_RATE_MAX = 1.5; // %/s — SELFGATE's physiological ceiling
const STEEP_FRAC_MAX = 0.05; // >5 % of falls steeper than the ceiling ⇒ unphysiological

function spo2Of(csvText) {
  const lines = csvText.trim().split('\n');
  const hdr = lines[0].split(',').map((s) => s.trim().toLowerCase());
  let si = hdr.findIndex((h) => /spo ?2|oxygen/.test(h));
  if (si < 0) si = 1; // O2Ring layout fallback: time, spo2, pulse, motion
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const v = +String(lines[i].split(',')[si]).trim();
    out.push(Number.isFinite(v) && v >= 40 && v <= 100 ? v : null);
  }
  return out;
}

/* Every POSITIVE one-second step down, as %/s. At the 1 Hz an O2Ring records,
   one sample IS one second, so the step and the rate are the same number. */
function fallRates(spo2) {
  const r = [];
  for (let i = 1; i < spo2.length; i++) {
    if (spo2[i] == null || spo2[i - 1] == null) continue;
    const d = spo2[i - 1] - spo2[i];
    if (d > 0) r.push(d);
  }
  return r.sort((a, b) => b - a);
}

function analyze(file) {
  const spo2 = spo2Of(readFileSync(file, 'utf8'));
  const r = fallRates(spo2);
  if (!r.length) return { file: basename(file), n: spo2.length, empty: true };
  const steep = r.filter((x) => x > FALL_RATE_MAX).length;
  const q = (p) => r[Math.min(r.length - 1, Math.floor(r.length * p))];
  return {
    file: basename(file),
    n: spo2.length,
    falls: r.length,
    max: r[0],
    p99: q(0.01),
    p95: q(0.05),
    steepFrac: steep / r.length,
    ok: steep / r.length <= STEEP_FRAC_MAX
  };
}

function selftest() {
  let fail = 0;
  const eq = (name, got, want) => {
    const ok = got === want;
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✕'} ${name}${ok ? '' : `  — got ${got} · want ${want}`}`);
  };
  // The mirrored constant must match the DSP's. A silent divergence would make every
  // verdict below meaningless, so it is checked against the source text, not assumed.
  const dsp = readFileSync(new URL('../oxydex-dsp.js', import.meta.url), 'utf8');
  const m = dsp.match(/FALL_RATE_MAX:\s*([\d.]+)/);
  eq('FALL_RATE_MAX mirrors oxydex-dsp SELFGATE', m && +m[1], FALL_RATE_MAX);

  // A PHYSIOLOGICAL desat: 97 → 90 over 10 s = 0.7 %/s, well inside the ceiling.
  const gentle = [];
  for (let k = 0; k < 600; k++) gentle.push(97);
  for (let k = 1; k <= 10; k++) gentle[100 + k] = Math.round(97 - (7 * k) / 10);
  const g = fallRates(gentle);
  eq('a 0.7 %/s ramp has NO fall past the ceiling', g.filter((x) => x > FALL_RATE_MAX).length, 0);

  // A PROBE-SQUEEZE edge: the same 7 % in one second.
  const square = [];
  for (let k = 0; k < 600; k++) square.push(97);
  square[101] = 90;
  eq('a 7 %/s step registers exactly one over-ceiling fall', fallRates(square).filter((x) => x > FALL_RATE_MAX).length, 1);
  eq('…and its magnitude is the full drop', fallRates(square)[0], 7);

  console.log(fail ? `\n✕ selftest: ${fail} failing` : '\n✓ selftest: all passing');
  process.exit(fail ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
if (!args.length) {
  console.error('usage: node tools/synth-desat-kinetics.mjs <dir-or-csv>...  |  --selftest');
  process.exit(2);
}

const files = [];
for (const a of args) {
  if (statSync(a).isDirectory()) {
    for (const f of readdirSync(a)) if (/\.csv$/i.test(f) && /o2ring/i.test(f)) files.push(join(a, f));
  } else files.push(a);
}
if (!files.length) {
  console.error('no O2Ring *.csv found');
  process.exit(2);
}

console.log(`SpO₂ desaturation kinetics — ceiling ${FALL_RATE_MAX} %/s (SELFGATE.FALL_RATE_MAX)\n`);
console.log('file                                        samples   falls   max   p99   p95   >ceiling');
let bad = 0;
for (const f of files.sort()) {
  const a = analyze(f);
  if (a.empty) {
    console.log(`${a.file.padEnd(42)}  ${String(a.n).padStart(6)}   (no usable SpO₂)`);
    continue;
  }
  if (!a.ok) bad++;
  console.log(
    `${a.file.padEnd(42)}  ${String(a.n).padStart(6)}  ${String(a.falls).padStart(6)}  ${String(a.max).padStart(4)}  ${String(a.p99).padStart(4)}  ${String(a.p95).padStart(4)}   ${(100 * a.steepFrac).toFixed(1).padStart(5)}%  ${a.ok ? '' : '← UNPHYSIOLOGICAL'}`
  );
}
if (bad) {
  console.log(
    `\n✕ ${bad} of ${files.length} file(s) exceed the ceiling on more than ${100 * STEEP_FRAC_MAX}% of falls.` +
      `\n  OxyDex's selfGateDesat will reject those desaturations as probe artifact, so any ODI/AHI` +
      `\n  measured on this corpus reports the GATE's behaviour, not the metric's.`
  );
  process.exit(1);
}
console.log(`\n✓ all ${files.length} file(s) desaturate within the physiological ceiling.`);
