/*
 * tools/trio-batch.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * TRIO BATCH — raw Polar Sensor Logger + O2Ring capture folder → per-night trio node-exports,
 * in the exact shape `tools/tch-multinight.mjs --dir` ingests (one subdir per night, three
 * `ganglior.node-export` JSONs: ECGDex · PpgDex · OxyDex).
 *
 * Closes the DATA half of INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III §1 ("the remaining owed
 * work is DATA, not code — commit ≥~5 more nights' three node-export JSONs and `--dir` prints
 * the real distribution").
 *
 * WHY A SEPARATE TOOL (not a DSP change): it only ORCHESTRATES the already-committed headless
 * compute() surfaces (ECGDex/PpgDex/OxyDex) — it adds no signal processing of its own, so it
 * moves no bundle and no manifestHash.
 *
 * PRIVACY (non-negotiable). The source capture folder is raw personal medical data and is
 * gitignored. This tool:
 *   - NEVER copies raw signal out of the source folder — it emits DERIVED summaries only;
 *   - runs every export through the SHARED `dexScrubExport` (dex-export.js) before writing, which
 *     drops `recording.device/serial/model` + input filenames/hashes and stamps `scrubbed:true`;
 *   - writes output filenames from the NIGHT + node only — never a device serial (dex-export.js §46:
 *     "NO device serial. The only sanctioned disambiguator is the short content digest").
 *
 * NIGHT BOUNDARY. Filename date ≠ night: a Verity PPG starting 2026-06-27T23:58 belongs to the
 * same night as an O2Ring stamped 2026-06-28T00:0x. A recording is assigned to the night of
 * (start − 12 h), so an evening start and the post-midnight hours of the same sleep both land on
 * the evening's date. Daytime (non-nocturnal) captures therefore land on the PREVIOUS night's key
 * and are filtered out by --min-hours unless --keep-daytime is passed.
 *
 * USAGE
 *   node tools/trio-batch.mjs --src "<capture dir>" [options]
 *   (no --max-old-space-size needed — the dispatcher sizes each child's heap from the probed host)
 *
 *     --src <dir>        raw capture folder (required)
 *     --out <dir>        output root (default: uploads/trio) — one subdir per night
 *     --night <key>      only this night (YYYY-MM-DD); repeatable
 *     --limit <n>        process at most n nights
 *     --min-hours <h>    skip a recording shorter than h hours (default 3)
 *     --min-overlap <h>  required three-way overlap (default 1 — tch-multinight needs ≥12 5-min epochs)
 *     --keep-daytime     do not filter non-nocturnal captures
 *     --jobs <n>         nights to compute in parallel (default: AUTO — probed from the host)
 *     --dry-run          plan only: print the night/file plan, compute nothing, write nothing
 *
 * PARALLELISM + MEMORY. Nights run as CHILD PROCESSES, pool-capped. The cap is PROBED, not assumed:
 * a night peaks at ~0.9 GB (a ~330 MB PPG text held while it parses into Float32 channels, plus a
 * ~180 MB ECG), so on a small machine RAM binds before CPU does. The tool takes min(cores−1, free
 * RAM ÷ ~1.2 GB) and prints what it picked and why — over-committing here does not merely slow the
 * run, it gets the process OOM-killed mid-corpus. Process-per-night (not threads) means each night's
 * memory is returned to the OS on exit, so nothing accumulates across the corpus, and no
 * --max-old-space-size is needed on the command line: the parent sizes each child's heap to the host.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url); // re-spawned as the child (see DISPATCH)
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
// ESM-MIGRATION: a co-loaded DSP (ecgdex-dsp.js …) may be a dual-mode ES module — shed its top-level
// export/import via the single classicify source before vm-loading (no-op on classic files).
const DexBuild = createRequire(import.meta.url)('./build-core.js');

/* ── args ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const optAll = (n) => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === n && argv[i + 1]) out.push(argv[i + 1]);
  return out;
};

const SRC = opt('--src', null);
// resolve(), not join(): join(ROOT, '/abs/path') CONCATENATES and would write inside the repo.
const OUT = resolve(ROOT, opt('--out', 'uploads/trio'));
const ONLY = optAll('--night');
const LIMIT = parseInt(opt('--limit', '0'), 10) || 0;
const MIN_HOURS = parseFloat(opt('--min-hours', '3'));
// Three-way overlap floor. NOT invented: tch-multinight needs ≥12 five-min epochs (= 1 h) to solve a
// night, and sensor-trio-worker.js:307 floors at 1000 s. 1 h satisfies both. Do not raise it without
// reason — a stricter floor silently discards eligible nights.
const MIN_OVERLAP = parseFloat(opt('--min-overlap', '1'));
const KEEP_DAYTIME = flag('--keep-daytime');
const DRY = flag('--dry-run');
const CHILD = flag('--child'); // internal: this process computes ONE night and exits

/* ── HARDWARE PROBE + CONCURRENCY PLAN ────────────────────────────────────────────────────────────
 * A night is EXPENSIVE and the cost is dominated by memory, not CPU: a Verity `_PPG.txt` is ~330 MB of
 * text which V8 holds as a string WHILE parsing it into Float32 channels, and the paired H10 `_ECG.txt`
 * adds ~180 MB. Measured peak ≈ 0.9 GB RSS per night (0.7 GB steady + filter scratch).
 *
 * So concurrency is capped by whichever runs out first — cores or RAM — and on a small machine that is
 * RAM. Getting this wrong is not a slowdown, it is an OOM kill mid-corpus (which is exactly how a
 * previous run lost its last night). We therefore probe the host and take the MINIMUM of the two limits,
 * never a fixed guess, and we PRINT what we chose and why (CLAUDE.md: no silent caps).
 *
 * Free memory — not total — is the honest budget: the box may already be hosting a browser, an IDE, and
 * a concurrent agent. We leave a reserve so we degrade to slower-but-correct instead of being OOM-killed.
 */
