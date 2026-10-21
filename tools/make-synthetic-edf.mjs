/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * make-synthetic-edf.mjs — emit a DETERMINISTIC, SYNTHETIC ResMed EDF file set.
 *
 * WHY THIS EXISTS. CPAPDex was the only node whose equivalence gate was
 * synthetic-only: `FIXTURE-PROVENANCE.json` said it "can't join the Phase-9
 * compute() ≡ committed export gate (its real input is a BINARY multi-file EDF
 * set, not a {text}/CSV)". The existing golden sidesteps `readEDF` entirely — it
 * feeds `_synthEdfSet()`, which hands the DSP already-DECODED structures. So the
 * binary EDF parser was never in the gated path.
 *
 * The obvious fix — commit a real night's EDFs — is not available: the EDF+ header
 * `recording` field carries a persistent DEVICE SERIAL, and this repo is public
 * (CPAP-REAL-CORPUS-2026-07-11-BRIEF §F3). So instead we SYNTHESIZE a real binary
 * EDF set: genuine .edf bytes that exercise the true `readEDF` → `buildSessionFromEdf`
 * → `cpapBuildExport` chain, containing no recording of any person.
 *
 * Waveform SHAPES are calibrated to the real corpus's distributions (median pressure
 * ~9 cmH2O, RR ~16/min, TV ~0.35 L, MV ~5.6 L/min, central-dominant events); the DATA
 * is closed-form and carries no personal information. Header identity fields are 'X'.
 *
 * BONUS — it covers §F6. The real corpus never exercises the SA2 oximetry lane
 * (217/222 sessions report `oximeter-not-connected`), so `selfGateDesat` / `detectDesats`
 * / `oximetryLane` had NEVER run on any gated input. This set ships a working SpO2
 * channel with real desaturations, so that lane is finally covered.
 *
 * FULLY DETERMINISTIC: no RNG, no Date.now(), fixed t0. Re-running reproduces the
 * files byte-for-byte — which is what lets them be content-addressed in GATE B.
 *
 *   node tools/make-synthetic-edf.mjs [outdir]      (default: uploads/)
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';

const argv = process.argv.slice(2);
/* `process.argv` BELONGS TO WHOEVER IS RUNNING. At module scope this refusal reads the IMPORTER's
   arguments, so an import of anything in this file judged flags it never passed (residue
   `2026-10-20-four-argv-adopters-refuse-at-module-scope-and-export`). The guard runs for the CLI only. */
const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI && (argv.includes('--help') || argv.includes('-h'))) {
  console.log('usage: node tools/make-synthetic-edf.mjs [outdir]   (default: uploads/)');
  process.exit(0);
}
/* MEASURED 2026-10-11: `node tools/make-synthetic-edf.mjs --help` CREATED A DIRECTORY NAMED `--help`
   and wrote five EDFs into it, because the output directory was `process.argv[2]` whatever it looked
   like (residue 2026-10-11-help-flag-made-a-directory). Write-side, which is the class
   `tools/argv-survey.mjs` deliberately does not probe — so this one had to be caught in the act. */
if (IS_CLI) refuseUnknownArgvOrExit(argv, { boolean: ['--help', '-h'], positional: true }, { tool: 'tools/make-synthetic-edf.mjs' });
const OUT = argv[0] || 'uploads';
const STAMP = '20260613_231433'; // fixed; matches the header clock below
const DATE_F = '13.06.26'; // EDF startdate  dd.mm.yy
const TIME_F = '23.14.33'; // EDF starttime  hh.mm.ss
const REC_DUR = 60; // seconds per data record (ResMed uses 60)
const RECORDS = 150; // 150 min = 2.5 h — a plausible night, modest file size

/* ── EDF writer ─────────────────────────────────────────────────────────────
   Header: 256 B main + ns*256 B signal headers, FIELD-MAJOR (all labels, then all
   transducers, …). Data records interleave each signal's samples as int16 LE.
   Digital↔physical must invert readEDF exactly:
       phys = (dig - digMin) * (physMax-physMin)/(digMax-digMin) + physMin        */
