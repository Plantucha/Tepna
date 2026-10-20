#!/usr/bin/env node
/*
 * tools/selftest-all.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * RUN EVERY TOOL'S SELFTEST — locally, in parallel, with assertion counts.
 *
 * ⚠️ THIS IS NOT THE GATE, and an earlier draft of this header wrongly said it was. CI ALREADY runs
 * every tool selftest: `.github/workflows/tests.yml`'s "Analysis-tool selftests" step greps
 * `tools/*.mjs` for `--selftest`, runs each one, and even refuses a run that finds fewer than ten —
 * so a tool quietly LOSING its selftest cannot read as success. That gate predates this script and
 * covers everything in this directory.
 *
 * The claim that "112+ assertions across eight tools are unrun" was FALSE. It came from grepping the
 * workflow for literal script paths, which missed a shell loop. Recorded here because the mistake is
 * the same shape as the ones this toolchain exists to catch: a check was searched for in the wrong
 * place, not found, and its absence believed.
 *
 * What this script actually adds, all of it modest:
 *   · ONE local command (`npm run test:tools`) instead of remembering the loop
 *   · PARALLEL — 28 tools in ~1.1 s against CI's serial pass
 *   · ASSERTION COUNTS, so a tool that silently drops from 30 assertions to 3 is visible; the CI
 *     loop reads PASS either way, because a smaller green suite is still green
 *
 * ── DISCOVERED, NOT LISTED ───────────────────────────────────────────────────────────────────
 * The tool set is found by scanning `tools/*.mjs` for a `--selftest` handler. A hardcoded list is the
 * thing that goes stale: the next tool someone writes would simply not be run, and its absence would
 * look identical to it passing. This repo already retired two committed-list files for that exact
 * reason (`docs-ledger-list.txt`, `changes-list.txt`, CPAP-REAL-CORPUS-FOLLOWUPS-II §4).
 *
 * A tool that declares `--selftest` and then EXITS NON-ZERO is a failure. A tool that declares it and
 * prints nothing recognisable is reported too — a selftest whose result cannot be read is not a pass.
 *
 * USAGE
 *   node tools/selftest-all.mjs          # every tool; non-zero if any fails
 *   node tools/selftest-all.mjs --list   # just show what would run
 *   node tools/selftest-all.mjs --json   # the sweep, plus ONE tepna.verdict/1 object on stdout (report → stderr)
 *   node tools/selftest-all.mjs --verdict-sample   # the object over a scratch result set, no sweep
 *
 * VERDICT — the second RUNNER adopter of VERDICT-CONTRACT §3d, through the same `aggregateChildren` as
 * run-check. Children are the per-tool selftests, read from the summary line this script already
 * parses: a parsed count ⇒ PASS (provenance 'summary', with n); green but UNPARSEABLE ⇒ UNKNOWN, never
 * a tool failure; a failing selftest ⇒ FAIL; a TIMEOUT or a kill ⇒ UNKNOWN (the tool decided nothing —
 * §3c's timeout rule); a tool discovery found but could not run (the `--self-test` near miss) ⇒ NOT_RUN,
 * excluded, unplanned ⇒ the run is UNKNOWN. The ratchet is this runner's ONE pre-stated criterion of its
 * own: an unratcheted unparseable tool, or a paid debt left in the map, is FAIL by name. The EXIT CODE
 * STAYS for the shell and CI.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeMask } from './js-lex.mjs';
import { aggregateChildren, makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'tools');
const argv = process.argv.slice(2);

/* A tool "has a selftest" if its source mentions the flag in a branch, not merely in a usage comment.
   Checking for the flag string alone would enrol every file whose header documents it. */
