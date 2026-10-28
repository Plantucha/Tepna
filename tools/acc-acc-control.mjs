/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * acc-acc-control.mjs — the CALIBRATION CONTROL for wide-range clock alignment.
 *
 * Backs CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF §2c. It exists because a negative
 * result from an uncalibrated instrument is not evidence: an attempt to fit the
 * CPAP's clock by aligning its flow signal against body movement came back
 * negative, and this asks whether the METHOD could have found the answer at all.
 *
 * The pair is chosen so the answer is already known. The capture host writes Polar
 * H10 chest ACC and Polar Verity arm ACC through one daemon on ONE clock, so their
 * true offset is 0 by construction — while remaining two different sensors at two
 * different body sites, correlated only through real movement. That is the same
 * problem shape as ACC-vs-flow, with a known answer. (ACC against itself would
 * only test the arithmetic.)
 *
 * Legs, and the decision each carries:
 *   COARSE@0    the wide-search parameters, true offset 0     — recovers ~0?
 *   COARSE@±I   same, with a known offset planted in device B — recovers I?
 *   FINE@0      PATAlign's own DEFAULTS (50 ms / ±1.6 s)      — does it work at all?
 *
 *   COARSE legs pass          -> instrument sound -> a negative elsewhere is REAL.
 *   FINE passes, COARSE fails -> parameters blind -> that negative is VOID.
 *
 * The injection leg is scored as recovered(I) − recovered(0), a self-consistency
 * check that needs no knowledge of the sign convention.
 *
 * MEASURED (13 nights, 2026-07-16 → 07-28): FINE 13/13 at 0.00 min; COARSE
 * recovers a planted −39 min on 1/13, attenuated to −14.3. Cause: a ±50 min search
 * at 250 ms bins scores 24,001 candidate lags against a ±15 s (121-bin) window, so
 * the chance-maximum correlation ≈ 0.41 exceeds the minCorr 0.35 gate — the gate is
 * inoperative and the peak is noise. Lengthening the window restores it monotonically
 * (±60 s → −27.3, 3/13; ±240 s → −31.4, 6/13) but never converges.
 *
 * Usage:  node tools/acc-acc-control.mjs [repoRoot] [corpusRoot]
 *         WH=<ms> to override the coarse correlation half-window (default 15000).
 * Read-only: parses recordings, writes nothing.
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

import { fileURLToPath } from 'node:url';
import { printVerdict, undeclaredVerdict, verdictSample } from './verdict-undeclared.mjs';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';
import { capturesRoot } from './home-paths.mjs';

/* REPO defaults to THIS FILE's own repo root, never to an absolute path.
   It used to default to `/run/media/…/Tepna`, and that is worse than a crash: run from a WORKTREE the
   tool silently loaded `build-core.js` and every DSP from the MAIN checkout, so it measured a different
   tree's code and reported the answer as if it were this one's. Several sessions work this repo in
   parallel worktrees (CLAUDE.md §👥), which is exactly the "spent an hour debugging another session's
   in-flight clock.js" failure that section exists to prevent — here it would be silent, because the
   tool runs fine and just answers about the wrong code. Two sibling tools carried the same class of
   defect as a hard constant and were dead outright (PR #686); this one ran, which is why it survived.
   An explicit argv[2] still overrides, for pointing it at another checkout ON PURPOSE. */
const SELF_REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The two positionals below already decline a `-` token, which means a mistyped flag silently
   selects the DEFAULT repo and root rather than the ones the operator named. Refuse it instead. */
/* The refusal must fire for the CLI ONLY. `process.argv` belongs to whoever is running, so a
   module-level refusal reads the IMPORTER's arguments — measured: the suite's `--jobs=auto`
   reached dual-clock-rate's guard through `await import()` and reded step 14 of 40. */
const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) refuseUnknownArgvOrExit(process.argv.slice(2), { boolean: ['--verdict-sample', '--selftest', '--help', '-h'], positional: true }, { tool: 'acc-acc-control' });
const argRepo = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const REPO = argRepo || SELF_REPO;
const argRoot = process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : null;
const ROOT = argRoot || capturesRoot();
/* VERDICT-CONTRACT §3b — this tool never pre-stated a band (its numbers are on record), so its object
   is UNKNOWN by design with the statistic in `result`; `--verdict-sample` is what the adoption gate reads. */
