#!/usr/bin/env node
/*
 * tools/consensus-polarity-wiring.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE WIRING IS WHERE A FIX STOPS BEING APPLIED, AND NOTHING COUNTED THE WIRING.
 *
 * `applyConsensusPolarity` re-detects a dissenting channel with the majority sign. Three co-located
 * photodiodes share a polarity convention, so a channel whose derivative-skewness sits near zero can
 * flip alone, and `detectChannel` decides each channel by itself: the dissenter is then detected
 * UPSIDE DOWN and its "feet" are peaks, roughly half a cardiac cycle out. The decision exists, it
 * ships in `ppgdex-dsp.js analyze`, and row
 * 2026-11-01-the-consensus-polarity-wiring-reached-one-of-ten-callers found most consumers never
 * call it.
 *
 * THE POPULATION IS THE CALL SITE, NOT THE FILE. Measured 2026-11-01 at `7fbd146dd`: 13 call sites
 * of `consensusBeats` across the root and `tools/`, of which 4 apply the decision first
 * (`ppgdex-dsp.js analyze`, `tools/ppg-fusion-e3.mjs`, `tools/pat-matchrate-strict.mjs`,
 * `tools/ppg-foot-consensus-e1.mjs`) and 9 apply nothing — two of them shipped workers. The row's
 * own title reads "one of ten", which counts the production applier and the nine, and leaves the
 * three tool appliers out of both halves; row
 * 2026-11-01-the-consensus-polarity-population-is-thirteen-call-sites-not-ten carries the count.
 *
 * ∅ A DECLARATION IS NOT A FIX, AND THIS GATE NEVER PRETENDS IT IS. Applying the decision at a
 * consumer MOVES that consumer's published numbers, so the remedy the row asks for is a decision per
 * caller rather than a blind flip. A caller therefore either applies the decision — which this gate
 * VERIFIES in the code, never from the comment — or declares, in a comment above the call, which of
 * two other states it is in:
 *
 *   @polarity-decision applies            the caller applies it; the scan must agree or this FAILS
 *   @polarity-decision n-a <row|reason>   the decision cannot bite here, with the reason beside it
 *   @polarity-decision behind <row key>   it applies, this caller does not, and a row holds the debt
 *
 * `behind` reads SHORTFALL — a third state, not a pass and not a fail, the `port-parity` shape. The
 * gate's condition is the CODE, never the row's state, so closing the row disarms nothing.
 *
 * TWO LIMITS, STATED RATHER THAN IMPLIED.
 *   · A verified `applies` means an `applyConsensusPolarity` call earlier in the file takes the SAME
 *     channel-set expression this call takes. It does not prove the two sit in one function body: a
 *     body bound at the next column-0 declaration reads two helpers inside a function as one (row
 *     2026-11-01-the-flag-arity-scan-bounds-a-helper-body-at-column-0), so this gate does not try.
 *     Instead it FAILS CLOSED on the only case where proximity could lie — two call sites in one
 *     file sharing one channel-set expression, where the apply call cannot be attributed to either.
 *     Every such site must declare.
 *   · A call reached through a variable, a map or a worker message is invisible to a source scan.
 *     The scan reads `consensusBeats(` as written.
 *
 * CLI: --check (default) · --json · --selftest · --verdict-sample
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { maskNonCode } from './argv-reads.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/consensus-polarity-wiring.mjs';
const CONSUMER = 'consensusBeats';
const APPLIER = 'applyConsensusPolarity';

/* The trees a call may live in. Named, never globbed: a glob would pull `node_modules` and every
   generated bundle into the population, and an inlined bundle copy is the same source twice. */
const SCAN = [
  { dir: '.', exts: ['.js'] },
  { dir: 'tools', exts: ['.mjs', '.js'] }
];

/* The row or reason must LOOK like one: `\S+` happily matched the `*/ ` that closes the comment,
   so a debt naming nothing read as a debt naming ` * /`. */;
const DECISION_RE = /@polarity-decision\s+(applies|n-a|behind)(?:\s+([A-Za-z0-9][\w.:\-/#]*))?/;
/* The marker that makes a line a comment in the trees this scans. A directive inside code is a
   string, and a string is not a declaration. */
const COMMENT_LINE = /^\s*(?:\*|\/\/|\/\*)/;
/* The declaration sits in the comment block above the call. Ten lines covers a `/* … *​/` block
   without reaching the previous statement. */
