/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * make-synthetic-eeg-edf.mjs — emit a DETERMINISTIC, SYNTHETIC single-channel EEG EDF.
 *
 * WHY THIS EXISTS. EEGDex is the one node whose `provenance/EEGDex.json` fragment
 * reads `fixtures: {}`, and the one node with no `env.equiv` leg. Its compute path
 * is therefore pinned only by in-suite assertions, which move with the code they
 * judge. `ingestEDF` — the real entry point, the one `eegdex-app.js` calls — has
 * never run on committed bytes in a gate.
 *
 * The obvious input is not available: a real sleep-EEG record is health data about a
 * person, and this repo is public. So this tool writes GENUINE EDF bytes around the
 * signal the engine already generates for its own known-answer group:
 * `EEGDSP.genSynthetic()` — five authored blocks of summed sines plus a seeded LCG,
 * 1800 s at 100 Hz, a fixed floating t0. No RNG, no Date.now(), no recording of any
 * person. Re-running reproduces the file byte-for-byte, which is what lets GATE B
 * content-address it.
 *
 * The signal is NOT re-derived here. Duplicating the generator would give the fixture
 * a second source of truth, so the tool loads `eegdex-dsp.js` into a vm realm co-loaded
 * like EEGDex.src.html (headless subset) and asks the engine for its own samples.
 *
 * WHAT IT ADDS TO THE GATED PATH: the EDF header arithmetic, the two-digit-year clock,
 * the int16 record decode, the channel pick out of the header, and the physical scaling
 * — none of which the synthetic FRAME used by the in-suite groups touches at all.
 *
 *   node tools/make-synthetic-eeg-edf.mjs [outdir]      (default: uploads/)
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
/* `process.argv` belongs to whoever is running: at module scope this refusal would read an
   IMPORTER's flags. The guard runs for the CLI only (residue 2026-10-20-four-argv-adopters…). */
const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI && (argv.includes('--help') || argv.includes('-h'))) {
  console.log('usage: node tools/make-synthetic-eeg-edf.mjs [outdir]   (default: uploads/)');
  process.exit(0);
}
if (IS_CLI) refuseUnknownArgvOrExit(argv, { boolean: ['--help', '-h'], positional: true }, { tool: 'tools/make-synthetic-eeg-edf.mjs' });
const OUT = argv[0] || 'uploads';

const FILE = 'synthetic_eegdex_c4.edf';
const SEC = 1800; // == genSynthetic's default duration: 60 epochs of 30 s
const HZ = 100; // == genSynthetic's default rate
const REC_DUR = 1; // seconds per data record
const RECORDS = SEC / REC_DUR;
const SPR = HZ * REC_DUR; // samples per record, per signal
const LABEL = 'EEG C4-A1'; // matches EEGDex's EEG_LABEL_RE on the C4 token
const DIM = 'uV';
/* An exact 10 counts/uV scale: (digMax-digMin)/(physMax-physMin) = 65535/6553.5 = 10.
   So the committed bytes hold the generator's signal quantised to 0.1 uV — a real PSG
   resolution — and the decode is integer arithmetic rather than a float that drifts. */
const PHYS_MIN = -3276.8;
const PHYS_MAX = 3276.7;
const DIG_MIN = -32768;
const DIG_MAX = 32767;
/* The header stamp, dd.mm.yy / hh.mm.ss. It must say the same instant as the frame's own
   floating t0Ms, and the control below refuses rather than writing a file that disagrees. */
const DATE_F = '01.01.26';
const TIME_F = '23.00.00';

