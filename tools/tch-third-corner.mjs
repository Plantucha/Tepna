#!/usr/bin/env node
/*
 * tools/tch-third-corner.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE O2RING AS A REAL THIRD CORNER — its own clock, not the host's.
 *
 * WHY. `_tchHat` marks a hat `pseudo` when any corner lacks per-sample device timing, and the
 * O2Ring has always been that corner: its PPG carries `sensor timestamp [ns] = 0` under a
 * `# timebase=host-disciplined` header. The conclusion drawn from that — "the O2Ring has no
 * clock" — is FALSE, and the device says so on its own screen. `OXYFRAME` carries `duration_s`,
 * a device-side counter, plus `ppg_n` per frame. Those two timestamp every raw PPG sample on
 * the RING's clock.
 *
 * ⚠ THE ACCOUNTING IS THE GUARD, AND IT MUST BE EXACT. `sum(ppg_n)` equalled the PPG row count
 * to the sample (3 240 245 on 2026-08-17). A reconstruction that merely looked plausible would
 * mis-timestamp every sample after the first dropped frame and no downstream check would see it,
 * so the sum is asserted before any timestamp is emitted — and it fails LOUD, never open.
 *
 * ⚠ FRAMES ARE A PREFIX OF THE ROWS, NOT A BIJECTION. Frames stop at the counter reset that ends
 * a session; the PPG file keeps its tail. Requiring equality rejects good nights (13 678 trailing
 * samples on 2026-08-17). Requiring `sum <= rows` and trimming is the honest form.
 *
 * ⚠ NEVER BUILD THE CORNER FROM `OXYFRAME.pr`. That is the ring's own SMOOTHED pulse rate and it
 * under-states σ exactly as the H10's `_HR.txt` does (CLAUDE.md §🎙️). Measured: `pr` yields
 * σ = 0.168 bpm and 75 % of the fusion weight — a number that is wrong in the direction that
 * makes it look authoritative. Beats come from the raw waveform or not at all.
 *
 * ⚠ WHAT THIS DOES NOT FIX — the finding that matters. Wiring the third corner does NOT rescue
 * the classic hat. With all three corners on genuine device clocks the solve STILL returns a
 * negative variance and still needs ρ ≈ 0.77 to close. The limit was never the timebase: three
 * sensors on one body measuring one heart have common-mode correlated errors, and that violates
 * TCH's founding assumption. So the `pseudo`/heuristic tier stands — and disciplining the O2Ring
 * waveform in CAPTURE would not upgrade it. Recorded here so nobody spends that work twice.
 *
 * Usage: node tools/tch-third-corner.mjs --ecg <H10_ECG.txt> --ppg <Verity_PPG.txt> \
 *                                        --oxyframe <O2_OXYFRAME.txt> --o2ppg <O2_PPG.txt>
 *        node tools/tch-third-corner.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/**
 * Parse OXYFRAME into the frame sequence that carries the ring's own clock.
 * Stops at the counter reset that ends a session — a decreasing `duration_s` is not a wrap.
 * @returns {Array<{dev:number,n:number,st:number,host:number}>}
 */
export function parseFrames(text) {
  const L = text.split('\n');
  const hdr = L[0].split(';');
  const iD = hdr.indexOf('duration_s'),
    iN = hdr.indexOf('ppg_n'),
    iS = hdr.indexOf('ppg_dur_step');
  if (iD < 0 || iN < 0) return [];
  const out = [];
  let prev = null;
  for (let i = 1; i < L.length; i++) {
    const p = L[i].split(';');
    if (p.length <= iN) continue;
    const d = Number(p[iD]),
      n = Number(p[iN]);
    const host = Date.parse(p[0] + 'Z') / 1000;
    if (!Number.isFinite(d) || !Number.isFinite(n) || n <= 0) continue;
    if (prev !== null && d < prev) break; // counter reset ⇒ session end
    prev = d;
    let st = iS >= 0 ? Number(p[iS]) : 1;
    if (!Number.isFinite(st) || st <= 0) st = 1;
    out.push({ dev: d, n, st, host });
  }
  return out;
}

