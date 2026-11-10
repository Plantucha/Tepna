#!/usr/bin/env node
/*
 * xss-sink-gate.mjs — regression gate for XSS sink fixes.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * #3318/#3343 fixed XSS sinks by routing all untrusted strings through the
 * canonical escaper (dex-escape.js: escapeHTML). This gate fails if a PR adds
 * a new innerHTML sink without an accompanying escape call.
 *
 * Heuristic (diff-based): an added line containing `innerHTML` has its RHS
 * analyzed. All `escapeHTML()`/`esc()` calls are stripped (their arguments
 * are safe), string literals are stripped (static), and any remaining
 * identifiers are flagged as potentially unescaped. A line like
 * `el.innerHTML = userInput + escapeHTML(safeVar)` FAILS because `userInput`
 * survives the stripping.
 *
 * LIMITS: This is still heuristic, not AST-based. It cannot track data flow
 * across lines, through function returns, or via aliased escapers. Template
 * literals with interpolation are conservatively flagged (the `${...}` parts
 * are not parsed). Where safety cannot be established, the gate fails
 * conservatively. Human review is required for complex cases. Do not describe
 * it as comprehensive XSS detection.
 *
 * This is intentionally strict. If the input is statically trusted, document
 * why and add the line to the ALLOW table below. That table was prose only
 * until 2026-11-10: the header named it, no code read it, so the single way
 * past a false positive was to lower the ratchet baseline — which hides the
 * line instead of naming it. ALLOW now has teeth (see the staleness leg).
 *
 * Usage: node tools/xss-sink-gate.mjs --base <sha>
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

const SINK_RE = /\.innerHTML\s*(\+=|=)/;
// Matches escapeHTML(...) or esc(...) calls, including nested parens (one level).
// ReDoS-safe: the inner alternation uses single-char [^()] (not [^()]*), so the
// two branches are disjoint at every position — no ambiguous backtracking.
const ESCAPE_CALL_RE = /\b(?:escapeHTML|esc)\s*\((?:[^()]|\([^()]*\))*\)/g;
// String literals (single, double, backtick without interpolation).
const STRING_RE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\$]|\\.)*`/g;
// Identifiers that could be unescaped variables.
const IDENT_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
// Known-safe identifiers (not user data).
const SAFE_IDENTS = new Set(['true', 'false', 'null', 'undefined', 'this']);

/* ── ALLOW — statements a human read, with the reason ─────────────────────────────────────────────
   The heuristic judges ONE statement and cannot follow a value into the function that escaped it;
   its own LIMITS paragraph says so. A renderer that assembles markup in builders and writes it
   through a single helper therefore fails AT the helper, where no identifier can be escaped,
   because escaping assembled markup would escape the markup itself.

   `{ file, match, reason }`, all three required. `match` is a SUBSTRING of the trimmed statement and
   never a pattern, so an entry cannot widen to cover a line nobody read, and it is scoped to one
   file, so the same statement elsewhere is still caught. The staleness leg in --full-tree is what
   stops this table from rotting into blanket approval: an entry that matches no sink in the tree
   FAILS the gate rather than sitting there. */
export const ALLOW = [
  {
    file: 'eegdex-render.js',
    match: 'el.innerHTML = html',
    reason:
      "the file's one sink helper (setHTML). Every value its builders interpolate goes through esc() or a number formatter, and the only raw markup is MetricRegistry.badge() output via evBadge(). The two EDF-derived strings — the channel label and the physical dimension — reach HTML only through row() and kpi(), which escape them."
  }
];

/**
 * PURE CORE #3 — is this statement one a human exempted, in this file, with a reason?
 * @returns {{file: string, match: string, reason: string}|null}
 */
export function allowedBy(file, stmt, table) {
  const t = table || ALLOW;
  for (const a of t) if (a.file === file && a.match && a.reason && String(stmt).includes(a.match)) return a;
  return null;
}

/**
 * PURE CORE #1 — the heuristic for ONE added line. Unchanged from the original; only extracted, so a
 * selftest can plant a sink and a control without a diff.
 *
 * @returns {{sink: boolean, unsafe: string[]}}
 */