const WINDOW = 10;

const FAIL_STATES = new Set(['undeclared', 'declared-unapplied', 'behind-but-applies', 'n-a-but-applies', 'declaration-names-nothing', 'ambiguous']);

/* ── the scan ────────────────────────────────────────────────────────────────────────────────── */

export function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

/* The first argument as WRITTEN, walked on the masked copy so a comma inside a string or a comment
   cannot end it. Returns null when the call's parenthesis never closes. */
export function firstArg(text, masked, open) {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    const c = masked[k];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, k).trim() || null;
    } else if (c === ',' && depth === 1) return text.slice(open + 1, k).trim() || null;
  }
  return null;
}

export function findCalls(text, name) {
  const masked = maskNonCode(text);
  const re = new RegExp(`(?:^|[^\\w$])((?:[A-Za-z_$][\\w$]*\\.)?${name})\\s*\\(`, 'g');
  const out = [];
  /* The advance sits in the `for` update clause, never in the condition: a `continue` below must
     still advance the regex or the scan never ends. */
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const at = m.index + m[0].indexOf(m[1]);
    /* `function consensusBeats(` is the DECLARATION. It takes the same shape as a call and is not
       one, so the preceding text decides. */
    if (/\bfunction\s+$/.test(masked.slice(Math.max(0, at - 24), at))) continue;
    const open = m.index + m[0].length - 1;
    out.push({ callee: m[1], index: at, line: lineOf(text, at), arg: firstArg(text, masked, open) });
  }
  return out;
}

export function declarationAbove(lines, callLine) {
  for (let i = callLine - 2; i >= 0 && i >= callLine - 2 - WINDOW; i--) {
    const l = lines[i];
    if (l === undefined) continue;
    const m = DECISION_RE.exec(l);
    if (!m) continue;
    if (!COMMENT_LINE.test(l)) continue;
    return { verb: m[1], arg: m[2] || null, line: i + 1 };
  }
  return null;
}

export function classifyFile(path, text) {
  const appliers = findCalls(text, APPLIER);
  const calls = findCalls(text, CONSUMER);
  const lines = text.split('\n');
  return calls.map((c) => {
    const row = { in: path, line: c.line, arg: c.arg, state: 'undeclared', declaredAt: null, why: null };
    const shared = calls.filter((o) => o.index !== c.index && o.arg === c.arg);
    const before = appliers.filter((a) => a.arg && a.arg === c.arg && a.index < c.index);
    const decl = declarationAbove(lines, c.line);
    if (decl) row.declaredAt = decl.line;
    if (shared.length && before.length) {
      row.state = 'ambiguous';
      row.why = `two call sites in this file take the channel set \`${c.arg}\`, so the apply call cannot be attributed to either`;
      return row;
    }
    const applied = before.length > 0;
    if (!decl) {
      if (applied) {
        row.state = 'applies';
        return row;
      }
      row.why = 'the call applies no polarity decision and declares none';
      return row;
    }
    if ((decl.verb === 'behind' || decl.verb === 'n-a') && !decl.arg) {
      row.state = 'declaration-names-nothing';
      row.why = `\`@polarity-decision ${decl.verb}\` carries no row or reason`;
      return row;
    }
    if (decl.verb === 'applies') {
      if (applied) {
        row.state = 'applies';
        return row;
      }
      row.state = 'declared-unapplied';
      row.why = `the declaration says it applies and no \`${APPLIER}\` call takes \`${c.arg}\` before this one`;
      return row;
    }
    if (applied) {
      row.state = decl.verb === 'behind' ? 'behind-but-applies' : 'n-a-but-applies';
      row.why = `the declaration says \`${decl.verb}\` and the call DOES apply the decision, so the declaration is stale`;
      return row;
    }
    row.state = decl.verb === 'behind' ? 'behind' : 'n-a';
    row.why = decl.verb === 'behind' ? `the debt is declared and held by ${decl.arg}` : `declared out of reach: ${decl.arg}`;
    return row;
  });
}

/* ── the verdict ─────────────────────────────────────────────────────────────────────────────── */

