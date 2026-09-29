/**
 * tools/absence-ledger.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * A STATE PER FINDING FOR `audits/ABSENCE-SURVEY-2026-09-22.json`, written by this tool and never by
 * hand. The survey confirmed 290 findings on 2026-09-23 and there was nowhere to record what happened
 * to any of them, so nothing did: `capture-host/mmeta.py:112` sat CONFIRMED for six days while the
 * same defect was found again independently and fixed by #3216. A finding with no state is a finding
 * nobody can be said to have dropped.
 *
 * ⚠️ THE SURVEY'S OUTPUT IS NOT EDITED. The state lives in a SIDECAR beside it. What 130 agents found
 * on 2026-09-23 is a record of that date, and a drain that rewrites it loses the ability to say what
 * was found versus what was done about it — the same rule as a capture: the bytes are immutable and
 * correction lives beside the file, dated and attributed (`CLAUDE.md` §∅).
 *
 * ── THE KEY IS CONTENT PLUS POSITION ────────────────────────────────────────────────────────────
 * Line numbers move on every edit, so a line-keyed state file detaches from its finding the first
 * time anything above it changes. The key is therefore `file · kind · normalised snippet`, plus an
 * OCCURRENCE ORDINAL among identical triples — #3192's lesson, learnt when a content-only key mapped
 * two distinct mutants onto one entry and blanked four of them.
 *
 * Measured on the committed artifact: 290 findings, 290 distinct triples, so **every ordinal is 0
 * today and the ordinal adds nothing to any current key**. It is here anyway, because that is exactly
 * what was true of the mutant ledger the day before it was not.
 *
 * ── THREE STATES, NOT TWO ───────────────────────────────────────────────────────────────────────
 *   open                  nothing has been decided about it
 *   fixed                 the code no longer does what the finding describes
 *   accepted-with-reason  it still does, deliberately, and the REASON is recorded in the code
 *
 * The third is not bureaucracy, it is what a two-state drain gets wrong forever. `telemetry.py:118`
 * (`calibrated_for`) treats an unknown rate as in-domain and its docstring now says why: *"AN UNKNOWN
 * RATE (None) IS TREATED AS IN-DOMAIN. That is deliberate and is the one concession: every caller that
 * cannot report a rate predates this parameter, and refusing there would silently disable worn
 * detection for all of them."* That is neither open nor fixed, and with two states it is re-litigated
 * by every session that reaches it.
 *
 * `accepted-with-reason` REQUIRES a `reason`; the schema refuses it empty, because an acceptance whose
 * argument is not written down is indistinguishable from a finding somebody gave up on.
 *
 * ── WHAT THIS TOOL DOES NOT CLAIM ───────────────────────────────────────────────────────────────
 * It does not decide states. The seeds below come from HAND-READING the seven capture-host findings
 * whose recorded snippet no longer matches the file, and everything else is `open` — including the 55
 * JS findings in the same condition, which were NOT read and must not be credited as fixed. Reclaiming
 * by content is not decidable on this artifact: snippets carry the survey's own annotations, 21 of them
 * contain literal ellipses, and several collapse multi-line source onto one line, so an automated
 * "gone" over-counted fixes by ~3.5× on the only population small enough to check
 * (`audits/COUNTING-ZERO-POPULATION-SURVEY-2026-09-29.md`).
 *
 *   node tools/absence-ledger.mjs             # verify: re-key and compare against the committed file
 *   node tools/absence-ledger.mjs --write     # (re)write the sidecar
 *   node tools/absence-ledger.mjs --selftest  # the properties below
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SURVEY = join(ROOT, 'audits', 'ABSENCE-SURVEY-2026-09-22.json');
export const LEDGER = join(ROOT, 'audits', 'ABSENCE-SURVEY-2026-09-22-STATE.json');

export const STATES = ['open', 'fixed', 'accepted-with-reason'];

/** Whitespace-collapsed, so a reformat does not re-key a finding. Nothing else is normalised: the
 *  snippet's TEXT is the identity, and lowering or stripping punctuation would merge distinct ones. */
export const normalise = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** `file · kind · snippet · occurrence` → a 12-hex digest. The ordinal is the count of identical
 *  triples seen BEFORE this one, so entry order in the survey fixes it and re-running is stable. */