function writeEDF(signals, opts = {}) {
  const ns = signals.length;
  const headerBytes = 256 + ns * 256;
  const sprSum = signals.reduce((s, x) => s + x.spr, 0);
  const size = headerBytes + sprSum * 2 * RECORDS;
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const put = (str, start, len) => {
    const s = String(str);
    for (let i = 0; i < len; i++) u8[start + i] = i < s.length ? s.charCodeAt(i) : 0x20;
  };

  put('0', 0, 8);
  // Identity fields deliberately blank ('X' = unknown, per EDF+). NO serial, NO patient.
  put('X X X X', 8, 80);
  put(`Startdate ${opts.recording || '13-JUN-2026 X X X'}`, 88, 80);
  put(DATE_F, 168, 8);
  put(TIME_F, 176, 8);
  put(String(headerBytes), 184, 8);
  put('EDF+C', 192, 44);
  put(String(RECORDS), 236, 8);
  put(String(REC_DUR), 244, 8);
  put(String(ns), 252, 4);

  let o = 256;
  const field = (len, fn) => {
    signals.forEach((s, i) => put(fn(s), o + i * len, len));
    o += ns * len;
  };
  field(16, (s) => s.label);
  field(80, () => ''); // transducer
  field(8, (s) => s.dim || '');
  field(8, (s) => s.physMin);
  field(8, (s) => s.physMax);
  field(8, (s) => s.digMin);
  field(8, (s) => s.digMax);
  field(80, () => ''); // prefilter
  field(8, (s) => s.spr);
  o += ns * 32; // reserved

  let p = headerBytes;
  for (let r = 0; r < RECORDS; r++) {
    for (const s of signals) {
      if (s.annotations) {
        // EDF Annotations: a timekeeping TAL, plus any events falling in this record
        const bytes = new Uint8Array(buf, p, s.spr * 2);
        let w = 0;
        const push = (str) => {
          for (let i = 0; i < str.length && w < bytes.length; i++) bytes[w++] = str.charCodeAt(i);
        };
        push(`+${r * REC_DUR}\x14\x14\x00`);
        for (const ev of s.annotations) {
          if (ev.onset >= r * REC_DUR && ev.onset < (r + 1) * REC_DUR) {
            push(`+${ev.onset}\x15${ev.dur}\x14${ev.label}\x14\x00`);
          }
        }
        p += s.spr * 2;
      } else {
        const scale = (s.digMax - s.digMin) / (s.physMax - s.physMin);
        for (let i = 0; i < s.spr; i++) {
          const t = r * REC_DUR + (i / s.spr) * REC_DUR; // seconds from session start
          const phys = s.fn(t);
          let dig = Math.round((phys - s.physMin) * scale + s.digMin);
          dig = Math.max(s.digMin, Math.min(s.digMax, dig));
          dv.setInt16(p, dig, true);
          p += 2;
        }
      }
    }
  }
  return Buffer.from(buf);
}

/* ── waveforms — closed-form, calibrated to the real corpus's DISTRIBUTIONS ──
   (shapes only; no recording of any person is reproduced here)                */
const MASK_ON = 60; // 1 min of pressure=0 → maskOnLatency
const on = (t) => t >= MASK_ON;

// therapy pressure: median ~9, p95 ~10.6 (corpus: 8.9 / 10.6)
const press = (t) => (!on(t) ? 0 : 9.0 + 1.1 * Math.sin(t / 900) + 0.45 * Math.sin(t / 137));
// EPR 3 → expiratory pressure sits 3 cmH2O below delivered (corpus post-2026-06-12)
const epr = (t) => (!on(t) ? 0 : Math.max(4, press(t) - 3));
// leak: near-zero baseline with occasional excursions (corpus: median 0, p95 ~17)
const leak = (t) => (!on(t) ? 0 : 1.5 + 26 * Math.pow(Math.max(0, Math.sin(t / 1500 - 1.2)), 8));
const rr = (t) => (!on(t) ? 0 : 16.0 + 1.4 * Math.sin(t / 600)); // corpus ~15.9
const tv = (t) => (!on(t) ? 0 : 0.35 + 0.045 * Math.sin(t / 420)); // corpus ~0.35 L
const mv = (t) => (!on(t) ? 0 : rr(t) * tv(t)); // ~5.6 L/min
const snore = (t) => (!on(t) ? 0 : 0.05 * Math.pow(Math.max(0, Math.sin(t / 700)), 6));
const flowlim = (t) => (!on(t) ? 0 : 0.04 * Math.pow(Math.max(0, Math.sin(t / 800 + 0.7)), 6));
// 25 Hz respiratory flow — a breathing sinusoid at the RR above
const flow = (t) => (!on(t) ? 0 : 28 * Math.sin(2 * Math.PI * (rr(t) / 60) * t));
// SpO2 with genuine desaturations (the lane the real corpus never exercises — §F6)
const DESATS = [1800, 3600, 5400, 7200];
const spo2 = (t) => {
  let v = 96.5 + 0.4 * Math.sin(t / 500);
  for (const d of DESATS) {
    const dt = t - d;
    if (dt >= 0 && dt < 40) v -= 9 * Math.sin((Math.PI * dt) / 40); // ~9-pt dip, 40 s
  }
  return v;
};
const pulse = (t) => 58 + 5 * Math.sin(t / 300) + 3 * Math.sin(t / 47);

