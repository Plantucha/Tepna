/*
 * sensor-trio-gpu.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebGPU fast lane for the sensor-trio Monte-Carlo power sweep.
 *
 * The sweep is Monte-Carlo over INDEPENDENT window-draws, so the whole grid is one
 * compute dispatch: ONE GPU THREAD PER WINDOW. Each thread carries its own RNG and its
 * own AR(1) states, walks the window's samples, and Welford-accumulates the variance of
 * the three pairwise difference series on the fly — so nothing of length `winSec` is ever
 * materialised. A thread emits three f32 sigmas (or the -1 sentinel on a non-positive
 * variance). The across-window median and the negative-variance tally stay on the CPU:
 * they are O(N) over a handful of windows and not worth a second kernel.
 *
 * 100% local, zero install: WebGPU ships in Chrome/Edge (incl. Windows) and needs no
 * driver toolkit, no Python, no native module. This file is a pure accelerator — when
 * `navigator.gpu` is missing or no adapter is granted, `TrioGPU.init()` resolves false
 * and the caller keeps using the existing Web-Worker CPU pool. Nothing else changes.
 *
 * ── FIDELITY: what is identical, and what deliberately is not ────────────────────────
 *
 * IDENTICAL — the planted device truth (DEV / SD_H_*), the generative model, and the TCH
 * estimator sigma^2_A = 1/2(V_AB + V_AC - V_BC).
 *
 * NOT IDENTICAL — the RNG. sensor-trio-worker.js seeds ONCE PER TRIAL and draws its N
 * windows sequentially from that one xorshift32 stream. That is inherently serial: window
 * w's draws depend on every draw window w-1 consumed. A GPU thread cannot know where in
 * the stream it starts. So we seed PER WINDOW instead, from a hash of
 * (stream, N, trial, windowIndex). The model is Gaussian, so this is the SAME statistical
 * model, not the same bytes: per-trial values differ, the distribution does not. Validated
 * by two-sample KS against the shipped worker — the JS-vs-GPU KS distance lands INSIDE the
 * JS-vs-JS null band, i.e. within the reference's own sampling noise. Treat GPU and CPU
 * runs as two independent Monte-Carlo samples, never as byte-for-byte reproductions of
 * each other. (The CPU pool remains bit-reproducible on its own terms.)
 *
 * ── The trend term is OMITTED, and that is exact — not an approximation ──────────────
 *
 * genWindow adds the SAME `trend[i]` to all three devices, and TCH consumes only pairwise
 * DIFFERENCES (a_h10 - a_verity, ...). The trend therefore cancels ALGEBRAICALLY, in full.
 * Verified numerically: adding an arbitrary large common trend to all three series moves
 * sigma-hat by 2.2e-16 bpm. So this shader never generates it — which also keeps the f32
 * arithmetic well away from the ~100-bpm-magnitude cancellation the trend would otherwise
 * force. Consequence worth knowing: since the trend cancels, the ONLY thing separating the
 * "dynamic" and "resting" regimes in the estimator is sdH (the shared-HRV amplitude); the
 * exercise ramp/decay shape contributes nothing to sigma-hat.
 *
 * ⚠️ This omission is valid ONLY while all three devices share one common trend. If the
 * model ever gives devices DIFFERENT trends, the cancellation dies and this shader must
 * generate the trend again.
 *
 * ── Precision ────────────────────────────────────────────────────────────────────────
 * WGSL has no f64, so the shader is f32 while the JS reference is f64. This is safe here
 * because the TCH combination is not catastrophically cancelling (the recovered sigma^2 is
 * the same order as the variances it is built from), and the f32 error is ~1e-6 relative
 * against Monte-Carlo noise of ~1e-2. Gate-checked against the f64 CPU path.
 */
'use strict';

