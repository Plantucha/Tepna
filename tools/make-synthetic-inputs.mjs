/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * make-synthetic-inputs.mjs — a COMMITTABLE vendor-format input for every node.
 *
 * WHY. The suite's strongest correctness gate — Phase-9 `compute() ≡ committed
 * export` — DOES NOT RUN IN CI. Every node's equivalence input is a real recording,
 * so it is gitignored, so on a fresh clone every leg self-skips:
 *
 *   ⊘ OxyDex / PulseDex / HRVDex / GlucoDex / PpgDex / ECGDex …
 *     "committed input absent — uploads/ is gitignored (personal data)"
 *
 * The gate CLAUDE.md §🔏 leans on to catch "a code change that moved a fixture's
 * output" has therefore been running ONLY on the maintainer's machine: a regression
 * that moved an export would go green through CI.
 * (CPAP-REAL-CORPUS-2026-07-11-BRIEF §M5, found while executing §P2.)
 *
 * THE FIX. An input that contains no personal data can be COMMITTED. So synthesize
 * one per node, in the exact VENDOR FORMAT each parser expects — the format is
 * copied, the DATA never is. Waveforms are closed-form and physiologically plausible;
 * they reproduce no recording of any person and carry no device identifier.
 * (§P2 already did this for CPAPDex's binary EDF set; this is the same trick for the
 * remaining six text formats.)
 *
 * These inputs do NOT replace the real-recording legs — those still run locally and
 * exercise genuine vendor quirks. They run ALONGSIDE, so the gate has teeth in CI too.
 *
 * FULLY DETERMINISTIC: no RNG, no Date.now(). Re-running reproduces every file
 * byte-for-byte, which is what lets GATE B content-address them.
 *
 *   node tools/make-synthetic-inputs.mjs [outdir]     (default: uploads/)
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'uploads';
fs.mkdirSync(OUT, { recursive: true });

const p2 = (n) => (n < 10 ? '0' : '') + n;
const p3 = (n) => (n < 100 ? (n < 10 ? '00' : '0') : '') + n;
// floating wall-clock formatting (Clock Contract: getUTC*, viewer-tz-independent)
const iso = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
};
const isoMs = (ms) => `${iso(ms)}.${p3(Math.floor(ms % 1000))}`;

const files = {};
const emit = (name, text) => {
  files[name] = text;
  fs.writeFileSync(path.join(OUT, name), text);
};

/* ── 1 · OxyDex — O2Ring / Wellue CSV (1 Hz SpO2 + pulse + motion) ──────────
   "Time,Oxygen Level,Pulse Rate,Motion" with "HH:MM:SS DD/MM/YYYY" (DMY).       */
{
  const t0 = Date.UTC(2026, 5, 13, 23, 0, 16); // 2026-06-13 23:00:16
  const N = 2 * 3600; // 2 h @ 1 Hz
  const DESATS = [1500, 3200, 4800, 6300];
  const rows = ['﻿Time,Oxygen Level,Pulse Rate,Motion'];
  for (let i = 0; i < N; i++) {
    const d = new Date(t0 + i * 1000);
    const stamp = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    let spo2 = 96.6 + 0.5 * Math.sin(i / 420);
    for (const s of DESATS) {
      const dt = i - s;
      if (dt >= 0 && dt < 45) spo2 -= 8.5 * Math.sin((Math.PI * dt) / 45);
    }
    const hr = 58 + 5 * Math.sin(i / 300) + 3 * Math.sin(i / 47);
    const motion = i % 900 === 0 ? 3 : 0;
    rows.push(`${stamp},${Math.round(spo2)},${Math.round(hr)},${motion}`);
  }
  emit('synthetic_oxydex_o2ring.csv', rows.join('\n') + '\n');
}

/* ── 2 · PulseDex — Polar H10 RR text (Polar Sensor Logger) ─────────────────
   "Phone timestamp;RR-interval [ms]" with ISO stamps.                           */
{
  const t0 = Date.UTC(2026, 5, 13, 20, 44, 49, 944);
  const rows = ['Phone timestamp;RR-interval [ms]'];
  let t = t0;
  for (let i = 0; i < 1800; i++) {
    // ~30 min of beats
    // RSA: respiratory sinus arrhythmia at ~15 breaths/min, on a ~1000 ms mean
    const rr = 1000 + 45 * Math.sin((2 * Math.PI * i) / 4.2) + 12 * Math.sin(i / 37);
    const v = Math.round(rr);
    t += v;
    rows.push(`${isoMs(t)};${v}`);
  }
  emit('synthetic_pulsedex_rr.txt', rows.join('\n') + '\n');
}

/* ── 3 · HRVDex — Welltory HRV summary CSV (one row per morning reading) ────── */
{
  const HEAD =
    'Date,Time,Stress(HRV),Energy(HRV),Focus,ANS balance(SNS),ANS balance(PSNS),Coherence index,HRV Score,CV,Measurement HR,Mean RR,SDNN,rMSSD,MxDMn,pNN50,AMo50,Mode,Total power,HF,LF,VLF,Health';
  const rows = [HEAD];
  for (let d = 29; d >= 0; d--) {
    // 30 daily readings, newest first
    const ms = Date.UTC(2026, 5, 17, 5, 42, 2) - d * 86400000;
    const s = iso(ms);
    const rmssd = 45 + 10 * Math.sin(d / 4.1);
    const sdnn = 90 + 18 * Math.sin(d / 5.3);
    const hr = 61 + 3 * Math.sin(d / 3.7);
    const f = (x, n = 3) => x.toFixed(n);
    rows.push(
      [
        s,
        s,
        f(25 + 8 * Math.sin(d / 6), 1),
        f(65 + 6 * Math.sin(d / 5), 1),
        f(60 + 10 * Math.sin(d / 4), 1),
        f(20 + 6 * Math.sin(d / 7), 1),
        f(55 + 4 * Math.sin(d / 6), 3),
        f(45 + 5 * Math.sin(d / 3), 1),
        f(56 + 5 * Math.sin(d / 4.5), 3),
        f(9.5 + 1.5 * Math.sin(d / 5), 1),
        f(hr, 1),
        f(60000 / hr, 3),
        f(sdnn, 3),
        f(rmssd, 3),
        f(0.35 + 0.03 * Math.sin(d / 4), 2),
        f(22 + 5 * Math.sin(d / 5), 2),
        f(22 + 3 * Math.sin(d / 6), 1),
        '1.025',
        f(9000 + 2500 * Math.sin(d / 4), 1),
        f(620 + 90 * Math.sin(d / 3), 1),
        f(950 + 120 * Math.sin(d / 5), 1),
        f(7400 + 2200 * Math.sin(d / 4), 1),
        '100.0'
      ].join(',')
    );
  }
  emit('synthetic_hrvdex_welltory.csv', rows.join('\n') + '\n');
}

/* ── 4 · GlucoDex — Abbott Lingo CGM CSV (zoned ISO + mg/dL) ─────────────────
   Zoned stamps exercise Clock-Contract rule 2 (zone authoritative).              */
{
  const HEAD = 'Time of Glucose Reading [T=(local time) +/- (time zone offset)], Measurement(mg/dL)';
  const rows = [HEAD];
  const t0 = Date.UTC(2026, 4, 3, 0, 0, 0);
  const N = 3 * 24 * 12; // 3 days @ 5-min
  for (let i = N - 1; i >= 0; i--) {
    // newest first, like the vendor export
    const ms = t0 + i * 5 * 60000;
    const d = new Date(ms);
    const hod = d.getUTCHours() + d.getUTCMinutes() / 60;
    // fasting ~95 with three meal excursions
    let g = 95 + 6 * Math.sin((2 * Math.PI * hod) / 24);
    for (const [mh, amp] of [
      [8, 45],
      [13, 55],
      [19, 50]
    ]) {
      const dt = hod - mh;
      if (dt >= 0 && dt < 3) g += amp * Math.exp(-Math.pow(dt - 0.8, 2) / 0.5);
    }
    rows.push(`${iso(ms)}-04:00,${Math.round(g)}`);
  }
  emit('synthetic_glucodex_lingo.csv', rows.join('\n') + '\n');
}

/* ── 5 · PpgDex — Polar Verity Sense raw PPG (3 LEDs + ambient, ~135 Hz) ───── */
{
  const HEAD = 'Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient';
  const rows = [HEAD];
  const FS = 135,
    SECS = 40; // 40 s — the export pins contentId
  //                                                            (a content-fold of the samples), so a short
  //                                                            clip gives the same assertion for 1/2 the bytes
  const t0 = Date.UTC(2026, 5, 21, 6, 5, 23, 891);
  const ns0 = 835351534233872000n;
  for (let i = 0; i < FS * SECS; i++) {
    const t = i / FS;
    const hr = 62 + 4 * Math.sin(t / 20); // bpm
    const ph = 2 * Math.PI * (hr / 60) * t;
    // systolic peak + a prominent DIASTOLIC wave (the 2x-HR trap PpgDex now handles)
    const pulse = Math.sin(ph) + 0.45 * Math.sin(2 * ph - 0.9);
    const base = -499500 + 2200 * pulse - 300 * Math.sin(t / 7);
    const ns = ns0 + BigInt(Math.round((i / FS) * 1e9));
    rows.push(`${isoMs(t0 + (i / FS) * 1000)};${ns};${Math.round(base)};${Math.round(base - 9340)};${Math.round(base - 17140)};${Math.round(-650690 + 40 * Math.sin(t / 11))};`);
  }
  emit('synthetic_ppgdex_verity.txt', rows.join('\n') + '\n');
}

/* ── 6 · ECGDex — Polar H10 raw ECG (130 Hz, µV) ────────────────────────────
   Needs real QRS morphology: Pan–Tompkins must find the R-peaks.                 */
{
  const HEAD = 'Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]';
  const rows = [HEAD];
  const FS = 130,
    SECS = 60; // 60 s — same reasoning as PPG above;
  //                                                            ~60 beats, plenty for the parse-path fold
  const t0 = Date.UTC(2026, 5, 17, 1, 6, 17, 723);
  const ns0 = 599630059061536896n;
  // beat times from an RSA-modulated RR series (so HRV metrics are non-degenerate)
  const beats = [];
  for (let t = 0.4, k = 0; t < SECS; k++) {
    beats.push(t);
    t += (1000 + 40 * Math.sin((2 * Math.PI * k) / 4.5) + 10 * Math.sin(k / 31)) / 1000;
  }
  const g = (x, mu, s, a) => a * Math.exp(-Math.pow(x - mu, 2) / (2 * s * s));
  for (let i = 0; i < FS * SECS; i++) {
    const t = i / FS;
    let v = 12 * Math.sin(2 * Math.PI * 0.25 * t); // slow baseline wander
    for (const b of beats) {
      const d = t - b;
      if (d < -0.25 || d > 0.45) continue;
      v += g(d, -0.16, 0.025, 90); // P
      v += g(d, -0.02, 0.008, -110); // Q
      v += g(d, 0.0, 0.01, 1150); // R
      v += g(d, 0.025, 0.011, -230); // S
      v += g(d, 0.22, 0.045, 260); // T
    }
    const ns = ns0 + BigInt(Math.round((i / FS) * 1e9));
    rows.push(`${isoMs(t0 + (i / FS) * 1000)};${ns};${((i / FS) * 1000).toFixed(6)};${Math.round(v)}`);
  }
  emit('synthetic_ecgdex_h10.txt', rows.join('\n') + '\n');
}

let total = 0;
for (const [n, t] of Object.entries(files)) {
  total += Buffer.byteLength(t);
  console.log(`  ${n.padEnd(34)} ${String(Buffer.byteLength(t)).padStart(9)} bytes`);
}
console.log(`\n  ${Object.keys(files).length} vendor-format inputs, ${(total / 1024).toFixed(0)} KB — deterministic, no personal data.`);
