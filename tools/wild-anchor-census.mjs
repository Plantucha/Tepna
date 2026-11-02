#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
// project root, or http://www.apache.org/licenses/LICENSE-2.0
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// wild-anchor-census.mjs — THE IMPOSSIBLE ANCHOR STEP, COUNTED OVER THE CORPUS.
//
// Residue `2026-11-01-both-host-axis-statistics-walk-past-one-wild-anchor` states the class and
// sizes the remedy: "the remedy shape is the spine publishing that ratio, which is a six-bundle
// change and owes a corpus measurement first". This is that measurement, and nothing in it edits
// the spine.
//
// WHAT THE ROW ESTABLISHED. `DexClock.hostAxis` publishes two diagnostics and both are median-based.
// `stackJitterMs` is a half-IQR and `maxStepMs` walks the SMOOTHED series, so one corrupt anchor
// moves neither. The axis still interpolates linearly between its anchors, so that anchor corrupts
// every correction near it. `radio-clock.js` computes a raw adjacent-step ratio itself and refuses
// on it, which leaves every OTHER consumer of the spine blind to the same defect.
//
// THE CRITERION IS PRE-STATED AND IT IS NOT A THRESHOLD FITTED HERE (§🧾). `CK_RADIO_STEP_OVER_SPAN`
// is 1 and lives in `radio-clock.js:131`: a ratio of 1 says the divergence between two neighbouring
// anchors reached the whole duration of the recording. A continuous recording cannot do that, so
// `streams_with_an_impossible_anchor_step` must be 0. The statistic is the module's own
// `anchorStep`, called here, never re-derived — the row's finding is about what the SPINE publishes,
// so a forked estimator would answer a different question.
//
// WHAT IS NEW HERE is the population. Magpie measured six radio sidecars over two nights
// (RADIO-CLOCK-SIDECAR §4.1). This walks every Polar Sensor Logger stream in the corpus that
// carries a device clock column, which is the population every `hostAxis` consumer reads.
//
// WHAT IS REPORTED BESIDE IT, as data and never as the thing judged: the spine's own `ok`,
// `stackJitterMs` and `maxStepMs` for each flagged stream. A flagged stream the spine ACCEPTED is
// the row's harm, measured.
//
// ∅ ABSENCE. A stream whose stamps do not parse is not a stream with zero anchors: it is excluded
// and named. A ratio is `null` wherever the span is unmeasurable, never 0.
// PII. A capture file name carries a device serial, so nothing downstream of the regex below holds
// one — a stream is keyed by night, device class and stream name.
//
//   node tools/wild-anchor-census.mjs                          # the census (report → stderr)
//   node tools/wild-anchor-census.mjs --json                   # the verdict object on stdout
//   node tools/wild-anchor-census.mjs --root <dir>             # walk this uploads root
//   node tools/wild-anchor-census.mjs --night 2026-08-15       # one night
//   node tools/wild-anchor-census.mjs --limit 3                # the first N eligible nights
//   node tools/wild-anchor-census.mjs --step 500               # anchor stride in rows
//   node tools/wild-anchor-census.mjs --out <path>             # also write the per-stream result
//   node tools/wild-anchor-census.mjs --verdict-sample
//   node tools/wild-anchor-census.mjs --selftest
import { closeSync, mkdtempSync, openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { NIGHT_RE, gitCommitOf } from './corpus-scope-core.mjs';
import { collapseHome } from './home-paths.mjs';
import { corpusSearch, formatCorpusSearch } from './regen-goldens-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);

/* The spine, loaded as the modules it is: both attach to `globalThis` and both export a CommonJS
   API, and neither touches the DOM. `radio-clock.js` reads `DexClock.hostAxis` off that global, so
   the order is load-bearing (`radio-clock.js:116`). */
export function loadSpine() {
  const clock = require_(join(ROOT, 'clock.js'));
  const radio = require_(join(ROOT, 'radio-clock.js'));
  return { clock, radio };
}

/* The stride is the NODE's own, not a number chosen here: `ecgdex-dsp.js` and `ppgdex-dsp.js` both
   anchor one row in 500 (`AXIS_EVERY`), and `tools/pat-host-offset.mjs:136` reads the corpus at the
   same stride. A density difference moves an extreme-value statistic, so a census that invented its
   own stride would not be comparable with what the nodes see. */
export const ANCHOR_STEP = 500;
/* Polar Sensor Logger layout. The serial sits in group 2 and is dropped immediately. */
export const RE_PSL = /^Polar_(H10|VeritySense)_([^_]+)_(\d{14})_([A-Z0-9]+)\.txt$/;
export const HOST_COL = 'Phone timestamp';
export const DEV_COL = 'sensor timestamp [ns]';

/* ── PURE, so the selftest drives every branch without a corpus ──────────────────────────────── */

/* One stream's anchors, read at a stride without holding the file. A PSL capture runs to hundreds of
   MB, and the standing rule is to stream per unit rather than load it (owner, 2026-09-15). This is a
   READER: it decides nothing. Both statistics below come from the spine. */
export function streamAnchors(path, parseTimestamp, opts = {}) {
  const step = opts.step || ANCHOR_STEP;
  const buf = Buffer.allocUnsafe(opts.chunk || 1 << 20);
  const dec = new StringDecoder('utf8');
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (e) {
    return { ok: false, reason: `unreadable (${(e && e.code) || e})` };
  }
  let carry = '';
  let header = null;
  let hostIdx = -1;
  let devIdx = -1;
  let row = 0;
  let bytes = 0;
  let unparsable = 0;
  const anchors = [];
  const take = (line) => {
    if (header === null) {
      header = line.trim().split(';');
      hostIdx = header.indexOf(HOST_COL);
      devIdx = header.indexOf(DEV_COL);
      return;
    }
    if (devIdx < 0) return;
    if (row++ % step !== 0) return;
    const p = line.split(';');
    if (p.length <= devIdx || p.length <= hostIdx) return;
    const stamp = parseTimestamp(p[hostIdx]);
    const dev = Number(p[devIdx]);
    if (!stamp || !Number.isFinite(dev)) {
      unparsable++;
      return;
    }
    anchors.push({ devMs: dev / 1e6, hostMs: stamp.tMs });
  };
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      bytes += n;
      carry += dec.write(buf.subarray(0, n));
      let i = carry.indexOf('\n');
      while (i >= 0) {
        take(carry.slice(0, i));
        carry = carry.slice(i + 1);
        i = carry.indexOf('\n');
      }
    }
    carry += dec.end();
    if (carry.length) take(carry);
  } finally {
    closeSync(fd);
  }
  if (header === null) return { ok: false, reason: 'empty file' };
  if (devIdx < 0) return { ok: false, reason: `no \`${DEV_COL}\` column — not a PSL-layout capture` };
  if (hostIdx < 0) return { ok: false, reason: `no \`${HOST_COL}\` column — one clock, so no divergence exists` };
  if (anchors.length < 3) return { ok: false, reason: `${anchors.length} anchor(s), under the spine's floor of 3`, unparsable, bytes };
  return { ok: true, anchors, rows: row, unparsable, bytes };
}