(function () {
  // ── planted device truth — MUST match sensor-trio-worker.js DEV / SD_H_* ──────────
  const SD_H_REST = 1.35,
    SD_H_DYN = 0.3;
  const DEV = {
    o2: { resp: 0.45, sigmaRest: 2.72 },
    h10: { resp: 1.0, sigmaRest: 1.86 },
    verity: { resp: 1.0, sigmaRest: 1.94 }
  };
  for (const k in DEV) {
    const d = DEV[k],
      sh = d.resp * SD_H_REST;
    d.sigma0 = Math.sqrt(Math.max(0.04, d.sigmaRest * d.sigmaRest - sh * sh));
  }
  const DKEYS = ['o2', 'h10', 'verity']; // shader device order — do not reorder
  const WG = 64; // workgroup size
  const MAX_WIN_PER_DISPATCH = 1 << 18; // keep workgroup count well inside limits

  const WGSL = /* wgsl */ `
struct Params {
  n        : u32,          // samples per window
  W        : u32,          // windows in this dispatch
  dyn      : u32,          // 1 = dynamic regime
  stream   : u32,          // seed stream (1 dynamic, 2 resting, 3+ri rho-leg, 100/200+di dur)
  t0       : u32,          // trial offset
  N        : u32,          // windows per trial
  ar       : f32,
  b        : f32,          // sqrt(1 - ar^2)
  rho      : f32,
  sdHdyn   : f32,
  sdHrest  : f32,
  resp     : vec3<f32>,    // o2, h10, verity
  sInd     : vec3<f32>,
  sCor     : vec3<f32>,
};
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> outSig : array<f32>;   // 3 per window

// xorshift32 — same generator family as the JS, but seeded PER WINDOW (see header).
fn rnd(s : ptr<function, u32>) -> f32 {
  var x = *s;
  x ^= x << 13u;
  x ^= x >> 17u;
  x ^= x << 5u;
  *s = x;
  // 24-bit mantissa, shifted into (0,1) so log() never sees 0
  return (f32(x >> 8u) + 0.5) * (1.0 / 16777216.0);
}
fn gauss(s : ptr<function, u32>) -> f32 {
  let u = rnd(s);
  let v = rnd(s);
  return sqrt(-2.0 * log(u)) * cos(6.283185307179586 * v);
}
// per-window seed mix — a window's randomness depends only on (stream, N, trial, widx),
// so a dispatch is reproducible regardless of how windows are chunked.
fn seedOf(stream : u32, N : u32, trial : u32, widx : u32) -> u32 {
  // WGSL requires explicit parens when mixing '*' and '^'
  var h : u32 = ((stream + 1u) * 0x9E3779B1u)
              ^ ((N + 1u)      * 0x85EBCA77u)
              ^ ((trial + 1u)  * 0xC2B2AE3Du)
              ^ ((widx + 1u)   * 0x27D4EB2Fu);
  h ^= h >> 15u; h = h * 0x2C1B3C6Du;
  h ^= h >> 13u; h = h * 0x297A2D39u;
  h ^= h >> 15u;
  return select(h, 1u, h == 0u);          // xorshift must never start at 0
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let w = gid.x;
  if (w >= P.W) { return; }

  let trial = P.t0 + w / P.N;
  let widx  = w % P.N;
  var st = seedOf(P.stream, P.N, trial, widx);

  // shared-HRV amplitude: the ONLY thing that separates the regimes (see header)
  var sdH : f32;
  if (P.dyn == 1u) { sdH = P.sdHdyn; } else { sdH = P.sdHrest * (0.45 + 1.15 * rnd(&st)); }

  // AR(1) states
  var hp : f32 = 0.0;
  var cp : f32 = 0.0;
  var np : vec3<f32> = vec3<f32>(0.0);

  // Welford accumulators for the three pairwise difference series
  var mHV : f32 = 0.0; var m2HV : f32 = 0.0;
  var mHO : f32 = 0.0; var m2HO : f32 = 0.0;
  var mVO : f32 = 0.0; var m2VO : f32 = 0.0;

  let hasRho = P.rho > 0.0;

  for (var i : u32 = 0u; i < P.n; i = i + 1u) {
    hp = P.ar * hp + P.b * gauss(&st);
    let h = sdH * hp;
    if (hasRho) { cp = P.ar * cp + P.b * gauss(&st); }
    np = vec3<f32>(
      P.ar * np.x + P.b * gauss(&st),
      P.ar * np.y + P.b * gauss(&st),
      P.ar * np.z + P.b * gauss(&st),
    );
    // NOTE: trend deliberately absent — it is common to all three devices and cancels
    // exactly in the differences below.
    let a = P.resp * h + P.sInd * np + P.sCor * cp;   // a.x=o2  a.y=h10  a.z=verity

    let c = f32(i + 1u);
    let dHV = a.y - a.z;  let eHV = dHV - mHV;  mHV += eHV / c;  m2HV += eHV * (dHV - mHV);
    let dHO = a.y - a.x;  let eHO = dHO - mHO;  mHO += eHO / c;  m2HO += eHO * (dHO - mHO);
    let dVO = a.z - a.x;  let eVO = dVO - mVO;  mVO += eVO / c;  m2VO += eVO * (dVO - mVO);
  }

  let dof = f32(P.n - 1u);
  let vAB = m2HV / dof;   // H-V
  let vAC = m2HO / dof;   // H-O
  let vBC = m2VO / dof;   // V-O

  let cvH = 0.5 * (vAB + vAC - vBC);   // h10
  let cvV = 0.5 * (vAB + vBC - vAC);   // verity
  let cvO = 0.5 * (vAC + vBC - vAB);   // o2

  let o = w * 3u;
  outSig[o + 0u] = select(-1.0, sqrt(cvO), cvO > 0.0);   // -1 = non-positive variance
  outSig[o + 1u] = select(-1.0, sqrt(cvH), cvH > 0.0);
  outSig[o + 2u] = select(-1.0, sqrt(cvV), cvV > 0.0);
}
`;

  let _dev = null,
    _pipe = null,
    _initTried = false,
    _why = 'not initialised';

  async function init() {
    if (_initTried) return !!_dev;
    _initTried = true;
    try {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        _why = 'no navigator.gpu (WebGPU unavailable)';
        return false;
      }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        _why = 'no WebGPU adapter granted';
        return false;
      }
      const dev = await adapter.requestDevice();
      if (!dev) {
        _why = 'no WebGPU device';
        return false;
      }
      dev.addEventListener?.('uncapturederror', (e) => {
        try {
          console.warn('[TrioGPU]', e.error?.message || e);
        } catch (_) {}
      });

      // A WGSL compile error does NOT throw from createComputePipeline — it surfaces
      // asynchronously. Without this check a broken shader reports "ok" and then writes
      // an all-zero buffer, which reads downstream as "every window had a negative
      // variance" — a silent wrong answer, far worse than no GPU at all. So: read the
      // compilation info, and capture validation errors around pipeline creation.
      const mod = dev.createShaderModule({ code: WGSL });
      if (mod.getCompilationInfo) {
        const info = await mod.getCompilationInfo();
        const bad = (info.messages || []).filter((m) => m.type === 'error');
        if (bad.length) {
          _why = 'WGSL compile error: ' + bad.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | ');
          return false;
        }
      }
      dev.pushErrorScope('validation');
      _pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
      const vErr = await dev.popErrorScope();
      if (vErr) {
        _why = 'pipeline validation: ' + vErr.message;
        _pipe = null;
        return false;
      }

      _dev = dev;

      // Smoke test: the shader must actually RECOVER the planted sigma on a small resting
      // cell. This is what turns "a pipeline was created" into "the GPU is producing real
      // numbers". If it does not, we disable the GPU and let the CPU pool take over.
      try {
        const probe = await _dispatch(256, { regime: 'resting', rho: 0, N: 1, t0: 0, winSec: 600, ar1: 0.9, stream: 2 });
        let ok = 0;
        for (let w = 0; w < 256; w++) {
          const s = probe[w * 3 + 1]; // h10 corner, planted sigma0 ~1.19
          if (isFinite(s) && s > 0.3 && s < 6) ok++;
        }
        if (ok < 200) {
          // expect nearly all windows to solve
          _why = `smoke test failed — only ${ok}/256 windows produced a plausible sigma`;
          _dev = null;
          _pipe = null;
          return false;
        }
      } catch (e) {
        _why = 'smoke test threw: ' + ((e && e.message) || e);
        _dev = null;
        _pipe = null;
        return false;
      }

      const i = adapter.info || {};
      _why = 'ok' + (i.vendor ? ' (' + i.vendor + (i.architecture ? '/' + i.architecture : '') + ')' : '');
      return true;
    } catch (e) {
      _why = (e && e.message) || String(e);
      _dev = null;
      _pipe = null;
      return false;
    }
  }

  // one dispatch → Float32Array of 3 sigmas per window (-1 = non-positive variance)
  async function _dispatch(nWin, opts) {
    const { regime, rho, N, t0, winSec, ar1, stream } = opts;
    const dyn = regime === 'dynamic';
    const b = Math.sqrt(1 - ar1 * ar1);

    // uniform: 11 scalars then three vec3 (each 16-byte aligned in std140-ish WGSL layout)
    const ub = new ArrayBuffer(96);
    const u32 = new Uint32Array(ub),
      f32 = new Float32Array(ub);
    u32[0] = winSec;
    u32[1] = nWin;
    u32[2] = dyn ? 1 : 0;
    u32[3] = stream;
    u32[4] = t0;
    u32[5] = Math.max(1, N);
    f32[6] = ar1;
    f32[7] = b;
    f32[8] = rho;
    f32[9] = SD_H_DYN;
    f32[10] = SD_H_REST;
    // vec3 members start at the next 16-byte boundary: byte 48, 64, 80
    for (let i = 0; i < 3; i++) {
      const d = DEV[DKEYS[i]];
      const corr = DKEYS[i] === 'h10' || DKEYS[i] === 'verity' ? rho : 0;
      f32[12 + i] = d.resp; // resp  @48
      f32[16 + i] = d.sigma0 * Math.sqrt(1 - corr); // sInd  @64
      f32[20 + i] = d.sigma0 * Math.sqrt(corr); // sCor  @80
    }

    const uBuf = _dev.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    _dev.queue.writeBuffer(uBuf, 0, ub);

    const bytes = nWin * 3 * 4;
    const sBuf = _dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rBuf = _dev.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const bind = _dev.createBindGroup({
      layout: _pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uBuf } },
        { binding: 1, resource: { buffer: sBuf } }
      ]
    });

    const enc = _dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(_pipe);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(nWin / WG));
    pass.end();
    enc.copyBufferToBuffer(sBuf, 0, rBuf, 0, bytes);
    _dev.queue.submit([enc.finish()]);

    await rBuf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(rBuf.getMappedRange().slice(0));
    rBuf.unmap();
    uBuf.destroy();
    sBuf.destroy();
    rBuf.destroy();
    return out;
  }

  const median = (a) => {
    const s = a.slice().sort((p, q) => p - q),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };

  /**
   * Same contract as sensor-trio-worker.js runCell → { med, negCount, negTot }.
   * count = trials in this call; each trial draws N windows.
   */
  async function runCell(regime, rho, N, t0, count, ar1, winSec, stream) {
    const med = { o2: [], h10: [], verity: [] };
    const negCount = { o2: 0, h10: 0, verity: 0 };
    const negTot = { o2: 0, h10: 0, verity: 0 };

    const perDispatch = Math.max(N, Math.floor(MAX_WIN_PER_DISPATCH / N) * N);
    let doneTrials = 0;
    while (doneTrials < count) {
      const trials = Math.min(Math.floor(perDispatch / N), count - doneTrials);
      const nWin = trials * N;
      const sig = await _dispatch(nWin, { regime, rho, N, t0: t0 + doneTrials, winSec, ar1, stream });

      for (let t = 0; t < trials; t++) {
        const per = { o2: [], h10: [], verity: [] };
        for (let w = 0; w < N; w++) {
          const base = (t * N + w) * 3;
          for (let ki = 0; ki < 3; ki++) {
            const k = DKEYS[ki],
              v = sig[base + ki];
            negTot[k]++;
            if (v > 0) per[k].push(v);
            else negCount[k]++;
          }
        }
        for (const k of DKEYS) if (per[k].length) med[k].push(median(per[k]));
      }
      doneTrials += trials;
    }
    return { med, negCount, negTot };
  }

  /** ρ-leg: per-window negative-variance count over M single windows (resting). */
  async function runRho(rho, ri, t0, count, ar1, winSec) {
    let neg = 0,
      done = 0;
    while (done < count) {
      const nWin = Math.min(MAX_WIN_PER_DISPATCH, count - done);
      const sig = await _dispatch(nWin, { regime: 'resting', rho, N: 1, t0: t0 + done, winSec, ar1, stream: 3 + ri });
      for (let w = 0; w < nWin; w++) {
        const b = w * 3;
        if (sig[b] <= 0 || sig[b + 1] <= 0 || sig[b + 2] <= 0) neg++; // .neg = ANY corner non-positive
      }
      done += nWin;
    }
    return { neg, count };
  }

  window.TrioGPU = {
    init,
    runCell,
    runRho,
    get ready() {
      return !!_dev;
    },
    get why() {
      return _why;
    }
  };
})();