export function buildVerdict(rows, scanned, opts = {}) {
  const bad = rows.filter((r) => FAIL_STATES.has(r.state));
  const behind = rows.filter((r) => r.state === 'behind');
  const checked = rows.length;
  const status = checked === 0 ? 'NOT_RUN' : bad.length ? 'FAIL' : behind.length ? 'SHORTFALL' : 'PASS';
  const reason =
    checked === 0
      ? opts.emptyReason || `no file in the scanned trees calls \`${CONSUMER}\`, so no wiring was read`
      : bad.length
        ? `${bad.length} call site(s) carry no readable polarity decision: ${bad.map((r) => `${r.in}:${r.line} — ${r.why}`).join(' · ')}`
        : behind.length
          ? `${behind.length} call site(s) stand declared behind the shipped decision: ${behind.map((r) => `${r.in}:${r.line} (${r.why})`).join(' · ')}`
          : null;
  return makeVerdict({
    gate: 'consensus-polarity-wiring',
    status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'consensus_calls_with_no_readable_polarity_decision', threshold: 0, unit: 'call sites', direction: 'lte' },
    result:
      checked === 0
        ? null
        : {
            applies: rows.filter((r) => r.state === 'applies').length,
            behind: behind.length,
            notApplicable: rows.filter((r) => r.state === 'n-a').length,
            unreadable: bad.length,
            filesScanned: scanned
          },
    evidence: [TOOL, ...new Set(rows.map((r) => r.in))],
    reason,
    tool: TOOL
  });
}

/* ── io ──────────────────────────────────────────────────────────────────────────────────────── */

function scanFiles(root) {
  const out = [];
  for (const s of SCAN) {
    const dir = join(root, s.dir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (!statSync(p).isFile()) continue;
      if (!s.exts.some((e) => f.endsWith(e))) continue;
      out.push(relative(root, p));
    }
  }
  return out.sort();
}

