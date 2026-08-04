#!/usr/bin/env node
/*
 * tools/beat-leg-closure.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THREE-SOURCE DRIFT CLOSURE for H10 ↔ Verity ↔ capture host (WEARABLE-DRIFT-DIRECT §7.3/§7.4).
 *
 * Legs A and B are each device against the box host, measured from the two columns every Polar file
 * carries (`tools/dual-clock-rate.mjs`). Their difference PREDICTS the device↔device rate. Leg C
 * measures that rate INDEPENDENTLY, from beat times on each device's own `sensor timestamp [ns]` axis
 * — never the host column. That independence is the whole point: derived from the host, leg C would be
 * the difference of two host-referenced series and could not fail.
 *
 * ⚠ TWO SIGN CONVENTIONS, BOTH ESTABLISHED BY PLANTED TRUTH, BOTH INITIALLY ASSUMED WRONG:
 *   1. `dual-clock-rate` reports `(slope − 1)` where `slope = host ms per device ms`, so its ppm is
 *      NEGATIVE when the device runs FAST. Planted a device fast by +20 ppm → it reports −19.5.
 *      Assuming the opposite inverts the prediction and turns a closing triple into an 18 ppm failure.
 *   2. `legC` returns d(t_V − t_H)/dt, i.e. (V_rate − H_rate). Planted −20 ppm → returns −20.0.
 * Neither is documented in prose. Re-derive them by planting, never by reading the sign off an example.
 *
 * ⚠ THE MATCHER MUST TRACK, NOT BAND-FILTER. A fixed acceptance window silently adopts the adjacent
 * beat once accumulated drift pushes the true lag out of it, which INVERTS the measured trend: planted
 * −20 ppm read +17.9. Tracking the pairing from a seeded reference recovers −40…+40 ppm to 0.0 ppm
 * under realistic HRV (CV 0.0522), 2 % dropouts per side and ±20 ms PAT jitter. Safe here because the
 * block-to-block lag change is ~12 ms against an RR of ~1000 — contrast JOINT-UNWRAP-ATTEMPT, where the
 * per-block offsets were themselves imprecise to a large fraction of an RR and no unwrap could work.
 *
 * Usage: node tools/beat-leg-closure.mjs --h10 <ECG.txt> --verity <PPG.txt> [--pred <ppm>]
 *        node tools/beat-leg-closure.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/**
 * Leg C — relative rate of two beat trains, each on its OWN clock. Pure; exported for the gate.
 * @returns {{ok:true,ppm:number,blocks:number,pts:Array}|{ok:false,reason:string}}
 */
export function legC(H, V, opts = {}) {
  const BLOCK = opts.block || 600;
  if (!H || !V || H.length < 100 || V.length < 100) return { ok: false, reason: 'too few beats' };
  const t0 = Math.max(H[0], V[0]),
    t1 = Math.min(H[H.length - 1], V[V.length - 1]);
  const blocks = [];
  for (let bs = t0; bs + BLOCK <= t1; bs += BLOCK) {
    const hb = [],
      vb = [];
    for (const t of H) if (t >= bs && t < bs + BLOCK) hb.push(t);
    for (const t of V) if (t >= bs - 3 && t < bs + BLOCK + 3) vb.push(t);
    if (hb.length < 200 || vb.length < 200) continue;
    blocks.push({ mid: (bs - t0) / 60, hb, vb });
  }
  if (blocks.length < 4) return { ok: false, reason: 'blocks ' + blocks.length + ' < 4' };

  /* Nearest Verity beat to (t + ref) — the search FOLLOWS the reference instead of sitting in a fixed
     window, which is what stops it walking to the adjacent beat as drift accumulates. */
  const lagAt = (blk, ref) => {
    const out = [];
    for (const t of blk.hb) {
      const want = t + ref;
      let lo = 0,
        hi = blk.vb.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (blk.vb[m] < want) lo = m + 1;
        else hi = m;
      }
      let best = null;
      for (const j of [lo - 1, lo, lo + 1]) {
        if (j < 0 || j >= blk.vb.length) continue;
        const d = blk.vb[j] - t;
        if (best === null || Math.abs(d - ref) < Math.abs(best - ref)) best = d;
      }
      if (best !== null) out.push(best);
    }
    out.sort((a, b) => a - b);
    return out.length ? out[out.length >> 1] : null;
  };

  /* Seed from block 0 — the ONLY place a whole-RR wrap is chosen, made where drift has not accumulated. */
  const rr = 60 / (opts.hrGuess || 60);
  let seed = null,
    bestSpread = Infinity;
  for (let k = -2; k <= 2; k++) {
    for (let base = -0.5; base <= 1.0; base += 0.05) {
      const ref = base + k * rr;
      const l = lagAt(blocks[0], ref);
      if (l === null) continue;
      if (Math.abs(l - ref) < bestSpread) {
        bestSpread = Math.abs(l - ref);
        seed = l;
      }
    }
  }
  if (seed === null) return { ok: false, reason: 'no seed' };

  const pts = [];
  let ref = seed;
  for (const blk of blocks) {
    const l = lagAt(blk, ref);
    if (l === null) continue;
    pts.push([blk.mid, l]);
    ref = l; // TRACK — this is the fix
  }
  const sl = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] - pts[i][0] > 60) sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  if (!sl.length) return { ok: false, reason: 'no slope pairs ≥60 min apart' };
  sl.sort((a, b) => a - b);
  return { ok: true, ppm: (sl[sl.length >> 1] / 60) * 1e6, blocks: pts.length, seed, pts };
}

