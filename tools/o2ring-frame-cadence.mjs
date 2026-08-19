#!/usr/bin/env node
/*
 * tools/o2ring-frame-cadence.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * IS THE O2RING'S ~1 Hz CADENCE A FIRMWARE CLOCK OR HOST BLE FRAMING? — measure, do not assume.
 *
 * Two streams carry a ~1 Hz beat, and they are NOT the same clock:
 *   · OXYLIVE (the live duration frames, logged in _PMDARRIVAL.csv) carries a DEVICE counter —
 *     `first_sensor_ns` = duration_s × 1e9 — that steps by EXACTLY 1.000 s (a dropped frame steps 2.000).
 *     That is a real firmware 1 Hz tick, and it sits beside a genuinely independent host arrival time.
 *   · PPG2W (_PPG2W.txt) has `sensor timestamp [ns] = 0` — NO device clock. Its per-sample host stamps
 *     are a ~10 ms interpolated ramp; the only 1 Hz structure is the frame RE-ANCHOR discontinuity every
 *     ~1 s, which is a BLE DELIVERY event, not a clock tick.
 *
 * So the firmware 1 Hz checkpoint is real but lives in the DURATION counter (which the onboard .dat also
 * uses); ppg2w can only be placed on that grid THROUGH the shared session, never by its own timestamps.
 * `independent` (host spread > 2 ms, per the Clock Contract) says whether the host arrival is a real
 * second clock or was drawn from the device stamp.
 *
 * Usage: node tools/o2ring-frame-cadence.mjs --arrival <_PMDARRIVAL.csv> [--ppg2w <_PPG2W.txt>]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Parse a PSL/capture-host timestamp `YYYY-MM-DDTHH:MM:SS.mmm` → floating ms (Clock Contract §1). PURE. */
export function parseHostTs(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null;
}

/** Median/mean/sd/min/max of a numeric array. PURE. Returns null for an empty array. */
export function deltaStats(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((p, c) => p + c, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((p, c) => p + (c - mean) ** 2, 0) / nums.length);
  return { n: nums.length, median: s[s.length >> 1], mean, sd, min: s[0], max: s[s.length - 1] };
}

/** Device counter vs host arrival for the OXYLIVE 1 Hz frames. PURE (takes parallel arrays). */
export function analyzeArrival(hostMs, devNs) {
  const hostD = [],
    devD = [];
  for (let i = 1; i < hostMs.length; i++) {
    hostD.push((hostMs[i] - hostMs[i - 1]) / 1000);
    devD.push((devNs[i] - devNs[i - 1]) / 1e9);
  }
  const hs = deltaStats(hostD);
  // spread of host inter-arrivals: >2 ms means the host is a real second clock, not the device stamp rounded
  const spreadMs = hs ? (hs.max - hs.min) * 1000 : 0;
  // fraction of device steps that are an EXACT integer second (1.000, 2.000 …) — the firmware-tick signature
  const devExact = devD.length ? devD.filter((d) => Math.abs(d - Math.round(d)) < 1e-6).length / devD.length : 0;
  return { hostDelta: hs, devDelta: deltaStats(devD), spreadMs, independent: spreadMs > 2, devExactFrac: devExact };
}

/** Frame-boundary rate from ppg2w per-sample host stamps: the ~1 Hz re-anchor discontinuities. PURE. */
export function frameBoundaryRate(sampleHostMs, tolMs = 3) {
  const d = [];
  for (let i = 1; i < sampleHostMs.length; i++) d.push(sampleHostMs[i] - sampleHostMs[i - 1]);
  if (!d.length) return null;
  const hist = {};
  d.forEach((x) => (hist[x] = (hist[x] || 0) + 1));
  const modal = +Object.entries(hist).sort((a, b) => b[1] - a[1])[0][0];
  const anomalies = d.filter((x) => Math.abs(x - modal) >= tolMs).length;
  const spanS = (sampleHostMs[sampleHostMs.length - 1] - sampleHostMs[0]) / 1000;
  return {
    samples: sampleHostMs.length,
    spanS,
    sampleHz: spanS > 0 ? sampleHostMs.length / spanS : 0,
    modalMs: modal,
    boundaries: anomalies,
    boundaryHz: spanS > 0 ? anomalies / spanS : 0
  };
}

/** Read _PMDARRIVAL.csv → {hostMs[], devNs[]} for the OXYLIVE_DURATION_S rows. */
export function readArrival(path) {
  const L = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const hostMs = [],
    devNs = [];
  for (const ln of L) {
    const p = ln.split(';');
    if (p.length < 4 || !/OXYLIVE_DURATION_S/.test(p[2])) continue;
    const h = parseHostTs(p[0]);
    const d = Number(p[3]);
    if (h != null && Number.isFinite(d)) {
      hostMs.push(h);
      devNs.push(d);
    }
  }
  return { hostMs, devNs };
}

/** Read _PPG2W.txt → per-sample host stamps (ms). */
export function readPpg2wHost(path) {
  const L = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const out = [];
  for (const ln of L) {
    const h = parseHostTs(ln.split(';')[0]);
    if (h != null) out.push(h);
  }
  return out;
}

