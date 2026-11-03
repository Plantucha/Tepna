#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// WHAT THE BOX'S SEAM SIDECAR FOUND, AND ON WHAT POPULATION IT LOOKED.
//
// `_SeamSidecar` (capture-host/writers.py) writes `<base>SEAMS.txt` beside every stream it scans, and
// its own docstring says why nothing consumes it yet: "EMITTED, NOT ENFORCED (owner decision
// 2026-09-16) … consumption is a separate unit precisely so the emission can be proven on real
// nights before any `computeHash` moves." This tool is that proof, or its refusal. It reads the
// sidecars the corpus already holds and answers one pre-stated question before any node is wired.
//
// THE POPULATION IS THE WHOLE QUESTION. The sidecar judges the interval between the previous sample
// and this one, so a writer session that starts fresh stores its first sample and judges nothing.
// That is right on a first connect and wrong on a reconnect, where the previous sample is the last
// row of the file this instance appends to. Measured 2026-09-21 on the owner's H10 night: the device
// clock stepped at the FIRST row of session 2, the file carried 178 `# final … seams=0` lines and 0
// seam rows, and 177 of 177 boundaries went unexamined. `examined` was true and reported on the
// wrong population.
//
// The arithmetic decides it per file, with no guess. A stream of `samples` rows scanned by `S` writer
// sessions holds `samples - 1` adjacent intervals in all. A sidecar that examines every boundary
// reports `sum(examined) == samples - 1`; one that skips every boundary reports `samples - S`. The
// difference IS the number of boundaries that reached an examined population, and the criterion is
// that none is left out.
//
// §∅: a file whose companion stream is absent or unreadable is EXCLUDED by name. It is never counted
// as a file with zero unexamined boundaries, because a sidecar we could not place against its stream
// has told us nothing about its population.

import { spawnSync } from 'node:child_process';
import { existsSync, openSync, readSync, closeSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { collapseHome } from './home-paths.mjs';

const BOUND_DEFAULT_MS = 60000;

// `fix(capture-host): a resumed seam sidecar examines the reconnect boundary` (#2902, 8f19897eb,
// 2026-09-22). Before it, a resumed sidecar stored its first sample and judged nothing, so EVERY
// reconnect boundary of an earlier night sits outside every examined population. Captured bytes are
// immutable, so no re-run repairs one — the criterion therefore binds on the nights recorded SINCE,
// and the earlier nights are reported beside it as the history they are.
const SEED_FIX_DAY = '2026-09-22';

/** The capture day, from the 14-digit stamp the filename carries, else the file's own mtime. */
function captureDay(path) {
  const m = basename(path).match(/(20\d{2})(\d{2})(\d{2})\d{6}/);
  if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, source: 'filename-stamp' };
  try {
    const d = new Date(statSync(path).mtimeMs);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { day: iso, source: 'mtime' };
  } catch {
    return { day: null, source: null };
  }
}

/**
 * Every `*SEAMS.txt` under `root`, found by `find` so a deep corpus tree costs one process.
 *
 * §4b: `find` exits non-zero when any part of the tree went unread, and it still prints everything
 * it did reach. Discarding that output turns a census of an UNKNOWN population into a census of no
 * population, reported as a clean one — so the rows are kept and the partial walk is named instead.
 */
function findSidecars(root) {
  const r = spawnSync('find', [root, '-name', '*SEAMS.txt', '-type', 'f'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26
  });
  const files = String(r.stdout || '')
    .split('\n')
    .filter(Boolean)
    .sort();
  const partial = r.status !== 0;
  return {
    files,
    partial,
    reason: partial ? `the walk exited ${r.status === null ? 'on a signal' : r.status}, so part of this tree went unread` : null
  };
}