const GB = 1024 ** 3;
const PER_JOB_GB = 1.2; // measured ~0.9 GB peak/night + headroom
const RESERVE_GB = 2.0; // never consume the host's last 2 GB
const HARD_CAP = 8; // beyond this the disk/parse becomes the bottleneck anyway
function planConcurrency() {
  const cores = Math.max(1, os.cpus().length);
  const freeGB = os.freemem() / GB,
    totalGB = os.totalmem() / GB;
  // `os.freemem()` excludes reclaimable page cache on Linux, so it UNDER-reports what is really
  // available. Trust the smaller of (free) and (total − reserve) — pessimistic on purpose.
  const budgetGB = Math.max(0, Math.min(freeGB, totalGB - RESERVE_GB));
  const byCpu = Math.max(1, cores - 1); // leave one core for the OS/coordinator
  const byMem = Math.max(1, Math.floor(budgetGB / PER_JOB_GB));
  const auto = Math.max(1, Math.min(byCpu, byMem, HARD_CAP));
  const asked = parseInt(opt('--jobs', '0'), 10) || 0;
  const jobs = asked > 0 ? asked : auto;
  return { cores, totalGB, freeGB, budgetGB, byCpu, byMem, auto, jobs, forced: asked > 0 };
}
// Child heap: enough for one night with room for the filter scratch, but never more than the host has.
function childHeapMB(planned) {
  const perJobMB = Math.floor((planned.budgetGB / Math.max(1, planned.jobs)) * 1024 * 0.9);
  return Math.max(1536, Math.min(8192, perJobMB));
}

if (!SRC || !existsSync(SRC)) {
  console.error('trio-batch: --src <capture dir> is required and must exist');
  process.exit(2);
}

/* ── 1 · headless DSP realm (mirrors tests/run-tests.mjs makeCtx/loadInto) ─── */
function makeCtx() {
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
  // oxydex-dsp.js is grandfathered-impure: it reads document.documentElement.outerHTML at LOAD.
  // Mirror tests/run-tests.mjs makeSandbox() exactly, so the DSPs run in the same realm the gates use.
  const documentStub = {
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
  };
  const store = new Map();
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = documentStub;
  sandbox.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  // the namespaced co-load contract (each DSP hangs its node object off the realm global)
  sandbox.__DEX_NAMESPACED__ = true;
  return vm.createContext(sandbox);
}
function loadInto(ctx, file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) throw new Error('module not found: ' + file);
  vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: file });
}

// LAZY — the DSP realm is built only by a process that actually COMPUTES. A dispatching parent never
// loads it (it only plans + spawns), which keeps the coordinator at a few MB instead of carrying a full
// DSP realm for the whole run.
let ctx = null,
  ECGDex,
  PpgDex,
  OxyDex,
  DexKernel,
  dexScrubExport,
  COMMON;
