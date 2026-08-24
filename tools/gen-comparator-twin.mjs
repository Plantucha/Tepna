#!/usr/bin/env node
/*
 * tools/gen-comparator-twin.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Generate the committed SYNTHETIC live-vs-SD BRP pin-twin pair for the CPAPDex comparator fixture
 * (CPAPDEX-LIVE-SD-COMPARATOR-2026-08-23-BRIEF). ONE wall-clock flow function is sampled into two
 * Flow.40ms EDFs (ns=1, 25 Hz, 30 min): the SD file starts 159 s BEFORE the live file and carries
 * amplitude ×0.998 — so CPAPCross.compareChannel must discover the 159 s device-clock offset, recover
 * the 0.998 scale, and report a 27.35-min overlap (= 1800 − 159 s), reproducing the real night pin's
 * identity verdict. int16 quantization is the ONLY residual (deterministic — no RNG), so the golden is
 * byte-reproducible. The real patient slices stay gitignored (health data, public repo); this synthetic
 * twin is what CI re-runs. After (re)generating, re-mint the golden:
 *   node tools/gen-comparator-twin.mjs
 *   DEX_UPLOADS="$PWD/uploads" node tools/regen-cpap-goldens.mjs   # writes cpapdex_comparator_golden.json
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FS = 25;
const REC = 1800; // 25 Hz × 1800 × 1 s = 30 min
const PMIN = -2;
const PMAX = 3;
const DMIN = -1000;
const DMAX = 1500;
const gain = (PMAX - PMIN) / (DMAX - DMIN); // 0.002 L/s per digit
const SCALE = 0.998; // sd = live × 0.998 (the night pin, ≈0.9977)
const OFF = 159; // sd starts 159 s before live → 27.35-min overlap
// absolute wall-clock flow, L/s — quasi-periodic (≈15 bpm + a harmonic), so alignment is phase-sensitive
const flow = (t) => 0.5 * Math.sin((2 * Math.PI * t) / 4) + 0.15 * Math.sin((2 * Math.PI * t) / 1.7);

function buildEdf(startTimeStr, startWallSec, amp) {
  const ns = 1;
  const hdr = 256 + ns * 256;
  const bpr = FS * 2;
  const size = hdr + bpr * REC;
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const put = (s, o, n) => {
    s = String(s);
    for (let i = 0; i < n; i++) u8[o + i] = i < s.length ? s.charCodeAt(i) : 0x20;
  };
  put('0', 0, 8);
  put('X X X X', 8, 80);
  put('Startdate 13-JUN-2026 SYNTH PIN-TWIN', 88, 80);
  put('13.06.26', 168, 8);
  put(startTimeStr, 176, 8);
  put(String(hdr), 184, 8);
  put('EDF+C', 192, 44);
  put(String(REC), 236, 8);
  put('1', 244, 8);
  put(String(ns), 252, 4);
  let o = 256;
  put('Flow.40ms', o, 16);
  o += ns * 16; // label
  o += ns * 80; // transducer
  put('L/s', o, 8);
  o += ns * 8; // dim
  put(String(PMIN), o, 8);
  o += ns * 8; // physMin
  put(String(PMAX), o, 8);
  o += ns * 8; // physMax
  put(String(DMIN), o, 8);
  o += ns * 8; // digMin
  put(String(DMAX), o, 8);
  o += ns * 8; // digMax
  o += ns * 80; // prefilter
  put(String(FS), o, 8);
  o += ns * 8; // samp/rec
  o += ns * 32; // reserved
  let p = hdr;
  for (let r = 0; r < REC; r++)
    for (let i = 0; i < FS; i++) {
      const t = startWallSec + (r * FS + i) / FS;
      const phys = amp * flow(t);
      let dig = Math.round((phys - PMIN) / gain + DMIN);
      dig = Math.max(DMIN, Math.min(DMAX, dig));
      dv.setInt16(p, dig, true);
      p += 2;
    }
  return buf;
}

// live 23:52:42; sd 23:50:03 (= live − 159 s), absolute wall seconds within the day
const liveWall = 23 * 3600 + 52 * 60 + 42;
const live = buildEdf('23.52.42', liveWall, 1.0);
const sd = buildEdf('23.50.03', liveWall - OFF, SCALE);
fs.writeFileSync(path.join(REPO, 'uploads', 'cpapdex_comparator_live_twin_BRP.edf'), Buffer.from(live));
fs.writeFileSync(path.join(REPO, 'uploads', 'cpapdex_comparator_sd_twin_BRP.edf'), Buffer.from(sd));
console.log(`wrote live+sd pin-twin EDFs (${live.byteLength} B each) into uploads/`);
