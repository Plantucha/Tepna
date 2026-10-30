#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ── wearable-sync — ARE THE WEARABLES ON THE SAME TIMELINE? ──────────────────
   Every clock tool in this repo measures a wearable against the CPAP. None
   compared the wearables with EACH OTHER, and all of them assumed they agreed.
   Measured, they do not: the H10 and the Verity sit ~3.3 s apart on 24 of 24
   phone-captured nights (median 3.3 s, NOT ONE inside 1 s) and ~0.2 s apart on
   all 6 nights captured by the vigil box. A systematic bias that survived months
   because no code ever made the comparison.

   Two accelerometers strapped to one body see the same turn at the same instant —
   physics, no physiology in between — so ACC-vs-ACC is the only contrast that can
   check this on EVERY night, rather than on the 8 of 31 where the sparse
   `movement_onset` event channel happened to clear its null.

   The estimator is `IntegratorDSP.alignEnvelopes` (gated: `integrator-dsp ·
   acc-align`), which reports a constant offset AND clock drift in ppm from
   windowed normalized cross-correlation — the published practice, cited in the
   module. This tool only finds files, parses them and prints.

   USAGE
     node tools/wearable-sync.mjs --src <capture dir> [--night YYYY-MM-DD]
                                  [--window 600] [--hop 300] [--max-lag 30]
                                  [--fs 10] [--json out.json] [--skip-existing]

   RUN IT DAILY, NOT IN BATCHES. A whole-corpus sweep is ~1-2 min per night, so 30
   nights is half an hour and a month of backlog is an afternoon — the work grows
   faster than anyone wants to wait for it, and an unmeasured night is
   indistinguishable from a synchronised one until someone looks. One night costs
   ~1-2 min:
     node tools/wearable-sync.mjs --src <captures> --night $(date +%F) \
          --json wearable-sync.json --skip-existing
   `--skip-existing` reads the ledger back and re-measures only what is missing, so
   the same command is safe to run on a timer and cheap to re-run after a failure.
   `--fs 4` costs ~6x less than the 10 Hz default and still resolves the offsets
   seen on this corpus (0.1-4.9 s); 10 Hz is for when the answer is near zero.

   A night is REPORTED WITH ITS REASON when it cannot be measured — a quiet night
   with no shared movement is a real outcome, not an error, and printing nothing
   would let an unmeasured night pass as a synchronised one. */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, openSync, readSync, closeSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const SRC = opt('--src', null);
const ONLY = opt('--night', null);
const FS_HZ = parseFloat(opt('--fs', '10'));
const WIN = parseFloat(opt('--window', '600'));
const HOP = parseFloat(opt('--hop', '300'));
const MAXLAG = parseFloat(opt('--max-lag', '30'));
const JSON_OUT = opt('--json', null);
const SKIP_EXISTING = argv.includes('--skip-existing');
const SELFTEST = argv.includes('--selftest');
const SAMPLE_AT = '2026-10-28T00:00:00Z';

/* THE ADOPTION SAMPLE prints the object ALONE, because `verdict-adoption` parses this stdout as
   JSON — the ordinary run prints the same object after a human line, which is right for a reader
   and unparseable for the checker. The names are synthetic and no commit identity is claimed, which
   is what `commitReason` says rather than a sha that would imply the sample was measured. */
/* THE SAMPLE LIVES IN A HELPER, and that placement is the assertion. `corpus-reads.mjs` blanks a
   body named `verdictSample` before it classifies the tool, so the clearance comes off the REAL
   walk below — a sample at top level would have this tool read as reporting a population over
   names no run enumerates. */
function verdictSample() {
  const sampleCaptureFiles = () => ['2026-07-21/Polar_H10_02849638_20260721194715_ACC.txt', '2026-07-21/Polar_VeritySense_0C301E3F_20260721194615_ACC.txt'];
  const snap = snapshotEntries('(sample)', { list: sampleCaptureFiles, unit: 'files', at: SAMPLE_AT });
  return populationVerdict(snap, snap, {
    tool: 'tools/wearable-sync.mjs',
    evidence: ['tools/wearable-sync.mjs'],
    at: SAMPLE_AT,
    commitReason: '--verdict-sample: synthetic files names, no code identity claimed'
  });
}
/* The object ALONE on stdout, because `verdict-adoption` parses it as JSON; the ordinary run prints
   the same object after a human line, which is right for a reader and unparseable for the checker. */