function loadDsps() {
  if (ctx) return;
  ctx = makeCtx();
  // clock.js FIRST — the delegating DSPs alias DexClock.parseTimestamp at load (CLAUDE.md §Clock Contract).
  // kernel-constants.js supplies DexKernel, which every builder stamps into the export envelope.
  for (const f of ['clock.js', 'kernel-constants.js', 'dex-export.js', 'oxydex-util.js', 'oxydex-dsp.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) loadInto(ctx, f);
  ({ ECGDex, PpgDex, OxyDex, DexKernel, dexScrubExport } = ctx);
  for (const [n, v] of Object.entries({ ECGDex, PpgDex, OxyDex, DexKernel, dexScrubExport })) if (!v) throw new Error('trio-batch: ' + n + ' did not load into the headless realm');
  // `rich: true` is what unlocks timeseries.epochs[] — the app's light stream omits it, and ONLY the
  // orchestrate emitter opts in (signal-orchestrate.emitEcg/PpgNodeExport). tch-multinight reads
  // timeseries.epochs[].{hr,motionIndex}, so without rich the export is epoch-less and useless here.
  COMMON = { kernel: DexKernel, rich: true };
}

/* ── 2 · scan + index the capture folder ─────────────────────────────────── */
// Polar Sensor Logger: Polar_<H10|Sense>_<SERIAL>_<YYYYMMDD>_<HHMMSS>_<STREAM>.txt
const RE_POLAR = /^Polar_(H10|Sense)_([0-9A-Fa-f]+)_(\d{8})_(\d{6})_([A-Z]+)\.txt$/;
// O2Ring: "O2Ring S 2100_<YYYYMMDDHHMMSS>.csv"
const RE_O2 = /^O2Ring[^_]*_(\d{14})\.csv$/;
// O2Ring NATIVE BINARY: "<YYYYMMDDHHMMSS>.dat" — the device's own file, written beside the vendor CSV.
// When the CSV export stops (app not opened, phone not synced) the .dat is all that survives, and a
// night with a perfectly good ECG+PPG pair used to be dropped for want of an anchor. See
// TRIO-BATCH-O2RING-DAT-2026-07-13-BRIEF.md.
const RE_O2_DAT = /^(\d{14})\.dat$/;

// capture-host (the BLE `capture.py` daemon) layout — the SAME vendor CONTENT under DIFFERENT names
// (CAPTURE-HOST-INTEGRATOR-FOLD §1): one 14-digit stamp instead of `<YYYYMMDD>_<HHMMSS>`, the device
// token `VeritySense` (not `Sense`), the stream `MAG` (not `MAGN`), and Wellue-prefixed O2Ring files.
// The file BYTES are identical to the Polar Sensor Logger / O2Ring exports the DSPs already parse, so
// matching these names lets a real capture-host night ingest with no rename shim.
const RE_POLAR_CH = /^Polar_(H10|VeritySense)_([0-9A-Fa-f]+)_(\d{14})_([A-Z0-9]+)\.txt$/;
const RE_O2_CH = /^Wellue_O2Ring-S_[^_]+_(\d{14})_SPO2\.csv$/;
const RE_O2_DAT_CH = /^Wellue_O2Ring-S_[^_]+_(\d{14})_STORED\.dat$/; // onboard backup (full session)

// Clock Contract: floating wall-clock ms — components verbatim through Date.UTC, never new Date(str).
const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s);
const parse14 = (s) => utc(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
const parse8_6 = (d, t) => utc(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));

// A recording belongs to the night of (start − 12 h): evening starts and post-midnight starts
// of the same sleep collapse onto one key. See NIGHT BOUNDARY above.
const nightKeyOf = (tMs) => new Date(tMs - 12 * 3600e3).toISOString().slice(0, 10);

const nights = new Map();
const bump = (key) => {
  if (!nights.has(key)) nights.set(key, { key, ecg: [], acc_h10: [], ppg: [], acc_ver: [], gyro: [], magn: [], oxy: [] });
  return nights.get(key);
};

// RECURSE: the Polar Sensor Logger corpus is one FLAT folder, but the capture-host daemon writes one
// SUBDIRECTORY PER NIGHT (plus a `stored/` dir of onboard .dat backups). Walk the tree so both layouts
// ingest from the same `--src` — the regexes match on the BASENAME, and `readdirSync(recursive:true)`
// on a flat folder still returns bare filenames, so this is back-compat for the Polar corpus.
for (const rel of readdirSync(SRC, { recursive: true })) {
  const name = basename(rel);
  const full = join(SRC, rel);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue;
  }
  if (!st.isFile()) continue;

  // Polar streams — normalize BOTH the Polar Sensor Logger and capture-host layouts to {dev, stream, t0}
  // (dev ∈ {H10, Sense}, stream ∈ {ECG, ACC, PPG, GYRO, MAGN}) before the shared routing below.
  let dev = null;
  let stream = null;
  let t0 = null;
  let m = RE_POLAR.exec(name);
  if (m) {
    dev = m[1];
    t0 = parse8_6(m[3], m[4]);
    stream = m[5];
  } else if ((m = RE_POLAR_CH.exec(name))) {
    dev = m[1] === 'VeritySense' ? 'Sense' : m[1];
    t0 = parse14(m[3]);
    stream = m[4] === 'MAG' ? 'MAGN' : m[4];
  }
  if (dev) {
    const rec = { name, full, t0, bytes: st.size, dev, stream };
    const n = bump(nightKeyOf(t0));
    if (dev === 'H10' && stream === 'ECG') n.ecg.push(rec);
    else if (dev === 'H10' && stream === 'ACC') n.acc_h10.push(rec);
    else if (dev === 'Sense' && stream === 'PPG') n.ppg.push(rec);
    else if (dev === 'Sense' && stream === 'ACC') n.acc_ver.push(rec);
    else if (dev === 'Sense' && stream === 'GYRO') n.gyro.push(rec);
    else if (dev === 'Sense' && stream === 'MAGN') n.magn.push(rec);
    continue;
  }
  // O2Ring vendor CSV — Polar-Sensor-Logger-style "O2Ring …_<14>.csv" OR capture-host "Wellue_O2Ring-S_…_SPO2.csv".
  m = RE_O2.exec(name) || RE_O2_CH.exec(name);
  if (m) {
    t0 = parse14(m[1]);
    bump(nightKeyOf(t0)).oxy.push({ name, full, t0, bytes: st.size, dev: 'O2Ring', stream: 'SPO2', kind: 'csv', stamp: m[1] });
    continue;
  }
  // O2Ring onboard binary — bare "<14>.dat" OR capture-host "Wellue_O2Ring-S_…_STORED.dat".
  m = RE_O2_DAT.exec(name) || RE_O2_DAT_CH.exec(name);
  if (m) {
    t0 = parse14(m[1]);
    bump(nightKeyOf(t0)).oxy.push({ name, full, t0, bytes: st.size, dev: 'O2Ring', stream: 'SPO2', kind: 'dat', stamp: m[1] });
  }
}

/* PREFER THE VENDOR CSV when the same session is present as BOTH files. The O2Ring writes the CSV and
   the .dat for one recording under the same 14-digit stamp, and they carry the same samples (the brief
   pins it: 24,040 rows, zero mismatches on SpO₂/pulse/motion). Keep the CSV — it is the corpus's
   established provenance — and drop its .dat twin, so one recording never appears as two anchors. */
for (const n of nights.values()) {
  const csvStamps = new Set(n.oxy.filter((r) => r.kind === 'csv').map((r) => r.stamp));
  n.oxy = n.oxy.filter((r) => r.kind !== 'dat' || !csvStamps.has(r.stamp));
}

/* END-STAMP — the last wall-clock stamp in a stream file, read from a 64 KB TAIL (never the whole
   file: a PPG waveform is ~350 MB). Gives each recording a real [t0, tEnd] window. */