export function keyOf(finding, occurrence = 0) {
  const parts = [finding.file, finding.kind, normalise(finding.snippet), String(occurrence)];
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

/** Every finding keyed, with its ordinal resolved. Pure. */
export function keyAll(confirmed) {
  const seen = new Map();
  return confirmed.map((f) => {
    const triple = [f.file, f.kind, normalise(f.snippet)].join('\u0000');
    const occurrence = seen.get(triple) ?? 0;
    seen.set(triple, occurrence + 1);
    return { key: keyOf(f, occurrence), occurrence, finding: f };
  });
}

/** A row is well-formed, or this says which rule it breaks. Pure; returns null when it is fine. */
export function rowProblem(row) {
  if (!row || typeof row !== 'object') return 'not an object';
  if (!STATES.includes(row.state)) {
    return `state ${JSON.stringify(row.state)} is not one of ${STATES.join(' · ')}`;
  }
  if (row.state === 'accepted-with-reason' && !normalise(row.reason)) {
    return 'accepted-with-reason carries no reason — an acceptance whose argument is not written down is a finding somebody gave up on';
  }
  return null;
}

/* ── THE SEEDS. Hand-read 2026-09-29; see the audit named in the header. Keyed by file+line ONLY here,
 *    because that is how a human reads them; the tool converts to the content key below, which is what
 *    is stored. A seed that matches no finding is a REFUSAL, not a silent no-op. ─────────────────── */
export const SEEDS = [
  {
    at: 'capture-host/allan.py:655',
    state: 'fixed',
    note: 'the [-2,+2] clamp is gone and the docstring now states why it was wrong; verified by reading the file 2026-09-29'
  },
  {
    at: 'capture-host/sealbox.py:280',
    state: 'fixed',
    note: '`max(..., default=<now>)` replaced by an explicit list plus "if nothing is left the answer is absence, not now"'
  },
  {
    at: 'capture-host/telemetry.py:118',
    state: 'accepted-with-reason',
    reason:
      'calibrated_for treats an unknown rate (None) as in-domain, deliberately: every caller that cannot report a rate predates the parameter, and refusing there would silently disable worn detection for all of them. The concession and its cost are stated in the function docstring.'
  },
  {
    at: 'capture-host/probe_verity_survey.py:587',
    state: 'open',
    note: 'reads as "gone" only because the recorded snippet collapses a multi-statement line; `or b""` is still present, 5 occurrences in the file'
  },
  {
    at: 'capture-host/probe_verity_offline.py:187',
    state: 'open',
    note: 'same false-gone as probe_verity_survey.py:587 — `or b""` still present'
  },
  {
    at: 'capture-host/nightqc.py:1676',
    state: 'open',
    note: 'the recorded line was refactored away; whether the defect went with it is NOT decidable from content, so it stays open rather than being credited'
  },
  {
    at: 'capture-host/writers.py:1544',
    state: 'open',
    note: 'that `except OSError: pass` is gone from this site; the pattern lives elsewhere WITH a reason comment. Not the same site, so not a fix of this finding'
  }
];

/** Build the ledger from the survey plus the seeds. Pure given both. */
export function build(survey, seeds = SEEDS) {
  const keyed = keyAll(survey.confirmed);
  const byAt = new Map(keyed.map((k) => [`${k.finding.file}:${k.finding.line}`, k]));
  const missing = seeds.filter((s) => !byAt.has(s.at)).map((s) => s.at);
  if (missing.length) {
    throw new Error(`seed(s) match no finding: ${missing.join(', ')} — a seed that silently does nothing is how a hand-read gets lost`);
  }
  const seedByKey = new Map(seeds.map((s) => [byAt.get(s.at).key, s]));
  const entries = keyed.map(({ key, occurrence, finding }) => {
    const s = seedByKey.get(key);
    const row = {
      key,
      file: finding.file,
      kind: finding.kind,
      severity: finding.severity ?? null,
      occurrence,
      /* The line at the time of the survey. RECORDED, never keyed on: it is provenance, not identity. */
      surveyLine: finding.line,
      state: s?.state ?? 'open'
    };
    if (s?.reason) row.reason = s.reason;
    if (s?.note) row.note = s.note;
    return row;
  });
  const bad = entries.map((e) => [e.key, rowProblem(e)]).filter(([, p]) => p);
  if (bad.length) throw new Error(`built a malformed row: ${bad[0][0]} — ${bad[0][1]}`);
  const tally = Object.fromEntries(STATES.map((s) => [s, entries.filter((e) => e.state === s).length]));
  return {
    _README: [
      'STATE FOR audits/ABSENCE-SURVEY-2026-09-22.json — WRITTEN BY tools/absence-ledger.mjs, NEVER BY HAND.',
      '',
      'The survey artifact beside this one is the record of what was found on 2026-09-23 and is not edited.',
      'This file records what has been DONE about each finding. Keys are content + occurrence, never the',
      'line, so an edit above a finding does not detach its state.',
      '',
      `States: ${STATES.join(' · ')}. An accepted-with-reason row must carry the reason; the builder refuses otherwise.`,
      '',
      'Everything not hand-read is `open`. "The snippet no longer matches the file" is NOT evidence of a fix:',
      'measured 2026-09-29, an automated reclaim over-counted fixes by ~3.5x on the only population small',
      'enough to verify. See audits/COUNTING-ZERO-POPULATION-SURVEY-2026-09-29.md.'
    ],
    source: 'audits/ABSENCE-SURVEY-2026-09-22.json',
    states: STATES,
    counts: { findings: entries.length, ...tally },
    entries
  };
}

const render = (o) => `${JSON.stringify(o, null, 1)}\n`;

export function selftest() {
  const fail = [];
  let ran = 0;
  /* COUNTED, not stated. A hardcoded total drifts the moment an assertion is added or removed, and a
     selftest whose reported count is a literal is one more number nobody re-derives. */
  const ok = (cond, what) => {
    ran += 1;
    if (!cond) fail.push(what);
  };

  const survey = JSON.parse(readFileSync(SURVEY, 'utf8'));
  const built = build(survey);

  /* 1 · re-keying the committed file is byte-identical — the property that makes "written by a tool"
   *     checkable rather than a claim. */
  if (existsSync(LEDGER)) {
    ok(readFileSync(LEDGER, 'utf8') === render(built), 'committed ledger is byte-identical to a rebuild');
  }

  /* 2 · a state outside the three refuses, and so does an acceptance with no argument. */
  ok(rowProblem({ state: 'wontfix' }) !== null, 'an unknown state refuses');
  ok(rowProblem({ state: 'fixed' }) === null, 'a known state passes');
  ok(rowProblem({ state: 'accepted-with-reason' }) !== null, 'acceptance with no reason refuses');
  ok(rowProblem({ state: 'accepted-with-reason', reason: '   ' }) !== null, 'a blank reason is no reason');
  ok(rowProblem({ state: 'accepted-with-reason', reason: 'because x' }) === null, 'acceptance with a reason passes');

  /* 3 · the key is content + POSITION: identical content at two sites must not collide. */
  const twin = [
    { file: 'a.js', kind: 'default-number', snippet: 'return x || 0;', line: 10 },
    { file: 'a.js', kind: 'default-number', snippet: 'return  x || 0;', line: 99 }
  ];
  const k = keyAll(twin);
  ok(k[0].key !== k[1].key, 'identical content at two sites gets distinct keys');
  ok(k[0].occurrence === 0 && k[1].occurrence === 1, 'the ordinal counts identical triples in order');
  ok(keyOf(twin[0], 0) === k[0].key, 'keyOf and keyAll agree at ordinal 0');

  /* 4 · the key ignores reflow but not content. */
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 'a  +\n b' }) === keyOf({ file: 'a.js', kind: 'k', snippet: 'a + b' }), 'whitespace does not re-key');
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 'a + b' }) !== keyOf({ file: 'a.js', kind: 'k', snippet: 'a - b' }), 'a changed operator does re-key');
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 's' }) !== keyOf({ file: 'b.js', kind: 'k', snippet: 's' }), 'the file is part of the identity');

  /* 5 · the LINE is not part of the key — the whole reason this is content-addressed. */
  ok(keyOf({ file: 'a.js', kind: 'k', snippet: 's', line: 1 }) === keyOf({ file: 'a.js', kind: 'k', snippet: 's', line: 900 }), 'moving a finding does not re-key it');

  /* 6 · a seed that matches nothing refuses rather than doing nothing silently. */
  let refused = false;
  try {
    build(survey, [{ at: 'no/such/file.py:1', state: 'fixed' }]);
  } catch {
    refused = true;
  }
  ok(refused, 'a seed matching no finding refuses');

  /* 7 · every seed landed, and the tally adds up. */
  ok(built.counts.findings === survey.confirmed.length, 'every finding has a row');
  ok(STATES.reduce((a, s) => a + built.counts[s], 0) === built.counts.findings, 'the tally covers every row');
  ok(built.counts.fixed === SEEDS.filter((s) => s.state === 'fixed').length, 'the fixed count is the seeded one');
  ok(built.counts['accepted-with-reason'] === SEEDS.filter((s) => s.state === 'accepted-with-reason').length, 'the accepted count is the seeded one');
  ok(new Set(built.entries.map((e) => e.key)).size === built.entries.length, 'keys are unique');

  if (fail.length) {
    console.error(`✗ absence-ledger selftest: ${fail.length} failed`);
    for (const f of fail) console.error(`    ${f}`);
    return 1;
  }
  console.log(`  absence-ledger: ${built.counts.findings} findings — ${built.counts.fixed} fixed · ` + `${built.counts['accepted-with-reason']} accepted · ${built.counts.open} open`);
  console.log(`  all ${ran} selftests passed`);
  return 0;
}

function main(argv) {
  refuseUnknownArgvOrExit(argv, { boolean: ['--write', '--selftest'], valued: [] }, { tool: 'absence-ledger' });
  if (argv.includes('--selftest')) return selftest();
  const built = render(build(JSON.parse(readFileSync(SURVEY, 'utf8'))));
  if (argv.includes('--write')) {
    writeFileSync(LEDGER, built, 'utf8');
    console.log(`wrote ${LEDGER}`);
    return 0;
  }
  if (!existsSync(LEDGER)) {
    console.error('✗ absence-ledger: no state file. Run with --write.');
    return 2;
  }
  if (readFileSync(LEDGER, 'utf8') !== built) {
    console.error('✗ absence-ledger: the committed state file is not what this tool would write.');
    console.error('  It is tool-written by contract — re-run with --write rather than editing it.');
    return 1;
  }
  console.log('  absence-ledger: committed state file is byte-identical to a rebuild');
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('absence-ledger.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