export function declaresSelftest(src) {
  const s = String(src || '');
  /* KEYED ON CALL POSITION, NOT ON THE CALLER'S NAME. This enumerated three spellings the author had
     met — `has(…)`, `includes(…)`, `argv.indexOf(…)` — so a FOURTH read identical to a tool with no
     selftest at all. Measured 2026-09-15: `tools/pin-coverage.mjs` reads the flag as
     `flag('--selftest')` and was absent from the run entirely; widening to any single-argument call
     recovers it and three more (`beat-comb-analysis`, `cpap-sa2-agreement`, `trio-batch`) with ZERO
     tools lost — 100 -> 104, verified per-file before the change.

     The literal must sit inside a call, which is what keeps a header comment that merely MENTIONS the
     flag out: `* node tools/x.mjs --selftest` in a usage block has no parentheses around it. */
  return /\(\s*['"]--selftest['"]\s*\)/.test(s);
}

/* ✅ CLOSED 2026-08-18, RE-VERIFIED 2026-08-27 — the incident below is HISTORY, not an open hazard.
   The detector it describes is implemented, wired and exit-enforcing (`nearMiss` -> process.exit 1), and
   was demonstrated to fire on 2026-08-27 by planting a tool spelling the flag `--self-test`: it was
   named, reported unreachable, and the run exited 1.
   Stamped because the paragraph below reads in the present tense of an open problem, and twice caused
   remediation work to be assigned for something already fixed. A header that DOCUMENTS a failure is not
   evidence the failure is open — run the mechanism's own check before acting on the narrative. */

/* A tool that HAS a selftest under a name discovery does not recognise is invisible, and invisibility
   here is indistinguishable from passing. Measured 2026-08-18: three tools spelled the flag
   `--self-test` (hyphenated) and compared it with `===`; the CI loop greps for the literal
   `--selftest` and `declaresSelftest` matches only `has(…)`/`includes(…)`/`indexOf(…)`, so **44 tools
   ran and those three never did** — for two independent reasons at once. Neither the loop's
   "fewer than ten is a failure" floor nor this script's count could see it: the floor was met by the
   other 44, and a tool that is never run contributes no count to miss.
   So the near-miss is now REPORTED rather than skipped. This predicate deliberately looks for the
   selftest MACHINERY (an exported/decl `selfTest`, or the hyphenated flag) in a file that
   `declaresSelftest` rejected — presence of a test with no way to reach it. */
/* ── THE SUMMARY THE FLEET ACTUALLY WRITES, not the one this script preferred ───────────────────────
   This was ONE regex — `all <N> selftests passed` — plus a bare `all green`. Every other spelling read
   as "prints no count", which is the SAME defect `declaresSelftest` had one function above: a reader
   enumerating the single form its author used, so a tool doing the right thing in different words is
   indistinguishable from one doing nothing at all.

   Measured 2026-09-16 over the 48 ratcheted tools: 22 of them DO report a count and were miscounted as
   silent — `N assertions passed` (9), `PASS (n/m)` (7), `N passed, M failed` (6). Only 26 genuinely
   print nothing. The tools were not wrong; the reader was.

   ORDER MATTERS: the canonical form is tried first so a tool printing both is read the intended way.
   `all green` stays LAST and captures no digits — readable, but no count, which is the honest result. */
export const SUMMARY_FORMATS = [/all (\d+) selftests passed/, /(\d+) assertions passed/, /\bPASS \((\d+)\/\d+\)/, /(\d+) passed,\s*\d+ failed/, /all green/];

export function declaresNearMissSelftest(src) {
  const s = String(src || '');
  if (declaresSelftest(s)) return false;
  return /--self-test/.test(s) || /function\s+selfTest\b/.test(s);
}

/* ── A COUNT IS COMPUTED, NEVER TYPED ─────────────────────────────────────────────────────────────
   This script reads the number a tool prints as that tool's assertion total, and the whole point of
   reading it is to SEE a suite shrink. A tool that prints a figure somebody typed
   (`console.log(… 'all 14 selftests passed')`) defeats that in both directions: delete an assertion
   and the typed 14 still prints; add one and it prints 14 anyway. Measured 2026-10-11 (residue
   `ten-tools-hardcode-a-selftest-count`): ten tools typed it, and a planted extra assertion left the
   literal version printing the old number with nothing red. By grep three of them could not even be
   shown wrong (their assertion style differs from `ok(` — 14 vs 13, 33 vs 32, 74 vs 0), and that
   unverifiability is the argument: the count has to be incremented by the assertion helper itself,
   the way `browser-lane.mjs` (#3404) and this file's own `eq` do.

   This is the static half of that rule: a PRINTING line (`console.log` / `console.error` /
   `process.stdout.write`) whose summary text carries a DIGIT LITERAL — `all 19 selftests passed`,
   `N assertions passed`, `… failed of 19` — is a typed count. An interpolated one (`${ran}`) carries
   no digit and is not matched. Comments are skipped, and so is a line that is not itself a print (a
   plant such as `suiteReported('✓ all 7 assertions passed')` quotes a summary, it does not print one).

   ⚠️ THE READER HAD TWO BLIND SPOTS, and both printed a number no run produced. Residue
   `2026-10-19-selftest-count-static-check-misses-a-one-hop-literal` reported the second; measuring it
   on 2026-10-20 over `origin/main` found the first as well, in TEN tools:

     SPELLING (4) — `pat-axis-leg-audit`, `pat-drift-attribution`, `pat-per-led`, `pin-coverage` print
     a flat `'SELFTEST PASS (7/7)'`. Two regexes here read `N selftests passed` and `failed of N`, so
     the `PASS (n/m)` spelling that `SUMMARY_FORMATS` one function above ALREADY parses was invisible.
     The two halves of one reader disagreed about what a summary looks like — the same defect as the
     2026-09-16 widening, pointed at the static side.

     HOP (6) — `measurement-walk` (34), `pat-mode-posture` (21), `probe-clock-equivalence` (8),
     `residue-cite-drift` (15), `stuck-run-lengths` (12), `verdict-adoption` (83) held the count in
     `const N = <digits>` and interpolated it, so no digit reached the print line. `pat-window-oracle`
     was the reported instance (#3675) and the row's sweep named it the only one, because that sweep
     looked for a digit ON the print line — the very shape this rule could not see.

   So `typedSummary` now reads the file's own `SUMMARY_FORMATS` vocabulary, and the scan resolves one
   hop through `typedNumericConsts`. Both widenings are deliberately narrow, because this file's own
   warning against a sixth regex applies to its static half too:
   - A `SUMMARY_FORMATS` match must share its line with the word `selftest`, OR sit inside the
     tool's own `--selftest` block. `PASS (n/m)` is generic, and a RESULT ratio printed elsewhere in a
     tool must never read as an assertion count — this file's defect class pointed at itself.
   - A `const` is a hop, and so is a `let`/`var` numeric that nothing in the file ever reassigns. See
     `typedNumericConsts` and `neverReassignedNumerics`.

   ⚠️ BOTH NARROWINGS WERE BLIND SPOTS, and residue `2026-10-20-two-narrowings-leave-a-typed-count-invisible`
   named them the day they were written: a typed `PASS (12/12)` printed with no marker word, and a
   `let N = 83` nothing reassigns, each read as clean. Closing them needed what a line scan cannot do,
   so this half now reads `codeMask` from `tools/js-lex.mjs` — the repo's one regex-aware lexer:
     · a `--selftest` guard's block is found by brace depth over real code, which is the REGION that
       licenses a marker-less ratio;
     · a reassignment is looked for over real code only, so a string or a comment naming the binding
       proves nothing, and a counter — `ran += 1`, `n++`, a later `N = xs.length` — is never a hop;
     · a print is a `console.log(` at an UNMASKED position. A line that QUOTES one inside a string
       literal does not print, which is what keeps this file's own decoy plants clean. Until today the
       marker-word guard did that job by accident of their wording, and inside a region it would not.
   MEASURED 2026-10-20 over all 276 files in `tools/`, 6 MiB of source: the two widenings add **0**
   flags, and 0 of 685 numeric `let`/`var` declarations survive the never-reassigned test, so neither
   blind spot has a live instance here — they buy a bound, not a repair. Cost, best of three warm
   passes: 139 ms against 18 ms, all of it the lexer; the three helpers share ONE mask per scan, which
   is what keeps it there, since a mask apiece read the same 6 MiB three times and cost 465 ms. The
   whole step spawns 181 child selftests, so a tenth of a second is not the figure that decides this.
   Ten plants and controls below pin the direction in both senses, and a false positive on a real
   counter was the cost that would have stopped the change.
   PURE: returns the offending lines, trimmed; a hop line names the constant it resolved. */
export function literalCountLines(src) {
  const text = String(src || '');
  const mask = codeMask(text);
  const regions = selftestRegions(text, mask);
  const consts = new Map([...typedNumericConsts(text), ...neverReassignedNumerics(text, mask)]);
  /* Inside the tool's own selftest block the marker word buys nothing, because every summary there IS
     a selftest summary; outside it the word is the only thing separating an assertion count from a
     measured result. */
  const typedHere = (line, at) => typedSummary(line) || (regions.some(([a, b]) => at >= a && at <= b) && SUMMARY_FORMATS.some((re) => (line.match(re) || [])[1] !== undefined));
  const out = [];
  let off = 0;
  for (const raw of text.split('\n')) {
    const at = off;
    off += raw.length + 1;
    const s = raw.trim();
    if (/^(\/\/|\/\*|\*)/.test(s)) continue;
    if (!printsAt(mask, at + (raw.length - raw.trimStart().length), s)) continue;
    if (typedHere(s, at)) {
      out.push(s.slice(0, 120));
      continue;
    }
    let sub = s;
    const used = [];
    for (const [k, v] of consts) {
      const re = new RegExp('\\$\\{\\s*' + k + '\\s*\\}', 'g');
      if (!re.test(sub)) continue;
      sub = sub.replace(re, v);
      used.push(k + ' = ' + v);
    }
    if (used.length && typedHere(sub, at)) out.push(s.slice(0, 100) + '   \u2190 typed one hop away: ' + used.join(', '));
  }
  return out;
}

/* Every character span that sits inside a `--selftest` guard block, by brace depth over real code.
   The flag itself always sits inside a STRING, so the mask cannot gate the anchor — a comment line
   naming the flag is skipped the way every other reader here skips one. A file with no guard returns
   no span, which is why a tool printing a bare `PASS (n/m)` in its report is untouched. PURE. */
export function selftestRegions(src, mask = null) {
  const text = String(src || '');
  const m = mask || codeMask(text);
  const spans = [];
  for (const g of text.matchAll(/--selftest/g)) {
    const bol = text.lastIndexOf('\n', g.index) + 1;
    if (/^\s*(\/\/|\/\*|\*)/.test(text.slice(bol, g.index))) continue;
    const open = text.indexOf('{', g.index);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (!m[i]) continue;
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          spans.push([open, i]);
          break;
        }
      }
    }
  }
  return spans;
}