const num = (label, dim, physMin, physMax, hz, fn) => ({
  label,
  dim,
  physMin,
  physMax,
  digMin: -32768,
  digMax: 32767,
  spr: Math.round(hz * REC_DUR),
  fn
});
const ann = (events) => ({ label: 'EDF Annotations', dim: '', physMin: -1, physMax: 1, digMin: -32768, digMax: 32767, spr: 60, annotations: events });

/* ── the five files ── */
// central-dominant residual, matching the corpus's event mix (CA >> H >> OA)
const EVE_EVENTS = [
  { onset: 420, dur: 14, label: 'Central Apnea' },
  { onset: 1150, dur: 16, label: 'Central Apnea' },
  { onset: 2010, dur: 12, label: 'Hypopnea' },
  { onset: 2880, dur: 18, label: 'Central Apnea' },
  { onset: 3640, dur: 21, label: 'Obstructive Apnea' },
  { onset: 4500, dur: 13, label: 'Central Apnea' },
  { onset: 5220, dur: 15, label: 'Hypopnea' },
  { onset: 6100, dur: 17, label: 'Central Apnea' },
  { onset: 7010, dur: 11, label: 'Central Apnea' },
  { onset: 7900, dur: 19, label: 'Hypopnea' }
];
const CSL_EVENTS = [{ onset: 3000, dur: 180, label: 'Cheyne-Stokes' }];

const files = {
  PLD: writeEDF([
    num('Press.2s', 'cmH2O', 0, 30, 0.5, press),
    num('EprPress.2s', 'cmH2O', 0, 30, 0.5, epr),
    num('Leak.2s', 'L/min', 0, 120, 0.5, leak),
    num('RespRate.2s', '1/min', 0, 60, 0.5, rr),
    num('TidVol.2s', 'L', 0, 3, 0.5, tv),
    num('MinVent.2s', 'L/min', 0, 30, 0.5, mv),
    num('Snore.2s', '', 0, 5, 0.5, snore),
    num('FlowLim.2s', '', 0, 1, 0.5, flowlim)
  ]),
  BRP: writeEDF([num('Flow.40ms', 'L/min', -120, 120, 25, flow)]),
  SA2: writeEDF([num('SpO2.1s', '%', 0, 100, 1, spo2), num('Pulse.1s', 'bpm', 0, 200, 1, pulse)]),
  EVE: writeEDF([ann(EVE_EVENTS)]),
  CSL: writeEDF([ann(CSL_EVENTS)])
};

/* THE WRITE IS THE PROGRAM, AND A PROGRAM MUST NOT RUN ON AN IMPORT. Putting the refusal behind
   `IS_CLI` without this would re-open `2026-10-11-help-flag-made-a-directory` on the import path:
   measured 2026-10-20, an import from a script run with `--jobs=auto` took that token as `OUT` and
   wrote five EDFs into a directory named after it. The CLI path is unchanged and still refuses. */
if (IS_CLI) {
  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const [kind, buf] of Object.entries(files)) {
    const f = path.join(OUT, `${STAMP}_${kind}.edf`);
    fs.writeFileSync(f, buf);
    total += buf.length;
    console.log(`  ${path.basename(f).padEnd(28)} ${String(buf.length).padStart(8)} bytes`);
  }
  console.log(`\n  ${Object.keys(files).length} files, ${(total / 1024).toFixed(0)} KB total — deterministic, no personal data.`);
}
