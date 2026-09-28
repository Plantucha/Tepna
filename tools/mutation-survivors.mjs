#!/usr/bin/env node
/*
 * tools/mutation-survivors.mjs — Tepna
 * Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * THE SURVIVOR LEDGER — brief: briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
 * Residue: 2026-09-24-mutation-survivors-outlive-the-pr-that-reported-them
 *
 * A mutation survivor is reported against ONE PR's diff and is never raised again once that PR
 * merges: the gate deliberately does not judge lines nobody touched, there is no full sweep (a JS
 * sweep is ~11,500 mutants ≈ 150 h) and capture.py cannot be swept at all (#3185's memory refusal
 * says so with numbers). The scoping is right; what is missing is that an unanswered finding leaves
 * NO RECORD, so its whole lifetime is one PR. Measured case: 14 survivors on
 * `loss_audit.py::_has_worn_evidence` (#3022), 4 killed by #3024, and the other 10 are recorded
 * nowhere today — not in the equivalence ledger, not in any gate output.
 *
 *   node tools/mutation-survivors.mjs ingest <verdict.json> --pr N --lane py|js [--run-id X] [--sha Y]
 *   node tools/mutation-survivors.mjs list [--lane L] [--open]
 *   node tools/mutation-survivors.mjs close <key> --killed N | --equivalent "<probe>"
 *   node tools/mutation-survivors.mjs ratchet --expect N
 *   node tools/mutation-survivors.mjs --selftest
 *
 * 🔴 WRITING THE LEDGER IS A LOCAL/SESSION ACTION, NEVER A CI ONE. A CI job that commits this file
 * needs `contents: write`; `mutation.yml` sets `contents: read`, and changing that is an owner
 * workflow edit held out of scope by the brief. CI only READS the committed ledger (`ratchet`).
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { makeVerdict } from './verdict-emit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = path.join(HERE, '..', 'mutation-survivors.json');
export const LANES = ['py', 'js'];

/**
 * A survivor's identity: lane + module + function + the mutant's own `-`/`+` pair.
 *
 * CONTENT, not position, and the two rejected candidates are worth naming because each is correct
 * somewhere else in this repo:
 *   · `__mutmut_N` — shifts whenever anything earlier in the function changes, so an entry keyed on
 *     it keeps MATCHING while pointing at a different mutation (`mutation_diff.diff_key`'s own
 *     docstring rejects it for the same reason).
 *   · `line + op + before` — what `tools/mutation-ai-probe.mjs::probeKey` uses, and right there: that
 *     journal lives inside ONE sweep of ONE file version. A ledger entry has to survive months of
 *     unrelated edits above it, and a line key orphans on the first insertion.
 * The `key` field is `mutation_diff.diff_key`'s output verbatim, so a survivor entry and an
 * equivalence entry for the same mutant carry the SAME string and can be read against each other.
 */
export function survivorKey({ lane, module: mod, fn, function: fname, key }) {
  // BOTH SPELLINGS, deliberately. A ledger row stores `function`; the ingest path and the tests
  // build `fn`. Reading only one of them is not a style slip — it silently produces a key with
  // `undefined` in it, which matches nothing, so EVERY committed entry reads as orphaned and the
  // ledger quietly empties itself. The selftest below caught exactly that.
  const name = fn ?? fname;
  return [lane, mod, name, String(key || '').trim()].join('\u0000');
}

/** The human-readable form of a key, for `list` and for `close <key>`. */
export function keyLabel(k) {
  const [lane, mod, fn, key] = String(k).split('\u0000');
  return `${lane}:${mod}::${fn}  ${key}`;
}

/**
 * The function a mangled mutant name belongs to. `mutation_diff.x_prune_scratches__mutmut_3` →
 * `prune_scratches`; a method carries mutmut's class separator (`xǁClsǁmeth`).
 * Returns null when the name is not a mangled mutant — the caller must not invent one.
 */
export function functionOfMutant(name) {
  const m = /(?:^|\.)(x(?:_|ǁ)[^.]*?)__mutmut_\d+$/.exec(String(name || ''));
  if (!m) return null;
  const mangled = m[1];
  if (mangled.startsWith('xǁ')) {
    const parts = mangled.split('ǁ');
    return parts.length >= 3 ? parts[2] : null;
  }
  return mangled.slice(2) || null;
}