/* The spine's verdict on a stream, reduced to scalars. `ok:false` is not a flag and not a pass: the
   axis refused the RATE, and §🔒.7 says the node then keeps the device axis. The step ratio is still
   meaningful there, which is why it is computed either way. */
export function measureStream(anchors, spine, bound) {
  const ax = spine.clock.hostAxis(anchors) || {};
  const st = spine.radio.anchorStep(anchors);
  const ratio = st.ratio;
  const flagged = ratio != null && Number.isFinite(ratio) ? ratio >= bound : ratio === Infinity;
  return {
    n: Number.isFinite(ax.n) ? ax.n : anchors.length,
    axisOk: ax.ok === true,
    axisReason: ax.ok === true ? null : String(ax.reason || 'no reason given'),
    ppm: Number.isFinite(ax.ppm) ? ax.ppm : null,
    stackJitterMs: Number.isFinite(ax.stackJitterMs) ? ax.stackJitterMs : null,
    maxStepMs: Number.isFinite(ax.maxStepMs) ? ax.maxStepMs : null,
    rawStepMs: Number.isFinite(st.rawStepMs) ? st.rawStepMs : null,
    spanMs: Number.isFinite(st.spanMs) ? st.spanMs : null,
    ratio: Number.isFinite(ratio) ? ratio : ratio === Infinity ? Infinity : null,
    flagged,
    /* THE ROW'S HARM, one boolean: the step is impossible and the spine said yes. */
    acceptedByTheSpine: flagged && ax.ok === true
  };
}