const endOf = (rec) => {
  /* O2Ring .dat: a binary with NO text stamps, so the tail-scan below finds nothing. It records at
     1 Hz, so tEnd = t0 + (records × 1000 ms). Read the whole file — a .dat is ~75 KB, not a waveform.
     FRAMING ONLY (10-byte header · 3-byte records · 0xFF 0xFF trailer): the VALUE decode — SpO₂, pulse,
     the motion×2 scale, the timestamps — stays single-sourced in oxydex-dsp.js decodeO2RingBinToCSV,
     which is what actually parses this file downstream. The planner never loads the DSP realm (see
     LAZY above), so it counts records rather than decoding them. */
  if (rec.kind === 'dat') {
    try {
      const b = readFileSync(rec.full);
      let n = 0;
      for (let off = 10; off + 3 <= b.length; off += 3) {
        if (b[off] === 0xff && b[off + 1] === 0xff) break;
        n++;
      }
      return n ? rec.t0 + n * 1000 : null;
    } catch {
      return null;
    }
  }
  const fd = openSync(rec.full, 'r');
  try {
    const size = statSync(rec.full).size;
    const n = Math.min(65536, size);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    const lines = buf
      .toString('utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      const first = lines[i].split(/[;,]/)[0].trim();
      // Polar: 2026-06-13T20:44:50.123 (ISO, no zone → components verbatim, Clock Contract rule 3)
      let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(first);
      if (m) return utc(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
      // O2Ring: 21:09:52 03/05/2026 (HH:MM:SS DD/MM/YYYY → rule 4, preferDMY)
      m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(first);
      if (m) return utc(+m[6], +m[5], +m[4], +m[1], +m[2], +m[3]);
    }
  } catch {
    /* unreadable tail → fall through to the size estimate */
  } finally {
    closeSync(fd);
  }
  return null;
};
const windowOf = (rec) => {
  if (rec._win) return rec._win;
  const tEnd = endOf(rec);
  rec._win = { t0: rec.t0, tEnd: tEnd != null && tEnd > rec.t0 ? tEnd : rec.t0 };
  return rec._win;
};
const overlapMs = (a, b) => {
  const A = windowOf(a),
    B = windowOf(b);
  return Math.max(0, Math.min(A.tEnd, B.tEnd) - Math.max(A.t0, B.t0));
};

/* ── MERGED SESSION INTERVALS ────────────────────────────────────────────────────────────────
   A night is not one file per stream. This box reconnects constantly — 07-24 wrote 8 ECG, 164 PPG
   and 153 SpO2 session files for a single night — so asking "which ONE file overlaps the anchor"
   measures the wrong thing entirely. Measured over the 2026-07-16..25 corpus, the best single-file
   three-way overlap versus the union of merged sessions:

     07-16  0.66 h vs  1.76 h      07-21  2.35 h vs  3.92 h
     07-17  1.00 h vs  3.59 h      07-22  1.07 h vs  4.75 h
     07-18  1.47 h vs 11.38 h      07-23  0.58 h vs  2.57 h   <- rejected, had 2.6 h
     07-19  3.35 h vs  8.54 h      07-24  0.45 h vs  2.91 h   <- rejected, had 2.9 h
     07-20  1.06 h vs  5.53 h      07-25  0.58 h vs  2.71 h   <- rejected, had 2.7 h

   Three of ten nights were discarded despite having ~3 h of genuine simultaneous tri-device
   recording, and 07-18 folded 1.47 h of the 11.38 h it actually had. Worse than the waste: the
   single-file rule always keeps the LONGEST CONTINUOUS session, which is by construction the
   calmest, least-interrupted stretch of the night. Every statistic downstream — the sigma
   distributions, the three-cornered hat — was therefore computed on a subsample selected for being
   artifact-free. That is a bias, not a sampling choice, and it gets worse the churnier the box gets.
   */
const mergeIv = (recs) => {
  const out = [];
  for (const r of recs.map(windowOf).sort((a, b) => a.t0 - b.t0)) {
    if (out.length && r.t0 <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r.tEnd);
    else out.push([r.t0, r.tEnd]);
  }
  return out;
};
const ivIntersect = (A, B) => {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]), e = Math.min(A[i][1], B[j][1]);
    if (e > s) out.push([s, e]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
};
const ivSpan = (A) => A.reduce((t, [s, e]) => t + (e - s), 0);

/* Every record of a stream that touches the night's merged anchor window — not the single best one.
   A record contributing zero overlap is still dropped (a daytime capture is not this night's sleep),
   so the concurrency guarantee the original comment insists on is preserved: what changes is that
   concurrency is now judged against the whole anchor, and ALL concurrent sessions are kept. */
const concurrentSet = (arr, anchorIv, label, key, minOverlapH) => {
  if (!arr.length || !anchorIv.length) return null;
  const kept = arr.filter((r) => ivSpan(ivIntersect(mergeIv([r]), anchorIv)) > 0);
  const ovMs = ivSpan(ivIntersect(mergeIv(kept), anchorIv));
  const H = (ms) => (ms / 3600e3).toFixed(1);
  if (ovMs < minOverlapH * 3600e3) {
    console.log(`    \u2717 ${key}: ${label} — NO concurrent recording (merged overlap ${H(ovMs)} h < ${minOverlapH} h) — night rejected`);
    return null;
  }
  const dropped = arr.length - kept.length;
  if (dropped) console.log(`    \u00b7 ${key}: ${label} — ${kept.length} concurrent session(s), ${H(ovMs)} h merged; skipped ${dropped} non-concurrent`);
  else console.log(`    \u00b7 ${key}: ${label} — ${kept.length} concurrent session(s), ${H(ovMs)} h merged`);
  return kept.sort((a, b) => windowOf(a).t0 - windowOf(b).t0);
};