/**
 * Turn ONE gate verdict into ledger entries, or REFUSE.
 *
 * Three refusals, each of them a fact the ledger cannot fabricate (§∅, §🧾):
 *  1. An unattributable run. No `--pr`, or one that disagrees with the verdict's own PR: an entry
 *     whose origin is unknown can never be closed by anyone, and a WRONG number is worse than none.
 *  2. An ABSENT measurement. `NOT_APPLICABLE` / `NOT_RUN` examined nothing, and ingesting that as an
 *     empty survivor list would read as "this function is clean" — a zero standing in for a gap.
 *  3. A lower bound, flagged not hidden. A FAIL's survivor list is complete only if every mutant
 *     reached a verdict; the checkable tell is `decided < generated`, and the shortfall rides on the
 *     batch rather than the list silently implying it is everything.
 */
export function entriesFromVerdict(doc, opts = {}) {
  const { pr, lane, runId = null, mergeSha = null, reported = null } = opts;
  if (!LANES.includes(lane)) return { refused: `unknown lane ${JSON.stringify(lane)} — one of ${LANES.join(', ')}` };
  if (!doc || typeof doc !== 'object') return { refused: 'verdict is not an object' };
  const v = doc.verdict || {};
  const status = v.status;
  if (!status) return { refused: 'no tepna.verdict/1 object in this artifact — nothing to attribute' };

  if (!Number.isInteger(pr) || pr <= 0) {
    return { refused: `refusing to ingest a run with no PR (--pr): an entry nobody can attribute is one nobody can close` };
  }
  const docPr = doc.pr ?? v.pr ?? null;
  if (docPr != null && Number(docPr) !== pr) {
    return { refused: `--pr ${pr} disagrees with the run's own PR ${docPr} — refusing rather than mis-attributing` };
  }

  if (status === 'NOT_APPLICABLE' || status === 'NOT_RUN') {
    return { refused: `status ${status} examined nothing — an absent measurement is not an empty survivor list (§∅)` };
  }

  const result = v.result || {};
  const generated = Number(result.generated ?? 0);
  const decided = Number(result.decided ?? 0);
  const lowerBound = generated > 0 && decided < generated;

  const entries = [];
  for (const s of doc.survivors || []) {
    const fn = functionOfMutant(s.mutant) || s.function || null;
    if (!fn) return { refused: `survivor ${JSON.stringify(s.mutant)} has no function this tool can name — refusing to guess` };
    entries.push({
      lane,
      module: s.module || null,
      function: fn,
      key: String(s.key || '').trim(),
      mutant: s.mutant || null,
      file_line: s.file_line || null,
      pr,
      run_id: runId,
      merge_sha: mergeSha,
      reported,
      state: 'open'
    });
  }
  return { entries, lowerBound, generated, decided, status };
}

/**
 * Fold new entries into the ledger. Idempotent on re-ingest of the same run, and a re-appearing
 * CLOSED key is a REGRESSION that is reported rather than silently reopened or silently dropped:
 * a mutant recorded `killed #N` that survives again means that kill stopped working, which is a
 * louder fact than a new survivor and must not be absorbed by an upsert.
 */
export function mergeEntries(ledger, incoming) {
  const rows = (ledger && ledger.entries) || [];
  const index = new Map(rows.map((e) => [survivorKey(e), e]));
  const added = [];
  const regressed = [];
  const unchanged = [];
  for (const e of incoming) {
    const k = survivorKey(e);
    const prev = index.get(k);
    if (!prev) {
      index.set(k, e);
      added.push(e);
    } else if (prev.state !== 'open') {
      regressed.push({ ...prev, seen_again_pr: e.pr });
    } else {
      unchanged.push(prev);
    }
  }
  return { entries: [...index.values()], added, regressed, unchanged };
}

/** Entries still awaiting an answer. The number the ratchet is about. */
export function openCount(ledger) {
  return ((ledger && ledger.entries) || []).filter((e) => e.state === 'open').length;
}

/**
 * The two-sided ratchet. Equality by default; may SHRINK freely; may only GROW through entries that
 * name the PR that reported them.
 *
 * One-sided would be the usual mistake here: a floor alone lets the count drift up silently, which
 * is the same "banked progress" failure `test_silent_except`'s ratchet is written against.
 */