export function classifySinkLine(line) {
  if (!SINK_RE.test(line)) return { sink: false, unsafe: [] };
  const m = line.match(/\.innerHTML\s*(?:\+=|=)\s*(.+?);?\s*$/);
  const rhs = m ? m[1] : '';
  /* escapeHTML()/esc() calls first — their ARGUMENTS are safe, so the whole call collapses. Then
     string literals, which are static. Whatever identifier survives both is untracked data. */
  let stripped = rhs.replace(ESCAPE_CALL_RE, '""');
  stripped = stripped.replace(STRING_RE, '""');
  const unsafe = [];
  for (const im of stripped.matchAll(IDENT_RE)) if (!SAFE_IDENTS.has(im[0])) unsafe.push(im[0]);
  return { sink: true, unsafe };
}

/**
 * PURE CORE #2 — walk a unified diff, tracking the current file, and collect violations.
 * @returns {{violations: Array<{file,line,unsafe}>, sinksAdded: number}}
 */
export function scanDiff(lines) {
  const violations = [];
  const allowed = [];
  const rows = lines || [];
  let file = '';
  let sinksAdded = 0;
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    if (l.startsWith('diff --git')) {
      const m = l.match(/b\/(.+)$/);
      file = m ? m[1] : '';
      continue;
    }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    if (!SINK_RE.test(l)) continue;
    sinksAdded += 1;
    /* ⚠️ A MULTI-LINE ASSIGNMENT USED TO READ AS SAFE, SILENTLY. `el.innerHTML =` at the end of one
       line with its right-hand side on the next matched the sink, produced an EMPTY rhs, found no
       identifier in it and was recorded clean — a false negative that also counted toward
       `sinksAdded`, so the gate reported examining it. Measured 2026-10-10: `pulsedex-app.js:988` is
       exactly this shape, and it is one of the 7 open `js/xss-through-dom` CodeQL alerts — the control
       that exposed it. The statement is now assembled across up to 4 following added lines, stopping
       at the `;`, before classification. */
    let stmt = l;
    if (!/\.innerHTML\s*(?:\+=|=)\s*\S/.test(l)) {
      for (let k = 1; k <= 4 && i + k < rows.length; k++) {
        const nxt = rows[i + k];
        if (!nxt.startsWith('+') || nxt.startsWith('+++')) break;
        stmt += ` ${nxt.slice(1).trim()}`;
        if (/;\s*$/.test(nxt)) break;
      }
    }
    const r = classifySinkLine(stmt);
    if (!r.unsafe.length) continue;
    /* An exempt line is EXCLUDED, never silently clean: it leaves the violation list and enters a
       population the verdict prints, so an exemption nobody sees is not approval in the dark. */
    const a = allowedBy(file, stmt.trim());
    if (a) allowed.push({ file, line: stmt.trim().slice(0, 100), match: a.match, reason: a.reason });
    else violations.push({ file, line: stmt.trim().slice(0, 100), unsafe: r.unsafe });
  }
  return { violations, sinksAdded, allowed };
}

/* An ALLOW entry that matched nothing in the population just scanned. Over the WHOLE TREE that means
   the line is gone or was renamed, so the exemption now covers nothing and must leave the table. */