if (argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

/* `--selftest` reads fixtures it writes itself, so it owes no `--src`. The guard still refuses an
   ordinary run with no corpus, which is the case it exists for. */
if (!SELFTEST && (!SRC || !existsSync(SRC))) {
  console.error('wearable-sync: --src <capture dir> is required and must exist');
  process.exit(2);
}

/* The DSP is loaded into a plain context the same way every other analysis tool in
   this repo does it, so the gated implementation runs — not a copy of it. */
const ctx = { console, Math, Date, JSON, isFinite, parseFloat, parseInt, Float64Array, Array, Object, String, Number, setTimeout };
ctx.window = ctx;
ctx.self = ctx;
ctx.globalThis = ctx;
createContext(ctx);
for (const f of ['clock.js', 'kernel-constants.js', 'dex-export.js', 'integrator-dsp.js']) runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
const DSP = ctx.IntegratorDSP;

/* TWO vendor timestamp layouts live in this corpus — `YYYYMMDDHHMMSS_ACC` (box)
   and `YYYYMMDD_HHMMSS_ACC` (phone). A regex that matched only the first silently
   skipped every pre-box night while reporting a clean run over the rest, which is
   how a 24-night blind spot looks from the outside. Both are matched explicitly,
   per the Clock Contract's "explicit vendor formats by regex" rule. */
const STAMP = /_(\d{8}_?\d{6})_ACC/;
/* THE FILENAME STAMP HAS ONE OWNER — `DexClock.fileStamp` (clock.js:255; Clock Contract §4, anchor
   source 2), off the realm above. The regex still decides WHICH field is the stamp, over both
   layouts; the slices that stood here fed a bare `Date.UTC`, which rolls an out-of-range component
   onto a real instant instead of refusing, so a month-13 stamp anchored a night in the following
   February. The owner range-validates the components and requires a year in [1990, 2099].
   TWO ANSWERS, NOT ONE: `null` is a name that carries no stamp field at all — not a capture, and
   silent, as it always was — while `false` is a stamp field the owner refused, which the walk below
   counts and names (§∅). */
const CK = ctx.DexClock;
if (!CK || typeof CK.fileStamp !== 'function') throw new Error('wearable-sync: DexClock.fileStamp did not load into the realm');
const stampMs = (f) => {
  const m = STAMP.exec(f);
  if (!m) return null;
  return CK.fileStamp(m[1])?.tMs ?? false;
};
const IS_H10 = /^Polar_H10_.*_ACC\.txt$/;
const IS_VER = /^Polar_(Sense|VeritySense)_.*_ACC\.txt$/;
// The evening owns the night: a file starting before noon belongs to the previous date.
const nightOf = (ms) => new Date(new Date(ms).getUTCHours() < 12 ? ms - 86400000 : ms).toISOString().slice(0, 10);

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;
/* THE FIRST DATA ROW OWNS THE START — THE NAME CARRIES THE SESSION'S.
   `stampMs` above reads the filename stamp, which the capture writer sets when the SESSION opens.
   A stream that bonds late opens after it. Board #373 measured the gap over the whole capture tree:
   the first data row of 8077 of 8077 files carries a parseable host stamp, 101 files disagree with
   their own name by over 5 min, and the worst sits 18.7 h out. The grid then drops every row outside
   `[t0, t0 + 12 h]` BY THE ROW'S OWN TIME, so a stream that opened 12 h after its session stamp lost
   all of its rows, and one that opened late lost its tail by the same gap. Row
   `2026-10-28-wearable-sync-anchors-its-window-at-the-session-stamp`; same repair as
   `tools/trio-anchor.mjs` and `sensor-trio-night.js` made for their own consumers.
   THE READ IS BOUNDED to the first 64 KiB, not the file: the window needs ONE row and an ACC file
   runs to hundreds of MiB, so a whole second pass over the corpus is the cost the row warned about.
   A final line the read may have cut is dropped rather than parsed. A head that carries no parseable
   row returns null, which the caller names rather than replacing with a number (§∅). */
const HEAD_BYTES = 65536;
const firstRowMs = (path) => {
  let fd = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.allocUnsafe(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    if (!n) return null;
    const lines = buf.toString('utf8', 0, n).split('\n');
    if (n === HEAD_BYTES) lines.pop();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(';');
      if (c.length < 4) continue;
      if (!ISO.test(String(c[0]).trim())) continue;
      const t = CK.parseTimestamp(String(c[0]).trim());
      if (t && isFinite(t.tMs)) return t.tMs;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
};
/* ONE SIDE'S START, AND WHAT IT ANCHORED ON. The start is the EARLIEST first-row stamp among the
   side's files. A file whose head carries no parseable row KEEPS ITS FILENAME STAMP and is counted:
   dropping it would shrink the window silently, and substituting a zero or a default is the bug this
   repo calls ∅. The caller prints both counts, so a night anchored on a name says so. */
const startOf = (list, readFirstRow) => {
  let t = Number.POSITIVE_INFINITY;
  let onRow = 0;
  let onName = 0;
  for (const f of list) {
    const r = readFirstRow(f.path);
    if (r === null || !isFinite(r)) {
      onName++;
      if (isFinite(f.t) && f.t < t) t = f.t;
      continue;
    }
    onRow++;
    if (r < t) t = r;
  }
  return { t: isFinite(t) ? t : null, onRow, onName };
};
/* The window opens where BOTH streams are live and runs 12 h, which is what the name-stamp version
   intended and could not deliver. `t0` is the LATER of the two sides' starts. */
const windowFor = (h10, ver, readFirstRow) => {
  const a = startOf(h10, readFirstRow);
  const b = startOf(ver, readFirstRow);
  if (a.t === null || b.t === null) return { t0: null, t1: null, onRow: a.onRow + b.onRow, onName: a.onName + b.onName };
  const t0 = Math.max(a.t, b.t);
  return { t0, t1: t0 + 12 * 3600000, onRow: a.onRow + b.onRow, onName: a.onName + b.onName };
};

if (SELFTEST) {
  let n = 0;
  const eq = (c, what) => {
    n++;
    if (!c) {
      console.error(`FAIL · ${what}`);
      process.exit(1);
    }
  };
  const dir = mkdtempSync(join(tmpdir(), 'wsync-selftest-'));
  const write = (name, body) => {
    const f = join(dir, name);
    writeFileSync(f, body);
    return f;
  };
  const HEAD = 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]\n';
  const row = (iso) => `${iso};1000;10;20;30\n`;
  try {
    const fA = write('a.txt', HEAD + row('2026-07-21T22:10:00.000') + row('2026-07-21T22:10:01.000'));
    eq(firstRowMs(fA) === Date.UTC(2026, 6, 21, 22, 10, 0, 0), 'firstRowMs reads the first DATA row, never the header');

    const fB = write('b.txt', HEAD + 'not a stamp;1;2;3;4\n' + row('2026-07-21T23:00:00.000'));
    eq(firstRowMs(fB) === Date.UTC(2026, 6, 21, 23, 0, 0, 0), 'it walks past a row whose stamp field is not a time');

    const fC = write('c.txt', HEAD + 'x;y;z\n');
    eq(firstRowMs(fC) === null, 'a head with no parseable data row reads null, never a substituted number');
    eq(firstRowMs(join(dir, 'absent.txt')) === null, 'an unreadable file reads null rather than throwing');

    const fD = write('d.txt', HEAD + `${'#'.repeat(HEAD_BYTES)}\n` + row('2026-07-21T22:00:00.000'));
    eq(firstRowMs(fD) === null, 'the read is BOUNDED — a row past the 64 KiB head is not reached, and the bound reports null');

    /* THE ROW'S OWN FAILURE CASE. The Verity name stamp sits at 19:00 and its rows open at 07:05 the
       next morning, 12 h 5 min later. Anchored on the names the window is [19:00, 07:00] and every
       Verity row falls outside it; anchored on the rows it opens at 07:05 and keeps them. */
    const nameH = Date.UTC(2026, 6, 21, 19, 0, 0);
    const nameV = Date.UTC(2026, 6, 21, 19, 0, 0);
    const rowH = Date.UTC(2026, 6, 21, 19, 2, 0);
    const rowV = Date.UTC(2026, 6, 22, 7, 5, 0);
    const fH = write('h.txt', HEAD + row('2026-07-21T19:02:00.000'));
    const fV = write('v.txt', HEAD + row('2026-07-22T07:05:00.000'));
    const H = [{ path: fH, t: nameH }];
    const V = [{ path: fV, t: nameV }];
    const oldT0 = Math.max(Math.min(...H.map((x) => x.t)), Math.min(...V.map((x) => x.t)));
    eq(oldT0 === nameH, 'the name-stamp anchor opens at the session stamp');
    eq(rowV >= oldT0 + 12 * 3600000, 'and the late stream sits OUTSIDE the window it opened — the defect');
    const w = windowFor(H, V, firstRowMs);
    eq(w.t0 === rowV, 'the row anchor opens at the LATER of the two streams first rows');
    eq(rowV >= w.t0 && rowV < w.t1, 'so the late stream row now sits inside the window');
    eq(rowH < w.t0, 'and the early stream is bounded by the late one, which is what "both live" means');
    eq(w.onRow === 2 && w.onName === 0, 'both sides report anchoring on a row');

    const wFallback = windowFor([{ path: fC, t: nameH }], V, firstRowMs);
    eq(wFallback.onName === 1 && wFallback.onRow === 1, 'a file with no parseable row keeps its NAME stamp and is COUNTED');
    eq(wFallback.t0 === rowV, 'and it does not move a window the other side bounds');

    const wNone = windowFor([{ path: fC, t: Number.NaN }], V, firstRowMs);
    eq(wNone.t0 === null, 'a side with no readable start at all reads null, so the caller can refuse the night');
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  console.log(`all ${n} selftests passed`);
  process.exit(0);
}

/* THE SWALLOW THAT WAS HERE: the `catch` returned the accumulator, so a subdirectory present and
   unreadable contributed nothing and left no trace — an unreadable tree and an empty one read the
   same, which is ∅. Both are still walked past rather than refused, because one unreadable
   subdirectory is reduced coverage over a corpus of many; what changes is that the walk now NAMES
   which directories it could not read, and the population line below carries the count. */
const walk = (d, out = [], unreadable = []) => {
  let ents = [];
  try {
    ents = readdirSync(d, { withFileTypes: true });
  } catch (e) {
    unreadable.push(`${d}: ${e.code || e.message}`);
    return out;
  }
  for (const e of ents) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out, unreadable);
    else out.push({ name: e.name, path: p });
  }
  return out;
};
/* The walk publishes what it walked. The lister reads the ROOT with no `catch`, so an unreadable
   `--src` reaches `snapshotEntries` as a named errno and refuses — the existence guard above answers
   ENOENT only. Members are paths relative to the root, because two subdirectories may hold one
   filename and a bare name would collapse them into one member. */