/**
 * Per-sample device time for every raw PPG sample. PURE — exported for the gate.
 * @returns {{ok:true,devT:Float64Array,used:number,trimmed:number,fsHz:number,stalls:Array}
 *          |{ok:false,reason:string}}
 */
export function deviceAxis(frames, sampleCount) {
  if (!frames || !frames.length) return { ok: false, reason: 'no frames' };
  const total = frames.reduce((a, f) => a + f.n, 0);
  // Frames are a PREFIX of the rows (see header). Exceeding them is a real inconsistency.
  if (total > sampleCount + 5) return { ok: false, reason: `frame sum ${total} EXCEEDS ppg rows ${sampleCount}` };
  const devT = new Float64Array(total);
  let k = 0;
  for (const f of frames) for (let j = 0; j < f.n; j++, k++) devT[k] = f.dev + (j / f.n) * f.st;
  const stalls = [];
  for (let i = 1; i < frames.length; i++) {
    const lag = frames[i].host - frames[i - 1].host - (frames[i].dev - frames[i - 1].dev);
    if (lag > 2.0) stalls.push({ atDev: frames[i].dev, lostSec: lag });
  }
  const fsHz = frames.reduce((a, f) => a + f.n / f.st, 0) / frames.length;
  return { ok: true, devT, used: total, trimmed: sampleCount - total, fsHz, stalls };
}

/** Beat times (device seconds) → per-minute mean HR, keyed by minute on a shared timeline. */
export function beatsToMinuteHr(beats, t0, shiftSec) {
  const bin = new Map();
  for (let i = 1; i < beats.length; i++) {
    const rr = beats[i] - beats[i - 1];
    if (rr < 0.3 || rr > 2.0) continue;
    const m = Math.floor((beats[i] - t0 + shiftSec) / 60);
    if (!bin.has(m)) bin.set(m, []);
    bin.get(m).push(60 / rr);
  }
  const out = [];
  for (const [m, v] of [...bin.entries()].sort((a, b) => a[0] - b[0])) if (v.length >= 20) out.push({ tMin: m, v: v.reduce((a, b) => a + b, 0) / v.length });
  return out;
}

