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
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import os from 'node:os';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url); // re-spawned as the child (see DISPATCH)
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

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
  vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: file });
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

for (const name of readdirSync(SRC)) {
  const full = join(SRC, name);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue;
  }
  if (!st.isFile()) continue;

  let m = RE_POLAR.exec(name);
  if (m) {
    const [, dev, , date, time, stream] = m;
    const t0 = parse8_6(date, time);
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
  m = RE_O2.exec(name);
  if (m) {
    const t0 = parse14(m[1]);
    bump(nightKeyOf(t0)).oxy.push({ name, full, t0, bytes: st.size, dev: 'O2Ring', stream: 'SPO2', kind: 'csv', stamp: m[1] });
    continue;
  }
  m = RE_O2_DAT.exec(name);
  if (m) {
    const t0 = parse14(m[1]);
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

/* PRIMARY PICK — by TEMPORAL OVERLAP with the night's anchor, NOT by file size.
   The corners of a three-cornered hat must be CONCURRENT: they must observe the same wall-clock
   window, or the estimator is comparing different recordings and the σ it prints is meaningless.
   Picking the biggest file per stream independently silently paired a 12:14 daytime ECG with an
   overnight PPG/SpO2 on 2026-06-13 (ECG 72 bpm awake vs PPG/Oxy 59 bpm asleep). Anchor = the
   O2Ring recording (always the sleep session); every other stream is the candidate with the most
   overlap against it, and a candidate with < MIN_OVERLAP_H of overlap is REJECTED outright. */
const primaryBy = (arr, anchor, label, key, minOverlapH) => {
  if (!arr.length) return null;
  if (!anchor) return null;
  const scored = arr.map((r) => ({ r, ov: overlapMs(r, anchor) })).sort((a, b) => b.ov - a.ov || b.r.bytes - a.r.bytes);
  const best = scored[0];
  const H = (ms) => (ms / 3600e3).toFixed(1);
  if (best.ov < minOverlapH * 3600e3) {
    console.log(`    ✗ ${key}: ${label} — NO concurrent recording (best overlap ${H(best.ov)} h < ${minOverlapH} h) — night rejected`);
    return null;
  }
  for (const d of scored.slice(1)) if (d.ov > 0 || d.r.bytes > 1e6) console.log(`    · ${key}: ${label} — not concurrent, skipping ${d.r.name} (overlap ${H(d.ov)} h)`);
  return best.r;
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
  const anchor = n.oxy.slice().sort((a, b) => durOf(b) - durOf(a) || b.bytes - a.bytes)[0] || null;
  if (!anchor) {
    console.log(`  ⊘ ${n.key} — not a trio night (no O2Ring anchor)`);
    continue;
  }
  const pick = {
    key: n.key,
    oxy: anchor,
    ecg: primaryBy(n.ecg, anchor, 'ECG', n.key, MIN_OVERLAP),
    accH10: primaryBy(n.acc_h10, anchor, 'H10 ACC', n.key, 0),
    ppg: primaryBy(n.ppg, anchor, 'PPG', n.key, MIN_OVERLAP),
    accVer: primaryBy(n.acc_ver, anchor, 'Verity ACC', n.key, 0),
    gyro: primaryBy(n.gyro, anchor, 'GYRO', n.key, 0),
    magn: primaryBy(n.magn, anchor, 'MAGN', n.key, 0)
  };
  const have = [pick.ecg && 'ECG', pick.ppg && 'PPG', pick.oxy && 'SpO2'].filter(Boolean);
  if (have.length < 3) {
    console.log(`  ⊘ ${n.key} — not a concurrent trio night (have: ${have.join('+') || 'none'})`);
    continue;
  }
  const ov = Math.min(overlapMs(pick.ecg, anchor), overlapMs(pick.ppg, anchor)) / 3600e3;
  console.log(`  ✓ ${n.key} — concurrent trio, ${ov.toFixed(1)} h three-way overlap`);
  trio.push(pick);
}

console.log(`\ntrio nights: ${trio.length}${LIMIT ? ` (limiting to ${LIMIT})` : ''}`);
const work = LIMIT ? trio.slice(0, LIMIT) : trio;

if (DRY) {
  for (const p of work) {
    console.log(`\n  ${p.key}`);
    for (const [k, f] of Object.entries(p)) if (f && f.name) console.log(`    ${k.padEnd(7)} ${f.name}  (${(f.bytes / 1e6).toFixed(1)} MB)`);
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

  /* ECGDex — raw H10 _ECG is the HONEST H10 leg (device _HR.txt is smoothed; CLAUDE.md).
     Build the parsed rec, then attach the _ACC companion so posture/accExtras run. */
  try {
    const rec = ECGDex.parseECG(readFileSync(p.ecg.full, 'utf8'));
    if (p.accH10) {
      const a = ECGDex.parseDeviceACC(readFileSync(p.accH10.full, 'utf8'));
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
    const rec = PpgDex.parsePPG(readFileSync(p.ppg.full, 'utf8'));
    const xyz = (f) => (f ? ctx.PPGDSP.parseSensorXYZ(readFileSync(f.full, 'utf8')) : null);
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
    const isDat = p.oxy.kind === 'dat';
    let text;
    if (isDat) {
      const bytes = new Uint8Array(readFileSync(p.oxy.full));
      if (!OxyDex.isO2RingBin(bytes)) throw new Error(`not an O2Ring native binary: ${p.oxy.name}`);
      text = OxyDex.decodeO2RingBinToCSV(bytes, p.oxy.name);
    } else {
      text = readFileSync(p.oxy.full, 'utf8');
    }
    const ex = OxyDex.compute({ text, fileMeta: { name: p.oxy.name } }, { ...COMMON, source: isDat ? 'o2ring-dat' : 'o2ring-csv' });
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