/* ── 3 · plan ────────────────────────────────────────────────────────────── */
let plan = [...nights.values()].sort((a, b) => a.key.localeCompare(b.key));
if (ONLY.length) plan = plan.filter((n) => ONLY.includes(n.key));

// The worker's hard floor is 1000 s of simultaneous coverage (sensor-trio-worker.js:307). Require
// MIN_HOURS of genuine three-way overlap here so a night that cannot make that floor never ships.
const trio = [];
for (const n of plan) {
  // Anchor on the O2Ring: it is always the sleep session (the Polar streams include daytime captures).
  // Rank by recorded DURATION, not bytes: bytes stopped being comparable once .dat joined CSV as an
  // oxy candidate (a binary .dat is ~10× denser than the same session's CSV, so a short daytime CSV
  // would outweigh a full night's .dat). Duration is what "the sleep session" actually means.
  const durOf = (r) => {
    const w = windowOf(r);
    return w.tEnd - w.t0;
  };
  // ANCHOR = every O2Ring session of the night, merged. The ring is still the anchor for the same
  // reason as before (it is always the sleep session, never a daytime capture) — but it is also the
  // most fragmented stream on this box (153-324 SpO2 files a night, longest single 0.57 h), so
  // anchoring on its longest SINGLE file capped the entire fold at that file's length. That is why
  // OxyDex contributed 14 epochs to a night where ECGDex contributed 78.
  const anchorIv = mergeIv(n.oxy);
  if (!anchorIv.length) {
    console.log(`  ⊘ ${n.key} — not a trio night (no O2Ring anchor)`);
    continue;
  }
  const pick = {
    key: n.key,
    oxy: n.oxy.slice().sort((a, b) => windowOf(a).t0 - windowOf(b).t0),
    ecg: concurrentSet(n.ecg, anchorIv, 'ECG', n.key, MIN_OVERLAP),
    accH10: concurrentSet(n.acc_h10, anchorIv, 'H10 ACC', n.key, 0),
    ppg: concurrentSet(n.ppg, anchorIv, 'PPG', n.key, MIN_OVERLAP),
    accVer: concurrentSet(n.acc_ver, anchorIv, 'Verity ACC', n.key, 0),
    gyro: concurrentSet(n.gyro, anchorIv, 'GYRO', n.key, 0),
    magn: concurrentSet(n.magn, anchorIv, 'MAGN', n.key, 0)
  };
  const have = [pick.ecg && 'ECG', pick.ppg && 'PPG', pick.oxy.length && 'SpO2'].filter(Boolean);
  if (have.length < 3) {
    console.log(`  ⊘ ${n.key} — not a concurrent trio night (have: ${have.join('+') || 'none'})`);
    continue;
  }
  // The gate is the genuine THREE-WAY intersection of the merged sets, not the smaller of two
  // pairwise overlaps — the previous form could pass a night where ECG and PPG each overlapped the
  // ring but at different times.
  const threeIvAll = ivIntersect(ivIntersect(mergeIv(pick.ecg), mergeIv(pick.ppg)), anchorIv);
  // ONE NIGHT IS ONE SLEEP, NOT EVERYTHING THAT SHARES A DATE KEY. Merging every session of the
  // night restored the data the single-file rule threw away — but it also let a DAYTIME ring
  // capture into the anchor, and the ECG/PPG sets are chosen against the anchor, so the daytime
  // hours came with it: OxyDex records came out 21.6 h and 14.6 h long, spanning an 8 h hole. That
  // is precisely the "12:14 daytime ECG paired with an overnight PPG" failure the original
  // single-file rule existed to prevent, reintroduced from the other side.
  //
  // So: cluster the three-way blocks, split wherever they are separated by more than SLEEP_GAP_H of
  // no concurrent recording, and keep the LONGEST cluster. Within it every session still merges —
  // reconnect churn is minutes, never hours, so this splits day from night without ever splitting a
  // night from itself.
  const SLEEP_GAP_H = 4;
  const clusters = [];
  for (const b of threeIvAll) {
    const last = clusters[clusters.length - 1];
    if (last && b[0] - last[last.length - 1][1] <= SLEEP_GAP_H * 3600e3) last.push(b);
    else clusters.push([b]);
  }
  const threeIv = clusters.sort((a, b) => ivSpan(b) - ivSpan(a))[0] || [];
  const ov = ivSpan(threeIv) / 3600e3;
  if (ov < MIN_OVERLAP) {
    console.log(`  ⊘ ${n.key} — three-way merged overlap ${ov.toFixed(1)} h < ${MIN_OVERLAP} h`);
    continue;
  }
  if (clusters.length > 1) {
    const shed = (ivSpan(threeIvAll) - ivSpan(threeIv)) / 3600e3;
    console.log(`    · ${n.key}: ${clusters.length} concurrent blocks >${SLEEP_GAP_H} h apart — keeping the longest, shedding ${shed.toFixed(1)} h (daytime)`);
  }
  // Every stream is now clipped to the sleep window: a session that does not touch it is not part of
  // this night, whatever its date key says.
  const inSleep = (l) => (l ? l.filter((r) => ivSpan(ivIntersect(mergeIv([r]), threeIv)) > 0) : l);
  pick.oxy = inSleep(pick.oxy);
  pick.ecg = inSleep(pick.ecg);
  pick.ppg = inSleep(pick.ppg);
  pick.accH10 = inSleep(pick.accH10);
  pick.accVer = inSleep(pick.accVer);
  pick.gyro = inSleep(pick.gyro);
  pick.magn = inSleep(pick.magn);
  console.log(`  ✓ ${n.key} — concurrent trio, ${ov.toFixed(1)} h three-way overlap (merged sessions)`);
  trio.push(pick);
}