export function ratchetVerdict(expected, actual, addedWithoutPr = 0) {
  if (addedWithoutPr > 0) {
    return { status: 'FAIL', reason: `${addedWithoutPr} new entr(ies) name no PR — an unattributable survivor cannot be closed by anyone` };
  }
  if (actual === expected) return { status: 'PASS', reason: null };
  if (actual < expected) {
    return { status: 'PASS', reason: `open survivors fell ${expected} → ${actual}; lower the expected count in the same PR` };
  }
  return { status: 'FAIL', reason: `open survivors rose ${expected} → ${actual} — a survivor was recorded and not answered, and nothing lowered the bar` };
}

/**
 * Entries whose key matches no mutant the current run generated: the mutated TEXT has changed, so
 * the finding may no longer apply — but it is REPORTED, never dropped. Same rule `mutate_diff`
 * already applies to orphaned equivalence entries: it excuses nothing until re-verified.
 */
export function orphanedEntries(ledger, presentKeys, scope = {}) {
  const present = new Set(presentKeys);
  return ((ledger && ledger.entries) || []).filter((e) => e.state === 'open' && (!scope.lane || e.lane === scope.lane) && (!scope.module || e.module === scope.module) && !present.has(survivorKey(e)));
}

// ── I/O ────────────────────────────────────────────────────────────────────────────────────────
const EMPTY = {
  _README:
    'The mutation survivor ledger. Keyed on lane + module + function + the mutant diff pair — NEVER __mutmut_N. ' +
    'Written by tools/mutation-survivors.mjs only (rows are never hand-edited); CI READS it for the ratchet and ' +
    'must never write it. See briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md.',
  entries: []
};

export function readLedger(p = LEDGER_PATH) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

