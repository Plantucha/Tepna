/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * make-synthetic-raw-frames.mjs — emit a DETERMINISTIC, SYNTHETIC headband raw-frame
 * capture: the `<base>_RAW.txt` row format `writers.StreamWriter.write_muse` writes.
 *
 * WHY THIS EXISTS. `ingestMuseRaw` is the second entry point of `eegdex-dsp.js`, and it
 * is the only one that carries TWO CLOCKS: a device tick inside every frame and a host
 * stamp in the row's first column. `ingestEDF` has a committed fixture; this road has
 * none, so the whole two-clock path — the frame tokeniser, the 14-bit unpack, the tick
 * unwrap across the 2^28 ns fold, `DexClock.hostAxis` over the row anchors, and the
 * epoch placement that spends it — is pinned only by in-suite assertions, which move
 * with the code they judge.
 *
 * `clock.js` asks for exactly this file before a node reads `deviceDrawn`: "a node
 * adopting `deviceDrawn` re-cuts its own fixtures to a realistic device axis first",
 * because a synthetic `devMs = i * 1000` is by construction indistinguishable from a
 * fabricated column. So the device axis here is NOT uniform. It is built the way the
 * device builds it: a 24-bit tick that folds every 268435456 ns, which is 2684354.56
 * ticks and therefore NO integer tick count, so the reconstructed device time carries
 * the same sub-microsecond wobble a real capture carries. `deviceDrawn` reads false on
 * it, which is the point.
 *
 * THE HOST COLUMN IS A SECOND CLOCK, not the device time rounded. Two properties make
 * it one, and the controls below refuse rather than write a file that lacks either:
 *   · delivery jitter of up to HOST_JITTER_MS, so the residual spread clears
 *     `CK_AXIS_INERT_MS` and `hostAxis` reports `independent: true`;
 *   · a planted rate offset of PPM host-ms per device-ms — the MEASURED value for this
 *     device (-49.9 ppm, 4 box sessions of 1.6 h to 7.4 h, 2026-11-26), not a
 *     theatrical one, because GATE B pins exact bytes and a fixture that plants a
 *     fabricated rate pins the fabrication.
 *
 * ⚠️ THIS FIXTURE PINS A PLACEMENT AND NOT A RATE, and the arithmetic says why rather
 * than a preference. Over its 60 s span the planted rate moves the host column by 3.0 ms
 * and the delivery jitter moves it by up to 12 ms, so `hostAxis` recovers -9.4 ppm, which
 * is the JITTER and not the plant. A file whose recovered ppm is dominated by the drift
 * needs a span of tens of minutes, which is tens of MB of hex in a public repo. The plant
 * is here because two real clocks do not share a rate, NOT as a number any assertion
 * recovers.
 *
 * The PLACEMENT is nonzero all the same, and it is in the committed output: the axis the
 * file's own columns support puts epoch 1 at t0 + 30002 ms rather than t0 + 30000 ms. That
 * is the right thing for a fixture to pin — the correction the data earns, not one the
 * generator asserts.
 *
 * ⚠️ AND IT IS NOT A SLEEP-STAGING CLAIM. The model this node stages with declares
 * `needs_whole_night: true`: its features carry night medians and a time-of-night term. A
 * 60 s file is two epochs, so those features are degenerate by construction and whatever
 * stage comes out is a known answer about the PATH and about nothing clinical. The 1800 s
 * EDF fixture beside it is the one that stages a plausible night.
 *
 * What the committed bytes pin, then: an independent axis resolves over the row anchors,
 * the device column reads as a realistic one (`deviceDrawn: false`), `compute` publishes
 * `tMsBasis: 'host-disciplined'`, the placed epoch time carries the correction, and the
 * export's timing block reads `timingSource: 'device+host'` — 'device+host' and not 'host'
 * BECAUSE the device column is realistic; a drawn one would read 'host'. The suite's
 * `eegdex · clock · epoch-placement` group pins the MAGNITUDE against a stub axis. Neither
 * one alone is the contract.
 *
 * No RNG, no Date.now(), no recording of any person: the signal is a declared sum of
 * sines plus a seeded LCG, and re-running reproduces the file byte-for-byte, which is
 * what lets GATE B content-address it.
 *
 * THE LAYOUT IS READ, NEVER TRANSCRIBED. Every constant below comes out of a
 * `muse-frame.js` loaded into a vm realm, and the packer asserts its round trip through
 * that file's own `unpackLsb`, so this inverse cannot drift away from the reader.
 *
 *   node tools/make-synthetic-raw-frames.mjs [outdir]      (default: uploads/)
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
  console.log('usage: node tools/make-synthetic-raw-frames.mjs [outdir]   (default: uploads/)');
  process.exit(0);
}
if (IS_CLI) refuseUnknownArgvOrExit(argv, { boolean: ['--help', '-h'], positional: true }, { tool: 'tools/make-synthetic-raw-frames.mjs' });
const OUT = argv[0] || 'uploads';

