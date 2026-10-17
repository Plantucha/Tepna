#!/usr/bin/env node
/*
 * brief-header-claims.mjs — the brief-header count-claim ratchet.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * A TRIAGE STAMP IS EVIDENCE-SHAPED, AND NOTHING CHECKED THAT ITS NUMBERS WERE READ. Residue row
 * `2026-09-07-drain-stamp-asserted-a-count-it-never-read`: a 2026-09-02 stamp on
 * MUTATION-COVERAGE-SELECTION asserted four nodes sit at ZERO equivalence-ledger entries and sized the
 * remainder from that. They carried 26 / 48 / 71 / 100. The stamp was not stale — it was wrong when
 * written, because the count was recalled rather than re-read, and the next session spent it as
 * measured and queued a sweep that would have regenerated 245 committed entries.
 *
 * Row `2026-09-23-sourced-claim-already-answers-the-stamp-problem` sized the fix and deliberately did
 * not build it: `tests/dex-tests.js` §8d¹ already RESOLVES `CLAIM <name> = <value> FROM <path>#<ptr>`
 * anywhere in `briefs/`, which beats naming a query because it re-reads the number instead of trusting
 * a citation. The missing half is the REQUIREMENT. This gate is that half, and nothing more: it never
 * resolves a pointer, so the repository keeps ONE resolver.
 *
 *   node tools/brief-header-claims.mjs                  # check
 *   node tools/brief-header-claims.mjs --base origin/main  # …and refuse baseline GROWTH
 *   node tools/brief-header-claims.mjs --json           # one tepna.verdict/1
 *   node tools/brief-header-claims.mjs --write-baseline # freeze today's population
 *   node tools/brief-header-claims.mjs --selftest
 *
 * ⚠️ WHY A RATCHET AND NOT A MANDATE. Measured 2026-10-17 over 563 briefs: 199 headers carry a
 * count-shaped assertion, 933 tuples. The extraction is NOT precise enough to mandate — in a 25-tuple
 * spread sample, `9 emit`, `11 name`, `0 run` and `17 now` are a number before a VERB, and no word-class
 * list separates them because `run` is a noun in this repo and a verb in that sentence. The 09-23 row's
 * "~1 false positive in 20" did not reproduce; the honest figure is nearer 1 in 6.
 *   That is §8d¹'s own measured conclusion a second time: a prose scanner's precision comes from a
 * rigid CONVENTION, not from the checking, so the marker must CREATE the convention. Hence: today's
 * tuples are FROZEN into a baseline (a false positive there costs nothing — it is a string in a JSON),
 * and a red fires only when a header GAINS a count that is neither baselined nor sourced. The baseline
 * may only SHRINK, which `--base` enforces against the ref, so appending to it is not an escape.
 *
 * ⚠️ WHAT THIS GATE DOES NOT CLAIM. A baselined count is not verified — it is GRANDFATHERED. The
 * population it reports is the debt, and the only legal way to retire a row is to source the number.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
export const BASELINE_PATH = 'tools/brief-header-claim-baseline.json';

/* FIXED GRAMMARS, EXCLUDED BY CONSTRUCTION RATHER THAN BY PRECISION. Each is a shape whose digits are
   never a count of the following word: a date, a PR number, a section number, a bare year, a clock
   time, a magnitude carrying its unit, a version or decimal, a sha. The 09-23 row's two naive
   extractions read 541 and 253 of 526 headers because these were still in the population — the
   spread is the measurement of leaving them in. ORDER MATTERS: the longest shape goes first, or a
   full date is eaten as a partial one and leaves a stray day behind. */
export const FIXED_GRAMMARS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{4}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /#\d+/g,
  /§\s?\d+(?:\.\d+)*[a-z]?/g,
  /\b(?:19|20)\d{2}\b/g,
  /\bv?\d+\.\d+(?:\.\d+)?\b/g,
  /\b\d[\d\s,]*\s*(?:ms|s|h|min|hours?|days?|ppm|%|kB|MB|GB|bpm|Hz|px|USD)\b/gi,
  /\b[0-9a-f]{7,40}\b/g
];

/* A COUNT IS AN INTEGER BEFORE A NOUN. A number before any of these is a number before a verb, a
   conjunction or a preposition — not a count of it. This list kills the sampled false positives it
   can; the ones it cannot are why the baseline exists. */
export const TAIL_STOP = new Set(
  (
    'are is was were be been being and or of in on at to by for with from as than then but not no nor so' +
    ' does do did done would will can could should may might must that which where when who whose whom' +
    ' into over under above below either both each per via plus minus already still never always only' +
    ' now here there emit emits name names run runs give gives read reads say says show shows left' +
    ' remain remains remaining more less fewer other others same such its their this these those'
  ).split(/\s+/)
);

