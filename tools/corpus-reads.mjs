#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// corpus-reads.mjs — decide, from a tool's SOURCE, whether it enumerates a corpus root it was
// handed at run time, and whether it reports the population it actually covered.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: Residue `2026-10-21-sixty-eight-corpus-enumerators-still-measure-whatever-set-
// they-caught`. `tools/corpus-scope.mjs` holds the primitive — `snapshotNights` around the run,
// `populationVerdict` at the end — and `tepna-corpus-tier.service` re-tiers the corpus daily at
// 14:30 EDT, so a long run can open over one night set and close over another. ONE tool reports
// the set it covered. Nothing MAKES any other tool do it, so a new corpus consumer inherits the
// defect by default rather than by oversight.
//
// THE PREDICATE IS THE HARD PART, AND TWO OBVIOUS ONES ARE BOTH WRONG:
//
//   "names a corpus root"  over-counts. 65 files in tools/ name `/srv/data/tepna-corpus`,
//                          `$DEX_UPLOADS` or an `uploads/` path. Most name it in a usage line or a
//                          comment and never enumerate anything, so no population can move under
//                          them.
//   "names a corpus root   under-counts, and it fails on the one known-good case: the wired
//    AND enumerates"       consumer `tools/tch-firmware-reference.mjs` takes `--dir <captures
//                          root>` and names no root at all. A scan that misses the control will
//                          miss the cases nobody has looked at.
//
// So the question this asks is neither. It is: DOES THIS TOOL ENUMERATE A DIRECTORY WHOSE PATH
// ARRIVED AT RUN TIME? A directory built from the repo root is a committed tree and cannot be
// re-tiered under the run. A directory off `process.argv`, `process.env` or a function parameter
// is whatever the caller pointed at, and that is the set that moves.
//
// Every class carries a `why`, because an abstention with an empty reason reads as a clearance.
//
// Usage:
//   node tools/corpus-reads.mjs                 # classify every tool under tools/
//   node tools/corpus-reads.mjs --json
//   node tools/corpus-reads.mjs --class enumerates
//   node tools/corpus-reads.mjs --selftest
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { maskNonCode } from './argv-reads.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The five classes, closed. A sixth would be a silent re-definition of the hazard set. */
export const TOOL_CLASSES = ['reports', 'enumerates', 'repo-tree', 'undecidable', 'no-enumeration'];

/* A directory read. `execFileSync('find', …)` counts: it enumerates, whatever walks it. */
/* ⚠️ `snapshotNights` IS AN ENUMERATION, and leaving it out inverted this scan. A tool that moves
   its walk behind `corpus-scope.mjs` stops calling `readdirSync` itself, so the first version of
   this list read the wired tool as "enumerates no directory" — the same bin as a tool that never
   touches a capture. Measured 2026-10-21 on `tch-fused-corpus.mjs`: wiring the population verdict
   moved it from `enumerates` to `no-enumeration`, which is a hazard set that shrinks because the
   hazard became invisible. The helper call is the enumeration, and its first argument is the root. */