function fmt(s) {
  return s ? `n=${s.n} med=${s.median.toFixed(3)} mean=${s.mean.toFixed(3)} sd=${s.sd.toFixed(3)} [${s.min.toFixed(3)}, ${s.max.toFixed(3)}]` : '(none)';
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${nm}`)) : (fail++, console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`));
  };

  // deltaStats basics
  const st = deltaStats([1, 2, 3, 4, 5]);
  ok('deltaStats median/mean', st.median === 3 && st.mean === 3, JSON.stringify(st));
  ok('deltaStats empty → null', deltaStats([]) === null);

  // parseHostTs is Clock-Contract floating (getUTC round-trips)
  const t = parseHostTs('2026-08-13T21:31:35.339');
  ok('parseHostTs floating ms', new Date(t).getUTCHours() === 21 && new Date(t).getUTCMinutes() === 31, String(t));
  ok('parseHostTs rejects junk', parseHostTs('not a stamp') === null);

  // arrival: a clean 1 Hz device counter beside a JITTERED independent host clock
  const host = [0],
    dev = [0];
  const jit = [1002, 809, 1273, 998, 1050, 940, 1100, 1002]; // ms, real host jitter
  for (let i = 0; i < jit.length; i++) {
    host.push(host[host.length - 1] + jit[i]);
    dev.push(dev[dev.length - 1] + 1e9); // exact 1.000 s device steps
  }
  const a = analyzeArrival(host, dev);
  ok('device counter reads exactly 1.000 s', a.devDelta.median === 1 && a.devExactFrac === 1, JSON.stringify(a.devDelta));
  ok('host jitter → independent=true', a.independent === true, `spread ${a.spreadMs.toFixed(1)}ms`);

  // the OPPOSITE control: a host column DRAWN from the device stamp (no jitter) → NOT independent
  const dhost = [0],
    ddev = [0];
  for (let i = 0; i < 8; i++) {
    dhost.push(dhost[dhost.length - 1] + 1000); // host == device, sub-ms spread
    ddev.push(ddev[ddev.length - 1] + 1e9);
  }
  ok('a drawn host column → independent=false', analyzeArrival(dhost, ddev).independent === false);

  // a device counter that SKIPS a frame steps 2.000, still an exact tick
  const sh = [0, 1000, 2000, 3000],
    sd = [0, 1e9, 3e9, 4e9]; // second step is 2.000 s (dropped frame)
  const sa = analyzeArrival(sh, sd);
  ok('a dropped frame is still an exact tick (2.000)', sa.devExactFrac === 1 && sa.devDelta.max === 2, JSON.stringify(sa.devDelta));

  // ppg2w frame boundaries: 100 Hz ramp re-anchored every ~1 s → boundaryHz ≈ 1, sampleHz ≈ 100
  const p = [1000];
  for (let s = 0; s < 5; s++) {
    for (let i = 0; i < 100; i++) p.push(p[p.length - 1] + 10); // 10 ms ramp, 100 samples = 1 s
    p.push(p[p.length - 1] + 40); // a 40 ms re-anchor gap at each frame boundary
  }
  const fr = frameBoundaryRate(p);
  ok('ppg2w sample rate ≈ 100 Hz', Math.abs(fr.sampleHz - 100) < 5, `${fr.sampleHz.toFixed(1)}`);
  ok('ppg2w frame boundaries ≈ 1 Hz', fr.boundaries === 5 && Math.abs(fr.boundaryHz - 1) < 0.1, JSON.stringify(fr));
  // a PERFECT ramp (no re-anchor) has zero boundaries — the anomaly detector does not invent them
  const flat = [];
  for (let i = 0; i < 500; i++) flat.push(1000 + i * 10);
  ok('a seamless ramp reports 0 boundaries', frameBoundaryRate(flat).boundaries === 0);

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const arrP = arg('--arrival');
  if (!arrP) {
    console.log('usage: --arrival <_PMDARRIVAL.csv> [--ppg2w <_PPG2W.txt>]');
    process.exit(2);
  }
  const { hostMs, devNs } = readArrival(arrP);
  if (hostMs.length < 3) {
    console.log('  fewer than 3 OXYLIVE frames — nothing to measure');
    process.exit(1);
  }
  const a = analyzeArrival(hostMs, devNs);
  console.log(`  OXYLIVE host Δs   : ${fmt(a.hostDelta)}`);
  console.log(`  OXYLIVE device Δs : ${fmt(a.devDelta)}  exact-tick ${(a.devExactFrac * 100).toFixed(1)}%`);
  console.log(`  host spread ${a.spreadMs.toFixed(1)} ms → independent=${a.independent}  (${a.independent ? 'a real second clock' : 'DRAWN from the device stamp — not a clock'})`);
  console.log(
    a.devExactFrac > 0.9
      ? '  ⇒ the firmware 1 Hz checkpoint is REAL — the duration counter ticks exact integer seconds.'
      : '  ⇒ the device counter does NOT tick clean seconds — no firmware 1 Hz checkpoint here.'
  );
  const p2wP = arg('--ppg2w');
  if (p2wP) {
    const fr = frameBoundaryRate(readPpg2wHost(p2wP));
    console.log(`\n  PPG2W : ${fr.samples} samples, ${fr.spanS.toFixed(1)} s → ${fr.sampleHz.toFixed(2)} Hz`);
    console.log(`  PPG2W frame boundaries : ${fr.boundaries} → ${fr.boundaryHz.toFixed(3)} Hz (BLE delivery, host-observed — ppg2w carries no device clock)`);
  }
}