console.log(`\ntrio nights: ${trio.length}${LIMIT ? ` (limiting to ${LIMIT})` : ''}`);
const work = LIMIT ? trio.slice(0, LIMIT) : trio;

if (DRY) {
  for (const p of work) {
    console.log(`\n  ${p.key}`);
    for (const [k, v] of Object.entries(p)) {
      const list = Array.isArray(v) ? v : v && v.name ? [v] : [];
      if (!list.length) continue;
      const mb = list.reduce((t, f) => t + f.bytes, 0) / 1e6;
      console.log(`    ${k.padEnd(7)} ${list.length} session(s), ${mb.toFixed(1)} MB total`);
      for (const f of list.slice(0, 3)) console.log(`            ${f.name}  (${(f.bytes / 1e6).toFixed(1)} MB)`);
      if (list.length > 3) console.log(`            … +${list.length - 3} more`);
    }
  }
  console.log('\n--dry-run: nothing computed, nothing written.');
  process.exit(0);
}

/* ── 3b · DISPATCH — one CHILD PROCESS per night, pool-capped to the host ────────────────────────────
 * Process-per-night, not worker-threads: a night's ~0.9 GB peak is returned to the OS the moment the
 * child exits, so memory never accumulates across a 17-night corpus. Threads would share one heap and
 * the high-water mark would only ever climb. It also contains a crash — one bad night can't take the run
 * down, it just reports and the pool continues.
 * The parent NEVER loads a DSP realm (see loadDsps) — it plans, spawns, and streams the children's lines.
 */
if (!CHILD && work.length > 1) {
  const plan = planConcurrency();
  const heapMB = childHeapMB(plan);
  console.log(
    `\nhost: ${plan.cores} core(s) · ${plan.totalGB.toFixed(1)} GB RAM (${plan.freeGB.toFixed(1)} GB free)` +
      `\nconcurrency: ${plan.jobs}${plan.forced ? ' (forced via --jobs)' : ''}` +
      ` — cpu allows ${plan.byCpu}, memory allows ${plan.byMem} @ ~${PER_JOB_GB} GB/night` +
      ` ⇒ ${plan.forced ? 'override' : 'min'} = ${plan.jobs} · child heap ${heapMB} MB`
  );
  if (!plan.forced && plan.byMem < plan.byCpu) console.log(`  note: MEMORY-bound on this host (${plan.budgetGB.toFixed(1)} GB usable) — more cores would not help.`);
  // Below one night's footprint we cannot honestly promise the run will survive. Say so LOUDLY rather
  // than letting the OS OOM-kill it half-way through and leave a truncated corpus behind (which has
  // happened: a killed run left 2026-07-06 with only its ECGDex export).
  if (plan.budgetGB < PER_JOB_GB)
    console.log(
      `  ⚠ LOW MEMORY: ~${plan.budgetGB.toFixed(1)} GB usable, but ONE night peaks at ~${PER_JOB_GB} GB` +
        ` (a ~330 MB PPG text is held while it parses into Float32 channels).\n` +
        `    Running anyway at 1×, but this host may swap or be OOM-killed. Close other apps, or process` +
        ` a night at a time with --night <YYYY-MM-DD>.`
    );

  const t0 = Date.now();
  const queue = work.slice();
  let done = 0,
    failed = 0;
  const runOne = (p) =>
    new Promise((res) => {
      const args = [`--max-old-space-size=${heapMB}`, __filename, '--src', SRC, '--out', OUT, '--night', p.key, '--child', '--min-hours', String(MIN_HOURS), '--min-overlap', String(MIN_OVERLAP)];
      if (KEEP_DAYTIME) args.push('--keep-daytime');
      const ch = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      ch.stdout.on('data', (d) => {
        out += d;
      });
      ch.stderr.on('data', (d) => {
        out += d;
      });
      ch.on('close', (code) => {
        done++;
        // Print each night's block whole, so interleaved children never shred each other's output.
        const body = out
          .split('\n')
          .filter((l) => /^\s{4}[✓✗⊘·]/.test(l))
          .join('\n');
        console.log(`\n▸ ${p.key}  [${done}/${work.length}]${code === 0 ? '' : `  ✗ child exit ${code}`}`);
        if (body) console.log(body);
        if (code !== 0) {
          failed++;
          if (!body)
            console.log(
              out
                .trim()
                .split('\n')
                .slice(-3)
                .map((l) => '    ' + l)
                .join('\n')
            );
        }
        res();
      });
    });
  const workers = Array.from({ length: Math.min(plan.jobs, queue.length) }, async () => {
    while (queue.length) await runOne(queue.shift());
  });
  await Promise.all(workers);

  const secs = (Date.now() - t0) / 1000;
  const complete = readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isDirectory() && readdirSync(join(OUT, d.name)).filter((f) => f.endsWith('.json')).length === 3).length;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`nights        : ${work.length} planned · ${complete} complete trio(s) on disk${failed ? ` · ${failed} child failure(s)` : ''}`);
  console.log(`wall-clock    : ${secs.toFixed(0)}s  (${(secs / work.length).toFixed(0)}s/night at ${plan.jobs}× — sequential would be ~${((secs * plan.jobs) / 60).toFixed(0)} min)`);
  console.log(`\nnext: node tools/tch-multinight.mjs --dir ${opt('--out', 'uploads/trio')}`);
  process.exit(failed ? 1 : 0);
}