const ENUM_CALL = /\b(readdirSync|opendirSync|globSync|snapshotNights)\s*\(|\breaddir\s*\(|execFileSync\(\s*['"]find['"]/g;

/* An expression that can only name a tree inside this checkout. `process.cwd()` is included on
   purpose: a tool run from the repo reads the repo, and a tool run elsewhere is already outside
   the population this gate describes. */
const REPO_DERIVED = /\b(HERE|ROOT|REPO|__dirname|import\.meta\.dirname)\b|process\.cwd\(\)|fileURLToPath/;

/* A path that arrived from outside the process. */
const RUNTIME_SUPPLIED = /process\.argv|process\.env|\bargv\b|\bopts?\.|\bflags?\./;

/* THE SCAN'S OWN POPULATION RULE. A tool that enumerates a run-time path is not yet a corpus
   consumer: `wt-done.mjs` walks a worktree, `repo-map.mjs` walks the checkout, and this file walks
   `tools/`. What makes a read a CORPUS read is capture vocabulary — a night-shaped directory name,
   a capture file suffix, or a named corpus root. Without this second axis the hazard set reads 59
   and most of it is repository housekeeping. */
const CAPTURE_VOCAB = [
  /\\d\{4\}-\\d\{2\}-\\d\{2\}/, // a night-shaped name TESTED AS A REGEX. A bare 2026-10-21 is
  //                                  excluded: nearly every file header carries a date, and
  //                                  including it put 248 of 286 tools in the population.
  /_(?:ECG|PPG|PPI|RR|HR|ACC)\\?\.txt|_SPO2|\\?\.edf\b/i, // `\\?` because a tool that writes the
  //   suffix inside a REGEX writes `_PPG\.txt`, and a pattern without the optional backslash matches
  //   only the plain-string form. `pat-dip-index.mjs` carries both suffixes in regex form alone, so
  //   the strict pattern dropped it out of the population the moment its night regex was wired away.
  /\/srv\/data\/tepna-corpus|DEX_UPLOADS|CORPUS-LOCATIONS|corpusSearch/,
  /corpus-scope\.mjs|snapshotNights\s*\(/, // the night primitive itself: a tool that calls it
  //                                  reads nights, and delegating the walk must not delete the
  //                                  evidence that it does.

  /captures? root|night(?:s)? root|per-night/i
];

/** Is this file a CORPUS consumer at all? The gate's population rule. PURE. */
export function isCorpusConsumer(text) {
  /* READ OVER THE RAW TEXT, NOT THE MASKED CODE. A capture suffix almost always sits inside a
     string literal (`'_ECG.txt'`), and masking blanks every string — reading the mask here cut the
     population from 50-odd tools to 16 and quietly dropped most real corpus consumers. A usage
     line that says `--dir <captures root>` is evidence too. The population rule is deliberately
     generous; the precision lives in the origin axis below, which decides what the tool ENUMERATES. */
  return CAPTURE_VOCAB.some((re) => re.test(String(text)));
}

/** Every identifier the file declares, mapped to the text of its initialiser. PURE. */
export function declarations(masked) {
  const out = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g;
  for (const m of masked.matchAll(re)) if (!out.has(m[1])) out.set(m[1], m[2]);
  return out;
}

/** Every identifier that is a function parameter somewhere in the file. PURE. */
export function parameters(masked) {
  const out = new Set();
  const re = /(?:function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|\b([A-Za-z_$][\w$]*)\s*=>)/g;
  for (const m of masked.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    for (const p of raw.split(',')) {
      const name = p
        .trim()
        .replace(/[={].*$/, '')
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  }
  return out;
}

/** Trace one argument expression to an origin. PURE, and it abstains rather than guessing. */
export function originOf(expr, decls, params, seen = new Set()) {
  const e = String(expr || '').trim();
  if (!e) return { origin: 'undecidable', why: 'the enumeration call has no readable argument' };
  if (REPO_DERIVED.test(e)) return { origin: 'repo', why: null };
  if (RUNTIME_SUPPLIED.test(e)) return { origin: 'runtime', why: null };
  /* A bare string literal is a repo-relative path: the mask has already removed real strings, so a
     surviving quote is impossible — an unquoted bare word is an identifier, resolved below. */
  const id = /^([A-Za-z_$][\w$]*)$/.exec(e);
  if (id) {
    const name = id[1];
    if (seen.has(name)) return { origin: 'undecidable', why: `\`${name}\` resolves to itself` };
    seen.add(name);
    if (params.has(name) && !decls.has(name)) return { origin: 'runtime', why: null };
    if (decls.has(name)) return originOf(decls.get(name), decls, params, seen);
    return { origin: 'undecidable', why: `\`${name}\` is neither declared nor a parameter in this file` };
  }
  /* A call or a join of several parts: decide on the parts. */
  const inner = e.replace(/^[A-Za-z_$][\w$]*\s*\(/, '').replace(/\)\s*$/, '');
  if (inner !== e) {
    const parts = inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seenOrigins = parts.map((p) => originOf(p, decls, params, new Set(seen)).origin);
    if (seenOrigins.includes('runtime')) return { origin: 'runtime', why: null };
    if (seenOrigins.includes('repo')) return { origin: 'repo', why: null };
  }
  return { origin: 'undecidable', why: `the argument \`${e.slice(0, 48)}\` traces to no declaration` };
}

/** The argument text of every enumeration call in the file, with its origin. PURE. */
export function enumerationSites(text) {
  const masked = maskNonCode(text);
  const decls = declarations(masked);
  const params = parameters(masked);
  const sites = [];
  for (const m of masked.matchAll(ENUM_CALL)) {
    const open = masked.indexOf('(', m.index + (m[0].endsWith('(') ? m[0].length - 1 : 0));
    if (open < 0) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const args = masked.slice(open + 1, end);
    const first = splitTop(args)[0] || '';
    const call = m[0].replace(/\s*\($/, '').replace(/\($/, '');
    const arg = /find/.test(call) ? splitTop(args)[1] || '' : first;
    sites.push({ call: call.trim(), arg: arg.trim(), ...originOf(arg, decls, params) });
  }
  return sites;
}

/** Split an argument list on top-level commas. PURE. */
export function splitTop(args) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(args)) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Decide one tool from its source. PURE. */
export function classifyTool(text) {
  const sites = enumerationSites(text);
  if (sites.length === 0) return { cls: 'no-enumeration', why: 'the file enumerates no directory', sites };
  const masked = maskNonCode(text);
  if (/\bpopulationVerdict\s*\(/.test(masked)) {
    return { cls: 'reports', why: null, sites };
  }
  const runtime = sites.filter((s) => s.origin === 'runtime');
  if (runtime.length > 0) {
    return { cls: 'enumerates', why: `${runtime.length} enumeration(s) over a path supplied at run time, with no population verdict`, sites };
  }
  const undec = sites.filter((s) => s.origin === 'undecidable');
  if (undec.length > 0 && undec.length === sites.length) {
    return { cls: 'undecidable', why: undec[0].why, sites };
  }
  return { cls: 'repo-tree', why: null, sites };
}

/* THE SCANNER IS NOT ITS OWN SUBJECT. This file carries every corpus root and capture suffix the
   population rule looks for, and it enumerates `tools/` off a parameter, so it classifies itself as
   a corpus consumer that enumerates a run-time path. That is the §4 self-match: a scan whose own
   text is its pattern reports about itself. Named here rather than filtered silently. */
export const SELF = 'tools/corpus-reads.mjs';

/** Classify every tool under one directory. Returns rows sorted by name. */
/* ── THE NAMED SET: corpus enumerators that report no population ───────────────────────────────
   DEBT, NOT APPROVAL. Each value is the number of run-time enumerations the scan found in that
   tool. A ratchet on the COUNT would pass a new consumer arriving as another one left, so the
   suite group pins the NAMES and reds in both directions: an unlisted enumerator, and a listed
   tool the scan has stopped reading as one.

   It lives here rather than in the suite because `verdict-adoption.mjs` reads a tool stem named
   under `tests/` as evidence that a test covers it. A hazard list is not that, and the mention
   alone reded its ratchet. */
export const UNWIRED_BACKLOG = {
  'acc-select-compare.mjs': 1,
  'acc-shared-movement.mjs': 1,
  'beat-correspondence.mjs': 1,
  'beat-error-recovery.mjs': 2,
  'codex-export.mjs': 1,
  'cvhr-fold-rescore.mjs': 1,
  'device-stability.mjs': 1,
  'dual-clock-rate.mjs': 1,
  'eqc-run.mjs': 2,
  'geometry-scan.mjs': 1,
  'h10-session-rate.mjs': 1,
  'hostaxis-estimator-bakeoff.mjs': 1,
  'nsrr-criterion-sweep.mjs': 1,
  'nsrr-oxydex-odi.mjs': 2,
  'oracle-ecg-firmware-rr.mjs': 3,
  'pat-drift-attribution.mjs': 2,
  'pat-ecg-axis-residual.mjs': 1,
  'pat-finger-coupler.mjs': 1,
  'pat-matchrate-strict.mjs': 2,
  'pat-mode-posture.mjs': 2,
  'pat-ppg-ppg-control.mjs': 1,
  'pat-residual-structure.mjs': 2,
  'pat-window-oracle.mjs': 1,
  'pin-coverage.mjs': 2,
  'pletha-marker-oracle.mjs': 1,
  'ppg-fusion-e3.mjs': 1,
  'ppg-gap-bridge-scan.mjs': 1,
  'ppg2w-spo2-fit.mjs': 1,
  'ppi-jitter-vs-ecg.mjs': 1,
  'resp-acc-headless.mjs': 2,
  'stage-lab.mjs': 11,
  'stitch-31d-run.mjs': 3,
  'stuck-run-lengths.mjs': 1,
  'trio-batch.mjs': 1,
  'wearable-sync.mjs': 1
};

export function scanDir(dir) {
  const rows = [];
  for (const f of readdirSync(dir)
    .filter((n) => /\.(mjs|js)$/.test(n))
    .sort()) {
    const text = readFileSync(join(dir, f), 'utf8');
    const r = classifyTool(text);
    const runtime = r.sites.filter((x) => x.origin === 'runtime').length;
    rows.push({ tool: `tools/${f}`, cls: r.cls, why: r.why, sites: r.sites.length, runtime, corpus: isCorpusConsumer(text) && `tools/${f}` !== SELF });
  }
  return rows;
}

const ARGV_SPEC = { valued: ['--class'], boolean: ['--json', '--selftest'] };

function selftest() {
  const cases = [
    ['a run-time directory with no verdict', 'const dir = process.argv[2];\nreaddirSync(dir);', 'enumerates'],
    ['a parameter is run-time too', 'function walk(root) { return readdirSync(root); }', 'enumerates'],
    ['the repo tree is not a corpus', "const ROOT = join(HERE, '..');\nreaddirSync(join(ROOT, 'tools'));", 'repo-tree'],
    ['a wired consumer reports', 'const dir = process.argv[2];\nconst b = snapshotNights(dir);\nreaddirSync(dir);\npopulationVerdict(b, a);', 'reports'],
    ['no enumeration at all', "const p = '/srv/data/tepna-corpus';\nconsole.log(p);", 'no-enumeration'],
    ['a root named in a COMMENT does not enumerate', '// walks /srv/data/tepna-corpus nightly\nconst x = 1;', 'no-enumeration'],
    ['an unresolvable argument abstains, it does not clear', 'readdirSync(someGlobal);', 'undecidable']
  ];
  let bad = 0;
  for (const [name, src, want] of cases) {
    const got = classifyTool(src).cls;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${name} → ${got}${ok ? '' : ` (wanted ${want})`}`);
  }
  /* THE CONTROL THE NAIVE PREDICATE FAILS. It names no corpus root and it is the one wired
     consumer, so a scan that does not read it as `reports` is measuring the wrong thing. */
  const ctl = classifyTool(readFileSync(join(HERE, 'tch-firmware-reference.mjs'), 'utf8'));
  const ctlOk = ctl.cls === 'reports';
  if (!ctlOk) bad++;
  console.log(`  ${ctlOk ? '✓' : '✗'} CONTROL tools/tch-firmware-reference.mjs → ${ctl.cls} (names no corpus root)`);
  const every = TOOL_CLASSES.every((c) => typeof c === 'string');
  if (!every) bad++;
  console.log(`  ${every ? '✓' : '✗'} the class vocabulary is ${TOOL_CLASSES.length} closed names`);
  /* The count is the point: `tools/selftest-all.mjs` reads PASS either way, and a suite quietly
     shrinking from nine legs to three is visible only in this number. */
  const total = cases.length + 2;
  console.log(bad === 0 ? `all ${total} selftests passed` : `corpus-reads selftest: FAIL (${bad} of ${total})`);
  return bad === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, ARGV_SPEC, { tool: 'tools/corpus-reads.mjs' });
  if (argv.includes('--selftest')) process.exit(selftest());
  const only = argv.includes('--class') ? argv[argv.indexOf('--class') + 1] : null;
  const rows = scanDir(HERE).filter((r) => (only ? r.cls === only : true));
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ rows }, null, 2));
  } else {
    const by = {};
    for (const r of scanDir(HERE)) by[r.cls] = (by[r.cls] || 0) + 1;
    for (const r of rows) console.log(`${r.cls.padEnd(15)} ${r.tool}${r.why ? `  — ${r.why}` : ''}`);
    console.log(`\n${TOOL_CLASSES.map((c) => `${c} ${by[c] || 0}`).join(' · ')}`);
  }
}