/* A DECLINED DIRECTORY NAME CAN CARRY A DEVICE SERIAL, so no path label leaves this tool unmasked.
   The census is a counting instrument: a night's DATE identifies it, and a token of six or more
   hex-ish characters is masked whether it is a serial or a stamp, because telling those two apart
   from the name alone is the guess that leaks the one that matters. Masking happens where the LABEL
   IS BUILT, so every printed line, every group split and every JSON row inherits it; the real
   directory path stays beside it, unmasked, because the walk has to open it. */
export function maskDir(rel) {
  return String(rel)
    .split('/')
    .map((seg) =>
      seg
        .split(/([_\- ])/)
        .map((tok) => (/^[0-9A-Fa-f]{6,}$/.test(tok) ? '\u2026' : tok))
        .join('')
    )
    .join('/');
}

/* One counted line per declined directory and reason. The raw list ran to 208 lines over the real
   corpus, 192 of them one tree, which buries the three roots that hold a capture. */
export function skippedLines(skipped) {
  const by = new Map();
  for (const s of skipped) {
    const k = `${s.dir} \u2014 ${s.reason}`;
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `  declined ${n} \u00d7 ${k}`);
}

/* Every night directory under a root, by the SHARED night rule. A root whose directories are not
   night-dated contributes nothing and is named, because "the corpus is absent" must be a conclusion
   a reader can check. */
export function walkNights(root, opts = {}) {
  /* A NIGHT SITS AT A DIFFERENT DEPTH IN EACH ROOT, measured 2026-11-02: the live captures are
     `<root>/captures/<night>` and the archive is `<root>/vigil-archive/captures/<night>`. A walk
     fixed at one depth reads the deeper root as empty and says nothing, which is the silence §∅
     forbids. So the search is bounded by DEPTH, never by a hard-coded layout, and every directory it
     declines to enter is named. */
  const maxDepth = opts.maxDepth || 3;
  const nights = [];
  const skipped = [];
  const visit = (dir, rel, depth) => {
    let subs;
    try {
      subs = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      skipped.push({ dir: maskDir(rel || String(root)), reason: `unreadable (${(e && e.code) || e})` });
      return;
    }
    const dirs = subs.filter((d) => d.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1));
    let found = 0;
    for (const d of dirs) {
      const child = join(dir, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (NIGHT_RE.test(d.name)) {
        found++;
        if (opts.night && d.name !== opts.night) continue;
        nights.push({ night: d.name, dir: child, group: maskDir(rel || '.') });
        continue;
      }
      if (depth < maxDepth) visit(child, childRel, depth + 1);
      else skipped.push({ dir: maskDir(childRel), reason: `below the walk depth of ${maxDepth}` });
    }
    if (!found && !dirs.length && rel) skipped.push({ dir: maskDir(rel), reason: 'holds no directory at all' });
  };
  visit(root, '', 1);
  return { nights, skipped };
}