const unreadableDirs = [];
let srcEntries = [];
const listCaptureFiles = (root) => {
  readdirSync(String(root));
  unreadableDirs.length = 0;
  srcEntries = walk(String(root), [], unreadableDirs);
  return srcEntries.map((e) => e.path.slice(String(root).length).replace(/^[/\\]/, ''));
};
const POP = { list: listCaptureFiles, unit: 'files' };
const popBefore = snapshotEntries(SRC, POP);
if (!popBefore.ok) {
  console.error(`wearable-sync: ${popBefore.reason} — ${SRC}`);
  process.exit(2);
}
const index = {};
const refusedStamps = [];
for (const { name, path } of srcEntries) {
  const t = stampMs(name);
  if (t === null) continue;
  if (t === false) {
    refusedStamps.push(name);
    continue;
  }
  const dev = IS_H10.test(name) ? 'H10' : IS_VER.test(name) ? 'VER' : null;
  if (!dev) continue;
  const k = nightOf(t);
  (index[k] ||= { H10: [], VER: [] })[dev].push({ path, t });
}

if (refusedStamps.length) {
  const shown = [...refusedStamps].sort().slice(0, 6);
  console.log(
    `refused ${refusedStamps.length} ACC file(s) whose filename stamp field is not a readable time (DexClock.fileStamp): ${shown.join(', ')}` +
      (refusedStamps.length > 6 ? ` … +${refusedStamps.length - 6} more` : '') +
      '\n'
  );
}