/** Newline count of `path`, streamed in fixed chunks so a 3-million-row stream costs no memory. */
function countLines(path) {
  const CHUNK = 1 << 20;
  const buf = Buffer.allocUnsafe(CHUNK);
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  let lines = 0;
  let lastByte = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 10) lines++;
      lastByte = buf[n - 1];
    }
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
  // A final row with no trailing newline is still a row.
  if (lastByte !== 10 && lines > 0) lines++;
  else if (lines === 0 && statSync(path).size > 0) lines = 1;
  return lines;
}

/** The leading comment and header lines of a capture stream, which are not samples. */
function headerLines(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  const buf = Buffer.allocUnsafe(1 << 14);
  let n = 0;
  try {
    n = readSync(fd, buf, 0, buf.length, 0);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
  const head = buf.slice(0, n).toString('utf8').split('\n');
  let k = 0;
  for (const line of head) {
    if (line.startsWith('#')) {
      k++;
      continue;
    }
    // One column header, recognised by carrying no digit-led first field.
    if (k === head.length) break;
    if (/^[A-Za-z_]/.test(line)) k++;
    break;
  }
  return k;
}

/** Parse one sidecar: its header, its `# final` sessions and its seam rows. */
function readSidecar(path) {
  const r = spawnSync('cat', [path], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) return null;
  const out = {
    stream: null,
    boundMs: null,
    sessions: [],
    seamRows: 0,
    maxStepMs: 0,
    maxStepAt: null,
    malformed: 0
  };
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# stream=')) {
      out.stream = (line.match(/stream=([^\s]+)/) || [])[1] ?? null;
      const b = line.match(/bound_ms=(\d+)/);
      out.boundMs = b ? Number(b[1]) : null;
      continue;
    }
    if (line.startsWith('# final')) {
      const se = line.match(/seams=(\d+)/);
      const ex = line.match(/examined=(\d+)/);
      if (!se || !ex) {
        out.malformed++;
        continue;
      }
      out.sessions.push({ seams: Number(se[1]), examined: Number(ex[1]) });
      continue;
    }
    if (line.startsWith('#') || line.startsWith('phone_ts')) continue;
    const f = line.split(';');
    if (f.length < 7) {
      out.malformed++;
      continue;
    }
    out.seamRows++;
    const step = Math.abs(Number(f[2]));
    if (Number.isFinite(step) && step > out.maxStepMs) {
      out.maxStepMs = step;
      out.maxStepAt = f[0] || null;
    }
  }
  return out;
}

/** The capture stream a sidecar annotates: `<base>SEAMS.txt` sits beside `<base>.txt`. */
function companionOf(path) {
  const b = basename(path);
  if (!b.endsWith('SEAMS.txt')) return null;
  return join(dirname(path), `${b.slice(0, -'SEAMS.txt'.length)}.txt`);
}

/** The stream kind, taken from the sidecar's own name, so an unparsed header costs nothing. */
function kindOf(path) {
  const m = basename(path).match(/_([A-Z0-9]+)SEAMS\.txt$/);
  return m ? m[1] : 'unknown';
}

/** One per stream kind. `null` maxima, because a maximum over no seam row is not 0 (§∅). */
function newKind() {
  return {
    files: 0,
    filesSinceFix: 0,
    sessions: 0,
    seams: 0,
    examined: 0,
    boundaries: 0,
    boundariesExamined: 0,
    boundariesSinceFix: 0,
    boundariesExaminedSinceFix: 0,
    maxStepMs: null,
    unplaceable: 0
  };
}

/**
 * The census over every `*SEAMS.txt` under `dirs`. Returns the report lines and the verdict rather
 * than printing either, so the selftest below drives every branch over a planted tree.
 */