const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the EEGDex.src.html script order (headless subset — no render/app) ── */
function realm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = {
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    },
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  // cpapdex-edf.js BEFORE eegdex-dsp.js: the DSP reads its EDF through that reader, by design.
  for (const f of ['kernel-constants.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'codegen/generated/eegdex-registry.js', 'cpapdex-edf.js', 'eegdex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

/* ── EDF writer ─────────────────────────────────────────────────────────────
   Header: 256 B main + ns*256 B signal headers, FIELD-MAJOR (all labels, then all
   transducers, …). Data records hold each signal's samples as int16 LE. The digital
   to physical map must invert readEDF exactly:
       phys = (dig - digMin) * (physMax-physMin)/(digMax-digMin) + physMin        */
function writeEDF(samples) {
  const ns = 1;
  const headerBytes = 256 + ns * 256;
  const size = headerBytes + SPR * 2 * RECORDS;
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const put = (str, start, len) => {
    const s = String(str);
    for (let i = 0; i < len; i++) u8[start + i] = i < s.length ? s.charCodeAt(i) : 0x20;
  };

  put('0', 0, 8);
  // Identity fields are 'X' (EDF+ for unknown). NO serial, NO patient, NO device.
  put('X X X X', 8, 80);
  put('Startdate 01-JAN-2026 X X X', 88, 80);
  put(DATE_F, 168, 8);
  put(TIME_F, 176, 8);
  put(String(headerBytes), 184, 8);
  put('EDF+C', 192, 44);
  put(String(RECORDS), 236, 8);
  put(String(REC_DUR), 244, 8);
  put(String(ns), 252, 4);

  let o = 256;
  const field = (len, v) => {
    put(v, o, len);
    o += ns * len;
  };
  field(16, LABEL);
  field(80, ''); // transducer
  field(8, DIM);
  field(8, PHYS_MIN);
  field(8, PHYS_MAX);
  field(8, DIG_MIN);
  field(8, DIG_MAX);
  field(80, ''); // prefilter
  field(8, SPR);
  o += ns * 32; // reserved

  const scale = (DIG_MAX - DIG_MIN) / (PHYS_MAX - PHYS_MIN);
  let p = headerBytes;
  let clipped = 0;
  for (let i = 0; i < RECORDS * SPR; i++) {
    let dig = Math.round((samples[i] - PHYS_MIN) * scale + DIG_MIN);
    if (dig < DIG_MIN || dig > DIG_MAX) {
      clipped++;
      dig = Math.max(DIG_MIN, Math.min(DIG_MAX, dig));
    }
    dv.setInt16(p, dig, true);
    p += 2;
  }
  return { buf: Buffer.from(buf), clipped };
}

const ctx = realm();
const EEGDSP = ctx.EEGDSP;
const CpapEdf = ctx.CpapEdf;
if (!EEGDSP || typeof EEGDSP.genSynthetic !== 'function') {
  console.error('refusing: eegdex-dsp.js did not publish EEGDSP.genSynthetic in the vm realm');
  process.exit(2);
}
const frame = EEGDSP.genSynthetic();
/* CONTROLS. Each one is a fact the committed bytes assert, so a generator that moves must
   stop this tool rather than quietly produce a file the fixture then pins as correct. */
if (frame.fs !== HZ || frame.samples.length !== SEC * HZ) {
  console.error(`refusing: genSynthetic returned ${frame.samples.length} samples at ${frame.fs} Hz, not ${SEC * HZ} at ${HZ}`);
  process.exit(2);
}
const clk = CpapEdf && typeof CpapEdf.parseEdfClock === 'function' ? CpapEdf.parseEdfClock(DATE_F, TIME_F) : null;
if (!clk || clk.t0Ms !== frame.t0Ms) {
  console.error(`refusing: the header stamp ${DATE_F} ${TIME_F} reads ${clk ? clk.t0Ms : null}, and the frame's floating t0Ms is ${frame.t0Ms}`);
  process.exit(2);
}

const { buf, clipped } = writeEDF(frame.samples);
if (clipped) {
  console.error(`refusing: ${clipped} sample(s) fell outside [${PHYS_MIN}, ${PHYS_MAX}] uV and would have been clipped`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const dest = path.join(OUT, FILE);
fs.writeFileSync(dest, buf);
const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
console.log(`wrote ${dest}  ${buf.length} B  sha256[0:16]=${sha}`);
console.log(`  ${LABEL} · ${HZ} Hz · ${SEC} s · ${RECORDS} records of ${SPR} samples · ${DIM} · t0 ${new Date(frame.t0Ms).toISOString()}`);