/* Bin tri-axial ACC onto a uniform grid as MEAN ABSOLUTE SAMPLE-TO-SAMPLE CHANGE.
   The differencing removes gravity and posture before any resampling, so a device
   lying at a different tilt cannot contribute a constant that survives binning. A
   slot no sample reached stays NaN — never 0, which the correlator would read as
   "measured stillness" rather than "not measured". */
function gridMotion(files, t0, t1, fs) {
  const n = Math.floor(((t1 - t0) / 1000) * fs);
  if (n <= 0) return null;
  const sum = new Float64Array(n),
    cnt = new Float64Array(n);
  for (const { path } of files) {
    let txt;
    try {
      txt = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const lines = txt.split('\n');
    if (lines.length < 10) continue;
    const head = lines[0].split(';').map((s) => s.trim().toLowerCase());
    const ix = ['x', 'y', 'z'].map((c) => head.findIndex((h) => h.startsWith(c)));
    if (ix.some((v) => v < 0)) continue;
    let px = null,
      py = 0,
      pz = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(';');
      if (c.length < 4) continue;
      const m = ISO.exec(c[0]);
      if (!m) continue;
      const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
      const x = +c[ix[0]],
        y = +c[ix[1]],
        z = +c[ix[2]];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      if (px != null && ms >= t0 && ms < t1) {
        const b = Math.floor(((ms - t0) / 1000) * fs);
        if (b >= 0 && b < n) {
          sum[b] += Math.abs(x - px) + Math.abs(y - py) + Math.abs(z - pz);
          cnt[b]++;
        }
      }
      px = x;
      py = y;
      pz = z;
    }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = cnt[i] ? Math.log1p(sum[i] / cnt[i]) : NaN;
  return out;
}

/* Already-measured nights, so a daily run is incremental. Only nights that were
   actually MEASURED are skipped: a night that failed for want of shared movement
   is retried, because the raw data may since have grown (a late session sync), and
   silently inheriting an old failure is how a blind spot becomes permanent. */
let prior = [];
if (SKIP_EXISTING && JSON_OUT && existsSync(JSON_OUT)) {
  try {
    prior = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    console.error(`wearable-sync: ${JSON_OUT} is unreadable — measuring everything rather than trusting it`);
    prior = [];
  }
}
const done = new Set(prior.filter((r) => r && r.confident).map((r) => r.night));
const keys = Object.keys(index)
  .filter((k) => (!ONLY || k === ONLY) && index[k].H10.length && index[k].VER.length && !done.has(k))
  .sort();
const population = populationVerdict(popBefore, snapshotEntries(SRC, POP), {
  tool: 'tools/wearable-sync.mjs',
  evidence: ['tools/wearable-sync.mjs']
});
console.log(
  `population: ${population.population.checked} file(s) walked under ${SRC}` +
    (unreadableDirs.length ? `, ${unreadableDirs.length} subdirectory/ies unreadable (${unreadableDirs.slice(0, 3).join('; ')})` : '') +
    `; ${Object.keys(index).length} night(s) carry an ACC stamp and ${keys.length} are measured here.`
);
console.log(
  `the remainder is named, not dropped: ${refusedStamps.length} refused stamp(s)` +
    (ONLY ? `, --night ${ONLY} selects one night` : '') +
    (done.size ? `, ${done.size} already measured` : '') +
    ', and a night without BOTH devices cannot be paired.'
);
console.log(`POPULATION ${JSON.stringify(population)}`);
if (done.size) console.log(`skipping ${done.size} night(s) already measured in ${JSON_OUT}\n`);
if (!keys.length) {
  /* "Nothing left to do" is SUCCESS, not failure. On a daily timer the second run
     of the day has nothing new, and exiting non-zero there would cry wolf every
     day until the alert is ignored — which is how a real failure gets missed. */
  if (done.size) {
    console.log(`nothing new — all ${done.size} night(s) already measured in ${JSON_OUT}`);
    process.exit(0);
  }
  console.error(`wearable-sync: no night under ${SRC} has BOTH an H10 and a Verity ACC file`);
  process.exit(1);
}
console.log(`wearable-sync — H10 vs Verity, ${keys.length} night(s), ${WIN}s windows / ${HOP}s hop / +/-${MAXLAG}s search @ ${FS_HZ} Hz\n`);
/* `drift(ppm)` prints a dash unless the slope is IDENTIFIABLE (§F7), and `spread` rides beside MAD
   because MAD alone reports 0.00 on a quantised plateau while two windows sit 1.2 s away. Same rule as
   the trio printer: a number does not appear without the thing that bounds it. */
console.log('night        H10 VER   span   offset(s)  drift(ppm)  usable  medR   MAD spread  verdict');
const rows = [];
for (const k of keys) {
  const g = index[k];
  /* The window anchors on each stream's FIRST DATA ROW, not on its filename stamp — see `firstRowMs`.
     A night where neither side offers a readable start is REPORTED, not skipped silently. */
  const w = windowFor(g.H10, g.VER, firstRowMs);
  if (w.t0 === null) {
    console.log(`${k}  — no readable start on one of the streams (no first row and no filename stamp)`);
    continue;
  }
  const { t0, t1 } = w;
  if (w.onName) console.log(`${k}  — ${w.onName} file(s) carry no parseable first row and keep their filename stamp`);
  const A = gridMotion(g.H10, t0, t1, FS_HZ),
    B = gridMotion(g.VER, t0, t1, FS_HZ);
  if (!A || !B) {
    console.log(`${k}  — could not grid one of the streams`);
    continue;
  }
  const r = DSP.alignEnvelopes(A, B, FS_HZ, { windowSec: WIN, hopSec: HOP, maxLagSec: MAXLAG, nullIters: 20 });
  const span = (Math.min(A.length, B.length) / FS_HZ / 3600).toFixed(2);
  const row = { night: k, nH10: g.H10.length, nVer: g.VER.length, spanH: +span, anchor: { t0, onRow: w.onRow, onName: w.onName }, ...r };
  delete row.windows; // the per-window detail is for --json, not the console
  rows.push({ ...row, windows: r.windows });
  console.log(
    `${k} ${String(g.H10.length).padStart(4)}${String(g.VER.length).padStart(4)} ${span.padStart(6)} h` +
      (r.offsetSec == null
        ? '        —          —        —     —      —   '
        : `${r.offsetSec.toFixed(2).padStart(10)}${(r.driftPpm == null ? '—' : r.driftPpm.toFixed(1)).padStart(12)}${(r.nUsable + '/' + r.nWindows).padStart(8)}${(r.medR == null ? '—' : r.medR.toFixed(2)).padStart(7)}${(r.madSec == null ? '—' : r.madSec.toFixed(2)).padStart(6)}${(r.lagSpreadSec == null ? '—' : r.lagSpreadSec.toFixed(2)).padStart(7)}  `) +
      (r.confident ? 'MEASURED' : `— ${(r.reason || '').slice(0, 52)}`)
  );
}
const ok = rows.filter((r) => r.confident);
console.log(`\n${ok.length} of ${rows.length} night(s) measured.`);
if (ok.length) {
  const L = ok.map((r) => r.offsetSec).sort((a, b) => a - b);
  const med = L[L.length >> 1];
  console.log(`offset: median ${med.toFixed(2)} s   range ${L[0].toFixed(2)} … ${L[L.length - 1].toFixed(2)} s`);
  console.log(`|offset| > 1 s on ${ok.filter((r) => Math.abs(r.offsetSec) > 1).length} of ${ok.length} measured night(s)`);
  const D2 = ok
    .filter((r) => r.driftPpm != null)
    .map((r) => r.driftPpm)
    .sort((a, b) => a - b);
  /* The drift summary reports how many nights it could NOT resolve, first. A median over the survivors
     alone is a selected statistic — the earlier version quoted one across nights where 7 of 14 were an
     atom at exactly 0.0 ppm, which reads as agreement and is a quantisation artefact (§F7). */
  const nRefused = ok.length - D2.length;
  if (D2.length)
    console.log(`drift : median ${D2[D2.length >> 1].toFixed(1)} ppm   range ${D2[0].toFixed(1)} … ${D2[D2.length - 1].toFixed(1)} ppm   (over the ${D2.length} night(s) where it is identifiable)`);
  if (nRefused)
    console.log(
      `drift : NOT IDENTIFIABLE on ${nRefused} of ${ok.length} measured night(s) — the slope's 95% interval spans zero, or its median is a quantised-lag tie block. Those nights have an offset and no drift, which is the honest pair.`
    );
  /* A wearable offset above a second is not a rounding detail: it is larger than every physiological
     latency this suite measures between these two devices, so it corrupts any cross-device timing
     before the physiology is even reached. Say so rather than printing a number and moving on. */
  const bad = ok.filter((r) => Math.abs(r.offsetSec) > 1);
  if (bad.length)
    console.log(
      `\n⚠ ${bad.length} night(s) exceed 1 s — larger than the cross-device physiological latencies measured on this corpus, so any cross-device timing on those nights carries it as a bias.`
    );
}
if (JSON_OUT) {
  // Merge, never overwrite: a daily run must not drop the nights it skipped.
  const merged = prior.filter((r) => r && !rows.some((n) => n.night === r.night)).concat(rows);
  merged.sort((a, b) => (a.night < b.night ? -1 : 1));
  writeFileSync(JSON_OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nper-window detail → ${JSON_OUT}`);
}