function census(dirs) {
  const files = [];
  // A named root that does not exist, or one `find` could not walk in full, is NAMED. Skipping it
  // silently would let a typo read as a clean corpus with nothing to answer for.
  const rootStates = [];
  for (const d of dirs) {
    if (!existsSync(d)) {
      rootStates.push({ root: collapseHome(d), state: 'absent', reason: 'the named root does not exist' });
      continue;
    }
    const w = findSidecars(d);
    rootStates.push({
      root: collapseHome(d),
      state: w.partial ? 'partial' : 'read',
      reason: w.reason
    });
    for (const f of w.files) files.push(f);
  }
  const rootsUnread = rootStates.filter((r) => r.state !== 'read').length;

  const byKind = new Map();
  const excluded = [];
  let checked = 0;
  let sessions = 0;
  let seamRows = 0;
  let examined = 0;
  let boundaries = 0;
  let boundariesExamined = 0;
  let maxStepMs = 0;
  let maxStepKind = null;
  let maxStepAt = null;
  let filesWithSeam = 0;
  let malformed = 0;
  let unplaceable = 0;
  let datedByMtime = 0;
  let filesSinceFix = 0;
  let boundariesSinceFix = 0;
  let boundariesExaminedSinceFix = 0;

  for (const path of files) {
    const kind = kindOf(path);
    const sc = readSidecar(path);
    if (!sc || sc.sessions.length === 0) {
      excluded.push({ kind, reason: sc ? 'no `# final` session line' : 'unreadable sidecar' });
      continue;
    }
    const comp = companionOf(path);
    const compLines = comp && existsSync(comp) ? countLines(comp) : null;
    if (compLines === null) {
      excluded.push({ kind, reason: 'the companion stream is absent or unreadable' });
      continue;
    }
    const hdr = headerLines(comp);
    if (hdr === null) {
      excluded.push({ kind, reason: 'the companion stream header could not be read' });
      continue;
    }
    const samples = compLines - hdr;
    const S = sc.sessions.length;
    const ex = sc.sessions.reduce((a, s) => a + s.examined, 0);
    const sm = sc.sessions.reduce((a, s) => a + s.seams, 0);
    // samples - S intervals when every boundary is skipped; samples - 1 when none is.
    const bExamined = ex - (samples - S);
    const b = S - 1;

    // §∅: a count outside [samples - S, samples - 1] means the sidecar and the stream do not count
    // ONE population, so this file says nothing about its boundaries and is excluded by name rather
    // than clamped into the tally. Measured on HR: the sidecar feeds on every notification while the
    // writer drops rows, so `examined` can exceed the intervals the file holds.
    if (bExamined < 0 || bExamined > b) {
      unplaceable++;
      excluded.push({
        kind,
        reason: `the sidecar examined ${ex} interval(s) where the stream holds ${Math.max(0, samples - 1)}, so the two do not count one population`
      });
      const ko = byKind.get(kind) ?? newKind();
      ko.unplaceable++;
      byKind.set(kind, ko);
      continue;
    }

    const cap = captureDay(path);
    const sinceFix = cap.day !== null && cap.day >= SEED_FIX_DAY;
    if (cap.source === 'mtime') datedByMtime++;

    checked++;
    sessions += S;
    examined += ex;
    seamRows += sc.seamRows;
    boundaries += b;
    boundariesExamined += bExamined;
    if (sinceFix) {
      filesSinceFix++;
      boundariesSinceFix += b;
      boundariesExaminedSinceFix += bExamined;
    }
    malformed += sc.malformed;
    if (sm > 0 || sc.seamRows > 0) filesWithSeam++;
    if (sc.maxStepMs > maxStepMs) {
      maxStepMs = sc.maxStepMs;
      maxStepKind = kind;
      maxStepAt = sc.maxStepAt;
    }

    const k = byKind.get(kind) ?? newKind();
    k.files++;
    k.sessions += S;
    k.seams += sc.seamRows;
    k.examined += ex;
    k.boundaries += b;
    k.boundariesExamined += bExamined;
    if (sc.maxStepMs > (k.maxStepMs ?? 0)) k.maxStepMs = sc.maxStepMs;
    if (sinceFix) {
      k.filesSinceFix++;
      k.boundariesSinceFix += b;
      k.boundariesExaminedSinceFix += bExamined;
    }
    byKind.set(kind, k);
  }

  const unexamined = boundaries - boundariesExamined;
  const unexaminedSinceFix = boundariesSinceFix - boundariesExaminedSinceFix;

  const lines = [];
  lines.push(`▸ seam sidecars: ${files.length} found, ${checked} measured, ${excluded.length} excluded ` + `(${unplaceable} of them unplaceable against their stream)`);
  for (const [kind, k] of [...byKind].sort()) {
    const un = k.boundaries - k.boundariesExamined;
    lines.push(
      `  ${kind.padEnd(8)} files ${String(k.files).padStart(4)} · sessions ${String(k.sessions).padStart(5)} ` +
        `· examined ${String(k.examined).padStart(10)} · seam rows ${String(k.seams).padStart(4)} ` +
        `· boundaries ${String(k.boundaries).padStart(5)}, ${un} outside any examined population` +
        ` · since ${SEED_FIX_DAY}: ${k.boundariesSinceFix - k.boundariesExaminedSinceFix} of ` +
        `${k.boundariesSinceFix} outside, over ${k.filesSinceFix} file(s)` +
        (k.unplaceable ? ` · ⊘ ${k.unplaceable} excluded, unplaceable` : '')
    );
  }
  if (checked > 0) {
    // §∅: with no seam row anywhere, there is no maximum — reporting 0 would read as a measured
    // 0 ms step, which is the opposite claim. Say that nothing was found instead.
    lines.push(
      seamRows === 0
        ? `  ${checked} measured file(s) carry NO seam row, so there is no largest device step to report`
        : `  ${filesWithSeam} of ${checked} measured file(s) carry at least one seam row; ` +
            `the largest device step reads ${maxStepMs.toFixed(3)} ms` +
            (maxStepKind ? ` on a ${maxStepKind} stream` : '') +
            (maxStepAt ? ` at ${String(maxStepAt).slice(0, 10)}` : '')
    );
  }
  for (const r of rootStates.filter((x) => x.state !== 'read')) {
    lines.push(`  ⚠ root ${r.root} reads ${r.state}: ${r.reason}`);
  }
  if (malformed > 0) lines.push(`  ⚠ ${malformed} malformed line(s) across the measured files`);
  for (const e of excluded.slice(0, 6)) lines.push(`  ⊘ ${e.kind}: ${e.reason}`);
  if (excluded.length > 6) lines.push(`  ⊘ … and ${excluded.length - 6} more excluded`);

  // The criterion binds on the nights recorded since the seed fix, because captured bytes are
  // immutable and no re-run repairs an earlier file. A corpus holding no such night has not been
  // examined for the question asked, which is NOT_RUN, never a pass over an empty population.
  // A FAIL survives an incomplete walk, because one boundary outside every examined population is a
  // positive finding whatever else went unread. A PASS does not: no counterexample over a population
  // the tool could not enumerate is UNKNOWN, never a pass.
  const status = checked === 0 ? 'NOT_RUN' : boundariesSinceFix === 0 ? 'NOT_RUN' : unexaminedSinceFix > 0 ? 'FAIL' : rootsUnread > 0 ? 'UNKNOWN' : 'PASS';
  const reason =
    checked === 0
      ? `no seam sidecar could be placed against its companion stream over ${files.length} found under ${rootStates.length} named root(s), so nothing was examined (${unplaceable} unplaceable, ${excluded.length - unplaceable} excluded for another reason, ${rootsUnread} root(s) unread)`
      : boundariesSinceFix === 0
        ? `no night recorded on or after ${SEED_FIX_DAY} carries a reconnect boundary, so the question has no population here — ${boundaries} earlier boundary interval(s) were read for context only`
        : unexaminedSinceFix > 0
          ? `${unexaminedSinceFix} reconnect boundary interval(s) of ${boundariesSinceFix} recorded since ${SEED_FIX_DAY} lie outside every examined population, so the emission is not proven on those nights`
          : rootsUnread > 0
            ? `every boundary recorded since ${SEED_FIX_DAY} reached an examined population, but ${rootsUnread} of ${rootStates.length} named root(s) could not be walked in full, so the population examined is not the population named`
            : null;

  const v = makeVerdict({
    gate: 'seam-sidecar-yield',
    status,
    population: { checked, eligible: files.length, excluded: excluded.length },
    criterion: {
      name: 'reconnect_boundaries_outside_any_examined_population',
      threshold: 0,
      unit: 'boundaries',
      direction: 'lte'
    },
    // §🧾: NOT_RUN examined nothing, so it must carry `result: null` — a count beside that status
    // would read as a measurement of a population the tool never had. The prose lines above still
    // report every figure, and the reason below names the ones that decide the status.
    result:
      status === 'NOT_RUN'
        ? null
        : {
            files: files.length,
            measured: checked,
            sessions,
            examined,
            seamRows,
            filesWithSeam,
            boundaries,
            boundariesExamined,
            unexaminedBoundaries: unexamined,
            seedFixDay: SEED_FIX_DAY,
            filesSinceFix,
            boundariesSinceFix,
            boundariesExaminedSinceFix,
            unexaminedBoundariesSinceFix: unexaminedSinceFix,
            unplaceableFiles: unplaceable,
            datedByMtime,
            maxStepMs: seamRows > 0 ? maxStepMs : null,
            maxStepKind: seamRows > 0 ? maxStepKind : null,
            maxStepReason:
              seamRows > 0
                ? null
                : `no measured file carries a seam row over ${checked} file(s) and ${examined} examined interval(s), so a largest step has no population — this is not a measured 0 ms`,
            boundMsDefault: BOUND_DEFAULT_MS,
            rootsNamed: rootStates.length,
            rootsUnread,
            byKind: Object.fromEntries([...byKind].sort())
          },
    evidence: ['tools/seam-sidecar-yield.mjs', 'capture-host/writers.py'],
    reason,
    tool: 'tools/seam-sidecar-yield.mjs'
  });

  return { lines, verdict: v, status };
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */

/** `# stream` + `phone_ts` header, then `rows` sample rows. */
function plantStream(dir, base, rows) {
  const body = [`# stream=${base}`, 'phone_ts;sensor_ts;value'];
  for (let i = 0; i < rows; i++) body.push(`2026-10-01 00:00:0${i % 10};${i * 1000000};${i}`);
  writeFileSync(join(dir, `${base}.txt`), `${body.join('\n')}\n`);
}

/** A sidecar whose `# final` lines carry `examined` in total across `finals.length` sessions. */
function plantSidecar(dir, base, finals, seamRows = []) {
  const body = [`# stream=${base} bound_ms=${BOUND_DEFAULT_MS}`, 'phone_ts;sensor_ts;step_ms;a;b;c;d'];
  for (const r of seamRows) body.push(r);
  for (const f of finals) body.push(`# final seams=${f.seams} examined=${f.examined}`);
  writeFileSync(join(dir, `${base}SEAMS.txt`), `${body.join('\n')}\n`);
}

/** One directory holding one stream and its sidecar, which is one population to place. */
function plantPair(root, name, base, rows, finals, seamRows = []) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  plantStream(dir, base, rows);
  plantSidecar(dir, base, finals, seamRows);
  return dir;
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const eq = (what, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++;
    else fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${what}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  };
  const root = mkdtempSync(join(tmpdir(), 'seam-sidecar-yield-'));
  try {
    /* Every plant below carries 12 lines over 2 header lines, so `samples` is 10 and a stream
       scanned by S sessions holds 10 - 1 = 9 intervals with no boundary skipped. */

    /* A · every boundary examined, on a night after the seed fix. */
    const a = plantPair(root, 'a', 'plant20261001120000_ECG', 10, [
      { seams: 0, examined: 5 },
      { seams: 0, examined: 4 }
    ]);
    const ra = census([a]).verdict;
    eq('every boundary examined reads PASS', ra.status, 'PASS');
    eq('…over one measured file and one boundary', [ra.result.measured, ra.result.boundaries], [1, 1]);
    eq('…with no boundary outside the examined population', ra.result.unexaminedBoundariesSinceFix, 0);
    eq('…and no reason, because nothing failed', ra.reason, null);
    eq('…§∅: no seam row means NO maximum step, not a 0 ms one', ra.result.maxStepMs, null);
    eq('…and the absent maximum says so by name', typeof ra.result.maxStepReason, 'string');
    eq('…the kind comes from the sidecar name', Object.keys(ra.result.byKind), ['ECG']);
    eq('…and the date comes from the filename stamp, never an mtime', ra.result.datedByMtime, 0);

    /* B · the same stream with the boundary interval skipped: examined = samples - S. */
    const b = plantPair(root, 'b', 'plant20261001130000_ECG', 10, [
      { seams: 0, examined: 4 },
      { seams: 0, examined: 4 }
    ]);
    const rb = census([b]).verdict;
    eq('a skipped boundary reads FAIL', rb.status, 'FAIL');
    eq('…and is counted, not described', rb.result.unexaminedBoundariesSinceFix, 1);
    eq('…and a non-PASS carries a reason', typeof rb.reason, 'string');

    /* C · more intervals examined than the stream holds: the two count no shared population. */
    const c = plantPair(root, 'c', 'plant20261001140000_HR', 10, [
      { seams: 0, examined: 9 },
      { seams: 0, examined: 9 }
    ]);
    const rc = census([c]);
    eq('an unplaceable file is excluded, never clamped', rc.verdict.population.excluded, 1);
    eq('…so nothing was measured, which is NOT_RUN over a null result', [rc.verdict.status, rc.verdict.result], ['NOT_RUN', null]);
    eq('…and the reason counts it', rc.verdict.reason.includes('1 unplaceable'), true);
    eq(
      '…while the prose still reports the kind',
      rc.lines.some((l) => l.includes('HR') && l.includes('unplaceable')),
      true
    );

    /* D · a night BEFORE the seed fix: read for context, outside the criterion's population. */
    const d = plantPair(root, 'd', 'plant20260801120000_PPG', 10, [
      { seams: 0, examined: 4 },
      { seams: 0, examined: 4 }
    ]);
    const rd = census([d]);
    eq('a pre-fix night alone leaves the question no population', [rd.verdict.status, rd.verdict.result], ['NOT_RUN', null]);
    eq('…and its boundary is named as context, never as a result', rd.verdict.reason.includes('1 earlier boundary interval(s)'), true);
    eq(
      '…while the prose places the file',
      rd.lines.some((l) => l.includes('1 measured')),
      true
    );

    /* E · a sidecar with no companion stream: nothing to place it against. */
    const e = join(root, 'e');
    mkdirSync(e, { recursive: true });
    plantSidecar(e, 'plant20261001150000_PPI', [{ seams: 0, examined: 9 }]);
    const re = census([e]).verdict;
    eq('a sidecar with no stream is excluded', [re.status, re.population.excluded], ['NOT_RUN', 1]);

    /* F · a seam row, which is where the largest device step comes from. */
    const f = plantPair(
      root,
      'f',
      'plant20261002120000_PPG',
      10,
      [
        { seams: 1, examined: 5 },
        { seams: 0, examined: 4 }
      ],
      ['2026-10-02 01:02:03;700000000;1234.5;a;b;c;d']
    );
    const rf = census([f]).verdict;
    eq('a seam row is counted and its step read', [rf.result.seamRows, rf.result.maxStepMs], [1, 1234.5]);
    eq('…on the kind that carried it', rf.result.maxStepKind, 'PPG');
    eq('…and a seam row is no failure by itself', rf.status, 'PASS');

    /* G · a sidecar that judged nothing: no `# final` line at all. */
    const g = plantPair(root, 'g', 'plant20261001160000_ECG', 10, []);
    const rg = census([g]).verdict;
    eq('a sidecar with no session line is excluded', [rg.status, rg.population.excluded], ['NOT_RUN', 1]);

    /* H · no 14-digit stamp in the name, so the date falls back to a MUTABLE mtime. */
    const h = plantPair(root, 'h', 'unstamped_ECG', 10, [
      { seams: 0, examined: 5 },
      { seams: 0, examined: 4 }
    ]);
    const rh = census([h]).verdict;
    eq('a name with no stamp is dated by mtime, and the count says so', rh.result.datedByMtime, 1);

    /* I · the whole plant at once: the arithmetic adds over roots. */
    const ri = census([a, b, c, d, e, f, g, h]).verdict;
    eq('one skipped boundary anywhere since the fix reads FAIL', ri.status, 'FAIL');
    eq('…over the files that could be placed', [ri.result.files, ri.result.measured], [8, 5]);
    eq('…and the unplaceable and excluded counts travel', [ri.result.unplaceableFiles, ri.population.excluded], [1, 3]);

    /* K · a root that does not exist is NAMED, and a clean count beside it is not a pass. */
    const rk = census([a, join(root, 'no-such-root')]);
    eq('an absent root cannot read PASS', rk.verdict.status, 'UNKNOWN');
    eq('…and is counted', [rk.verdict.result.rootsNamed, rk.verdict.result.rootsUnread], [2, 1]);
    eq(
      '…and named in the prose',
      rk.lines.some((l) => l.includes('reads absent')),
      true
    );
    eq('…while the boundary it did place is still clean', rk.verdict.result.unexaminedBoundariesSinceFix, 0);

    /* L · a tree `find` cannot walk in full keeps its rows and says the walk was partial. */
    const unreadable = join(b, 'unreadable');
    mkdirSync(unreadable, { recursive: true });
    chmodSync(unreadable, 0);
    let rl;
    try {
      rl = census([b]);
    } finally {
      chmodSync(unreadable, 0o755);
    }
    eq('a partial walk keeps the rows it did reach', rl.verdict.result.measured, 1);
    eq('…so a real finding survives it', rl.verdict.status, 'FAIL');
    eq(
      '…and the partial walk is named',
      rl.lines.some((l) => l.includes('reads partial')),
      true
    );

    /* J · no root at all examines nothing, which is never a pass. */
    const rj = census([]).verdict;
    eq('a census of no tree is NOT_RUN over a null result', [rj.status, rj.result], ['NOT_RUN', null]);
    eq('…and the population it examined is 0 of 0', [rj.population.checked, rj.population.eligible], [0, 0]);
    eq('…and says why', typeof rj.reason, 'string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(fail === 0 ? `  all ${pass} selftests passed` : `  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

/** The verdict shape over a planted PASS tree: no corpus, no night name, no device. */
function verdictSample() {
  const root = mkdtempSync(join(tmpdir(), 'seam-sidecar-yield-sample-'));
  try {
    const d = plantPair(root, 'sample', 'plant20261001120000_ECG', 10, [
      { seams: 0, examined: 5 },
      { seams: 0, examined: 4 }
    ]);
    return census([d]).verdict;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  refuseUnknownArgvOrExit({
    boolean: ['--json', '--selftest', '--verdict-sample'],
    valued: ['--dir']
  });
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  if (flag('--selftest')) process.exit(selftest());
  if (flag('--verdict-sample')) {
    printVerdict(verdictSample(), { json: true });
    process.exit(0);
  }
  const dirs = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--dir') dirs.push(argv[++i]);
  if (dirs.length === 0) {
    console.error('usage: seam-sidecar-yield.mjs --dir <corpus root> [--dir …] [--json]');
    console.error('  no default root: a census of a tree nobody named is a census of nothing');
    process.exit(2);
  }
  const res = census(dirs);
  if (flag('--json')) console.log(JSON.stringify(res.verdict, null, 1));
  else {
    console.log(res.lines.join('\n'));
    printVerdict(res.verdict);
  }
  process.exit(res.status === 'PASS' ? 0 : 1);
}