/* The numeric `let`/`var` bindings nothing in the file ever reassigns, as NAME → the digits. A binding
   that is never reassigned is a typed number on every line that reads it, exactly as a `const` is, and
   `typedNumericConsts` explains why taking ANY numeric `let` was refused: 56 of 104 tools flagged, and
   nearly all of them correct counters. The difference here is the test — a reassignment is searched for
   over real CODE, so `ran += 1`, `n++` and a later `N = xs.length` all disqualify a binding, while a
   string or a comment naming it does not. Measured 2026-10-20: 644 numeric `let`/`var` bindings across
   `tools/`, and 0 of them survive this test, so the widening flags nothing today. PURE. */
export function neverReassignedNumerics(src, mask = null) {
  const text = String(src || '');
  const m = mask || codeMask(text);
  let code = '';
  for (let i = 0; i < text.length; i++) code += m[i] ? text[i] : text[i] === '\n' ? '\n' : ' ';
  const out = new Map();
  const decl = /(?:^|[;{}\s])(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*(?:;|$|\n)/gm;
  for (const d of code.matchAll(decl)) out.set(d[1], d[2]);
  for (const k of [...out.keys()]) {
    const assigns = (code.match(new RegExp('\\b' + k + '\\s*=(?!=)', 'g')) || []).length;
    const decls = (code.match(new RegExp('(?:let|var)\\s+' + k + '\\s*=(?!=)', 'g')) || []).length;
    const bumps = (code.match(new RegExp('\\b' + k + '\\s*(?:\\+=|-=|\\*=|/=|\\+\\+|--)|(?:\\+\\+|--)\\s*' + k + '\\b', 'g')) || []).length;
    if (assigns > decls || bumps > 0) out.delete(k);
  }
  return out;
}

/* Does this line PRINT, or does it QUOTE a print? The mask decides: a `console.log(` inside a string
   literal is not a call, so a plant such as `eq(literalCountLines("console.log('PASS (31/52)')") …)`
   is read as what it is. `at` is the line's offset in the source the mask was built from. PURE. */
export function printsAt(mask, at, line) {
  for (const call of ['console.log(', 'console.error(', 'process.stdout.write(']) {
    let i = line.indexOf(call);
    while (i >= 0) {
      if (mask[at + i]) return true;
      i = line.indexOf(call, i + 1);
    }
  }
  return false;
}

/* A summary line carrying a count somebody typed. The first two spellings are the original rule. The
   rest come from `SUMMARY_FORMATS` — the same list the RUNTIME half parses — and only on a line that
   names a selftest, which is the false-positive guard the doc above states. PURE. */
export function typedSummary(line) {
  const s = String(line || '');
  if (/\b\d+\s+(?:selftests?|assertions?)\s+passed\b/.test(s)) return true;
  if (/\b(?:failed|FAILED)\b[^\n]*\bof\s+\d+\b/.test(s)) return true;
  if (!/selftest/i.test(s)) return false;
  return SUMMARY_FORMATS.some((re) => {
    const m = s.match(re);
    return !!m && m[1] !== undefined;
  });
}

/* The `const NAME = <digits>` bindings in a file, as NAME → the digits. A `const` can never be
   reassigned, so a numeric one is a typed number on every line that reads it, however far from the
   print it sits. ⚠️ A COUNTER IS NOT A HOP, and the exclusion is load-bearing: a first pass that took
   any `let`/`var` numeric flagged 56 of 104 tools (measured 2026-10-20), nearly all of them correct
   counters — `let ran = 0` incremented by the assertion helper is exactly what this rule ASKS for.
   `let` and `var` are therefore left alone, which also means a never-reassigned `let` holding a count
   stays invisible here; that is the safe direction. PURE. */
export function typedNumericConsts(src) {
  const out = new Map();
  for (const raw of String(src || '').split('\n')) {
    const s = raw.trim();
    if (/^(\/\/|\/\*|\*)/.test(s)) continue;
    const m = s.match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*(?:;|$)/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/* ── RATCHET: tools whose selftest prints NO PARSEABLE ASSERTION COUNT ──────────────────────────────
   DEBT, NOT APPROVAL, and it may only go DOWN. The count is this script's entire added value over the
   CI loop — CI reads PASS either way, so a suite silently shrinking from 30 assertions to 3 is visible
   ONLY here, and only for a tool that reports one. A tool in this map is a tool that gate cannot watch.

   ⚠️ A NEW TOOL MAY NOT JOIN IT. An unlisted tool with an unreadable summary FAILS, which is how
   TOOL-BUILD-STANDARD stops being a checklist nobody is held to. To pass, end the selftest with a line
   the parser reads — `all <N> selftests passed` — as `box-sample.mjs` and `assertion-strength.mjs` do.
   Adding an entry here is a deliberate act of owing the debt rather than paying it, exactly as
   capture-host's `test_silent_except.RATCHET` is kept rather than deleted.

   Seeded at 48 of 104 on 2026-09-16, the day `declaresSelftest` widened from three hard-coded call
   spellings to any call position and discovered four tools the runner had never executed. Cut to 26
   the SAME day by widening the summary parser: 22 of the 48 were reporting counts all along, in
   formats the reader did not know. The ratchet forced that bookkeeping — it exits 1 on a paid debt
   left in the map, so the parser could not be widened without removing them.

   ⚠️ AND THE WIDENING STOPS HERE — measured, not assumed. Of the 26 that remain, only TWO print a
   number at all (`release-land`, `wt-done`, as `selftest: N/N ok`); the other 24 genuinely end with
   `all passed` and count nothing. A sixth regex would therefore buy two tools while adding
   false-positive risk on any tool that prints a ratio in its own output — a reader matching `N/M`
   anywhere will eventually read a RESULT as an assertion count, which is this file's own defect
   class pointed at itself.

   So the remaining 26 are REAL debt, not a reader gap, and each is paid per-tool: make the selftest
   count its assertions and end with `all <N> selftests passed`. Do not re-derive this — the split was
   measured on 2026-09-16 by running all 26 and testing their last three lines for any numeral. */
export const UNPARSEABLE_RATCHET = new Set([
  'acc-select-compare.mjs',
  'acc-shared-movement.mjs',
  'aperiodic-method-compare.mjs',
  'deep-vlf-probe.mjs',
  'device-stability.mjs',
  'ecg-apnea-correlate.mjs',
  'find-copied-bodies.mjs',
  'find-unwired-js.mjs',
  'gate-subject.mjs',
  'nearest-advocate.mjs',
  'nsrr-stage-validate.mjs',
  'oxydex-export-staleness.mjs',
  'pat-ecg-axis-residual.mjs',
  'pat-fiducial-compare.mjs',
  'pat-fiducial.mjs',
  'pb-agreement.mjs',
  'pb-operating-point.mjs',
  'ppg-foot-residual-sweep.mjs',
  'qwen-agent.mjs',
  'release-land.mjs',
  'synth-desat-kinetics.mjs',
  'tools-index.mjs',
  'verify-fixtures.mjs',
  'wt-done.mjs'
]);

const files = readdirSync(TOOLS)
  .filter((f) => f.endsWith('.mjs') && f !== 'selftest-all.mjs')
  .filter((f) => {
    try {
      return declaresSelftest(readFileSync(join(TOOLS, f), 'utf8'));
    } catch (_) {
      return false;
    }
  })
  .sort();

/* This script is excluded from its own DISCOVERY list, which would leave its predicates ungated — the
   exact shape it exists to catch. `--selftest` therefore runs them; the CI loop finds this file by that
   same literal and runs it, so the detector is gated by the mechanism it guards. */
const TOOL_TIMEOUT_MS = 120000;

/* WHY a tool failed, not just THAT it did. `err` from execFile carries the only evidence that exists
   for a timeout (`killed`, SIGTERM) or a crash (a non-zero `code`, a stack on stderr), and it was
   discarded entirely — so every NON-assertion failure reported as a bare "FAILED" with a blank line
   under it. Ordered most-specific first: a killed process ALSO carries an exit code, so testing
   `killed` before `code` is load-bearing, and a selftest leg pins that order. */
export function whyFailed(err, timeoutMs) {
  if (!err) return null;
  if (err.killed || err.signal === 'SIGTERM') return `TIMED OUT after ${timeoutMs / 1000}s (killed, ${err.signal || 'no signal'})`;
  if (err.code != null) return `exited ${err.code}`;
  if (err.signal) return `killed by ${err.signal}`;
  return String(err.message || 'failed').split('\n')[0];
}

/* WHICH LINES to show. Assertion lines lead when the tool printed any; otherwise the TAIL of whatever
   it did say. An empty return means it said nothing at all — itself the tell for a timeout — and the
   caller prints that in words rather than as a blank line. */
export function failureLines(out) {
  const all = String(out || '').split('\n');
  const marked = all.filter((l) => l.includes('\u2717') || l.includes('FAILED'));
  if (marked.length) return marked.slice(0, 4);
  return all.filter((l) => l.trim()).slice(-6);
}

/* ── the §3d object — pure over the per-tool results, so the selftest can plant every row ───────────
   results: [{ f, ok, readable, n, why }] as `run` produces them; nearMiss: tools discovery could not run;
   ratchet: the UNPARSEABLE_RATCHET set in force. */
export function childrenFrom(results, nearMiss, ratchet) {
  const kids = results.map((r) => {
    if (!r.ok) {
      const killed = /TIMED OUT|killed by/.test(r.why || '');
      return { name: 'tools/' + r.f, provenance: 'summary', status: killed ? 'UNKNOWN' : 'FAIL', why: r.why || 'failed' };
    }
    if (!r.readable)
      return {
        name: 'tools/' + r.f,
        provenance: 'summary',
        status: 'UNKNOWN',
        why: ratchet.has(r.f) ? 'no parseable summary (ratcheted debt)' : 'no parseable summary and NOT in UNPARSEABLE_RATCHET'
      };
    return { name: 'tools/' + r.f, provenance: 'summary', status: 'PASS', n: r.n };
  });
  for (const f of nearMiss) kids.push({ name: 'tools/' + f, provenance: 'not-run', why: 'has a selftest discovery cannot reach' });
  return kids;
}

export function sweepVerdict(results, nearMiss, ratchet, { commit, commitReason, at } = {}) {
  const children = childrenFrom(results, nearMiss, ratchet);
  const agg = aggregateChildren(children, { eligible: children.length });
  const unratcheted = results.filter((r) => r.ok && !r.readable && !ratchet.has(r.f)).map((r) => r.f);
  const paid = [...ratchet].filter((f) => results.some((r) => r.f === f && r.readable));
  let { status, reason, result } = agg;
  const assertions = results.reduce((a, r) => a + (r.ok && r.readable && r.n ? r.n : 0), 0);
  if (result)
    result = {
      ...result,
      assertions,
      unratcheted,
      paid,
      children: result.children.map((c, i) => ({ ...c, ...(children[i].n ? { n: children[i].n } : {}), ...(children[i].why ? { why: children[i].why } : {}) }))
    };
  /* THE RATCHET is the runner's own pre-stated criterion; a violation is FAIL by name even when every
     child is green — it is the only thing this script adds over the CI loop (see UNPARSEABLE_RATCHET). */
  if ((unratcheted.length || paid.length) && status !== 'FAIL') {
    status = 'FAIL';
    reason =
      `ratchet violated: ${unratcheted.length} tool(s) green but unparseable and NOT in UNPARSEABLE_RATCHET (${unratcheted.join(' · ') || '—'}); ${paid.length} paid debt(s) still in the map (${paid.join(' · ') || '—'})` +
      (agg.reason ? `; also ${agg.reason}` : '');
  }
  return makeVerdict({
    gate: 'selftest-all',
    status,
    population: agg.population,
    criterion: {
      name: 'children_failing (any failing selftest ⇒ FAIL; a timeout or an unparseable summary ⇒ UNKNOWN, never green; a near-miss tool is NOT_RUN ⇒ UNKNOWN; the UNPARSEABLE_RATCHET may only go down — a violation is FAIL)',
      threshold: 0,
      unit: 'failing children',
      direction: 'eq'
    },
    result,
    evidence: children.filter((c) => c.provenance !== 'not-run').map((c) => `node ${c.name} --selftest`),
    reason,
    tool: 'tools/selftest-all.mjs',
    commit,
    commitReason,
    at
  });
}

/* A scratch result set: three parsed counts, one ratcheted-unparseable, one near miss — the honest
   shape of a real sweep today (UNKNOWN: the ratchet debt and the unreachable tool), no code identity. */
export function verdictSample() {
  const R = [
    { f: 'scratch-a.mjs', ok: true, readable: true, n: 12 },
    { f: 'scratch-b.mjs', ok: true, readable: true, n: 7 },
    { f: 'scratch-c.mjs', ok: true, readable: true, n: 30 },
    { f: 'scratch-d.mjs', ok: true, readable: false, n: null }
  ];
  return sweepVerdict(R, ['scratch-e.mjs'], new Set(['scratch-d.mjs']), {
    commit: null,
    commitReason: '--verdict-sample: a scratch result set, no sweep run, no code identity claimed',
    at: '2026-09-22T00:00:00Z'
  });
}

if (argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

if (argv.includes('--selftest')) {
  let n = 0;
  const eq = (c, m) => {
    n++;
    if (!c) {
      console.error(`  \u2717 FAILED: ${m}`);
      process.exit(1);
    }
  };
  eq(declaresSelftest("if (argv.includes('--selftest')) {"), 'includes() form is recognised');
  eq(declaresSelftest("if (has('--selftest')) {"), 'has() form is recognised');
  eq(declaresSelftest("if (argv.indexOf('--selftest') >= 0) {"), 'indexOf() form is recognised');
  eq(!declaresSelftest(' * usage: node tools/x.mjs --selftest'), 'a usage COMMENT alone does not enrol a tool');
  eq(!declaresSelftest("if (process.argv[2] === '--self-test') {"), 'the hyphenated === form is NOT recognised (this is the bug)');
  eq(declaresNearMissSelftest("if (process.argv[2] === '--self-test') { selfTest(); }"), 'the hyphenated flag is reported as a near miss');
  eq(declaresNearMissSelftest('export function selfTest() { return 3; }'), 'selftest machinery with no reachable flag is a near miss');
  eq(!declaresNearMissSelftest("if (argv.includes('--selftest')) { selfTest(); }"), 'a correctly-enrolled tool is NOT a near miss');
  eq(!declaresNearMissSelftest('export function main() { return 0; }'), 'a tool with no selftest at all is not a near miss');
  /* THE FAILURE REPORT ITSELF (2026-09-02). This filtered a failing tool's output to lines containing
     the assertion marker or FAILED — the shape of an ASSERTION failure — and dropped `err`, so a
     timeout or a crash printed a bare "FAILED" and a BLANK line. Measured: two independent
     `dsp-review-qwen` failures printed exactly that while the tool passes standalone, so the cause
     could not be diagnosed — the runner had thrown the evidence away. Verified against a planted
     hanging tool, which now reports `TIMED OUT after 120s (killed, SIGTERM)`. */
  eq(whyFailed(null, 120000) === null, 'a successful run has no failure reason');
  eq(whyFailed({ killed: true, signal: 'SIGTERM' }, 120000).startsWith('TIMED OUT after 120s'), 'a killed process is reported as a TIMEOUT, in seconds');
  eq(whyFailed({ killed: true, signal: 'SIGTERM', code: 1 }, 120000).includes('TIMED OUT'), 'timeout wins over an exit code — a killed process also carries one');
  eq(whyFailed({ code: 7 }, 120000) === 'exited 7', 'a non-zero exit reports its code');
  eq(whyFailed({ signal: 'SIGKILL' }, 120000) === 'killed by SIGKILL', 'a signal kill (OOM) is named, not swallowed');
  eq(whyFailed({ message: 'spawn ENOENT\nstack' }, 120000) === 'spawn ENOENT', 'a spawn failure reports its first line only');
  eq(failureLines('ok\n  \u2717 parse: junk\nmore').length === 1, 'assertion lines lead when the tool printed any');
  eq(failureLines('a\nb\nc\nd\ne\nf\ng\nh').length === 6, 'otherwise the TAIL is shown, capped at 6 lines');
  eq(failureLines('').length === 0, 'no output at all returns nothing — the caller says so in words');
  eq(failureLines('  \n\n  ').length === 0, 'whitespace-only output is no output');
  /* ── the bounded pool ────────────────────────────────────────────────────────────────────────
     Two contracts, and BOTH matter. Concurrency, because the whole defect was unbounded fan-out —
     84 subprocesses on 24 cores starving a tool into its own 120 s timeout. And ORDER, because the
     reporting below indexes results by position: a pool that returns completion-ordered results
     would silently attribute every failure to the wrong tool, which is a worse bug than the one
     being fixed and would not show up as a crash. */
  {
    let live = 0;
    let peak = 0;
    const seen = await runPooled(
      [5, 4, 3, 2, 1, 0, 6, 7],
      async (v) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, v));
        live--;
        return v * 10;
      },
      3
    );
    eq(peak <= 3, `the pool never exceeds its limit (peak ${peak}, limit 3)`);
    eq(peak > 1, `…and it is actually CONCURRENT, not serialised (peak ${peak})`);
    eq(seen.join(',') === '50,40,30,20,10,0,60,70', 'results stay in INPUT order, not completion order');
  }
  /* ── §3d PLANTS, one per table row, each object built through makeVerdict (an invalid one THROWS) */
  {
    const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
    const ok = (f, cnt) => ({ f, ok: true, readable: true, n: cnt });
    const R3 = [ok('a.mjs', 3), ok('b.mjs', 4), ok('c.mjs', 5)];
    const green = sweepVerdict(R3, [], new Set(), AT);
    eq(green.status === 'PASS' && green.result.assertions === 12 && green.population.checked === 3, '§3d · every tool parsed ⇒ PASS, assertions summed');
    eq(
      green.result.children.every((c) => c.provenance === 'summary' && c.n),
      '§3d · children carry provenance summary and their count'
    );
    const fail = sweepVerdict([ok('a.mjs', 3), { f: 'b.mjs', ok: false, readable: false, why: 'exited 1' }, ok('c.mjs', 5)], [], new Set(), AT);
    eq(fail.status === 'FAIL' && fail.result.firstFailure === 'tools/b.mjs', '§3d plant · a failing selftest ⇒ FAIL, named');
    const to = sweepVerdict([ok('a.mjs', 3), { f: 'b.mjs', ok: false, readable: false, why: 'TIMED OUT after 120s (killed, SIGTERM)' }], [], new Set(), AT);
    eq(to.status === 'UNKNOWN' && /b\.mjs/.test(to.reason), '§3d plant · a TIMEOUT ⇒ UNKNOWN, never a tool failure');
    const unp = sweepVerdict([ok('a.mjs', 3), { f: 'b.mjs', ok: true, readable: false, n: null }], [], new Set(['b.mjs']), AT);
    eq(unp.status === 'UNKNOWN' && unp.population.checked === 2, '§3d plant · green but unparseable (ratcheted) ⇒ UNKNOWN, still checked');
    const unr = sweepVerdict([ok('a.mjs', 3), { f: 'b.mjs', ok: true, readable: false, n: null }], [], new Set(), AT);
    eq(unr.status === 'FAIL' && /NOT in UNPARSEABLE_RATCHET \(b\.mjs\)/.test(unr.reason), '§3d plant · unparseable and NOT ratcheted ⇒ FAIL by the ratchet, named');
    const paid = sweepVerdict(R3, [], new Set(['a.mjs']), AT);
    eq(paid.status === 'FAIL' && /paid debt\(s\) still in the map \(a\.mjs\)/.test(paid.reason), '§3d plant · a paid debt left in the map ⇒ FAIL (the ratchet only goes down)');
    const nm = sweepVerdict(R3, ['z.mjs'], new Set(), AT);
    eq(
      nm.status === 'UNKNOWN' && JSON.stringify(nm.population) === JSON.stringify({ checked: 3, eligible: 4, excluded: 1 }),
      '§3d plant · a near-miss tool is NOT_RUN, excluded, and the run is UNKNOWN'
    );
    const none = sweepVerdict([], ['z.mjs'], new Set(), AT);
    eq(none.status === 'NOT_RUN' && none.result === null, '§3d plant · nothing ran ⇒ NOT_RUN with result null');
    const sample = verdictSample();
    eq(sample.status === 'UNKNOWN' && sample.population.eligible === 5 && sample.producedBy.commit === null, '§3d · --verdict-sample is the honest shape: UNKNOWN over 4 checked of 5, no commit');
  }
  /* ── a COUNT IS COMPUTED, NEVER TYPED (residue 2026-10-11-ten-tools-hardcode-a-selftest-count) ──
     Plants first — the detector's own sensitivity — then the real tree: no tool types its count. */
  {
    eq(literalCountLines("console.log(fail ? fail + ' failed of 14' : 'all 14 selftests passed');").length === 1, 'literal · the `all N selftests passed` spelling is a typed count');
    eq(literalCountLines("console.log(fails.length ? 'selftest FAILED (' + fails.length + ' of 13)' : 'x');").length === 1, 'literal · a `FAILED … of N` denominator is a typed count');
    eq(literalCountLines("console.log('selftest: all 20 selftests passed');").length === 1, 'literal · a prefixed spelling is still caught');
    eq(literalCountLines('console.log(`all ${ran} selftests passed`);').length === 0, 'literal · an interpolated count is NOT flagged');
    eq(literalCountLines('console.log(fail ? `${fail} failed of ${ran}` : `all ${ran} selftests passed`);').length === 0, 'literal · an interpolated denominator is NOT flagged');
    eq(literalCountLines("// console.log('all 14 selftests passed')\n * 'all 14 selftests passed'").length === 0, 'literal · a comment is not a print');
    eq(literalCountLines("ok(suiteReported('✓ all 7 assertions passed') === true);").length === 0, 'literal · a quoted plant that is not itself a print is not flagged');

    /* ── THE SPELLING HALF ── the `PASS (n/m)` form `SUMMARY_FORMATS` parses, which the two original
       regexes could not see. Four tools printed a flat one (measured 2026-10-20). */
    eq(literalCountLines("console.log('SELFTEST PASS (7/7)');").length === 1, 'spelling · a flat `SELFTEST PASS (7/7)` is a typed count');
    eq(literalCountLines("console.log(fail ? `FAIL (${fail})` : 'SELFTEST PASS (22/22)');").length === 1, 'spelling · a typed PASS beside an interpolated FAIL is still caught');
    eq(literalCountLines("console.log('SELFTEST PASS (12 passed, 0 failed)');").length === 1, 'spelling · the `N passed, M failed` form counts too');
    eq(literalCountLines('console.log(`SELFTEST PASS (${ran}/${ran})`);').length === 0, 'spelling · an interpolated PASS ratio is NOT flagged');
    /* DECOY: the marker word is the false-positive guard this file's own ratchet comment asks for. A
       RESULT ratio is not an assertion count, and a reader matching `n/m` anywhere would say it is. */
    eq(literalCountLines("console.log('GATE PASS (12/12)');").length === 0, 'spelling DECOY · a PASS ratio with no selftest marker is a RESULT, never an assertion count');
    eq(literalCountLines("console.log('coupling PASS (31/52) nights');").length === 0, 'spelling DECOY · a measured ratio in a tool report is not a summary');

    /* ── THE HOP HALF ── residue `2026-10-19-selftest-count-static-check-misses-a-one-hop-literal`. */
    eq(typedNumericConsts('const N = 83;\nconst NAME = 4;\n').get('N') === '83', 'hop · a numeric const is collected');
    eq(typedNumericConsts('const ROWS = items.length;\nconst R = /\\d+/;\n').size === 0, 'hop · a computed or non-numeric const is not a typed number');
    eq(typedNumericConsts('// const N = 9;\n   * const M = 9;\n').size === 0, 'hop · a const inside a comment is not collected');
    eq(typedNumericConsts('let ran = 0;\nvar seen = 0;\n').size === 0, 'hop DECOY · a `let`/`var` counter is NOT a hop — taking them flagged 56 of 104 tools, nearly all correct');
    eq(literalCountLines('const N = 83;\nconsole.log(`all ${N} selftests passed`);').length === 1, 'hop · a count one hop away in a const IS a typed count');
    eq(literalCountLines('const TOTAL = 45;\nconsole.log(`SELFTEST PASS (${TOTAL}/${TOTAL})`);').length === 1, 'hop · the `pat-window-oracle` shape the row reported (#3675)');
    eq(/typed one hop away: TOTAL = 45/.test(literalCountLines('const TOTAL = 45;\nconsole.log(`SELFTEST PASS (${TOTAL}/${TOTAL})`);')[0]), 'hop · the reported line NAMES the constant and its value');
    eq(
      literalCountLines('let ran = 0;\nconst ok = () => { ran += 1; };\nconsole.log(`all ${ran} selftests passed`);').length === 0,
      'hop DECOY · a counter the helper increments is NOT flagged — it is what the rule asks for'
    );
    eq(literalCountLines('let N = 83;\nconsole.log(`all ${N} selftests passed`);').length === 1, 'hop · a `let` nothing ever reassigns is a typed count, exactly as a const is');
    eq(literalCountLines('let N = 83;\nN = xs.length;\nconsole.log(`all ${N} selftests passed`);').length === 0, 'hop DECOY · a binding reassigned anywhere in the file is no hop');
    eq(
      literalCountLines('let n = 0;\nfor (const x of xs) n++;\nconsole.log(`all ${n} selftests passed`);').length === 0,
      'hop DECOY · an inc-only counter is disqualified by the `n++`, with no assignment to find'
    );
    eq(neverReassignedNumerics("let N = 7;\nconst s = 'N = 1; N += 1';\n").get('N') === '7', 'hop · a reassignment QUOTED in a string is not a reassignment — the mask reads code only');
    eq(
      neverReassignedNumerics('let ran = 0;\nran += 1;\n').size === 0 && neverReassignedNumerics('var N = 5;\n').get('N') === '5',
      'hop · a compound assign disqualifies, a lone `var` numeric does not'
    );
    eq(
      literalCountLines("if (argv.includes('--selftest')) {\n  console.log(fail ? `FAIL (${fail})` : 'PASS (12/12)');\n}").length === 1,
      'region · a typed ratio INSIDE the selftest block needs no marker word'
    );
    eq(
      literalCountLines("if (argv.includes('--selftest')) {\n  console.log('PASS (12/12)');\n}\nconsole.log('GATE PASS (9/9)');").length === 1,
      'region DECOY · the same spelling outside the block is still a RESULT, so only one line is reported'
    );
    eq(selftestRegions("// argv.includes('--selftest') {\nconsole.log('PASS (3/3)');").length === 0, 'region · a comment naming the flag opens no block');
    eq(
      literalCountLines("if (argv.includes('--selftest')) {\n  eq(f(\"console.log('coupling PASS (31/52)')\").length === 0, 'decoy');\n}").length === 0,
      'region · a print QUOTED inside the block is not a print — the mask decides it, never the wording'
    );
    eq(literalCountLines('const FS = 100;\nconsole.log(`resampled at ${FS} Hz`);').length === 0, 'hop DECOY · a const in a print that is not a summary is not a count');
    eq(literalCountLines('const N = 8;\nconsole.log(`all ${N} selftests passed`);\nconsole.log(`${f} failed of ${N}`);').length === 2, 'hop · both summary lines of one tool are reported');
    const typed = readdirSync(TOOLS)
      .filter((f) => f.endsWith('.mjs') && f !== 'selftest-all.mjs')
      .filter((f) => literalCountLines(readFileSync(join(TOOLS, f), 'utf8')).length > 0)
      .sort();
    eq(typed.length === 0, `no tool prints a typed assertion count — it must be incremented by the assertion helper (${typed.length}: ${typed.join(' · ')})`);
  }
  console.log(`all ${n} selftests passed`);
  process.exit(0);
}

if (argv.includes('--list')) {
  console.log(files.map((f) => '  tools/' + f).join('\n'));
  process.exit(0);
}

const run = (f) =>
  new Promise((res) => {
    const t0 = Date.now();
    execFile(process.execPath, [join(TOOLS, f), '--selftest'], { cwd: ROOT, timeout: TOOL_TIMEOUT_MS, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const ms = Date.now() - t0;
      const out = String(stdout || '') + String(stderr || '');
      const m = SUMMARY_FORMATS.map((re) => out.match(re)).find(Boolean);
      /* Load is sampled AT THE KILL, not at the end: by the time the sweep finishes the spike that
         killed the tool is gone, and an average taken then would describe a different machine. */
      res({ f, ms, load: err ? os.loadavg()[0] : null, ok: !err, n: m && m[1] ? Number(m[1]) : null, readable: !!m, out, why: whyFailed(err, TOOL_TIMEOUT_MS) });
    });
  });

const unratcheted = [];
const nearMiss = readdirSync(TOOLS)
  .filter((f) => f.endsWith('.mjs') && f !== 'selftest-all.mjs')
  .filter((f) => {
    try {
      return declaresNearMissSelftest(readFileSync(join(TOOLS, f), 'utf8'));
    } catch (_) {
      return false;
    }
  })
  .sort();

/* LOAD AT SWEEP START, and again at every kill (below). §3.4's surviving hypothesis is that the kills
   come from CROSS-SESSION load — several fleet sessions running full gates on one box — which is
   invisible from inside any single session. Printing the 1-minute load average is what turns that from a
   narrative into something falsifiable: a kill at LOW load refutes it outright, and a kill at high load
   with no other gate running refutes it differently. Costs one syscall. */
const JSON_OUT = argv.includes('--json');
const out = JSON_OUT ? (...a) => console.error(...a) : (...a) => console.log(...a);
const load0 = os.loadavg()[0];
out(`  load average at sweep start: ${load0.toFixed(2)} (${os.cpus().length} cores)`);
/* 🔴 BOUNDED, NOT `Promise.all(files.map(run))` — which spawned EVERY tool at once: measured 84 node
   subprocesses on 24 cores, against a fixed 120 s per-tool timeout. A tool that needs real CPU is then
   starved by its 83 siblings and killed at the cap, so `test:tools` reds the LOCAL `npm run check` for
   reasons unrelated to the change under test. That happened three times on 2026-09-03, on three
   unrelated branches, always to `dsp-review-qwen.mjs` (it drives a local model) — which passes
   STANDALONE at load 5.53, HIGHER than the 3.95 one of the sweep runs died at. Machine load was never
   the discriminator; the sweep manufactured its own contention.
   ⚠️ CI is unaffected and that is why this never showed there: `.github/workflows/tests.yml` runs the
   same selftests in a SEQUENTIAL bash loop, one at a time. The defect lived entirely on the local gate.
   ⚠️ NOT a bigger timeout — raising 120 s hides the fan-out and the next slow tool re-finds it.
   Order is preserved (results[i] belongs to files[i]) because the reporting below indexes by position. */
const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));
async function runPooled(list, worker, limit) {
  const out = new Array(list.length);
  let next = 0;
  async function pump() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await worker(list[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, pump));
  return out;
}
const results = await runPooled(files, run, CONCURRENCY);
/* Wall time is printed for the tools that can actually approach the timeout, so the §3.4 account stays
   testable on every run rather than only when something dies: if a ≤0.3 s tool ever times out, the
   CPU-demand explanation is refuted, and these numbers are how anyone would notice. */