export function staleAllow(allowed, table) {
  const t = table || ALLOW;
  return t.filter((a) => !allowed.some((x) => x.file === a.file && x.match === a.match));
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  // THE PLANTED VIOLATION — an added sink with an unescaped variable, the #3318 shape.
  const bad = classifySinkLine('+  el.innerHTML = userInput;');
  ok(bad.sink && bad.unsafe.includes('userInput'), 'a planted unescaped sink is caught and the identifier named');
  /* The mixed case the header calls out: one escaped argument does NOT launder the line. */
  const mixed = classifySinkLine('+  el.innerHTML = userInput + escapeHTML(safeVar);');
  ok(mixed.unsafe.includes('userInput') && !mixed.unsafe.includes('safeVar'), 'an escaped call does not launder an unescaped sibling');

  /* THE CONTROLS — without these the gate could flag EVERY added line and still pass the plant. */
  ok(classifySinkLine('+  el.innerHTML = escapeHTML(x);').unsafe.length === 0, 'CONTROL: a fully escaped sink is clean');
  ok(classifySinkLine("+  el.innerHTML = '<b>static</b>';").unsafe.length === 0, 'CONTROL: a string literal is static, not user data');
  ok(classifySinkLine('+  const x = userInput;').sink === false, 'CONTROL: a line with no innerHTML is not a sink at all');
  ok(
    classifySinkLine('-  el.innerHTML = userInput;').sink === true && scanDiff(['-  el.innerHTML = userInput;']).violations.length === 0,
    'CONTROL: a REMOVED sink is not an addition — the scan is diff-directional'
  );

  /* THE MULTI-LINE SINK — the shape that read as safe until the CodeQL control named the file it hid
     in. The assignment's RHS is on the following line; without assembly the rhs is empty and the line
     is recorded clean while still counting as a sink examined. */
  const split = scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML =', "+    userInput + '<br>' + n + ';'"]);
  ok(split.violations.length === 1 && split.violations[0].unsafe.includes('userInput'), 'a sink whose RHS is on the NEXT line is caught');
  ok(split.sinksAdded === 1, '…and counted once, not once per assembled line');

  /* ── THE METRIC SWITCH, PLANTED ────────────────────────────────────────────────────────────────
     The case the FILE count could not see: one file, five sinks, four of them escaped. The work is
     four fifths done and the file is still listed, so a files-based baseline moves by ZERO and the
     ratchet reports no progress on a real security fix. This is not hypothetical — #3437 escaped
     sinks in two listed files and the file count stayed 42, which is why the metric changed. */
  const fiveSinks = ['diff --git a/a.js b/a.js'];
  for (let k = 0; k < 5; k++) fiveSinks.push(`+  el${k}.innerHTML = userInput${k};`);
  const allBad = scanDiff(fiveSinks);
  ok(allBad.violations.length === 5, 'five unescaped sinks in one file count as FIVE', `got ${allBad.violations.length}`);
  ok([...new Set(allBad.violations.map((v) => v.file))].length === 1, '…and as ONE file');

  const fourFixed = ['diff --git a/a.js b/a.js'];
  for (let k = 0; k < 4; k++) fourFixed.push(`+  el${k}.innerHTML = escapeHTML(userInput${k});`);
  fourFixed.push('+  el4.innerHTML = userInput4;');
  const partly = scanDiff(fourFixed);
  ok(partly.violations.length === 1, 'escaping four of the five leaves ONE unescaped sink', `got ${partly.violations.length}`);
  ok([...new Set(partly.violations.map((v) => v.file))].length === 1, '…while the FILE count is unchanged at one — the blindness, in one assertion');
  /* And the ratchet must now MOVE on that work, where before it could not. */
  ok(ratchet(partly.violations.length, { count: 5 }).status === 'SHORTFALL', 'the sink ratchet asks to be LOWERED after the four fixes');
  ok(ratchet(1, { count: 1 }).status === 'PASS', 'an unchanged sink count passes');
  ok(ratchet(2, { count: 1 }).status === 'FAIL', 'a RISEN sink count fails');
  const fileMetric = [...new Set(partly.violations.map((v) => v.file))].length;
  ok(ratchet(fileMetric, { count: 1 }).status === 'PASS', 'CONTROL · the OLD file metric reports PASS over the same four fixes — it cannot see them');

  /* The ledger entry this gate reads must carry the new unit, or the gate and its baseline disagree
     about what the number means — which is how a ratchet silently measures the wrong thing. */
  const led = readBacklog(join(ROOT, BACKLOG_LEDGER), 'xss-sink-gate', (f) => readFileSync(f, 'utf-8'));
  ok(led != null, 'the backlog ledger still has an xss-sink-gate entry');
  ok(led != null && /sink/i.test(led.unit || ''), 'the ledger UNIT names sinks, not files', JSON.stringify(led && led.unit));
  ok(led != null && led.files != null, 'the ledger keeps files as a second, non-ratcheted column', JSON.stringify(led && led.files));

  const splitSafe = scanDiff(['diff --git a/x.js b/x.js', '+  el.innerHTML =', '+    escapeHTML(x);']);
  ok(splitSafe.violations.length === 0, 'CONTROL: a multi-line sink that IS escaped stays clean');
  ok(scanDiff(['+  el.innerHTML =', '-  removed line']).violations.length === 0, 'CONTROL: assembly stops at a non-added line rather than reading across the hunk');

  // The walk attributes a violation to the right FILE, which is what makes the failure routable.
  const walked = scanDiff(['diff --git a/oxydex-render.js b/oxydex-render.js', '+  el.innerHTML = n.date;']);
  ok(walked.violations.length === 1 && walked.violations[0].file === 'oxydex-render.js', 'the violation names the file it is in');
  ok(walked.sinksAdded === 1, 'the population counts sinks ADDED, so a pass over zero sinks is distinguishable');
  ok(scanDiff(['+++ b/x.js', '+  el.innerHTML = userInput;']).violations.length === 1, 'the +++ header is skipped but the following line is not');

  /* ── THE SHRINK-ONLY RATCHET ──────────────────────────────────────────────────────────────────────
     Four states, and the one that matters most is the THIRD: a count that FELL must not quietly pass,
     or the baseline stays at its seeded value forever and the ratchet stops being one. */
  ok(ratchet(5, null).status === 'NOT_RUN', 'no baseline yet ⇒ NOT_RUN, never a pass over an unrecorded number');
  ok(ratchet(6, { count: 5 }).status === 'FAIL', 'a count ABOVE the baseline fails — something was merged unexamined');
  ok(ratchet(4, { count: 5 }).status === 'SHORTFALL', 'a count BELOW the baseline is a SHORTFALL asking for the baseline to be lowered');
  ok(ratchet(5, { count: 5 }).status === 'PASS', 'an unchanged count passes');
  ok(/lower the baseline/.test(ratchet(4, { count: 5 }).reason || ''), '…and says what to do about it');
  ok(ratchet(0, { count: 0 }).status === 'PASS', 'a cleared backlog passes at zero');

  /* ── THE ALLOW TABLE, PLANTED BOTH WAYS ───────────────────────────────────────────────────────
     A hatch is only as good as its controls: these legs plant an exempt line, the SAME line in
     another file, a different line in the exempt file, and an entry with no reason. Without the
     three controls the predicate could exempt everything and still pass the plant. */
  const TBL = [{ file: 'a.js', match: 'el.innerHTML = html', reason: 'a human read this one and wrote down why' }];
  ok(allowedBy('a.js', '  el.innerHTML = html;', TBL) !== null, 'an exempt statement in its own file is recognised');
  ok(allowedBy('b.js', '  el.innerHTML = html;', TBL) === null, 'CONTROL: the SAME statement in another file is NOT exempt — an entry is file-scoped');
  ok(allowedBy('a.js', '  el.innerHTML = other;', TBL) === null, 'CONTROL: a different statement in the exempt file is NOT exempt');
  ok(allowedBy('a.js', '  el.innerHTML = html;', [{ file: 'a.js', match: 'el.innerHTML = html', reason: '' }]) === null, 'an entry with NO reason exempts nothing — the reason IS the mechanism');

  const exempted = scanDiff(['diff --git a/eegdex-render.js b/eegdex-render.js', '+    el.innerHTML = html;']);
  ok(exempted.violations.length === 0 && exempted.allowed.length === 1, 'the real table exempts the real sink helper, as EXCLUDED rather than clean');
  ok(exempted.sinksAdded === 1, '…while the sink still counts as EXAMINED, so the verdict population stays honest');
  ok(scanDiff(['diff --git a/eegdex-render.js b/eegdex-render.js', '+    el.innerHTML = userInput;']).violations.length === 1, 'CONTROL: another unescaped sink in the exempt FILE is still caught');
  ok(staleAllow([], ALLOW).length === ALLOW.length, 'an ALLOW entry that matched no sink is reported stale');
  ok(staleAllow(exempted.allowed, ALLOW).length === 0, '…and one that matched is not');
  ok(
    ALLOW.every((a) => a.file && a.match && a.reason && a.reason.length > 60),
    'every real ALLOW entry carries a file, a match and a reason long enough to be one'
  );
  ok(
    ALLOW.every((a) => existsSync(join(ROOT, a.file))),
    'every real ALLOW entry names a file that still exists'
  );

  const line = fail.length ? `xss-sink-gate selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, sinksAdded, violations, base, fullTree, files, baseline, allowed, stale, reason }) {
  const exempt = (allowed || []).length;
  const v = Verdict.make({
    gate: 'xss-sink-gate',
    status,
    population: { checked: sinksAdded - exempt, eligible: sinksAdded, excluded: exempt },
    criterion: fullTree
      ? { name: 'the-whole-tree-backlog-of-unescaped-innerhtml-sinks-may-only-fall', threshold: baseline ? baseline.count : 0, unit: 'innerHTML sinks with an unescaped identifier', direction: 'lte' }
      : { name: 'no-added-innerhtml-sink-carries-an-unescaped-identifier', threshold: 0, unit: 'added sinks with an unescaped identifier', direction: 'eq' },
    result:
      status === 'NOT_RUN' && !fullTree
        ? null
        : {
            sinksAdded,
            violations: violations.map((v2) => ({ file: v2.file, unsafe: v2.unsafe })),
            allowed: (allowed || []).map((a) => ({ file: a.file, match: a.match, reason: a.reason })),
            ...(stale && stale.length ? { staleAllow: stale.map((a) => ({ file: a.file, match: a.match })) } : {}),
            ...(fullTree ? { mode: 'full-tree', unescapedSinks: violations.length, sinksInTree: sinksAdded, files, fileCount: files.length, baseline: baseline ? baseline.count : null } : {})
          },
    evidence: ['tools/xss-sink-gate.mjs', 'dex-escape.js'],
    reason:
      status === 'PASS'
        ? null
        : reason || (status === 'NOT_RUN' ? `no innerHTML sink was added in ${base}..HEAD — nothing was examined` : `${violations.length} added sink(s) carry an unescaped identifier`),
    producedBy: {
      tool: 'tools/xss-sink-gate.mjs',
      commit: (() => {
        try {
          return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        } catch {
          return null;
        }
      })()
    },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`xss-sink-gate produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

/* THE EMPTY TREE. `git diff <empty>..HEAD` presents every tracked file as added, which turns this
   diff-scoped scanner into a whole-tree one WITHOUT touching its core — the same classifier, a larger
   population. That matters because code merged before a diff gate existed is never examined by it, so
   the backlog is invisible by construction rather than by neglect. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/* ⚠️ maxBuffer EXPLICITLY, and 1 MiB is why. Node's default killed the first full-tree run with
   `spawnSync ENOBUFS` on a 5.9 MiB diff — the same defect that made `verify-fixtures` report a PASSING
   suite as RED this morning. A truncated or refused capture is never a clean scan, so the buffer is
   sized for the whole tree and a genuine overflow still throws rather than returning a short read. */
function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch (e) {
    if (e.status === 1) return '';
    throw e;
  }
}