export function writeLedger(ledger, p = LEDGER_PATH) {
  const out = { ...EMPTY, ...ledger, _README: EMPTY._README };
  out.entries = (out.entries || []).slice().sort((a, b) => survivorKey(a).localeCompare(survivorKey(b)));
  fs.writeFileSync(p, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

function arg(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function cmdIngest(argv) {
  const file = argv[1];
  if (!file) {
    console.error('ingest needs a verdict JSON path');
    return 2;
  }
  const prRaw = arg('--pr', argv);
  const r = entriesFromVerdict(JSON.parse(fs.readFileSync(file, 'utf8')), {
    pr: prRaw == null ? null : Number(prRaw),
    lane: arg('--lane', argv),
    runId: arg('--run-id', argv),
    mergeSha: arg('--sha', argv),
    reported: new Date().toISOString().slice(0, 10)
  });
  if (r.refused) {
    console.error(`mutation-survivors: REFUSING — ${r.refused}`);
    return 2;
  }
  const ledger = readLedger();
  const m = mergeEntries(ledger, r.entries);
  writeLedger({ ...ledger, entries: m.entries });
  console.log(`ingested ${r.entries.length} survivor(s): ${m.added.length} new, ${m.unchanged.length} already open`);
  if (r.lowerBound) {
    console.log(`  ⚠ LOWER BOUND: ${r.decided} of ${r.generated} mutants reached a verdict — this list is not all of them`);
  }
  for (const g of m.regressed) {
    console.log(`  🔴 REGRESSION: ${keyLabel(survivorKey(g))} was ${g.state} and survives again (seen on #${g.seen_again_pr})`);
  }
  console.log(`open: ${openCount({ entries: m.entries })}`);
  return m.regressed.length ? 1 : 0;
}

function cmdList(argv) {
  const ledger = readLedger();
  const lane = arg('--lane', argv);
  const onlyOpen = argv.includes('--open');
  const rows = (ledger.entries || []).filter((e) => (!lane || e.lane === lane) && (!onlyOpen || e.state === 'open'));
  for (const e of rows) console.log(`${e.state.padEnd(12)} #${String(e.pr).padEnd(5)} ${keyLabel(survivorKey(e))}`);
  console.log(`\n${rows.length} shown · ${openCount(ledger)} open of ${(ledger.entries || []).length}`);
  return 0;
}

function cmdClose(argv) {
  const label = argv[1];
  const killed = arg('--killed', argv);
  const equiv = arg('--equivalent', argv);
  if (!label || (!killed && !equiv)) {
    console.error('close <key-label> --killed N | --equivalent "<probe>"');
    return 2;
  }
  const ledger = readLedger();
  const hits = (ledger.entries || []).filter((e) => keyLabel(survivorKey(e)).includes(label));
  if (hits.length !== 1) {
    console.error(`close matched ${hits.length} entries — it must match exactly one`);
    return 2;
  }
  hits[0].state = killed ? `killed #${Number(killed)}` : 'equivalent';
  if (equiv) hits[0].probe = equiv;
  writeLedger(ledger);
  console.log(`closed: ${keyLabel(survivorKey(hits[0]))} → ${hits[0].state}`);
  return 0;
}

/** The ONE verdict object this tool emits. Shared by `ratchet` and `--verdict-sample` so the
 * sample cannot drift from the thing it is a sample of — a sample that is not the real shape is
 * exactly the partial adoption `verdict-adoption` exists to catch. */
export function ratchetVerdictObject({ expect, actual, eligible, noPr }) {
  const v = ratchetVerdict(expect, actual, noPr);
  // Built through the shared emitter, not by hand: it supplies `scope` and the commit provenance the
  // contract requires and VALIDATES the result, so a malformed verdict throws here rather than
  // shipping as a green-looking object nothing checked.
  return makeVerdict({
    gate: 'mutation-survivor-ratchet',
    tool: 'tools/mutation-survivors.mjs',
    status: v.status,
    scope: 'internal',
    population: { checked: actual, eligible, excluded: eligible - actual },
    criterion: { name: 'open_survivors', threshold: expect, unit: 'entries', direction: 'lte' },
    result: { open: actual, expected: expect },
    evidence: ['mutation-survivors.json'],
    reason: v.reason
  });
}

function cmdRatchet(argv) {
  const expect = Number(arg('--expect', argv));
  if (!Number.isInteger(expect)) {
    console.error('ratchet needs --expect N');
    return 2;
  }
  const ledger = readLedger();
  const actual = openCount(ledger);
  const noPr = (ledger.entries || []).filter((e) => e.state === 'open' && !e.pr).length;
  const obj = ratchetVerdictObject({ expect, actual, eligible: (ledger.entries || []).length, noPr });
  console.log(JSON.stringify(obj));
  return obj.status === 'PASS' ? 0 : 1;
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let fail = 0;
  const ck = (what, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      fail++;
      console.log(`  ✗ ${what}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    } else console.log(`  ✓ ${what}`);
  };

  console.log('\nthe key is CONTENT — a mutmut index is not a name');
  ck(
    'the same mutation in two functions is two entries',
    survivorKey({ lane: 'py', module: 'a.py', fn: 'f', key: '- x | + y' }) === survivorKey({ lane: 'py', module: 'a.py', fn: 'g', key: '- x | + y' }),
    false
  );
  ck(
    'the same mutation in two lanes is two entries',
    survivorKey({ lane: 'py', module: 'a', fn: 'f', key: '- x | + y' }) === survivorKey({ lane: 'js', module: 'a', fn: 'f', key: '- x | + y' }),
    false
  );
  ck(
    'whitespace around the pair does not fork the identity',
    survivorKey({ lane: 'py', module: 'a', fn: 'f', key: ' - x | + y ' }),
    survivorKey({ lane: 'py', module: 'a', fn: 'f', key: '- x | + y' })
  );
  ck(
    'a COMMITTED row (function:) and a fresh entry (fn:) key identically — the bug that emptied the ledger',
    survivorKey({ lane: 'py', module: 'm.py', function: 'f', key: '- a | + b' }),
    survivorKey({ lane: 'py', module: 'm.py', fn: 'f', key: '- a | + b' })
  );
  ck('…and neither spelling silently keys on undefined', survivorKey({ lane: 'py', module: 'm.py', fn: 'f', key: '- a | + b' }).includes('undefined'), false);
  ck('a mangled mutant names its function', functionOfMutant('mutation_diff.x_prune_scratches__mutmut_3'), 'prune_scratches');
  ck('…including a method', functionOfMutant('m.xǁClsǁmeth__mutmut_12'), 'meth');
  ck('…and refuses to invent one', functionOfMutant('not a mutant'), null);

  console.log('\ningest refuses what it cannot attribute');
  const FAILDOC = { verdict: { status: 'FAIL', result: { generated: 4, decided: 4 } }, survivors: [{ mutant: 'm.x_f__mutmut_1', module: 'm.py', key: '- a | + b' }] };
  ck('no --pr is a refusal, not a guess', !!entriesFromVerdict(FAILDOC, { lane: 'py' }).refused, true);
  ck('a --pr that disagrees with the run is a refusal', !!entriesFromVerdict({ ...FAILDOC, pr: 9 }, { lane: 'py', pr: 8 }).refused, true);
  ck('an agreeing --pr is fine', !!entriesFromVerdict({ ...FAILDOC, pr: 8 }, { lane: 'py', pr: 8 }).refused, false);
  ck('an unknown lane is a refusal', !!entriesFromVerdict(FAILDOC, { lane: 'rust', pr: 1 }).refused, true);
  for (const st of ['NOT_APPLICABLE', 'NOT_RUN']) {
    ck(`${st} examined nothing — not an empty survivor list`, !!entriesFromVerdict({ verdict: { status: st }, survivors: [] }, { lane: 'py', pr: 1 }).refused, true);
  }
  ck(
    'a PASS with no survivors ingests as zero entries, which is a MEASUREMENT',
    entriesFromVerdict({ verdict: { status: 'PASS', result: { generated: 9, decided: 9 } }, survivors: [] }, { lane: 'py', pr: 1 }).entries.length,
    0
  );

  console.log('\na FAIL list is a LOWER BOUND while mutants went undecided');
  ck('decided < generated flags the shortfall', entriesFromVerdict({ verdict: { status: 'FAIL', result: { generated: 30, decided: 27 } }, survivors: [] }, { lane: 'py', pr: 1 }).lowerBound, true);
  ck('a fully decided run does not', entriesFromVerdict(FAILDOC, { lane: 'py', pr: 1 }).lowerBound, false);

  console.log('\nmerge is idempotent, and a closed entry that survives again is a REGRESSION');
  const e1 = entriesFromVerdict(FAILDOC, { lane: 'py', pr: 7 }).entries;
  const once = mergeEntries({ entries: [] }, e1);
  ck('first ingest adds one', [once.added.length, once.entries.length], [1, 1]);
  const twice = mergeEntries({ entries: once.entries }, e1);
  ck('re-ingesting the same run adds nothing', [twice.added.length, twice.entries.length], [0, 1]);
  const closed = once.entries.map((e) => ({ ...e, state: 'killed #8' }));
  const again = mergeEntries({ entries: closed }, e1);
  ck('a killed mutant that survives again is reported, not reopened silently', [again.added.length, again.regressed.length], [0, 1]);
  ck('…and the ledger is not quietly rewritten to open', again.entries[0].state, 'killed #8');

  console.log('\nthe ratchet is TWO-SIDED');
  ck('equal passes', ratchetVerdict(5, 5).status, 'PASS');
  ck('shrinking passes', ratchetVerdict(5, 3).status, 'PASS');
  ck('growing fails', ratchetVerdict(5, 6).status, 'FAIL');
  ck('…and says what happened', /rose 5 → 6/.test(ratchetVerdict(5, 6).reason), true);
  ck('an entry naming no PR fails whatever the count', ratchetVerdict(5, 5, 1).status, 'FAIL');

  console.log('\norphans are REPORTED, never dropped');
  const led = {
    entries: [
      { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', state: 'open' },
      { lane: 'py', module: 'm.py', function: 'f', key: '- c | + d', state: 'open' },
      { lane: 'py', module: 'm.py', function: 'f', key: '- e | + f', state: 'killed #2' }
    ]
  };
  const present = [survivorKey({ lane: 'py', module: 'm.py', fn: 'f', key: '- a | + b' })];
  ck('an open entry the run no longer generates is orphaned', orphanedEntries(led, present).length, 1);
  ck(
    '…and a CLOSED one is not resurrected as an orphan',
    orphanedEntries(led, present).every((e) => e.state === 'open'),
    true
  );
  ck('open counting ignores closed rows', openCount(led), 2);

  console.log(fail ? `${fail} failed of 29` : 'all 29 selftests passed');
  return fail ? 1 : 0;
}

const CMDS = { ingest: cmdIngest, list: cmdList, close: cmdClose, ratchet: cmdRatchet };

if (process.argv[1] && process.argv[1].endsWith('mutation-survivors.mjs')) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest());
  if (argv.includes('--verdict-sample')) {
    // A SAMPLE, not a measurement: it reports on a two-entry stand-in, never on the committed
    // ledger, so running it can neither pass nor fail the real ratchet.
    console.log(JSON.stringify(ratchetVerdictObject({ expect: 2, actual: 2, eligible: 3, noPr: 0 })));
    process.exit(0);
  }
  const fn = CMDS[argv[0]];
  if (!fn) {
    console.error('usage: mutation-survivors.mjs ingest <verdict.json> --pr N --lane py|js | list | close | ratchet --expect N | --selftest');
    process.exit(2);
  }
  process.exit(fn(argv));
}