/* `_RAW.txt` is load-bearing in the NAME: `eegdex-app.js` routes a dropped file to this road by
   `/_RAW\.txt$/i` and to the EDF road otherwise. A fixture under any other name would be gated
   through a parser the app would never hand it. */
const FILE = 'synthetic_eegdex_frames_RAW.txt';
const EPOCHS = 2; // 2 x 30 s: the shortest file that publishes a stage TRANSITION to the bus
const EPOCH_SEC = 30;
/* ONE NOTIFICATION DOES NOT CARRY A FIXED NUMBER OF EEG RECORDS, and that is what makes the device
   column realistic rather than drawn. A real notification mixes records of several tags and the
   batching varies, so the device time between two ROW anchors is not one repeated step. A fixed
   batch was measured here first: it gives a drawn share of 0.88, over `CK_AXIS_DRAWN_SHARE`, and
   `clock.js` would then read this fixture as a fabricated column. This plan cycles three batch
   sizes, so the three row steps land at about a third each. Its sum must divide the record count. */
const PACKET_PLAN = [3, 5, 4];
const HOST_JITTER_MS = 12; // BLE delivery jitter, uniform over [0, this]
const PPM = -49.9; // host-ms per device-ms, MEASURED; negative is a device running fast
/* The first row's host stamp, local civil time, zone-free — `_phone_ts`'s own format. Row 0 carries
   no jitter, so this string IS the frame's `t0Ms` and the control below refuses if it is not. */
const T0_MS = Date.UTC(2026, 0, 1, 23, 0, 0, 0);

const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── the EEGDex.src.html script order (headless subset — no render/app, no stage model) ── */
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
  /* NO STAGE MODULE IS LOADED HERE, AND THAT IS DELIBERATE — the sibling EDF generator states the
     same refusal and the same reason: this realm asks for `ingestMuseRaw` only, which reads no
     model. `tools/regen-eegdex-goldens.mjs` owns the `compute` call and loads both stage files.
     clock.js BEFORE eegdex-dsp.js (CLAUDE.md §✅) and muse-frame.js with it: the ingest refuses by
     name — `clock-absent`, `frame-reader-absent` — rather than throwing, so a realm missing either
     would mint a known answer about nothing. */
  for (const f of [
    'kernel-constants.js',
    'signal-frame.js',
    'dex-export.js',
    'metric-registry.js',
    'codegen/generated/eegdex-registry.js',
    'cpapdex-edf.js',
    'clock.js',
    'muse-frame.js',
    'eegdex-dsp.js'
  ])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

/* ── the signal ─────────────────────────────────────────────────────────────
   A declared waveform, not a second copy of `genSynthetic`'s: that one is 100 Hz and this
   device is 256 Hz, and a resample would invent samples the engine never authored. Each
   epoch gets its own band emphasis so the stager sees two different 30 s stretches rather
   than one repeated minute. The amplitude unit is UNDECLARED on this road (the reader states
   the 14-bit field is raw counts and that the scale is unmeasured), so these are counts
   around the mid-code and nothing here implies uV. */
const EEG_MID = 8192; // 2^13, the middle of the unsigned 14-bit code
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296; // [0, 1)
  };
}
function signalCounts(n, fsHz, epochSec, maxCode) {
  const noise = lcg(20261126),
    out = new Array(n);
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fsHz,
      ep = Math.floor(t / epochSec) % 2,
      /* epoch 0: an alpha-dominant stretch. epoch 1: a delta-dominant one. */
      v =
        ep === 0
          ? 900 * Math.sin(2 * Math.PI * 10 * t) + 220 * Math.sin(2 * Math.PI * 18.5 * t) + 120 * Math.sin(2 * Math.PI * 4.3 * t)
          : 2400 * Math.sin(2 * Math.PI * 1.1 * t) + 700 * Math.sin(2 * Math.PI * 2.7 * t) + 90 * Math.sin(2 * Math.PI * 12 * t),
      code = Math.round(EEG_MID + v + 180 * (noise() - 0.5));
    if (code < 0 || code > maxCode) clipped++;
    out[i] = Math.min(maxCode, Math.max(0, code));
  }
  return { counts: out, clipped: clipped };
}