/* THE SHRINK-ONLY BACKLOG LEDGER, shared with absence-regression. Seeded from the first measured run;
   a count ABOVE it fails, a count below it asks to be lowered. It is debt, not approval, and it may
   only fall — the same ratchet as the resolvability baseline and the untimed-group share. */
export const BACKLOG_LEDGER = 'audits/FULL-TREE-BACKLOG.json';

export function readBacklog(file, gate, readFn) {
  try {
    const d = JSON.parse(readFn(file));
    const e = d && d.gates && d.gates[gate];
    return e && typeof e.count === 'number' ? e : null;
  } catch {
    return null;
  }
}

/**
 * PURE CORE — judge a full-tree count against the ledger. Separated so the selftest can plant a rise,
 * a fall and a first run with no ledger at all.
 * @returns {{status: string, reason: (string|null)}}
 */
export function ratchet(count, baseline) {
  if (baseline == null) return { status: 'NOT_RUN', reason: `no baseline recorded for this gate yet — seed ${BACKLOG_LEDGER} with the measured count (${count}) and the paths` };
  if (count > baseline.count) return { status: 'FAIL', reason: `full-tree backlog ROSE: ${count} > baseline ${baseline.count} — new findings were merged, not inherited` };
  if (count < baseline.count)
    return { status: 'SHORTFALL', reason: `backlog FELL to ${count} from ${baseline.count} — lower the baseline in ${BACKLOG_LEDGER}; a ratchet that is not tightened stops being one` };
  return { status: 'PASS', reason: null };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const asJson = argv.includes('--json');
  /* ⚠️ --full-tree IS NEVER A PR GATE. It scans the whole repo, so on any PR it would report the
     INHERITED backlog as that PR's findings — blocking work on code the author never touched, which is
     how a useful measurement becomes a thing people route around. It is a nightly/release reading of a
     number that may only fall. The PR gate stays diff-scoped and unchanged. */
  const fullTree = argv.includes('--full-tree');
  const baseIdx = process.argv.indexOf('--base');
  const base = fullTree ? EMPTY_TREE : baseIdx >= 0 ? process.argv[baseIdx + 1] : 'HEAD';

  const diff = sh(`git diff ${base}..HEAD -U3 -- '*.js' '*.src.html' ':!tests/' ':!tools/'`);
  const { violations, sinksAdded, allowed } = scanDiff(diff.split('\n'));

  if (fullTree) {
    const files = [...new Set(violations.map((v) => v.file))].sort();
    const baseline = readBacklog(join(ROOT, BACKLOG_LEDGER), 'xss-sink-gate', (f) => readFileSync(f, 'utf-8'));
    /* 🔴 THE RATCHET COUNTS SINKS, NOT FILES — changed 2026-10-11 after measuring that it was blind to
       the work it exists to track. A file carries ~5 sinks (314 across 42 files) and leaves the list
       only when its LAST one is escaped, so escaping four of five moves the baseline by zero.
       MEASURED, not argued: #3437 escaped sinks in `dex-profile.js` and `resp-acc-analysis-app.js`,
       both of which REMAIN in the list because they hold others — and the file count stayed at 42. A
       ratchet that cannot see a merged security fix is not a ratchet, it is a number that happens to
       be true. `files` stays as a second column: it is the better unit for "how many modules still
       need review", just not for progress. */
    /* THE STALENESS LEG, and it only works here: over the whole tree every sink is in the population,
       so an entry that matched nothing is an exemption covering no line. A stale entry FAILS — the
       same teeth the co-load tables carry, for the same reason (an unread exemption rots silently). */
    const stale = staleAllow(allowed);
    const r = stale.length
      ? { status: 'FAIL', reason: `stale ALLOW entry (matches no sink in the tree): ${stale.map((a) => `${a.file} :: ${a.match}`).join(', ')}` }
      : ratchet(violations.length, baseline);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(verdictOf({ status: r.status, sinksAdded, violations, base, fullTree: true, files, baseline, allowed, stale, reason: r.reason }), null, 1)}\n`);
    } else {
      process.stdout.write(`xss-sink-gate --full-tree · ${sinksAdded} innerHTML sink(s) in the tree · ${violations.length} with an unescaped identifier, in ${files.length} file(s)\n`);
      for (const f of files) process.stdout.write(`    ${f}\n`);
      process.stdout.write(
        `  baseline: ${baseline ? `${baseline.count} unescaped sink(s)` : '(none yet)'}${baseline && baseline.files != null ? ` · ${baseline.files} file(s), not ratcheted` : ''} · ${allowed.length} exempt by ALLOW → ${r.status}${r.reason ? ` — ${r.reason}` : ''}\n`
      );
    }
    process.exit(r.status === 'FAIL' ? 1 : 0);
  }

  /* NOT_RUN WHEN NO SINK WAS ADDED. A diff that adds no innerHTML sink gives this gate nothing to
     judge, and "every added sink is escaped" over zero sinks is not evidence of anything — it is the
     examined-nothing shape, which this repo reports rather than dresses up as a pass. */
  const status = sinksAdded === 0 ? 'NOT_RUN' : violations.length ? 'FAIL' : 'PASS';

  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, sinksAdded, violations, base, allowed }), null, 1)}\n`);
  } else if (status === 'FAIL') {
    process.stderr.write('✕ xss-sink-gate: new innerHTML sink(s) without escape:\n');
    for (const v of violations.slice(0, 10)) process.stderr.write(`    ${v.file}: ${v.line} [unescaped: ${v.unsafe.join(', ')}]\n`);
    process.stderr.write('\nRoute untrusted strings through dex-escape.js escapeHTML (#3318).\n');
    process.stderr.write('If the input is statically trusted, document why and add to ALLOW.\n');
  } else if (status === 'NOT_RUN') {
    process.stdout.write(`xss-sink-gate: NOT_RUN — no innerHTML sink added in ${base}..HEAD, so nothing was examined\n`);
  } else {
    process.stdout.write(`xss-sink-gate: ✓ PASS — ${sinksAdded} added sink(s) examined, ${sinksAdded - allowed.length} escaped, ${allowed.length} exempt by ALLOW\n`);
    for (const a of allowed) process.stdout.write(`    EXEMPT ${a.file}: ${a.line}\n      ${a.reason}\n`);
  }
  process.exit(status === 'FAIL' ? 1 : 0);
}

main();