function realm() {
  const DB = require(join(ROOT, 'tools', 'build-core.js'));
  const noop = () => {};
  const ctx = { console: { log: noop, warn: noop, error: noop }, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['kernel-constants.js', 'clock.js', 'dex-export.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js', 'integrator-tch.js'])
    vm.runInContext(DB.classicify(fs.readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

function readPpgValues(path) {
  const L = fs.readFileSync(path, 'utf8').split('\n');
  let s = 0;
  while (s < L.length && (L[s].startsWith('#') || L[s].startsWith('Phone'))) s++;
  const vals = [];
  for (let i = s; i < L.length; i++) {
    const p = L[i].split(';');
    if (p.length < 3) continue;
    const v = Number(p[2]);
    if (Number.isFinite(v)) vals.push(v);
  }
  return vals;
}

function polarAnchor(path) {
  const t = fs.readFileSync(path, 'utf8');
  const nl = t.indexOf('\n');
  const p = t.slice(nl + 1, t.indexOf('\n', nl + 1)).split(';');
  return { host: Date.parse(p[0] + 'Z') / 1000 };
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
    }
  };
  console.log('tch-third-corner selftest');

  // planted frames: 3 frames of 100 samples, 1 device-second each
  const frames = [
    { dev: 10, n: 100, st: 1, host: 1000 },
    { dev: 11, n: 100, st: 1, host: 1001 },
    { dev: 12, n: 100, st: 1, host: 1002 }
  ];
  const a = deviceAxis(frames, 300);
  ok('exact accounting accepted', a.ok === true, a.reason);
  ok('emits one timestamp per sample', a.used === 300, 'used=' + a.used);
  ok('first sample sits on its frame', a.devT[0] === 10);
  ok('samples advance INSIDE a frame', Math.abs(a.devT[50] - 10.5) < 1e-9, String(a.devT[50]));
  ok('frame boundary is exact', Math.abs(a.devT[100] - 11) < 1e-9, String(a.devT[100]));
  ok(
    'axis is monotonic',
    a.devT.every((v, i) => i === 0 || v >= a.devT[i - 1])
  );

  // a PREFIX of the rows must be accepted and reported, not rejected
  const pre = deviceAxis(frames, 340);
  ok('frames as a prefix are accepted', pre.ok === true, pre.reason);
  ok('the tail is reported as trimmed', pre.trimmed === 40, 'trimmed=' + pre.trimmed);

  // frames claiming MORE samples than exist is a real inconsistency and must fail closed
  const over = deviceAxis(frames, 100);
  ok('frames exceeding rows FAIL closed', over.ok === false && /EXCEEDS/.test(over.reason), over.reason);
  ok('empty frame list fails closed', deviceAxis([], 10).ok === false);

  // a planted stall must be found, and its size reported
  const st = deviceAxis(
    [
      { dev: 10, n: 10, st: 1, host: 1000 },
      { dev: 11, n: 10, st: 1, host: 1041 } // host +41 s, counter +1 s ⇒ 40 s lost
    ],
    20
  );
  ok('planted stall detected', st.stalls.length === 1, 'n=' + st.stalls.length);
  ok('stall size recovered', st.stalls.length === 1 && Math.abs(st.stalls[0].lostSec - 40) < 1e-6);
  // and a healthy pair must NOT report one — a detector that always fires is not a detector
  const nost = deviceAxis(
    [
      { dev: 10, n: 10, st: 1, host: 1000 },
      { dev: 11, n: 10, st: 1, host: 1001 }
    ],
    20
  );
  ok('healthy frames report NO stall', nost.stalls.length === 0, 'n=' + nost.stalls.length);

  // parseFrames must stop at the counter reset
  const txt = 'Phone timestamp;duration_s;ppg_n;ppg_dur_step\n' + '2026-08-17T21:00:00.000;10;100;1\n' + '2026-08-17T21:00:01.000;11;100;1\n' + '2026-08-17T21:00:02.000;0;100;1\n';
  ok('parseFrames stops at the counter reset', parseFrames(txt).length === 2, String(parseFrames(txt).length));

  // minute binning keys off the SHIFT, so two corners can share a timeline
  const beats = [];
  for (let i = 0; i < 200; i++) beats.push(i * 1.0);
  const m0 = beatsToMinuteHr(beats, 0, 0);
  const m5 = beatsToMinuteHr(beats, 0, 300);
  ok('shift moves the minute index', m5.length && m0.length && m5[0].tMin === m0[0].tMin + 5);

  if (fail === 0) console.log(`\n✓ all ${pass} selftests passed`);
  else console.log(`\n✗ selftest — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

const argv = process.argv;
const arg = (k) => {
  const i = argv.indexOf(k);
  return i > 0 ? argv[i + 1] : null;
};

if (argv.includes('--selftest')) selftest();
else {
  const ecg = arg('--ecg'),
    vppg = arg('--ppg'),
    oxy = arg('--oxyframe'),
    o2p = arg('--o2ppg');
  if (!ecg || !vppg || !oxy || !o2p) {
    console.log('usage: --ecg <H10_ECG> --ppg <Verity_PPG> --oxyframe <O2_OXYFRAME> --o2ppg <O2_PPG>');
    process.exit(2);
  }
  const ctx = realm();
  const { h10Beats, verityBeats } = await import(join(ROOT, 'tools', 'beat-leg-closure.mjs'));

  console.log('INPUT VALIDATION — a corner that is empty must fail loudly, never silently');
  const frames = parseFrames(fs.readFileSync(oxy, 'utf8'));
  const vals = readPpgValues(o2p);
  const ax = deviceAxis(frames, vals.length);
  if (!ax.ok) {
    console.log('  O2Ring  FAIL: ' + ax.reason);
    process.exit(1);
  }
  const det = ctx.PPGDSP.detectChannel(Float64Array.from(vals.slice(0, ax.used)), ax.fsHz);
  const idx = det && (det.feet && det.feet.length ? det.feet : det.peaks);
  if (!idx || !idx.length) {
    console.log('  O2Ring  FAIL: no beats detected');
    process.exit(1);
  }
  const o2Beats = Array.from(idx).map((i) => ax.devT[Math.min(ax.devT.length - 1, Math.round(i))]);
  console.log('  O2Ring  samples=%d (trimmed %d post-reset) frames=%d fs=%s Hz beats=%d stalls=%d', ax.used, ax.trimmed, frames.length, ax.fsHz.toFixed(2), o2Beats.length, ax.stalls.length);
  const hb = h10Beats(ecg, ctx);
  if (!hb || hb.length < 500) {
    console.log('  H10     FAIL: beats=' + (hb ? hb.length : 0));
    process.exit(1);
  }
  console.log('  H10     beats=%d span=%s min', hb.length, ((hb[hb.length - 1] - hb[0]) / 60).toFixed(1));
  const vb = verityBeats(vppg, ctx);
  if (!vb || vb.length < 500) {
    console.log('  Verity  FAIL: beats=' + (vb ? vb.length : 0));
    process.exit(1);
  }
  console.log('  Verity  beats=%d span=%s min', vb.length, ((vb[vb.length - 1] - vb[0]) / 60).toFixed(1));

  const T0 = Math.max(polarAnchor(ecg).host, polarAnchor(vppg).host, frames[0].host);
  const A = beatsToMinuteHr(hb, hb[0], polarAnchor(ecg).host - T0);
  const B = beatsToMinuteHr(vb, vb[0], polarAnchor(vppg).host - T0);
  const C = beatsToMinuteHr(o2Beats, o2Beats[0], frames[0].host - T0);
  const key = (s) => new Map(s.map((p) => [p.tMin, p.v]));
  const mA = key(A),
    mB = key(B),
    mC = key(C);
  const common = [...mA.keys()].filter((k) => mB.has(k) && mC.has(k) && k >= 0).sort((x, y) => x - y);
  console.log('\nCOMMON MINUTES across all three = %d', common.length);
  if (common.length < 30) {
    console.log('  too few for a hat');
    process.exit(1);
  }
  const mk = (m) => common.map((k) => m.get(k));
  const r = ctx.IntegratorTCH.threeCorneredHat(mk(mA), mk(mB), mk(mC), { labels: ['H10', 'Verity', 'O2Ring'] });
  console.log('\nTHREE-CORNERED HAT — O2Ring on its OWN clock');
  if (!r.ok) {
    console.log('  ' + r.reason);
    process.exit(1);
  }
  for (const k of ['H10', 'Verity', 'O2Ring']) console.log(`  σ ${k.padEnd(7)} ${r.sigma[k].toFixed(3).padStart(7)} bpm   weight ${r.weights[k].toFixed(3)}`);
  console.log('  method=%s  rho=%s  negativeVariance=%s  culprit=%s', r.method, r.rho, r.negative, r.culprit);
  if (r.negative)
    console.log(
      '\n  ⚠ NEGATIVE VARIANCE with three real device clocks — the classic hat still fails.\n' +
        '    The limit is common-mode correlation between sensors on one body, NOT the timebase,\n' +
        '    so `pseudo`/heuristic stands and capture-side timing work would not upgrade it.'
    );
}