function realm() {
  const DB = require(join(ROOT, 'tools', 'build-core.js'));
  const noop = () => {};
  const ctx = { console: { log: noop, warn: noop, error: noop }, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['kernel-constants.js', 'clock.js', 'dex-export.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) vm.runInContext(DB.classicify(fs.readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

export function h10Beats(path, ctx) {
  const L = fs.readFileSync(path, 'utf8').split('\n');
  const ns = [],
    uv = [];
  for (let i = 1; i < L.length; i++) {
    const p = L[i].split(';');
    if (p.length < 4) continue;
    const t = Number(p[1]),
      v = Number(p[3]);
    if (Number.isFinite(t) && Number.isFinite(v)) {
      ns.push(t);
      uv.push(v);
    }
  }
  if (ns.length < 1000) return null;
  const f = (ns.length - 1) / ((ns[ns.length - 1] - ns[0]) / 1e9);
  const i16 = Int16Array.from(uv.map((v) => Math.max(-32768, Math.min(32767, Math.round(v)))));
  const pk = ctx.ECGDSP.detectPeaks(i16, ctx.ECGDSP.bandpass(i16, f), f);
  const idx = pk && pk.peaks ? pk.peaks : pk;
  if (!idx || !idx.length) return null;
  return Array.from(idx).map((i) => ns[Math.min(ns.length - 1, Math.round(i))] / 1e9);
}

export function verityBeats(path, ctx) {
  const raw = fs.readFileSync(path, 'utf8');
  const L = raw.split('\n');
  const dev = [];
  for (let i = 1; i < L.length; i++) {
    const p = L[i].split(';');
    if (p.length > 2) {
      const t = Number(p[1]);
      if (Number.isFinite(t)) dev.push(t / 1e9);
    }
  }
  const rec = ctx.PPGDSP.parsePPG(raw);
  if (!rec || !rec.ch || !rec.ch.length) return null;
  /* The device axis is read from the COLUMN, not from rec.relSec — relSec is host-disciplined via
     hostAxis, and using it would make leg C the difference of two host-referenced series. Verified:
     the parser neither resamples nor gap-fills here, so peak index i is raw row i. */
  if (rec.ch[0].length !== dev.length) return null;
  const per = rec.ch.map((c) => ctx.PPGDSP.detectChannel(c, rec.fs));
  let ri = 0,
    b = -1;
  per.forEach((p, i) => {
    if (p.peaks.length > b) {
      b = p.peaks.length;
      ri = i;
    }
  });
  const cons = ctx.PPGDSP.consensusBeats(per, ri, rec.fs);
  const idx = cons && (cons.feet && cons.feet.length ? cons.feet : cons.peaks);
  if (!idx || !idx.length) return null;
  return Array.from(idx).map((i) => dev[Math.min(dev.length - 1, Math.round(i))]);
}

function selftest() {
  let s = 12345;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const norm = () => {
    let u = 0,
      v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let pass = 0,
    fail = 0;
  console.log('leg-C known-answer — realistic HRV (CV 0.0522), 2 % dropouts/side, ±20 ms PAT jitter\n');
  console.log('  planted   reported     err');
  for (const P of [-40e-6, -20e-6, -8e-6, 0, 8e-6, 20e-6, 40e-6]) {
    const H = [],
      V = [];
    let t = 0;
    while (t < 563 * 60) {
      t += Math.max(0.4, 1.0 * (1 + 0.0522 * norm()));
      if (rnd() > 0.02) H.push(t);
      if (rnd() > 0.02) V.push((t + 0.25 + 0.02 * norm()) * (1 + P));
    }
    const r = legC(H, V, { hrGuess: 60 });
    const truth = P * 1e6;
    const err = r.ok ? r.ppm - truth : NaN;
    const ok = r.ok && Math.abs(err) < 1.0;
    ok ? pass++ : fail++;
    console.log(`  ${truth.toFixed(1).padStart(7)}   ${(r.ok ? r.ppm.toFixed(1) : r.reason).padStart(8)}   ${(r.ok ? err.toFixed(1) : '—').padStart(5)}  ${ok ? '✓' : '✗'}`);
  }
  console.log(`\n${fail === 0 ? '✓' : '✗'} selftest — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--selftest')) selftest();
  const hp = arg('--h10'),
    vp = arg('--verity');
  if (!hp || !vp) {
    console.error('usage: node tools/beat-leg-closure.mjs --h10 <ECG.txt> --verity <PPG.txt> [--pred <ppm>]');
    process.exit(2);
  }
  const ctx = realm();
  const H = h10Beats(hp, ctx),
    V = verityBeats(vp, ctx);
  if (!H || !V) {
    console.error('beat extraction failed');
    process.exit(1);
  }
  const hr = 60 / ((H[H.length - 1] - H[0]) / H.length);
  const r = legC(H, V, { hrGuess: hr });
  if (!r.ok) {
    console.error('leg C: ' + r.reason);
    process.exit(1);
  }
  console.log(`H10 ${H.length} beats · Verity ${V.length} beats · ${r.blocks} blocks`);
  console.log(`leg C (V−H, device axes, host-independent) = ${r.ppm.toFixed(1)} ppm`);
  const pred = arg('--pred');
  if (pred != null) {
    const p = Number(pred);
    console.log(`predicted from host legs                   = ${p.toFixed(1)} ppm`);
    console.log(`CLOSURE RESIDUAL                           = ${(r.ppm - p).toFixed(1)} ppm`);
  }
}
