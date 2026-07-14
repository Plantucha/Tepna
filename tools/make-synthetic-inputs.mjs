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

/* ── 1b · OxyDex ADVERSARIAL — the shapes the CLEAN synthetics cannot express ───────────────────────
   DEEP-AUDIT-2026-07-11 §1/§8/§9. Every equivalence input in this file (and every committed fixture
   before it) is a CLEAN, short, DMY, gapless recording. Three of the audit's worst defects were
   therefore STRUCTURALLY INVISIBLE to CI — the gate could not have caught them no matter how green it
   ran:

     §1  an MM/DD-ordered O2Ring file (the Clock Contract lists BOTH orders for this vendor) flipped
         date order MID-FILE, ran the clock BACKWARD, and shipped durationMin = -254460 with
         ODI-4 = 0/h — an apnea night reading as perfectly healthy.
     §8  parseCSV DROPS the device's '- -' no-reading rows, so a row INDEX stops being a second-offset.
         Two consumers rebuilt event time from the index anyway; on a lossy night a desat landed 849 s
         from its true time, against a 15 s / 60 s coincidence gate.
     §9  two surfaced metrics head-sliced to the FIRST HOUR of a 6-10 h night, undisclosed.

   These three inputs express exactly those shapes, so the invariants are now machine-checked in CI:
   the MDY file must compute IDENTICALLY to the DMY one · a dropped-row night must place every event on
   its OWN parsed stamp · a long night's window-based metrics must describe the whole night.
   Deterministic and closed-form, like their clean siblings; they encode a FORMAT, never a person.  */
{
  /* NOTE the start date. The night must span 12 → 13 June, NOT 13 → 14, and that is the whole point:
     a row like 06/12 is AMBIGUOUS (both fields ≤ 12) while 06/13 is not. The per-row heuristic the audit
     found would read the ambiguous rows one way (preferDMY → 6 Dec) and the unambiguous ones the other
     (13 > 12 → 13 Jun) — the order FLIPS mid-file and the clock runs BACKWARD. A night that spans only
     days > 12 has no ambiguous rows at all, so every row resolves correctly and the bug never fires:
     such an input would pass against the BROKEN code and prove nothing. (This file did exactly that on
     its first cut; the red-against-old-code check is what caught it.) */
  const t0 = Date.UTC(2026, 5, 12, 23, 0, 16); // 2026-06-12 23:00:16 — spans midnight into the 13th
  const DESATS = [1500, 3200, 4800, 6300];
  // the same physiological night the clean file describes — one shared waveform, three renderings
  const spo2At = (i) => {
    let v = 96.6 + 0.5 * Math.sin(i / 420);
    for (const s of DESATS) {
      const dt = i - s;
      if (dt >= 0 && dt < 45) v -= 8.5 * Math.sin((Math.PI * dt) / 45);
    }
    return Math.round(v);
  };
  const hrAt = (i) => Math.round(58 + 5 * Math.sin(i / 300) + 3 * Math.sin(i / 47));
  const HEAD = '\ufeffTime,Oxygen Level,Pulse Rate,Motion';
  const clock = (d) => `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  const dmy = (d) => `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const mdy = (d) => `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${d.getUTCFullYear()}`;

  // §1 · the SAME night written in BOTH vendor date orders. It spans 12 → 13 June, so it mixes
  //      AMBIGUOUS rows (06/12 — both fields ≤ 12) with unambiguous ones (06/13) — precisely the
  //      mid-file-flip trigger. The two files MUST compute identically.
  for (const [name, fmt] of [
    ['synthetic_oxydex_o2ring_dmy.csv', dmy],
    ['synthetic_oxydex_o2ring_mdy.csv', mdy]
  ]) {
    const N = 2 * 3600;
    const rows = [HEAD];
    for (let i = 0; i < N; i++) {
      const d = new Date(t0 + i * 1000);
      rows.push(`${clock(d)} ${fmt(d)},${spo2At(i)},${hrAt(i)},${i % 900 === 0 ? 3 : 0}`);
    }
    emit(name, rows.join('\n') + '\n');
  }

  // §8 · a LOSSY night: a 20-minute block of the device's '- -' no-reading rows sits between two desats,
  //      so every row index AFTER it is offset from its true second by ~1200. Any consumer that rebuilds
  //      event time from the INDEX rather than the row's own stamp drifts by minutes here.
  {
    const N = 2 * 3600;
    const GAP0 = 2400,
      GAP1 = GAP0 + 20 * 60; // the dropout straddles the 2nd desat's neighbourhood
    const rows = [HEAD];
    for (let i = 0; i < N; i++) {
      const d = new Date(t0 + i * 1000);
      if (i >= GAP0 && i < GAP1) {
        rows.push(`${clock(d)} ${dmy(d)},- -,- -,0`);
        continue;
      }
      rows.push(`${clock(d)} ${dmy(d)},${spo2At(i)},${hrAt(i)},${i % 900 === 0 ? 3 : 0}`);
    }
    emit('synthetic_oxydex_o2ring_lossy.csv', rows.join('\n') + '\n');
  }

  // §9 · a FULL-LENGTH overnight (7 h). Its first hour is deliberately UNLIKE the rest — a fast 20 s
  //      SpO2 oscillation for the first hour, a slow 50 s one for the remaining six — so any metric that
  //      silently analyses only the head reports the wrong rhythm for the night.
  {
    const N = 7 * 3600;
    const rows = [HEAD];
    for (let i = 0; i < N; i++) {
      const d = new Date(t0 + i * 1000);
      const per = i < 3600 ? 20 : 50;
      const v = Math.round(95 + 2 * Math.sin((2 * Math.PI * i) / per));
      rows.push(`${clock(d)} ${dmy(d)},${v},${hrAt(i)},${i % 900 === 0 ? 3 : 0}`);
    }
    emit('synthetic_oxydex_o2ring_longnight.csv', rows.join('\n') + '\n');
  }
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

/* ── 4b · GlucoDex ADVERSARIAL twin — a 14 h SENSOR-CHANGE GAP ────────────────
   WHY THIS FILE EXISTS. The clean twin above carries no long gap, so it exercises none of the
   FLAG.GAP_LONG path — and that hole cost a real number. DEEP-AUDIT-2026-07-14 §1 (exclude GAP_LONG
   from every distribution metric) declared itself EXPORT-INERT on the clean twin's evidence and
   shipped; the REAL Abbott Lingo night *does* carry a multi-hour sensor-change gap, so its export
   moved, its committed fixture went stale, and the SERVED GlucoDex ran the pre-fix DSP against real
   users' CGM data until it was found by hand. The leg that would have caught it (the real-recording
   equiv leg) SKIPS wherever uploads/ is absent — i.e. in CI, and on the machine of whoever lands the
   change. The fix is not another assertion: it is an input that trips the flag AND CAN BE COMMITTED.
   Same reasoning, and the same shape, as the four committed adversarial OxyDex twins
   (DEEP-AUDIT-FOLLOWUPS-2026-07-12 §A) — a real adversarial night would have been gitignored too,
   and CI would have stayed exactly as blind.

   THE GAP IS BUILT SO THE DRAWN LINE IS WRONG IF COUNTED. Readings stop on the post-lunch decay
   (143 mg/dL) and resume 14 h later at fasting (100). clean() still draws the bridge — the chart
   needs a line — so 168 fabricated cells ramp 143→100 with none of the real diurnal structure.
   Counted as measured glucose they pad every daypart's n and flatten its CV; excluded, they vanish.
   The hole straddles afternoon + evening + overnight, so it lands squarely in the daypart block the
   §1 fix actually moved. cadence 5 min ⇒ gapThresh = max(5*2.5, 5+3) = 12.5 min, so every interior
   cell of a 14 h hole is GAP_LONG, not the short physiologic GAP bridge.

   MEASURED — the twin separates the two codes by 167 samples (this is why it is worth committing):
     current code   daypart n = {overnight 168, morning 216, afternoon 169, evening 144} = 697
     PRE-§1 code    daypart n = {216, 216, 216, 216}                                      = 864
   i.e. the old code reports the 14 h hole as 167 measured readings. The golden below pins 697, so
   9bdb9be would have RED in CI, on its own PR, with no corpus present.                            */
{
  const HEAD = 'Time of Glucose Reading [T=(local time) +/- (time zone offset)], Measurement(mg/dL)';
  const rows = [HEAD];
  const t0 = Date.UTC(2026, 4, 3, 0, 0, 0);
  const N = 3 * 24 * 12; // 3 days @ 5-min — same span/shape as the clean twin
  // sensor change on day 2: readings stop 14:00, resume 04:00 on day 3 (14 h).
  const GAP_FROM = Date.UTC(2026, 4, 4, 14, 0, 0);
  const GAP_TO = Date.UTC(2026, 4, 5, 4, 0, 0);
  for (let i = N - 1; i >= 0; i--) {
    const ms = t0 + i * 5 * 60000;
    if (ms > GAP_FROM && ms < GAP_TO) continue; // the sensor is OFF — no rows at all, not zeros
    const d = new Date(ms);
    const hod = d.getUTCHours() + d.getUTCMinutes() / 60;
    let g = 95 + 6 * Math.sin((2 * Math.PI * hod) / 24);
    for (const [mh, amp] of [
      [8, 45],
      [13, 55],
      [19, 50]
    ]) {
      const dt = hod - mh;
      if (dt >= 0 && dt < 3) g += amp * Math.exp(-Math.pow(dt - 0.8, 2) / 0.5);
    }
    // land the LAST pre-gap reading on the lunch peak (~180) so the drawn bridge falls the full
    // in-range span to the ~85 fasting reading that resumes 14 h later. A flat bridge would be a
    // weak twin: the interpolation has to be somewhere the metrics would notice.
    rows.push(`${iso(ms)}-04:00,${Math.round(g)}`);
  }
  emit('synthetic_glucodex_lingo_gap.csv', rows.join('\n') + '\n');
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