/* ── the packer: the exact inverse of `muse-frame.js`'s `unpackLsb` ───────── */
function packLsb(fields, width, nBytes) {
  const bytes = new Array(nBytes).fill(0);
  for (let j = 0; j < fields.length; j++)
    for (let b = 0; b < width; b++) {
      const k = j * width + b;
      if (k >= nBytes * 8) break;
      if (Math.floor(fields[j] / Math.pow(2, b)) % 2 === 1) bytes[k >> 3] |= 1 << (k & 7);
    }
  return bytes;
}
const hex = (bytes) => bytes.map((b) => (b & 255).toString(16).padStart(2, '0')).join('');

/* ── the host stamp: `getUTC*` on a floating tMs, Clock Contract §5 ───────── */
const p2 = (v) => String(v).padStart(2, '0');
function phoneTs(tMs) {
  const d = new Date(tMs);
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`
  );
}

const die = (msg) => {
  console.error(`refusing: ${msg}`);
  process.exit(2);
};

const ctx = realm();
const MF = ctx.MuseFrame;
const EEGDSP = ctx.EEGDSP;
if (!MF || typeof MF.unpackLsb !== 'function' || typeof MF.tokenise !== 'function') die('muse-frame.js did not publish MuseFrame in the vm realm');
if (!EEGDSP || typeof EEGDSP.ingestMuseRaw !== 'function') die('eegdex-dsp.js did not publish EEGDSP.ingestMuseRaw in the vm realm');

/* Every layout number is READ. A transcription here would be a second declaration of the wire
   format, and the first one to move would be silently wrong. */
const HEADER_LEN = MF.HEADER_LEN,
  RECORD_HEAD = MF.RECORD_HEAD,
  TAG_EEG = MF.TAG_EEG,
  REC_SIZE = MF.RECORD_SIZE[TAG_EEG],
  DATA_LEN = REC_SIZE - RECORD_HEAD,
  WIDTH = MF.EEG_WIDTH,
  CH = MF.EEG_CHANNELS,
  SPR = MF.EEG_SAMPLES,
  REC_NS = MF.EEG_RECORD_NS,
  WRAP_NS = MF.WRAP_NS,
  NS_PER_TICK = MF.NS_PER_TICK,
  MAX_CODE = Math.pow(2, WIDTH) - 1,
  /* `muse-frame.js` keeps `EEG_FIELDS` private, so the field count is DERIVED from the two
     exported numbers rather than transcribed, and the data-length control below is what proves
     the derivation still matches the wire format. */
  FIELDS = SPR * CH;
if (Math.floor((DATA_LEN * 8) / WIDTH) !== FIELDS) die(`a ${DATA_LEN} B data field holds ${Math.floor((DATA_LEN * 8) / WIDTH)} fields of ${WIDTH} bits, not ${FIELDS}`);

const N_REC = (EPOCHS * EPOCH_SEC * 1e9) / REC_NS;
if (!Number.isInteger(N_REC)) die(`${EPOCHS * EPOCH_SEC} s is not a whole number of ${REC_NS} ns records`);
const PLAN_SUM = PACKET_PLAN.reduce((a, b) => a + b, 0);
if (N_REC % PLAN_SUM) die(`${N_REC} records do not divide into whole cycles of the packet plan (${PACKET_PLAN.join('+')} = ${PLAN_SUM})`);
const N_SMP = N_REC * SPR;

const sig = signalCounts(N_SMP, N_SMP / (EPOCHS * EPOCH_SEC), EPOCH_SEC, MAX_CODE);
if (sig.clipped) die(`${sig.clipped} sample(s) fell outside the ${WIDTH}-bit code range and would have been clipped`);

/* The device epoch sits on a fold boundary of its own header unit, so the first record's tick is 0
   and `devMs0` is 0 — the device clock reads the same instant as the first host stamp, which is what
   a device whose clock was set by the phone does. */
const W = BigInt(WRAP_NS);
const B0 = (BigInt(T0_MS) * 1000000n) / W;

const jitter = lcg(49900001);
const rows = [];
let roundTripChecked = 0;
let r0 = 0;
for (let p = 0; r0 < N_REC; p++) {
  const nRec = PACKET_PLAN[p % PACKET_PLAN.length];
  const seq = p % 65536; // the 16-bit packet counter, +1 per notification from 0
  const pktLen = HEADER_LEN + nRec * REC_SIZE;
  if (pktLen > 255) die(`a packet of ${pktLen} B cannot declare its own length in one byte`);
  const devNs0 = B0 * W + BigInt(r0) * BigInt(REC_NS);
  const base = devNs0 / W;
  const pkt = new Array(pktLen).fill(0);
  pkt[0] = pktLen; // `tokenise` refuses on `length-byte` unless this IS the length
  pkt[1] = seq & 255; // the low byte, which the captured file's counter column holds
  pkt[2] = (seq >> 8) & 255; // header[0]; `packetSeq` reads the two together
  for (let b = 0; b < 5; b++) pkt[3 + b] = Number((base >> BigInt(8 * b)) & 255n); // device time u40 LE
  pkt[8] = 0;
  /* EVERY RECORD OF A PACKET SHARES ITS HEADER BASE, exactly as the device sends them: the header
     carries one device time per notification and each record's own tick carries the part below the
     fold. A generator that re-based every record would hide the fold arithmetic the tick unwrap
     exists to do. */
  for (let k = 0; k < nRec; k++) {
    const r = r0 + k,
      devNs = B0 * W + BigInt(r) * BigInt(REC_NS),
      rem = Number(devNs - base * W),
      tick = Math.round(rem / NS_PER_TICK);
    if (tick < 0 || tick >= 0x800000) die(`record ${r} needs a tick of ${tick}, outside the 24-bit positive range`);
    const fields = new Array(FIELDS);
    for (let s = 0; s < SPR; s++)
      for (let c = 0; c < CH; c++) {
        /* Channel 0 carries the authored signal — it is `EEG_ELECTRODES[0]`, the packing-order
           default `ingestMuseRaw` picks when no channel is named. The other seven carry declared
           variants of it, so a named-channel pick is exercised on real distinct columns rather
           than on eight copies of one. */
        const v = sig.counts[(r * SPR + s) % N_SMP];
        fields[s * CH + c] = c === 0 ? v : Math.min(MAX_CODE, Math.max(0, EEG_MID + Math.round((v - EEG_MID) / (1 + c)) + 37 * c));
      }
    const data = packLsb(fields, WIDTH, DATA_LEN);
    /* THE ROUND TRIP, through the reader's own unpack. The packer is a new inverse of a function
       this repo already ships; without this control the two could drift apart and the fixture
       would pin the drift. Checked on every record, because the cost is one array per record. */
    const back = MF.unpackLsb(data, WIDTH, false);
    for (let j = 0; j < FIELDS; j++) if (back[j] !== fields[j]) die(`record ${r} field ${j} packed ${fields[j]} and unpacked ${back[j]}`);
    roundTripChecked++;
    const off = HEADER_LEN + k * REC_SIZE;
    pkt[off] = TAG_EEG;
    pkt[off + 1] = r % 256; // the per-tag record index, +1 modulo 256
    pkt[off + 2] = tick & 255;
    pkt[off + 3] = (tick >> 8) & 255;
    pkt[off + 4] = (tick >> 16) & 255;
    for (let b = 0; b < DATA_LEN; b++) pkt[off + RECORD_HEAD + b] = data[b];
  }
  const tk = MF.tokenise(pkt);
  if (!tk.packet) die(`packet ${p} does not tokenise: ${tk.reason}`);
  if (tk.packet.records.length !== nRec) die(`packet ${p} tokenised to ${tk.packet.records.length} records, not ${nRec}`);
  if (MF.packetSeq(tk.packet) !== seq) die(`packet ${p} reads back counter ${MF.packetSeq(tk.packet)}, not ${seq}`);
  /* The host stamp of the row: the device duration scaled by the planted rate, plus delivery
     jitter. Row 0 takes no jitter so the first stamp IS `T0_MS`. */
  const devMs = (r0 * REC_NS) / 1e6,
    hostMs = T0_MS + Math.round(devMs * (1 + PPM / 1e6) + (p === 0 ? 0 : jitter() * HOST_JITTER_MS));
  rows.push(`${phoneTs(hostMs)};${String(devNs0)};${seq & 255};${pktLen};${hex(pkt)}`);
  r0 += nRec;
}

const text = `${rows.join('\n')}\n`;

/* ── CONTROLS. Each one is a fact the committed bytes assert, so a generator that moves must stop
   this tool rather than quietly produce a file the fixture then pins as correct. ───────────────── */
const fr = EEGDSP.ingestMuseRaw(text, {});
if (!fr.ok) die(`the written text does not ingest: ${fr.reason}`);
if (fr.samples.length !== N_SMP) die(`the ingest read ${fr.samples.length} samples, not ${N_SMP}`);
if (fr.fs !== N_SMP / (EPOCHS * EPOCH_SEC)) die(`the ingest measured ${fr.fs} Hz, not ${N_SMP / (EPOCHS * EPOCH_SEC)}`);
if (fr.t0Ms !== T0_MS) die(`the ingest read t0Ms ${fr.t0Ms}, and row 0's stamp says ${T0_MS}`);
if (fr.frames.gapCount || fr.frames.lostRecords || fr.frames.restarts || fr.frames.repeats) die(`the ingest found a discontinuity: ${JSON.stringify(fr.frames)}`);
if (Object.keys(fr.frames.unparsable).length || Object.keys(fr.frames.refusedRows).length)
  die(`the ingest refused rows: ${JSON.stringify({ unparsable: fr.frames.unparsable, refused: fr.frames.refusedRows })}`);
const ax = fr.hostAxis || {};
if (ax.ok !== true) die(`DexClock.hostAxis did not resolve over the row anchors: ${ax.reason}`);
/* THE TWO PROPERTIES THIS FIXTURE EXISTS FOR. `independent` is the gate the node reads, and
   `deviceDrawn === false` is the "realistic device axis" `clock.js` asks a `deviceDrawn` adopter
   to re-cut its fixtures to — a uniform device column would make this file indistinguishable
   from a fabricated one. */
if (ax.independent !== true) die(`the host column is not an independent clock (residual spread did not clear the inert bound): ${JSON.stringify(ax)}`);
if (ax.deviceDrawn !== false) die(`the device column reads as DRAWN (share ${ax.drawnShare}), so this file is not a realistic device axis`);
if (!fr.hostCorr || typeof fr.hostCorr.correctionAt !== 'function') die('the frame carries no live hostCorr, so compute would publish tMsBasis device-index');
if (!(typeof fr.devMs0 === 'number' && isFinite(fr.devMs0))) die(`the frame carries devMs0 ${fr.devMs0}, which places no epoch`);
/* THE PLACEMENT ITSELF. A file whose axis moves no epoch time would satisfy every control above
   and pin nothing this fixture exists to pin, so the last epoch's correction must round to a
   nonzero millisecond. It is read the way `analyze` reads it — DIFFERENTIALLY from the first
   epoch, because `t0Ms` is already the host stamp of row 0. */
const corr0 = fr.hostCorr.correctionAt(fr.devMs0),
  corrLast = Math.round(fr.hostCorr.correctionAt(fr.devMs0 + (EPOCHS - 1) * EPOCH_SEC * 1000) - corr0);
if (!isFinite(corr0) || !corrLast) die(`the axis moves the last epoch by ${corrLast} ms, so the placed times would equal the device-index ones`);

fs.mkdirSync(OUT, { recursive: true });
const dest = path.join(OUT, FILE);
fs.writeFileSync(dest, text);
const sha = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
console.log(`wrote ${dest}  ${text.length} B  sha256[0:16]=${sha}`);
console.log(
  `  ${rows.length} rows of ${PACKET_PLAN.join('/')} EEG records · ${N_REC} records · ${N_SMP} samples · ${fr.fs} Hz · ${EPOCHS * EPOCH_SEC} s · channel ${fr.channel} of ${fr.channels.length}`
);
console.log(`  packed fields round-tripped through MuseFrame.unpackLsb on ${roundTripChecked} record(s)`);
console.log(`  host axis: ${ax.anchors} anchors · independent ${ax.independent} · deviceDrawn ${ax.deviceDrawn} (share ${ax.drawnShare})`);
console.log(`  ppm read ${ax.ppm} over ${EPOCHS * EPOCH_SEC} s — delivery jitter at this span, NOT the planted ${PPM} (3.0 ms over the span, against ${HOST_JITTER_MS} ms of jitter)`);
console.log(`  epoch ${EPOCHS - 1} is placed ${corrLast} ms off its device-index time`);