if (process.argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample('tools/acc-acc-control.mjs'), null, 1));
  process.exit(0);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: node tools/acc-acc-control.mjs [<repo-root>] [<captures-dir>]');
  console.log("  repo-root defaults to this tool's own checkout; captures-dir to $DEX_CAPTURES.");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const DexBuild = require(path.join(REPO, 'tools/build-core.js'));

function realm() {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, contains: () => false },
    setAttribute: noop,
    appendChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop
  });
  const ctx = vm.createContext({
    console,
    document: { getElementById: () => null, createElement: el, head: el(), body: el(), documentElement: el(), addEventListener: noop, querySelectorAll: () => [] },
    setTimeout,
    clearTimeout
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.addEventListener = noop;
  for (const f of ['clock.js', 'kernel-constants.js', 'dex-export.js', 'ppgdex-dsp.js', 'pat-align.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(REPO, f), 'utf8')), ctx, { filename: f });
  return ctx;
}
const _REALM = realm();
const PA = _REALM.PATAlign;
/* THE FILENAME STAMP HAS ONE OWNER — `DexClock.fileStamp` (clock.js:255; Clock Contract §4, anchor
   source 2), off the realm this tool already loads `clock.js` into. */
const CK = _REALM.DexClock;
if (!CK || typeof CK.fileStamp !== 'function') throw new Error('acc-acc-control: DexClock.fileStamp did not load into the realm');

/* flow-vs-acc.mjs's exact settings, and PATAlign's own defaults. */
const COARSE = { dtMs: 250, windowHalfMs: Number(process.env.WH || 15000), maxLagMs: 3000000, minCorr: 0.35, anchorMinGapMs: 60000 };
const FINE = { dtMs: 50, windowHalfMs: 1600, maxLagMs: 1600, minCorr: 0.6, anchorMinGapMs: 3000 };
const INJECT = [0, -39 * 60000, 17.5 * 60000]; // 0, the CPAP's known −39 min, and a +17.5 min linearity check

/* Clock Contract: regex the explicit format, never new Date(str). Capture-host ACC carries a
   no-zone ISO phone timestamp (rule 3) -> components verbatim through Date.UTC. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;
function isoMs(s) {
  const m = ISO.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
}

/* One ACC file -> {t: Float64Array (absolute floating ms), v: Float32Array (|xyz| in mg)}.
 *
 * COLUMNS ARE READ FROM THE HEADER, NOT ASSUMED. The capture host changed this file's schema mid-
 * corpus: through 2026-07-18 it wrote
 *     Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]
 * and from 2026-07-21 it dropped the relative column entirely
 *     Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]
 * A fixed-index parser silently yields ZERO rows on the newer layout — which it did, and which is why
 * the first run of this control saw only 2 of 13 nights. Never index these columns positionally.
 *
 * Timebase: the first row's phone timestamp anchors the file (Clock Contract rule 3, no-zone ISO ->
 * Date.UTC of the components as written), and the per-row offset comes from the `sensor timestamp
 * [ns]` delta, which is present in BOTH layouts. Verified equal to the retired `timestamp [ms]`
 * column to all printed digits (671185.348986 ms both ways). The ns values (~6e17) exceed
 * MAX_SAFE_INTEGER, so a float64 delta carries ~128 ns of error — 4 orders of magnitude below the
 * finest bin used here (50 ms), so it is parsed as Number deliberately rather than BigInt per row. */
function parseACC(file) {
  const txt = fs.readFileSync(file, 'utf8');
  let p = txt.indexOf('\n');
  if (p < 0) return null;
  const hdr = txt
    .slice(0, p)
    .replace(/\r$/, '')
    .split(';')
    .map((h) => h.trim());
  const iNs = hdr.findIndex((h) => /^sensor timestamp/i.test(h));
  const iX = hdr.findIndex((h) => /^X\b/i.test(h));
  const iY = hdr.findIndex((h) => /^Y\b/i.test(h));
  const iZ = hdr.findIndex((h) => /^Z\b/i.test(h));
  if (iNs < 0 || iX < 0 || iY < 0 || iZ < 0) return null;
  const need = Math.max(iNs, iX, iY, iZ);
  let q = txt.indexOf('\n', p + 1);
  if (q < 0) return null;
  const t0 = isoMs(txt.slice(p + 1, q));
  if (t0 == null) return null;

  // count rows to size the arrays exactly
  let rows = 1;
  for (let i = p + 1; i < txt.length; i++) if (txt.charCodeAt(i) === 10) rows++;
  const T = new Float64Array(rows),
    V = new Float32Array(rows);
  let n = 0,
    i0 = p + 1,
    ns0 = NaN;
  while (i0 < txt.length && n < rows) {
    let i1 = txt.indexOf('\n', i0);
    if (i1 < 0) i1 = txt.length;
    let f = 0,
      s = i0,
      ns = NaN,
      x = NaN,
      y = NaN,
      z = NaN;
    for (let i = i0; i <= i1; i++) {
      if (i === i1 || txt.charCodeAt(i) === 59) {
        if (f === iNs) ns = +txt.slice(s, i);
        else if (f === iX) x = +txt.slice(s, i);
        else if (f === iY) y = +txt.slice(s, i);
        else if (f === iZ) z = +txt.slice(s, i);
        f++;
        s = i + 1;
      }
    }
    if (f > need && isFinite(ns) && isFinite(x) && isFinite(y) && isFinite(z)) {
      if (!isFinite(ns0)) ns0 = ns;
      T[n] = t0 + (ns - ns0) / 1e6;
      V[n] = Math.sqrt(x * x + y * y + z * z);
      n++;
    }
    i0 = i1 + 1;
  }
  return n ? { t: T.subarray(0, n), v: V.subarray(0, n) } : null;
}

/* All of one device's fragments for one night, stitched and time-ordered. */
function stitch(files) {
  const parts = [];
  let tot = 0;
  for (const f of files) {
    const a = parseACC(f);
    if (a) {
      parts.push(a);
      tot += a.t.length;
    }
  }
  if (!tot) return null;
  parts.sort((a, b) => a.t[0] - b.t[0]);
  const T = new Float64Array(tot),
    V = new Float32Array(tot);
  let n = 0;
  for (const a of parts) {
    T.set(a.t, n);
    V.set(a.v, n);
    n += a.t.length;
  }
  return { t: T, v: V };
}

/* PA.envelope wants an indexable of {tMs, v}. Materialise only the grid span, with an optional shift
   applied to the timeline (the injected offset). */
function envOf(s, t0, t1, shiftMs, opts) {
  const out = [];
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i] + shiftMs;
    if (t >= t0 && t <= t1) out.push({ tMs: t, v: s.v[i] });
  }
  return out.length >= 20 ? PA.envelope(out, t0, t1, opts) : null;
}

const med = (a) => {
  const b = a.slice().sort((x, y) => x - y);
  return b.length ? b[b.length >> 1] : NaN;
};

/* --- `--selftest`: the parser, the stitch and the FINE leg against synthetic ACC with a known answer.
   It writes two layouts of one stream into a scratch dir, so it needs no corpus. */
if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) {
  let pass = 0;
  let fail = 0;
  const ok = (cond, name) => {
    if (cond) pass++;
    else {
      fail++;
      console.log('  ✗ ' + name);
    }
  };
  // a seeded LCG, so the known answer is the same on every machine
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const HZ = 50;
  const N = 30 * 60 * HZ; // 30 min
  const move = new Float64Array(N);
  for (let s = 0; s < N; ) {
    s += Math.floor((8 + rnd() * 20) * HZ); // a movement every 8–28 s
    const len = Math.floor((1 + rnd() * 2) * HZ);
    const amp = 100 + rnd() * 400;
    for (let i = 0; i < len && s + i < N; i++) move[s + i] = amp * Math.sin((Math.PI * i) / len);
  }
  const T0 = Date.UTC(2026, 6, 16, 23, 0, 0);
  const NS0 = 599000000000000000;
  const stream = (gain, noise) => {
    const z = new Float64Array(N);
    for (let i = 0; i < N; i++) z[i] = 1000 + gain * move[i] + noise * (rnd() - 0.5);
    return z;
  };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
  const write = (file, z, i0, i1, layout) => {
    const head = layout === 'old' ? 'Phone timestamp;sensor timestamp [ns];timestamp [ms];X [mg];Y [mg];Z [mg]' : 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]';
    const rows = [head];
    for (let i = i0; i < i1; i++) {
      const ms = (i * 1000) / HZ;
      const cells = [iso(T0 + ms), String(NS0 + Math.round(ms * 1e6))];
      if (layout === 'old') cells.push(ms.toFixed(3));
      cells.push('0', '0', z[i].toFixed(3));
      rows.push(cells.join(';'));
    }
    fs.writeFileSync(file, rows.join('\n') + '\n');
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-acc-selftest-'));
  try {
    const zA = stream(1, 20);
    const zB = stream(0.6, 20);
    const f = (n) => path.join(dir, n);
    write(f('a-old.txt'), zA, 0, N, 'old');
    write(f('a-new.txt'), zA, 0, N, 'new');
    // device B in two fragments; the stitch must order them by time, not by argument order
    write(f('b-2.txt'), zB, N / 2, N, 'new');
    write(f('b-1.txt'), zB, 0, N / 2, 'new');
    fs.writeFileSync(f('no-z.txt'), 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg]\n2026-07-16 23:00:00.000;1;0;0\n');
    fs.writeFileSync(f('bad-stamp.txt'), 'Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]\n16/07/2026 23:00:00;1;0;0;1000\n');

    const pOld = parseACC(f('a-old.txt'));
    const pNew = parseACC(f('a-new.txt'));
    ok(pOld && pOld.t.length === N, `the six-column layout parses every row (got ${pOld && pOld.t.length}, want ${N})`);
    ok(pNew && pNew.t.length === N, `the five-column layout parses every row (got ${pNew && pNew.t.length}, want ${N})`);
    let same = pOld && pNew;
    for (let i = 0; same && i < N; i += 997) same = pOld.t[i] === pNew.t[i] && pOld.v[i] === pNew.v[i];
    ok(same, 'both layouts give the same samples');
    ok(pNew && pNew.t[0] === T0, `the first phone stamp anchors the file (got ${pNew && pNew.t[0]}, want ${T0})`);
    ok(pNew && Math.abs(pNew.t[N - 1] - T0 - ((N - 1) * 1000) / HZ) < 0.001, 'the sensor ns delta carries the timebase');
    ok(pNew && Math.abs(pNew.v[7] - Math.abs(zA[7])) < 0.01, 'v is the |xyz| magnitude');
    ok(parseACC(f('no-z.txt')) === null, 'a header without a Z column parses to null');
    ok(parseACC(f('bad-stamp.txt')) === null, 'a first row with no ISO stamp parses to null');
    ok(isoMs('2026-07-16 23:00:00.5') === T0 + 500, 'isoMs reads a fraction as milliseconds');

    const A = stitch([f('a-new.txt')]);
    const B = stitch([f('b-2.txt'), f('b-1.txt')]);
    let mono = B && B.t.length === N;
    for (let i = 1; mono && i < N; i++) mono = B.t[i] > B.t[i - 1];
    ok(mono, 'stitch orders two fragments by time');
    ok(stitch([f('no-z.txt')]) === null, 'stitch over no parseable fragment is null');

    // the FINE leg: true offset 0 recovers ~0; a planted +800 ms recovers |Δ| ≈ 800 ms
    const ov0 = Math.max(A.t[0], B.t[0]);
    const ov1 = Math.min(A.t[N - 1], B.t[N - 1]);
    const envA = envOf(A, ov0, ov1, 0, FINE);
    const r0 = PA.alignByAnchors(envA, envOf(B, ov0, ov1, 0, FINE), ov0, FINE);
    const m0 = r0.ok ? med(r0.anchors.map((a) => a.offsetMs)) : NaN;
    ok(r0.ok && Math.abs(m0) <= 100, `FINE recovers the true offset 0 (got ${r0.ok ? m0 + ' ms' : r0.reason})`);
    const r8 = PA.alignByAnchors(envA, envOf(B, ov0, ov1, 800, FINE), ov0, FINE);
    const m8 = r8.ok ? med(r8.anchors.map((a) => a.offsetMs)) : NaN;
    ok(r8.ok && Math.abs(Math.abs(m8 - m0) - 800) <= 100, `FINE recovers a planted 800 ms (got ${r8.ok ? m8 - m0 + ' ms' : r8.reason})`);
    // an unrelated movement stream: no clean shared movement, so no alignment
    const zC = new Float64Array(N);
    for (let i = 0; i < N; i++) zC[i] = 1000 + 20 * (rnd() - 0.5);
    write(f('c.txt'), zC, 0, N, 'new');
    const rc = PA.alignByAnchors(envA, envOf(stitch([f('c.txt')]), ov0, ov1, 0, FINE), ov0, FINE);
    ok(!rc.ok, `a stream with no movement does not align (got ${rc.ok ? 'ok' : rc.reason})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  /* ── THE FILENAME STAMP OWNER — the night key comes from `DexClock.fileStamp` ──────────────────
     Residue 2026-10-27-five-filename-stamp-time-readers-slice-the-digits-without-an-owner. Both
     halves per leg: the name this tool always accepted still buckets to the SAME night, and the
     impossible twin refuses rather than rolling onto a real one. Measured before the delegation:
     `20260725_256100` (hour 25) rolled to 2026-07-26T02:01 and was STITCHED INTO the 2026-07-25
     night as a second fragment — `1+2` where the names say `1+1` — so the cost was a corrupted
     control figure, not a lost night. */
  const nightOfStamp = (s) => {
    const got = CK.fileStamp(s);
    return got ? new Date(got.tMs - 12 * 3600e3).toISOString().slice(0, 10) : null;
  };
  ok(nightOfStamp('20260725_225058') === '2026-07-25', 'stamp: the PSL split layout buckets to its night');
  ok(nightOfStamp('20260725225058') === '2026-07-25', 'stamp: the capture-host contiguous layout buckets to the SAME night');
  ok(nightOfStamp('20260726_015058') === '2026-07-25', 'stamp: a post-midnight start still belongs to the evening that opened it');
  ok(nightOfStamp('20261332_225058') === null, 'stamp: month 13 refuses (a bare Date.UTC keyed 2027-02-01)');
  ok(nightOfStamp('20260725_256100') === null, 'stamp: hour 25 refuses (a bare Date.UTC stitched it into 2026-07-25)');
  ok(nightOfStamp('20260725_230000') === '2026-07-25', 'stamp: hour 23 is ACCEPTED — kills a `h >= 23` guard');
  ok(nightOfStamp('202607252250581') === null, 'stamp: a 15-digit run refuses rather than taking its first fourteen digits');
  ok(nightOfStamp('99999999_225058') === null, 'stamp: an all-nines date refuses (a bare Date.UTC keyed year 10007)');
  if (fail) {
    console.log(`acc-acc-control selftest: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`all ${pass} selftests passed`);
  process.exit(0);
}

/* --- inventory: night -> device -> fragment list --- */
/* THE WALK IS THE POPULATION RULE, so the lister carries a name the snapshot can publish. The bare
   `catch { return o }` that stood here read an unreadable directory as an empty one at EVERY level:
   an unreadable ROOT scored zero fragments and said nothing, and an unreadable SUBDIRECTORY left no
   trace at all, so a partly readable tree and a whole one printed the same inventory (§∅ — an
   absent root is not a zero). The root read now has no `catch`, and a subdirectory nobody can read
   is named and counted beside the figure. */
const unreadableDirs = [];
let capturePaths = [];
const listCaptureFragments = (root) => {
  const base = String(root);
  fs.readdirSync(base);
  unreadableDirs.length = 0;
  capturePaths = [];
  const walk = (d) => {
    let e;
    try {
      e = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      unreadableDirs.push(`${path.relative(base, d) || '.'}: ${err.code || err.message}`);
      return;
    }
    for (const x of e) {
      const q = path.join(d, x.name);
      if (x.isDirectory()) walk(q);
      else capturePaths.push(q);
    }
  };
  walk(base);
  return capturePaths.map((q) => path.relative(base, q));
};
const POP = { list: listCaptureFragments, unit: 'capture-files' };
const popBefore = snapshotEntries(ROOT, POP);
if (!popBefore.ok) {
  console.error(`\u2715 acc-acc-control: ${popBefore.reason} — ${ROOT}`);
  process.exit(2);
}
const nights = new Map();
// Names whose stamp field the owner refused — counted and named, never dropped silently.
const refusedStamps = [];
let accMatched = 0;
for (const f of capturePaths) {
  const b = path.basename(f);
  const h10 = /^Polar_H10_[0-9A-Fa-f]+_(\d{8}_?\d{6})_ACC\.txt$/.exec(b);
  const ver = h10 ? null : /^Polar_(?:VeritySense|Sense)_[0-9A-Fa-f]+_(\d{8}_?\d{6})_ACC\.txt$/.exec(b);
  const m = h10 || ver;
  if (!m) continue;
  accMatched++;
  const dev = h10 ? 'h10' : 'ver';
  /* PSL writes the stamp as YYYYMMDD_HHMMSS (underscore inside); the capture host writes 14
     contiguous digits. The regex above accepts both — the spelling fix alone matched 0 PSL files,
     because the stamp shape was a SECOND, independent blindness that only the 0->54 control
     exposed — and the OWNER reads either layout, so the positional slices that stood here are gone.
     They fed a bare `Date.UTC`, which rolls an out-of-range component onto a real instant: a
     month-13 stamp read as the following February and still produced a night key. The owner
     range-validates through `parseTimestamp` and requires a year in [1990, 2099], so it returns
     null, and a null is refused by name rather than anchored (§∅). */
  const got = CK.fileStamp(m[1]);
  if (!got) {
    refusedStamps.push(b);
    continue;
  }
  const night = new Date(got.tMs - 12 * 3600e3).toISOString().slice(0, 10); // noon-to-noon
  if (!nights.has(night)) nights.set(night, { h10: [], ver: [] });
  nights.get(night)[dev].push(f);
}

if (refusedStamps.length) {
  const shown = [...refusedStamps].sort().slice(0, 6);
  console.log(
    `\n  refused ${refusedStamps.length} ACC file(s) whose filename stamp field is not a readable time (DexClock.fileStamp): ${shown.join(', ')}` +
      (refusedStamps.length > 6 ? ` … +${refusedStamps.length - 6} more` : '')
  );
}

console.log('\nACC↔ACC CONTROL — H10 chest vs Verity arm, one host clock, TRUE OFFSET = 0');
console.log(`  COARSE (flow-vs-acc params): ${COARSE.dtMs} ms bins · ±${COARSE.windowHalfMs / 1000} s window · ±${COARSE.maxLagMs / 60000} min search · minCorr ${COARSE.minCorr}`);
console.log(`  FINE   (PATAlign DEFAULTS):  ${FINE.dtMs} ms bins · ±${FINE.windowHalfMs} ms window · ±${FINE.maxLagMs} ms search · minCorr ${FINE.minCorr}`);
/* THE OFFER BESIDE THE READ. The ACC filename patterns are a SELECTION over the files the walk
   offered, never the walk's rule, so the unmatched remainder is named rather than implied. */
const population = populationVerdict(popBefore, snapshotEntries(ROOT, POP), {
  tool: 'tools/acc-acc-control.mjs',
  evidence: ['tools/acc-acc-control.mjs']
});
console.log(
  `  population: ${population.population.checked} capture file(s) offered under ${ROOT}` +
    `; ${accMatched} matched an H10 or Verity _ACC.txt name, ${population.population.checked - accMatched} did not` +
    `; ${nights.size} night(s) keyed` +
    (unreadableDirs.length ? `; ${unreadableDirs.length} unreadable subdirectory(ies): ${unreadableDirs.join(', ')}` : '')
);
console.log(`POPULATION ${JSON.stringify(population)}`);

const res = [];
let skipped = 0; // nights with both streams that did not parse or did not overlap — the verdict's `excluded`
for (const [night, d] of [...nights].sort()) {
  if (!d.h10.length || !d.ver.length) continue;
  const A = stitch(d.h10),
    B = stitch(d.ver);
  if (!A || !B) {
    console.log(`  ${night}  UNPARSED — h10 ${A ? A.t.length : 0} rows / ver ${B ? B.t.length : 0} rows (${d.h10.length}+${d.ver.length} fragments)`);
    skipped++;
    continue;
  }
  const ov0 = Math.max(A.t[0], B.t[0]),
    ov1 = Math.min(A.t[A.t.length - 1], B.t[B.t.length - 1]);
  const ovMin = (ov1 - ov0) / 60000;
  if (!(ovMin > 30)) {
    console.log(`  ${night}  overlap only ${ovMin.toFixed(0)} min — skipped`);
    skipped++;
    continue;
  }

  const row = { night, ovMin, legs: {} };
  for (const [tag, opts] of [
    ['COARSE', COARSE],
    ['FINE', FINE]
  ]) {
    const envA = envOf(A, ov0, ov1, 0, opts);
    for (const inj of tag === 'COARSE' ? INJECT : [0]) {
      const envB = envOf(B, ov0, ov1, inj, opts);
      let r = { ok: false, reason: 'no envelope' };
      if (envA && envB) r = PA.alignByAnchors(envA, envB, ov0, opts);
      const key = `${tag}@${(inj / 60000).toFixed(1)}`;
      if (r.ok) {
        const offs = r.anchors.map((a) => a.offsetMs / 60000).sort((a, b) => a - b);
        row.legs[key] = { ok: true, n: r.anchors.length, cand: r.candidates, med: med(offs), lo: offs[0], hi: offs[offs.length - 1] };
      } else row.legs[key] = { ok: false, why: r.reason, cand: r.candidates };
    }
  }
  res.push(row);

  const F = (k) => {
    const L = row.legs[k];
    if (!L) return '        -   ';
    if (!L.ok) return `  ${(L.why || '').slice(0, 22).padEnd(22)}`;
    return `${L.med.toFixed(2).padStart(8)} (${L.n}/${L.cand}) [${L.lo.toFixed(1)}..${L.hi.toFixed(1)}]`;
  };
  console.log(`  ${night} ov=${row.ovMin.toFixed(0).padStart(4)}m  C@0 ${F('COARSE@0.0')}  C@-39 ${F('COARSE@-39.0')}  C@+17.5 ${F('COARSE@17.5')}  FINE ${F('FINE@0.0')}`);
}

/* --- verdict --- */
console.log('\n===== VERDICT =====');
function leg(key, label, expectDelta) {
  const ok = res.map((r) => r.legs[key]).filter((L) => L && L.ok);
  if (!ok.length) {
    console.log(`  ${label.padEnd(26)} 0/${res.length} nights aligned at all`);
    return;
  }
  const meds = ok.map((L) => L.med);
  const spread = ok.map((L) => L.hi - L.lo);
  let extra = '';
  if (expectDelta != null) {
    // self-consistency: recovered(I) - recovered(0) should equal ±I
    const pairs = res.filter((r) => r.legs[key] && r.legs[key].ok && r.legs['COARSE@0.0'] && r.legs['COARSE@0.0'].ok);
    const d = pairs.map((r) => r.legs[key].med - r.legs['COARSE@0.0'].med);
    const hit = d.filter((x) => Math.abs(Math.abs(x) - Math.abs(expectDelta)) <= 5).length;
    extra = ` · Δ vs @0 median ${med(d).toFixed(2)} min (want ±${Math.abs(expectDelta)}) · recovered ${hit}/${pairs.length}`;
  } else {
    const hit = meds.filter((x) => Math.abs(x) <= 5).length;
    extra = ` · within ±5 min of the true 0: ${hit}/${ok.length}`;
  }
  console.log(`  ${label.padEnd(26)} ${ok.length}/${res.length} aligned · median offset ${med(meds).toFixed(2)} min · median anchor spread ${med(spread).toFixed(1)} min${extra}`);
}
leg('COARSE@0.0', 'COARSE @ true 0', null);
leg('COARSE@-39.0', 'COARSE @ injected -39', -39);
leg('COARSE@17.5', 'COARSE @ injected +17.5', 17.5);
leg('FINE@0.0', 'FINE @ true 0', null);

/* The object — UNKNOWN with the four legs' statistics carried verbatim (the VERDICT banner above is
   explanation; the object is the API). Population = nights that parsed and overlapped. */
{
  const legStat = (key) => {
    const ok = res.map((r) => r.legs[key]).filter((L) => L && L.ok);
    return {
      aligned: ok.length,
      of: res.length,
      medianOffsetMin: ok.length ? +med(ok.map((L) => L.med)).toFixed(2) : null,
      medianAnchorSpreadMin: ok.length ? +med(ok.map((L) => L.hi - L.lo)).toFixed(1) : null
    };
  };
  printVerdict(
    undeclaredVerdict({
      tool: 'tools/acc-acc-control.mjs',
      stat: {
        label: 'ACC↔ACC alignment recovery per leg (offset min, anchor spread min)',
        legs: { coarse0: legStat('COARSE@0.0'), coarseMinus39: legStat('COARSE@-39.0'), coarsePlus17_5: legStat('COARSE@17.5'), fine0: legStat('FINE@0.0') }
      },
      population: { checked: res.length, eligible: res.length + skipped },
      evidence: [ROOT + '/**/*_ACC.txt']
    })
  );
}