const slow = (r) => (r && r.ms >= 1000 ? `  [${(r.ms / 1000).toFixed(1)} s]` : '');
let failed = 0,
  warned = 0,
  total = 0;
for (const r of results) {
  if (!r.ok) {
    failed++;
    out(`  ✗ tools/${r.f}  FAILED${r.why ? '  — ' + r.why : ''}${slow(r)}${r.load != null ? `  [load ${r.load.toFixed(2)} at the kill, ${load0.toFixed(2)} at start]` : ''}`);
    /* PRINT THE EVIDENCE THAT EXISTS, not only the evidence of one failure shape. This filtered the
       tool's output to lines containing `✗` or `FAILED` — the signature of an ASSERTION failure — so a
       timeout, a crash or any non-zero exit whose output carries neither token printed a BLANK LINE and
       the run said only that something failed. Measured 2026-09-02: two independent `dsp-review-qwen`
       failures both printed exactly that blank, while the tool passes standalone (21 ok, 0 failed) —
       the cause could not be diagnosed because the runner had thrown it away. §4b's family: a report
       that shows the part matching its expectations and silently drops the rest. Assertion lines still
       lead when present; otherwise the tail of whatever the tool did say, and `(no output at all)` when
       it said nothing, which is itself the tell for a timeout. */
    const shown = failureLines(r.out);
    out(shown.length ? shown.map((l) => '      ' + l.trim()).join('\n') : '      (no output at all — consistent with a timeout or a kill before the tool printed)');
  } else if (!r.readable) {
    /* Exited 0 but printed nothing this script recognises. WARN, do not fail.
       The EXIT CODE is the contract a tool actually declares; "must also print a summary I can parse"
       is this script's preference, and enforcing it flagged NINE pre-existing analysis tools that are
       working correctly. A gate that lands red on day one over a formatting opinion gets switched
       off, and then the real failures it would have caught go with it — the same argument that kept a
       coverage threshold out of #1163. */
    warned++;
    if (UNPARSEABLE_RATCHET.has(r.f)) {
      out(`  ⚠ tools/${r.f}  green (exit 0), but no parseable summary — cannot report an assertion count${slow(r)}`);
    } else {
      /* NOT grandfathered. The warn-don't-fail argument above is about the 48 tools that predate the
         rule; it is not a licence for the next one. A tool nobody can count assertions for is a tool
         whose suite can shrink to nothing unnoticed, and that is the only thing this script adds. */
      unratcheted.push(r.f);
      out(`  ✗ tools/${r.f}  green, but prints NO PARSEABLE ASSERTION COUNT and is not in UNPARSEABLE_RATCHET${slow(r)}`);
    }
  } else {
    total += r.n || 0;
    out(`  ✓ tools/${r.f}${r.n ? '  ' + r.n + ' assertions' : '  green'}${slow(r)}`);
  }
}
for (const f of nearMiss) {
  out(`  ✗ tools/${f}  HAS a selftest that discovery cannot reach — spell the flag \`--selftest\` and read it from a CALL, e.g. \`flag('--selftest')\` or \`argv.includes('--selftest')\``);
}
/* A tool that has PAID its debt must leave the map, or the ratchet stops being one: a stale entry is
   a standing permission nobody re-earned, and the count would drift up again behind it. */
const paid = [...UNPARSEABLE_RATCHET].filter((f) => results.some((r) => r.f === f && r.readable));
for (const f of paid) {
  out(`  ✗ tools/${f}  now reports a count — REMOVE it from UNPARSEABLE_RATCHET (the ratchet may only go down)`);
}
for (const f of unratcheted) {
  out(`  → tools/${f}: end its selftest with \`all <N> selftests passed\` (see box-sample.mjs)`);
}
out(
  `\n${failed || nearMiss.length ? `✗ ${failed} tool selftest(s) FAILED${nearMiss.length ? `, ${nearMiss.length} unreachable` : ''}` : `✓ ${results.length} tools, ${total}+ assertions — all green`}${warned ? `  (${warned} green but unparseable)` : ''}`
);
if (JSON_OUT) console.log(JSON.stringify(sweepVerdict(results, nearMiss, UNPARSEABLE_RATCHET)));
/* THE EXIT CODE STAYS — the shell and CI read it until the consumer reads the object (§3d). */
process.exit(failed || nearMiss.length || unratcheted.length || paid.length ? 1 : 0);