const COUNT = /\b(\d{1,6}|zero)\s+([A-Za-z][A-Za-z-]+)/g;
/* The marker §8d¹ resolves. This gate reads only the VALUE a header sourced — resolution stays there,
   single-sourced, so a pointer is never checked twice by two drifting implementations. */
const CLAIM_FROM = /CLAIM\s+[A-Za-z][A-Za-z0-9_]*\s*=\s*(-?\d+(?:\.\d+)?)\s+FROM\s+[^\s#`]+#[A-Za-z0-9_./-]+/g;

/** The `**Status:**` line of a brief, or null when it has none. */
export function statusHeader(text) {
  const m = String(text || '').match(/^[ \t]*\*\*Status:\*\*.*$/m);
  return m ? m[0] : null;
}

/** The integer values a header SOURCED, so a count may be checked against them. */
export function sourcedValues(header) {
  return [...String(header || '').matchAll(CLAIM_FROM)].map((m) => Number(m[1]));
}

/** The count-shaped assertions in a header, after the fixed grammars and the tail stops. */
export function countClaims(header) {
  let h = String(header || '');
  for (const re of FIXED_GRAMMARS) h = h.replace(re, ' ');
  const out = [];
  for (const m of h.matchAll(COUNT)) {
    if (TAIL_STOP.has(m[2].toLowerCase())) continue;
    out.push({ tuple: `${m[1]} ${m[2]}`, value: m[1].toLowerCase() === 'zero' ? 0 : Number(m[1]) });
  }
  return out;
}

/**
 * PURE CORE. `briefs` is [{ file, text }]; `baseline` is { <file>: [tuple, …] }. No fs, so the
 * selftest plants a header without touching the repository.
 */
export function classify(briefs, baseline) {
  const rows = [];
  let headersWithClaims = 0;
  for (const { file, text } of briefs) {
    const header = statusHeader(text);
    if (header == null) {
      /* A brief with no header is `docs-ledger`'s business, not this gate's — it is NOT a silent pass
         here either, because a stamp that does not exist cannot assert a count. */
      rows.push({ file, tuple: null, status: 'no-header' });
      continue;
    }
    const claims = countClaims(header);
    if (claims.length) headersWithClaims += 1;
    const srcd = sourcedValues(header);
    const base = new Set(baseline[file] || []);
    for (const c of claims) {
      if (srcd.includes(c.value)) rows.push({ file, tuple: c.tuple, status: 'sourced' });
      else if (base.has(c.tuple)) rows.push({ file, tuple: c.tuple, status: 'baselined' });
      else rows.push({ file, tuple: c.tuple, status: 'unsourced-new-claim' });
    }
  }
  const violations = rows.filter((r) => r.status === 'unsourced-new-claim');
  /* RETIRED entries are REPORTED, never a violation: a stamp reworded or sourced is the direction this
     ratchet exists to buy, and a gate that reds on progress gets switched off. */
  const live = new Set(rows.filter((r) => r.tuple).map((r) => `${r.file}\u0000${r.tuple}`));
  const retired = [];
  for (const [file, tuples] of Object.entries(baseline)) {
    for (const t of tuples) if (!live.has(`${file}\u0000${t}`)) retired.push({ file, tuple: t });
  }
  return { rows, violations, retired, headersWithClaims, baselineSize: Object.values(baseline).reduce((a, v) => a + v.length, 0) };
}

/** Tuples the baseline GAINED against its own earlier copy. A ratchet may only shrink. */
export function baselineGrowth(before, after) {
  const added = [];
  for (const [file, tuples] of Object.entries(after || {})) {
    const was = new Set((before || {})[file] || []);
    for (const t of tuples) if (!was.has(t)) added.push({ file, tuple: t });
  }
  return added;
}

function readBriefs() {
  const dir = join(ROOT, 'briefs');
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ file: `briefs/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
}

function readBaseline() {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8'));
    return j.headers || {};
  } catch {
    return null;
  }
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };
  const brief = (status) => [{ file: 'briefs/X-BRIEF.md', text: `<!-- c -->\n**Status:** ${status}\n\nbody\n` }];

  // THE INCIDENT ITSELF, in miniature: the stamp that asserted a count it never read.
  const stamp = 'PROPOSED (core BUILT, remainder X-blocked — verified 2026-09-02: four nodes sit at zero entries)';
  ok(
    countClaims(`**Status:** ${stamp}`).some((c) => c.tuple === 'zero entries'),
    'the 2026-09-02 stamp shape is detected'
  );
  ok(classify(brief(stamp), {}).violations.length === 1, 'an unbaselined, unsourced count is a violation');
  ok(classify(brief(stamp), { 'briefs/X-BRIEF.md': ['zero entries'] }).violations.length === 0, 'the same count, baselined, is grandfathered');

  // THE WAY OUT IS THE GRAMMAR, and it is matched by VALUE, not by the presence of a marker.
  const sourced = '**Status:** DONE — 2026-10-17 · CLAIM nodeEntries = 26 FROM tools/mutate-equivalence.json#cpapdex, so 26 nodes stand';
  ok(classify([{ file: 'briefs/X-BRIEF.md', text: sourced }], {}).violations.length === 0, 'a count whose value a sourced CLAIM states needs no baseline');
  const mixed = '**Status:** DONE — CLAIM a = 26 FROM f.json#k · and 48 nights';
  ok(classify([{ file: 'briefs/X-BRIEF.md', text: mixed }], {}).violations.length === 1, 'a SECOND, different count in a sourced header is still a violation');

  /* THE FIXED GRAMMARS. Each digit shape below is never a count of the word after it, and the 09-23
     row's inflated 541-of-526 extraction is what leaving them in measures. */
  for (const [h, why] of [
    ['**Status:** DONE — 2026-10-17 · **Created:** 2026-09-02', 'a date is not a count'],
    ['**Status:** DONE — fixed #3575 and #3580', 'a PR number is not a count'],
    ['**Status:** REFERENCE (living — see §4.4 and §2c)', 'a section number is not a count'],
    ['**Status:** DONE — the 2026 sweep', 'a bare year is not a count'],
    ['**Status:** DONE — a 21 min run at 49.7 ms', 'a magnitude carries its unit and is not a count'],
    ['**Status:** DONE — v2.19.0 shipped', 'a version is not a count'],
    ['**Status:** DONE — at 3c0dbdec', 'a sha is not a count'],
    ['**Status:** DONE — the 18:40 poll', 'a clock time is not a count']
  ])
    ok(countClaims(h).length === 0, why);

  // A NUMBER BEFORE A VERB is not a count, which is the measured false-positive class.
  ok(countClaims('**Status:** DONE — 11 name the defect, 0 run clean, 17 now pending').length === 0, 'a number before a verb or adverb is excluded');
  // …and a real count survives all of it.
  ok(
    countClaims('**Status:** DONE — 26 nights scored').some((c) => c.value === 26),
    'a plain count is still detected'
  );

  // THE RATCHET. Growth is refused; shrinkage is the point.
  ok(baselineGrowth({ a: ['1 x'] }, { a: ['1 x', '2 y'] }).length === 1, 'an appended baseline tuple is GROWTH and is refused');
  ok(baselineGrowth({ a: ['1 x', '2 y'] }, { a: ['1 x'] }).length === 0, 'a removed tuple is shrinkage and is legal');
  ok(baselineGrowth({}, { b: ['3 z'] }).length === 1, 'a whole new baselined file is growth too');

  // RETIREMENT IS REPORTED, NOT RED.
  const ret = classify(brief('DONE — nothing numeric'), { 'briefs/X-BRIEF.md': ['zero entries'] });
  ok(ret.violations.length === 0 && ret.retired.length === 1, 'a baselined tuple that is gone is reported as retired, never as a failure');

  // A HEADERLESS BRIEF IS NAMED, NOT SILENTLY SKIPPED.
  ok(classify([{ file: 'briefs/Y.md', text: 'no header here' }], {}).rows[0].status === 'no-header', 'a brief with no Status header is reported');

  // ANTI-VACUITY: the population must be real, or a green says nothing.
  ok(classify([], {}).rows.length === 0, 'an empty corpus produces no rows, which main() treats as a failure rather than a pass');

  const line = fail.length ? `brief-header-claims selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function verdictOf({ status, res, growth, scanned, reason }) {
  const v = Verdict.make({
    gate: 'brief-header-claims',
    status,
    population: { checked: scanned, eligible: scanned, excluded: 0 },
    criterion: {
      name: 'no_unbaselined_unsourced_count_in_a_brief_status_header',
      threshold: 0,
      unit: 'unsourced new claims',
      direction: 'eq'
    },
    result: {
      briefsScanned: scanned,
      headersWithACount: res.headersWithClaims,
      baselinedTuples: res.baselineSize,
      sourcedTuples: res.rows.filter((r) => r.status === 'sourced').length,
      retiredTuples: res.retired.length,
      unsourcedNewClaims: res.violations.map((r) => `${r.file}: ${r.tuple}`),
      baselineGrowth: (growth || []).map((r) => `${r.file}: ${r.tuple}`)
    },
    evidence: ['tools/brief-header-claims.mjs', BASELINE_PATH, 'briefs/RESIDUE.md'],
    reason: status === 'PASS' ? null : reason,
    producedBy: {
      tool: 'tools/brief-header-claims.mjs',
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
  if (!chk.ok) throw new Error(`brief-header-claims produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const briefs = readBriefs();
  if (!briefs || briefs.length === 0) {
    process.stderr.write('✕ brief-header-claims: briefs/ is unreadable or empty — a gate that examined nothing is not a pass\n');
    process.exit(1);
  }

  if (argv.includes('--write-baseline')) {
    const headers = {};
    for (const { file, text } of briefs) {
      const h = statusHeader(text);
      if (h == null) continue;
      const srcd = sourcedValues(h);
      const bare = countClaims(h).filter((c) => !srcd.includes(c.value));
      if (bare.length) headers[file] = [...new Set(bare.map((c) => c.tuple))];
    }
    const n = Object.values(headers).reduce((a, v) => a + v.length, 0);
    writeFileSync(
      join(ROOT, BASELINE_PATH),
      `${JSON.stringify(
        {
          schema: 'tepna.brief-header-claim-baseline/1',
          frozen: new Date().toISOString().slice(0, 10),
          note: 'Count-shaped assertions standing in brief **Status:** headers when the ratchet was frozen. GRANDFATHERED, never verified: an entry here is a number a stamp asserts and no artifact re-resolves. The only legal edit is REMOVAL — source the number as `CLAIM <name> = <value> FROM <path>#<pointer>` (resolved by tests/dex-tests.js §8d¹) or reword the header. Growth is refused by `--base`. Some entries are extraction false positives; they cost nothing here, which is why the ratchet is frozen rather than mandated.',
          residue: '2026-09-07-drain-stamp-asserted-a-count-it-never-read',
          /* THE DEBT AS TWO SCALARS, so a brief may SOURCE it and §8d¹ re-resolves the number. This is
             the escape path exercised in the tree rather than only in the selftest: shrink the baseline
             and the brief that quotes it reds until the quote moves. */
          tupleCount: n,
          headerCount: Object.keys(headers).length,
          headers
        },
        null,
        1
      )}\n`
    );
    process.stdout.write(`frozen ${n} tuple(s) across ${Object.keys(headers).length} header(s) into ${BASELINE_PATH}\n`);
    process.exit(0);
  }

  const baseline = readBaseline();
  if (baseline == null) {
    process.stderr.write(`✕ brief-header-claims: ${BASELINE_PATH} is missing or invalid — the ratchet has no floor, which is not a pass\n`);
    process.exit(1);
  }
  const res = classify(briefs, baseline);

  /* THE RATCHET'S OTHER HALF. Without this, appending to the baseline is the escape, and the gate
     measures nothing but a session's willingness to edit a JSON. */
  let growth = [];
  const bi = argv.indexOf('--base');
  if (bi !== -1 && argv[bi + 1]) {
    const ref = argv[bi + 1];
    try {
      const prior = JSON.parse(execFileSync('git', ['show', `${ref}:${BASELINE_PATH}`], { cwd: ROOT, encoding: 'utf8' }));
      growth = baselineGrowth(prior.headers || {}, baseline);
    } catch {
      /* ABSENT AT THE BASE IS NOT GROWTH — this is how the gate's own first commit passes, and the
         file's absence is visible in that diff. A ref that does not exist is the caller's error and
         is reported rather than swallowed into a green. */
      if (!/^[0-9a-zA-Z._/-]+$/.test(ref)) {
        process.stderr.write(`✕ brief-header-claims: --base ${ref} is not a readable ref\n`);
        process.exit(1);
      }
    }
  }

  const reasons = [];
  if (res.violations.length) reasons.push(`${res.violations.length} unsourced new count(s) in a Status header`);
  if (growth.length) reasons.push(`${growth.length} tuple(s) APPENDED to the baseline — a ratchet may only shrink`);
  const status = reasons.length ? 'FAIL' : 'PASS';

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, res, growth, scanned: briefs.length, reason: reasons.join('; ') }), null, 1)}\n`);
  } else {
    for (const r of res.violations)
      process.stderr.write(
        `✕ ${r.file}: the Status header asserts "${r.tuple}" and nothing re-reads it — source it as \`CLAIM <name> = ${r.tuple.split(' ')[0]} FROM <path>#<pointer>\`, or reword the header\n`
      );
    for (const g of growth) process.stderr.write(`✕ ${BASELINE_PATH} gained "${g.tuple}" for ${g.file} — the baseline may only shrink\n`);
    if (res.retired.length) process.stdout.write(`· ${res.retired.length} baselined tuple(s) no longer appear — remove them from the baseline when convenient\n`);
    if (status === 'PASS')
      process.stdout.write(
        `brief-header-claims: ✓ PASS — ${briefs.length} briefs, ${res.headersWithClaims} header(s) carry a count, ${res.baselineSize} grandfathered, ${res.rows.filter((r) => r.status === 'sourced').length} sourced\n`
      );
    else process.stderr.write(`\nbrief-header-claims: FAIL — ${reasons.join('; ')}\n`);
  }
  process.exit(status === 'PASS' ? 0 : 1);
}

main();