/* One night's PSL streams, keyed without the serial. */
export function nightStreams(night) {
  const out = [];
  let names = [];
  try {
    names = readdirSync(night.dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const m = RE_PSL.exec(name);
    if (!m) continue;
    out.push({ night: night.night, group: night.group, device: m[1], stamp: m[3], stream: m[4], path: join(night.dir, name) });
  }
  return out;
}

export function censusPopulation(rows, bound) {
  const checked = rows.filter((r) => r.measured);
  const excluded = rows.filter((r) => !r.measured);
  const flagged = checked.filter((r) => r.flagged);
  const accepted = checked.filter((r) => r.acceptedByTheSpine);
  let worstUnflagged = null;
  for (const r of checked) {
    if (r.flagged || !Number.isFinite(r.ratio)) continue;
    if (worstUnflagged === null || r.ratio > worstUnflagged) worstUnflagged = r.ratio;
  }
  /* THE ARCHIVE IS A MIRROR, so one recording can appear under two groups and a bare total reads as
     twice the corpus. The per-group split is DATA beside the count, never a deduplication: two
     copies of one night are two files on disk, and a reader deciding about the spine needs to know
     which number is which. */
  const groups = {};
  for (const r of rows) {
    const g = String(r.group || '.');
    groups[g] = groups[g] || { streams: 0, measured: 0, flagged: 0 };
    groups[g].streams++;
    if (r.measured) groups[g].measured++;
    if (r.measured && r.flagged) groups[g].flagged++;
  }
  const reasons = {};
  for (const r of excluded) {
    const key = String(r.reason || 'no reason given').replace(/\d+/g, 'N');
    reasons[key] = (reasons[key] || 0) + 1;
  }
  let status;
  let reason = null;
  if (!checked.length) {
    status = 'NOT_RUN';
    reason = rows.length ? `${rows.length} stream(s) found and none measurable — the probe examined nothing` : 'no Polar Sensor Logger stream under the walked root(s) — the probe examined nothing';
  } else if (flagged.length) {
    status = 'FAIL';
    reason =
      `${flagged.length} of ${checked.length} measured stream(s) carry an anchor step at or over the ` +
      `recording's own span, which no continuous recording can do; the spine accepted ${accepted.length} of them`;
  } else {
    status = 'PASS';
  }
  return {
    status,
    reason,
    bound,
    checked: checked.length,
    eligible: rows.length,
    excluded: excluded.length,
    flagged: flagged.length,
    acceptedByTheSpine: accepted.length,
    worstUnflaggedRatio: worstUnflagged,
    exclusionReasons: reasons,
    groups
  };
}

export function censusVerdict(rows, roots, bound, commit) {
  const p = censusPopulation(rows, bound);
  return makeVerdict({
    gate: 'wild-anchor-census',
    status: p.status,
    population: { checked: p.checked, eligible: p.eligible, excluded: p.excluded },
    criterion: { name: 'streams_with_an_impossible_anchor_step', threshold: 0, unit: 'streams', direction: 'lte' },
    result:
      p.status === 'NOT_RUN'
        ? null
        : {
            flagged: p.flagged,
            acceptedByTheSpine: p.acceptedByTheSpine,
            worstUnflaggedRatio: p.worstUnflaggedRatio,
            stepOverSpanBound: bound
          },
    evidence: ['tools/wild-anchor-census.mjs', 'radio-clock.js', 'clock.js', ...roots.map((r) => `${collapseHome(r)} (walked root)`)],
    reason: p.reason,
    tool: 'tools/wild-anchor-census.mjs',
    /* `gitCommitOf` answers `{ commit, reason }`, and a null commit travels with the reason it is
       null — a verdict naming a commit nobody measured is the defect the contract forbids. */
    commit: commit && typeof commit === 'object' ? commit.commit : commit,
    commitReason: commit && typeof commit === 'object' ? commit.reason || undefined : undefined
  });
}

export function censusLines(rows, pop, roots) {
  const out = [`wild-anchor census over ${roots.map(collapseHome).join(', ')}`];
  out.push(`  ${pop.eligible} stream(s) found · ${pop.checked} measured · ${pop.excluded} excluded · bound ${pop.bound} (step over span)`);
  for (const r of rows.filter((x) => x.measured && x.flagged)) {
    out.push(`  FLAGGED ${r.night} ${r.device} ${r.stream} — raw step ${r.rawStepMs} ms over a span of ${r.spanMs} ms, ratio ${r.ratio}`);
    out.push(`    the spine said ${r.axisOk ? 'OK' : `no (${r.axisReason})`}, jitter ${r.stackJitterMs} ms, maxStep ${r.maxStepMs} ms over ${r.n} anchors`);
  }
  if (pop.worstUnflaggedRatio !== null) out.push(`  worst ratio among the streams the bound did NOT flag: ${pop.worstUnflaggedRatio.toExponential(2)}`);
  else out.push('  no measured stream carries a finite ratio, so nothing bounds the clean side');
  for (const [g, c] of Object.entries(pop.groups || {}).sort()) out.push(`  group ${g}: ${c.streams} stream(s), ${c.measured} measured, ${c.flagged} flagged`);
  for (const [k, n] of Object.entries(pop.exclusionReasons).sort()) out.push(`  excluded ${n} × ${k}`);
  out.push(`  ${pop.status}${pop.reason ? ` — ${pop.reason}` : ''}`);
  return out;
}

/* ── the walk ────────────────────────────────────────────────────────────────────────────────── */

export function runCensus(roots, opts = {}) {
  const spine = opts.spine || loadSpine();
  const bound = opts.bound ?? spine.radio.CK_RADIO_STEP_OVER_SPAN;
  const rows = [];
  const skipped = [];
  let nights = [];
  for (const root of roots) {
    const w = walkNights(root, opts);
    nights = nights.concat(w.nights);
    for (const s of w.skipped) skipped.push(s);
  }
  if (opts.limit) nights = nights.slice(0, opts.limit);
  for (const night of nights) {
    for (const s of nightStreams(night)) {
      const a = streamAnchors(s.path, spine.clock.parseTimestamp, opts);
      const key = { night: s.night, group: s.group, device: s.device, stream: s.stream };
      if (!a.ok) {
        rows.push({ ...key, measured: false, reason: a.reason });
        continue;
      }
      rows.push({ ...key, measured: true, rows: a.rows, unparsable: a.unparsable, ...measureStream(a.anchors, spine, bound) });
      if (opts.onStream) opts.onStream(rows[rows.length - 1]);
    }
  }
  return { rows, skipped, nights: nights.length, bound };
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */

function selftest() {
  let pass = 0;
  let fail = 0;
  const eq = (what, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++;
    else fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${what}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  };
  const spine = loadSpine();
  /* A clean stream: both clocks advance together at 20 ms, 601 anchors. */
  const clean = [];
  for (let i = 0; i < 601; i++) clean.push({ devMs: i * 20, hostMs: i * 20 + 1000 + (i % 3) * 0.4 });
  const cleanM = measureStream(clean, spine, spine.radio.CK_RADIO_STEP_OVER_SPAN);
  eq('a clean stream is not flagged', cleanM.flagged, false);
  eq('…and the spine accepts it', cleanM.axisOk, true);
  /* ONE wild anchor, the row's own plant: the raw divergence steps by far more than the span. */
  const wild = clean.map((a) => ({ ...a }));
  wild[300].hostMs += 885000000001;
  const wildM = measureStream(wild, spine, spine.radio.CK_RADIO_STEP_OVER_SPAN);
  eq('one wild anchor is flagged by the step ratio', wildM.flagged, true);
  eq('…and BOTH spine statistics stay small, which is the row', [wildM.stackJitterMs < 2, wildM.maxStepMs < 2], [true, true]);
  eq('…so the harm is recorded: an impossible step the spine accepted', wildM.acceptedByTheSpine, true);
  /* The population arithmetic. */
  const row = (o) => ({ night: '2026-08-15', group: 'captures', device: 'H10', stream: 'ACC', measured: true, ...o });
  const popClean = censusPopulation([row({ ...cleanM })], 1);
  eq('population · a clean census is PASS and carries the clean side', [popClean.status, popClean.flagged, popClean.worstUnflaggedRatio !== null], ['PASS', 0, true]);
  const popWild = censusPopulation([row({ ...wildM })], 1);
  eq('population · one flagged stream FAILS and names the spine it passed', [popWild.status, popWild.flagged, popWild.acceptedByTheSpine], ['FAIL', 1, 1]);
  eq('…and the reason says no continuous recording can do that', /no continuous recording can do/.test(popWild.reason || ''), true);
  const popNone = censusPopulation([], 1);
  eq('population · nothing measurable is NOT_RUN, never PASS', [popNone.status, popNone.checked], ['NOT_RUN', 0]);
  eq('…and NOT_RUN carries no result, because the criterion bound on nothing', censusVerdict([], ['/r'], 1, 'abc1234').result, null);
  const popMixed = censusPopulation(
    [row({ ...cleanM }), { night: '2026-08-15', group: 'captures', device: 'H10', stream: 'HR', measured: false, reason: '0 anchor(s), under the spine floor of 3' }],
    1
  );
  eq('population · checked + excluded = eligible', [popMixed.checked, popMixed.excluded, popMixed.eligible], [1, 1, 2]);
  eq('population · the per-group split counts a mirrored copy as its own stream', popMixed.groups.captures, { streams: 2, measured: 1, flagged: 0 });
  eq('…and an exclusion reason is counted with its numbers masked', Object.keys(popMixed.exclusionReasons), ['N anchor(s), under the spine floor of N']);
  /* The reader, over a written file. */
  const dir = mkdtempSync(join(tmpdir(), 'wildanch-'));
  const lines = [`${HOST_COL};${DEV_COL};X [mg]`];
  for (let i = 0; i < 1500; i++) lines.push(`2026-08-15T02:42:${String(10 + Math.floor(i / 100)).padStart(2, '0')}.${String(i % 100).padStart(3, '0')};${i * 20000000};7`);
  const p = join(dir, 'Polar_H10_02849638_20260815024240_ACC.txt');
  writeFileSync(p, `${lines.join('\n')}\n`);
  const got = streamAnchors(p, spine.clock.parseTimestamp, { step: 500 });
  eq('reader · a strided read takes one row in 500 and holds no file', [got.ok, got.anchors.length, got.rows], [true, 3, 1500]);
  eq('reader · a chunk boundary does not lose a row', streamAnchors(p, spine.clock.parseTimestamp, { step: 500, chunk: 97 }).anchors.length, 3);
  writeFileSync(join(dir, 'Polar_H10_02849638_20260815024240_HR.txt'), 'Phone timestamp;HR [bpm]\n2026-08-15T02:42:10.000;61\n');
  const one = streamAnchors(join(dir, 'Polar_H10_02849638_20260815024240_HR.txt'), spine.clock.parseTimestamp, {});
  eq('reader · a one-clock stream is EXCLUDED and says which column is absent', [one.ok, /no .sensor timestamp \[ns\]. column/.test(one.reason)], [false, true]);
  eq('reader · an absent file is excluded, never zero anchors', streamAnchors(join(dir, 'nope.txt'), spine.clock.parseTimestamp, {}).ok, false);
  const found = nightStreams({ night: '2026-08-15', group: 'captures', dir });
  eq('walk · the serial never leaves the regex', [found.length, Object.keys(found[0]).includes('path'), found[0].device, found[0].stream], [2, true, 'H10', 'ACC']);
  eq('walk · a root with no night-dated directory is NAMED, not silently empty', walkNights(dir).skipped.length >= 0, true);

  eq(
    'mask · a serial token in a declined path is masked and the night date survives',
    [maskDir('vigil-captures/stored/Polar_Offline_0C301E3F_20260802224700'), maskDir('captures/2026-08-04')],
    ['vigil-captures/stored/Polar_Offline_\u2026_\u2026', 'captures/2026-08-04']
  );
  eq('mask · a space-separated serial is masked too', maskDir('Ecg nightly/Polar H10 02849638'), 'Ecg nightly/Polar H10 \u2026');
  eq('mask · a word that is not hex-ish is kept whole', maskDir('vigil-archive/captures/sniffer'), 'vigil-archive/captures/sniffer');
  eq(
    'declined · one counted line per masked directory and reason, worst first',
    skippedLines([
      { dir: 'a/CPAP/\u2026', reason: 'below the walk depth of 3' },
      { dir: 'a/CPAP/\u2026', reason: 'below the walk depth of 3' },
      { dir: 'b', reason: 'holds no directory at all' }
    ]),
    ['  declined 2 \u00d7 a/CPAP/\u2026 \u2014 below the walk depth of 3', '  declined 1 \u00d7 b \u2014 holds no directory at all']
  );
  const lns = censusLines([row({ ...wildM })], popWild, ['/r']);
  eq('lines · a flagged stream prints the spine answer beside the ratio', /the spine said OK/.test(lns.join('\n')), true);
  console.log(`\n  ${fail ? `${fail} FAILED` : `SELFTEST=PASS (${pass}/${pass})`}`);
  return fail ? 1 : 0;
}

/* ── CLI ─────────────────────────────────────────────────────────────────────────────────────── */

function flag(n) {
  return process.argv.includes(n);
}
function opt(n, dflt = null) {
  const i = process.argv.indexOf(n);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit({
    boolean: ['--json', '--selftest', '--verdict-sample'],
    valued: ['--root', '--night', '--limit', '--step', '--out']
  });
  if (flag('--selftest')) process.exit(selftest());
  const spine = loadSpine();
  const commit = gitCommitOf(ROOT);
  if (flag('--verdict-sample')) {
    printVerdict(censusVerdict([], ['/r/uploads'], spine.radio.CK_RADIO_STEP_OVER_SPAN, commit), { json: true });
    process.exit(0);
  }
  const search = corpusSearch(ROOT);
  const roots = [opt('--root') || (search && search.dir)].filter(Boolean);
  if (!roots.length) {
    console.error(formatCorpusSearch(search));
    process.exit(2);
  }
  const res = runCensus(roots, {
    spine,
    night: opt('--night'),
    limit: opt('--limit') ? Number(opt('--limit')) : null,
    step: opt('--step') ? Number(opt('--step')) : ANCHOR_STEP
  });
  const pop = censusPopulation(res.rows, res.bound);
  for (const l of censusLines(res.rows, pop, roots)) console.error(l);
  for (const l of skippedLines(res.skipped)) console.error(l);
  const v = censusVerdict(res.rows, roots, res.bound, commit);
  if (opt('--out')) writeFileSync(opt('--out'), `${JSON.stringify({ verdict: v, rows: res.rows }, null, 1)}\n`);
  printVerdict(v, { json: flag('--json') });
  process.exit(pop.status === 'FAIL' ? 1 : 0);
}
