#!/usr/bin/env node
/*
 * tools/gen-maskoff-twin.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE MASK-OFF TWIN (DEEP-AUDIT-VI-FOLLOWUPS §1.9).
 *
 * `detectBreaths().breathRate` divided breaths by the WHOLE RECORDING (`durSec = recordsRead ×
 * recDur`) while every sibling ventilation figure computed beside it is `_filterBy(..., maskOn)`.
 * A surfaced breaths/min was therefore diluted by however long the mask was off.
 *
 * THE CORPUS CANNOT FALSIFY THAT. Mask-on measured 1.000 on all 24 nights §1.5 folded, so every
 * real night has wall ≡ mask-on and is SILENT about the denominator by construction — the exact
 * §2.1 shape ("a fixture corpus can only falsify what it can express"). This twin is the input
 * that expresses it:
 *
 *   PLD pressure : 10 cmH2O for the FIRST HALF, 0 for the second   → mask-on = 50 % of the record
 *   BRP flow     : a breathing waveform in the first half, flat in the second (mask off ⇒ no flow)
 *
 * So the true rate is `breaths / mask-on minutes`, and the pre-fix form reports HALF of it. The
 * twin therefore REDS the old denominator and GREENS the fix, which "no fixture moved" could never
 * have done. Deterministic, synthetic, no personal data.
 *
 *   node tools/gen-maskoff-twin.mjs      # writes uploads/cpapdex_maskoff_twin_{BRP,PLD}.edf
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC = 1200; // 1200 × 1 s records = 20 min total; 10 min mask-on, 10 min mask-off
const HALF = REC / 2;
const BREATH_SEC = 4; // 15 breaths/min while the mask is on — the number the fix must recover

/* One-channel EDF writer, same shape as tools/gen-comparator-twin.mjs. `sample(t, rec)` returns a
   physical value; `rec` is the record index so a channel can switch behaviour at the half-way mark. */
function buildEdf({ label, dim, pmin, pmax, fsHz, sample }) {
  const ns = 1;
  const DMIN = -32768;
  const DMAX = 32767;
  const hdr = 256 + ns * 256;
  const bpr = fsHz * 2;
  const buf = new ArrayBuffer(hdr + bpr * REC);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const put = (s, o, n) => {
    s = String(s);
    for (let i = 0; i < n; i++) u8[o + i] = i < s.length ? s.charCodeAt(i) : 0x20;
  };
  put('0', 0, 8);
  put('X X X X', 8, 80);
  put('Startdate 13-JUN-2026 SYNTH MASKOFF-TWIN', 88, 80);
  put('13.06.26', 168, 8);
  put('22.00.00', 176, 8);
  put(String(hdr), 184, 8);
  put('EDF+C', 192, 44);
  put(String(REC), 236, 8);
  put('1', 244, 8);
  put(String(ns), 252, 4);
  let o = 256;
  put(label, o, 16);
  o += ns * 16;
  o += ns * 80;
  put(dim, o, 8);
  o += ns * 8;
  put(String(pmin), o, 8);
  o += ns * 8;
  put(String(pmax), o, 8);
  o += ns * 8;
  put(String(DMIN), o, 8);
  o += ns * 8;
  put(String(DMAX), o, 8);
  o += ns * 8;
  o += ns * 80;
  put(String(fsHz), o, 8);
  o += ns * 8;
  o += ns * 32;
  const gain = (pmax - pmin) / (DMAX - DMIN);
  let p = hdr;
  for (let r = 0; r < REC; r++) {
    for (let i = 0; i < fsHz; i++) {
      const t = r + i / fsHz;
      let dig = Math.round((sample(t, r) - pmin) / gain + DMIN);
      dig = Math.max(DMIN, Math.min(DMAX, dig));
      dv.setInt16(p, dig, true);
      p += 2;
    }
  }
  return Buffer.from(buf);
}

// BRP Flow @25 Hz — breathing while the mask is on, flat afterwards.
const brp = buildEdf({
  label: 'Flow.40ms',
  dim: 'L/s',
  pmin: -2,
  pmax: 3,
  fsHz: 25,
  sample: (t, r) => (r < HALF ? 0.5 * Math.sin((2 * Math.PI * t) / BREATH_SEC) : 0)
});
// PLD MaskPress @0.5 Hz — 10 cmH2O on, then 0. This is what builds `maskOn`.
const pld = buildEdf({
  label: 'MaskPress.2s',
  dim: 'cmH2O',
  pmin: 0,
  pmax: 25,
  fsHz: 1, // 1 sample/record = 1 Hz; the parser reads samples-per-record, not a nominal 0.5
  sample: (_t, r) => (r < HALF ? 10 : 0)
});
fs.writeFileSync(path.join(REPO, 'uploads', 'cpapdex_maskoff_twin_BRP.edf'), brp);
fs.writeFileSync(path.join(REPO, 'uploads', 'cpapdex_maskoff_twin_PLD.edf'), pld);
console.log(`wrote cpapdex_maskoff_twin_{BRP,PLD}.edf — ${REC} s total, ${HALF} s mask-on, ~${(HALF / BREATH_SEC).toFixed(0)} breaths`);
console.log(`  expected: fixed = ${(60 / BREATH_SEC).toFixed(1)} br/min (breaths / mask-on min) · pre-fix = ${(60 / BREATH_SEC / 2).toFixed(1)} (breaths / wall min)`);