/* ── 4 · compute + scrub + write ─────────────────────────────────────────── */
loadDsps(); // only reached by a CHILD, or a single-night / --jobs 1 run
const hoursOf = (ex) => {
  const d = ex && ex.recording && ex.recording.durationSec;
  return d != null ? d / 3600 : null;
};
// A scrubbed export must never carry the serial back out via a filename/device field.
const writeExport = (dir, node, key, ex) => {
  const scrubbed = dexScrubExport(ex);
  const f = join(dir, `${node}_${key}.node-export.json`);
  writeFileSync(f, JSON.stringify(scrubbed, null, 2) + '\n');
  const eps = (scrubbed.timeseries && scrubbed.timeseries.epochs) || [];
  const withHr = eps.filter((e) => e.hr != null).length;
  const withMot = eps.filter((e) => e.motionIndex != null).length;
  console.log(`    ✓ ${node.padEnd(7)} ${eps.length} epochs · ${withHr} hr · ${withMot} motion`);
  return { node, epochs: eps.length, hr: withHr, motion: withMot };
};

mkdirSync(OUT, { recursive: true });
const summary = [];

for (const p of work) {
  console.log(`\n▸ ${p.key}`);
  const dir = join(OUT, p.key);
  mkdirSync(dir, { recursive: true });
  const row = { key: p.key, nodes: [] };

  /* ── MERGING SESSIONS, AND WHY IT IS DONE ON PARSED RECORDS ────────────────────────────────
     Concatenating the raw TEXT is not an option: the worst per-stream union in this corpus is
     775 MB (07-20 Verity ACC) and 559 MB (07-18 ECG), both past V8's ~537 MB maximum string, so a
     text merge would throw `Invalid string length` on exactly the nights with the most data.
     Parsed samples are ~10x denser than their text, so merging there is both safe and exact.

     NO TIME IS EVER FABRICATED. The silence between two sessions is real — the sensor was off-link
     — and each parser already has a way to say so, which is the way used here:
       ECG carries `gaps:[{idx,ms}]`, so the inter-session silence becomes one more gap entry at
       the join, and every carried-over gap has its index shifted by the join offset.
       PPG carries per-sample `relSec`, so a later session's samples simply land at their true
       offset from the first session's t0 and the hole appears as a jump in relSec.
     A merge that closed those holes instead would be inventing signal. */
  const mergeEcg = (recs) => {
    recs = recs.filter((r) => r && r.int16 && r.int16.length && r.t0Ms != null).sort((a, b) => a.t0Ms - b.t0Ms);
    if (recs.length <= 1) return recs[0] || null;
    const fs = recs[0].fs;
    // A rate change mid-night would make one sample index mean two different durations. It does not
    // happen on an H10 (130 Hz fixed), but assuming it cannot is how a silent corruption starts.
    const odd = recs.find((r) => Math.abs((r.fs || fs) - fs) > 0.5);
    if (odd) throw new Error(`ECG sessions disagree on fs (${fs} vs ${odd.fs}) — refusing to merge`);
    let n = 0;
    for (const r of recs) n += r.int16.length;
    const out = new Int16Array(n);
    const gaps = [];
    let idx = 0, prevEndMs = null;
    for (const r of recs) {
      if (prevEndMs != null) {
        const d = r.t0Ms - prevEndMs;
        if (d > 0) gaps.push({ idx: idx - 1, ms: d });   // the real off-link silence
      }
      for (const g of r.gaps || []) gaps.push({ idx: g.idx + idx, ms: g.ms });
      out.set(r.int16, idx);
      idx += r.int16.length;
      prevEndMs = r.t0Ms + (r.int16.length / fs) * 1000;
    }
    return { int16: out, fs, gaps, t0Ms: recs[0].t0Ms, offsetMin: recs[0].offsetMin, source: 'file', durSec: n / fs };
  };
  const mergePpg = (recs) => {
    recs = recs.filter((r) => r && r.n && r.t0Ms != null).sort((a, b) => a.t0Ms - b.t0Ms);
    if (recs.length <= 1) return recs[0] || null;
    const base = recs[0];
    const nch = base.ch.length;
    const bad = recs.find((r) => r.ch.length !== nch || r.site !== base.site);
    if (bad) throw new Error('PPG sessions disagree on channel count or site — refusing to merge');
    let n = 0;
    for (const r of recs) n += r.n;
    const ch = Array.from({ length: nch }, () => new Float32Array(n));
    const amb = new Float32Array(n);
    const relSec = new Float64Array(n);
    let idx = 0;
    for (const r of recs) {
      const off = (r.t0Ms - base.t0Ms) / 1000;          // true offset — the gap shows up here
      for (let c = 0; c < nch; c++) ch[c].set(r.ch[c].subarray(0, r.n), idx);
      if (r.amb) amb.set(r.amb.subarray(0, r.n), idx);
      for (let i = 0; i < r.n; i++) relSec[idx + i] = off + r.relSec[i];
      idx += r.n;
    }
    return {
      ch, amb, relSec, fs: base.fs, n, t0Ms: base.t0Ms, offsetMin: base.offsetMin,
      durSec: relSec[n - 1], site: base.site, gap: null,
      sentinelRejected: recs.reduce((t, r) => t + (r.sentinelRejected || 0), 0),
      sentinelKept: recs.reduce((t, r) => t + (r.sentinelKept || 0), 0)
    };
  };

  /* ECGDex — raw H10 _ECG is the HONEST H10 leg (device _HR.txt is smoothed; CLAUDE.md).
     Build the parsed rec, then attach the _ACC companion so posture/accExtras run. */
  try {
    const rec = mergeEcg(p.ecg.map((f) => ECGDex.parseECG(readFileSync(f.full, 'utf8'))));
    if (p.accH10 && p.accH10.length) {
      const a = ECGDex.parseDeviceACC(readFileSync(p.accH10[0].full, 'utf8'));
      rec.deviceACC = a.acc;
      rec.accFs = a.accFs;
    }
    const ex = ECGDex.compute(rec, { ...COMMON, source: 'polar-h10-ecg' });
    const h = hoursOf(ex);
    if (!KEEP_DAYTIME && h != null && h < MIN_HOURS) console.log(`    ⊘ ECGDex  ${h.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
    else row.nodes.push(writeExport(dir, 'ECGDex', p.key, ex));
  } catch (e) {
    console.log(`    ✗ ECGDex  ${e.message}`);
  }

  /* PpgDex — Verity HR MUST come from raw _PPG (device _HR.txt is all-zero; _PPI is header-only).
     ACC+GYRO drive the per-epoch motionIndex. */
  try {
    const rec = mergePpg(p.ppg.map((f) => PpgDex.parsePPG(readFileSync(f.full, 'utf8'))));
    // The IMU companions stay single-session: they only drive the per-epoch motionIndex, and the
    // 775 MB ACC union is the one that would blow the string limit. Documented, not silent.
    const xyz = (l) => (l && l.length ? ctx.PPGDSP.parseSensorXYZ(readFileSync(l[0].full, 'utf8')) : null);
    rec.acc = xyz(p.accVer);
    rec.gyro = xyz(p.gyro);
    rec.magn = xyz(p.magn);
    const ex = PpgDex.compute(rec, { ...COMMON, source: 'polar-sense-ppg' });
    const h = hoursOf(ex);
    if (!KEEP_DAYTIME && h != null && h < MIN_HOURS) console.log(`    ⊘ PpgDex  ${h.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
    else row.nodes.push(writeExport(dir, 'PpgDex', p.key, ex));
  } catch (e) {
    console.log(`    ✗ PpgDex  ${e.message}`);
  }

  /* OxyDex — O2Ring CSV (HH:MM:SS DD/MM/YYYY → Clock Contract rule 4, preferDMY). The Motion
     column supplies this corner's motionIndex. fileMeta name is already serial-free. */
  try {
    /* .dat → CSV text via OxyDex's OWN decoder (the same one the browser drop path uses), because
       compute() takes {samples|rows|text} and never bytes. Not a second implementation: the 3-byte
       layout, the 0xFF 0xFF trailer, the motion×2 scale and the filename→t0 rule live in exactly one
       place. Verified equivalent on 2026-07-06, the night that has both files. */
    // SpO2 merges as TEXT: the whole-night union is at most 1.4 MB in this corpus, nowhere near the
    // string limit, and every row carries its own absolute stamp so concatenation in time order is
    // exactly the same record the ring would have written had it never dropped. Header kept once.
    const oxyText = (f) => {
      if (f.kind === 'dat') {
        const bytes = new Uint8Array(readFileSync(f.full));
        if (!OxyDex.isO2RingBin(bytes)) throw new Error(`not an O2Ring native binary: ${f.name}`);
        return OxyDex.decodeO2RingBinToCSV(bytes, f.name);
      }
      return readFileSync(f.full, 'utf8');
    };
    const parts = p.oxy.map(oxyText).filter((t) => t && t.trim());
    if (!parts.length) throw new Error('no readable O2Ring session');
    const head = parts[0].split('\n')[0];
    const text = [parts[0].trimEnd()]
      .concat(parts.slice(1).map((t) => {
        const lines = t.split('\n');
        return (lines[0].trim() === head.trim() ? lines.slice(1) : lines).join('\n').trimEnd();
      }).filter(Boolean))
      .join('\n') + '\n';
    const isDat = p.oxy.some((f) => f.kind === 'dat');
    const ex = OxyDex.compute({ text, fileMeta: { name: p.oxy[0].name } }, { ...COMMON, source: isDat ? 'o2ring-dat' : 'o2ring-csv' });
    const h = hoursOf(ex);
    if (!KEEP_DAYTIME && h != null && h < MIN_HOURS) console.log(`    ⊘ OxyDex  ${h.toFixed(1)} h < --min-hours ${MIN_HOURS} (daytime/short) — skipped`);
    else row.nodes.push(writeExport(dir, 'OxyDex', p.key, ex));
  } catch (e) {
    console.log(`    ✗ OxyDex  ${e.message}`);
  }

  summary.push(row);
}

/* ── 5 · verdict ─────────────────────────────────────────────────────────── */
const complete = summary.filter((r) => r.nodes.length === 3);
console.log(`\n${'─'.repeat(64)}`);
console.log(`nights written : ${summary.length}`);
console.log(`complete trios : ${complete.length}  (all three node-exports)`);
const noMotion = complete.filter((r) => r.nodes.some((n) => n.motion === 0)).length;
if (noMotion)
  console.log(
    `motion gaps    : ${noMotion} night(s) have a corner with 0 motion epochs\n` +
      `                 (ECGDex does not stamp motionIndex on its epochs today — see\n` +
      `                  ecgdex-dsp.js epoch push; PpgDex/OxyDex do. The motion-ρ leg of\n` +
      `                  TCH FU-III §1 needs that DSP change, not more data.)`
  );
console.log(`\nnext: node tools/tch-multinight.mjs --dir ${opt('--out', 'uploads/trio')}`);