export function run(root) {
  const files = scanFiles(root);
  const rows = [];
  for (const f of files) rows.push(...classifyFile(f, readFileSync(join(root, f), 'utf8')));
  return { rows, scanned: files.length };
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */

let ran = 0;
function ok(cond, what) {
  ran++;
  if (!cond) {
    console.error(`  ✗ ${what}`);
    process.exitCode = 1;
  }
}

const CALL = 'const cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);\n';
const APPLY = 'PPGDSP.applyConsensusPolarity(per, (i, s) => PPGDSP.detectChannel(rec.ch[i], rec.fs, s));\n';
const one = (text) => classifyFile('c.mjs', text)[0];

function selftest() {
  ok(findCalls(CALL, CONSUMER).length === 1, 'a call is found');
  ok(findCalls(CALL, CONSUMER)[0].arg === 'per', 'and its channel-set expression is the first argument');
  ok(findCalls(`function ${CONSUMER}(perChannel, refIdx, fs) {\n`, CONSUMER).length === 0, 'the declaration is not a call');
  ok(findCalls(`// ${CALL}`, CONSUMER).length === 0, 'a call in a comment is not a call');
  ok(findCalls(`const s = '${CALL.trim()}';\n`, CONSUMER).length === 0, 'a call in a string is not a call');
  ok(findCalls('x.consensusBeats(f(a, b), i, fs);\n', CONSUMER)[0].arg === 'f(a, b)', 'a nested comma does not end the first argument');
  ok(findCalls('x.consensusBeats(per', CONSUMER)[0].arg === null, 'an unclosed call yields no argument');

  ok(one(APPLY + CALL).state === 'applies', 'an apply call on the same set verifies');
  ok(one(CALL).state === 'undeclared', 'a bare call is undeclared');
  ok(one(CALL + APPLY).state === 'undeclared', 'an apply call AFTER the consumer does not count');
  ok(one('PPGDSP.applyConsensusPolarity(other, r);\n' + CALL).state === 'undeclared', 'an apply call on a DIFFERENT set does not count');
  ok(one(`/* @polarity-decision behind 2026-11-01-a-row */\n${CALL}`).state === 'behind', 'a declared debt is behind');
  ok(one(`/* @polarity-decision n-a 2026-11-01-a-row */\n${CALL}`).state === 'n-a', 'a declared out-of-reach call is n-a');
  ok(one(`/* @polarity-decision behind */\n${CALL}`).state === 'declaration-names-nothing', 'a debt naming no row fails');
  ok(one(`/* @polarity-decision applies */\n${CALL}`).state === 'declared-unapplied', 'a declaration cannot assert what the code does not do');
  ok(one(`${APPLY}/* @polarity-decision applies */\n${CALL}`).state === 'applies', 'and it agrees when the code does');
  ok(one(`${APPLY}/* @polarity-decision behind 2026-11-01-a-row */\n${CALL}`).state === 'behind-but-applies', 'a stale debt declaration fails');
  ok(one(`${APPLY}/* @polarity-decision n-a 2026-11-01-a-row */\n${CALL}`).state === 'n-a-but-applies', 'a stale n-a declaration fails');
  ok(one(`const d = '@polarity-decision behind 2026-11-01-a-row';\n${CALL}`).state === 'undeclared', 'a directive in a code line is not a declaration');
  ok(one(`/* @polarity-decision behind 2026-11-01-a-row */\n${'\n'.repeat(WINDOW + 2)}${CALL}`).state === 'undeclared', `a declaration ${WINDOW + 2} lines above does not bind`);

  const amb = classifyFile('c.mjs', APPLY + CALL + CALL);
  ok(amb.length === 2, 'two call sites in one file are two rows');
  ok(
    amb.every((r) => r.state === 'ambiguous'),
    'and a shared channel set makes proximity unattributable'
  );
  ok(classifyFile('c.mjs', APPLY + CALL + CALL.replace('per', 'other'))[0].state === 'applies', 'a second call on another set does not spoil the first');

  ok(buildVerdict([{ state: 'applies', in: 'a' }], 1).status === 'PASS', 'an all-applied population is a PASS');
  ok(buildVerdict([{ state: 'behind', in: 'a', why: 'w' }], 1).status === 'SHORTFALL', 'a declared debt is SHORTFALL');
  ok(buildVerdict([{ state: 'undeclared', in: 'a', why: 'w' }], 1).status === 'FAIL', 'an undeclared call is a FAIL');
  ok(buildVerdict([], 0).status === 'NOT_RUN', 'an empty population examined nothing');
  ok(buildVerdict([], 0).result === null, 'and it reports no measured result');
  ok(/n-a/.test(JSON.stringify(buildVerdict([{ state: 'n-a', in: 'a', why: 'w' }], 1).result)) === false, 'n-a is counted as notApplicable');
  ok(buildVerdict([{ state: 'n-a', in: 'a', why: 'w' }], 1).result.notApplicable === 1, 'and the count is 1');

  if (process.exitCode) return;
  console.log(`selftest: all ${ran} assertions passed`);
}

/* ── cli ─────────────────────────────────────────────────────────────────────────────────────── */

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: [], boolean: ['--check', '--json', '--selftest', '--verdict-sample'] }, { tool: 'consensus-polarity-wiring' });
  const has = (f) => argv.includes(f);
  if (has('--selftest')) {
    selftest();
    process.exit(process.exitCode || 0);
  }
  if (has('--verdict-sample')) {
    /* The sample runs the SAME builder over a root that cannot exist, so no second copy of the
       object can drift from the one a real refusal prints. */
    const sample = run(join(ROOT, 'no-such-tree-for-a-verdict-sample'));
    printVerdict(buildVerdict(sample.rows, sample.scanned, { emptyReason: 'the scanned root does not exist, so no file was read' }));
    process.exit(0);
  }
  const { rows, scanned } = run(ROOT);
  const verdict = buildVerdict(rows, scanned);
  if (has('--json')) console.log(JSON.stringify({ rows, scanned }, null, 1));
  else {
    for (const r of rows) {
      const mark = r.state === 'applies' ? '✓' : r.state === 'behind' || r.state === 'n-a' ? '◐' : '✗';
      console.log(`  ${mark} ${r.in}:${r.line} ${CONSUMER}(${r.arg}) — ${r.state}${r.why ? ` — ${r.why}` : ''}`);
    }
    console.log(
      `consensus-polarity-wiring: ${rows.length} call site(s) over ${scanned} file(s) — ${verdict.result ? `${verdict.result.applies} apply · ${verdict.result.behind} declared behind · ${verdict.result.notApplicable} out of reach · ${verdict.result.unreadable} unreadable` : 'nothing called'}`
    );
  }
  printVerdict(verdict);
  process.exit(verdict.status === 'FAIL' ? 1 : 0);
}
