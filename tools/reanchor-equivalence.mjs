#!/usr/bin/env node
/*
 * tools/reanchor-equivalence.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE CLASSIFICATION DECAYS BECAUSE ITS KEY CONTAINS A LINE NUMBER.
 *
 * `tools/mutate-equivalence.json` is keyed on `(line, op, before)`. `op` and `before` describe the
 * CODE; `line` describes where it happened to sit. So any edit ABOVE a recorded mutant orphans it,
 * even when the mutated line is untouched — and `mutate.mjs` then excludes it from every count as a
 * stale entry, which is right, but means the classification quietly shrinks toward nothing.
 *
 * MEASURED, and fast: #1127 changed `pulsedex-dsp.js` within hours of 19 entries landing.
 * TEN of the nineteen orphaned — and every one of the ten had an IDENTICAL `(op, before)` still
 * present in the file, at a new line. Nothing about the code had changed at all. Left alone, the
 * ledger would have lost half a file's work to a formatting-adjacent commit.
 *
 * ── WHY RE-ANCHORING IS SAFE HERE, AND EXACTLY WHEN IT IS NOT ────────────────────────────────
 * The repo has already been bitten by the general version of this. `MUTATION-AUDIT-RUNBOOK` records
 * a non-unique anchor silently relocating a mutation: `str.replace(old, new, 1)` on text occurring
 * twice mutated the WRONG function, and three mutants read as survived while the control scored a
 * function the tests never claimed to cover.
 *
 * So the ONLY re-anchor this tool performs is the unambiguous one:
 *
 *     re-anchor  ⇔  exactly ONE generated mutant in the file has the same (op, before)
 *
 * More than one match ⇒ AMBIGUOUS, left orphaned. Zero matches ⇒ the code really did change, left
 * orphaned. Neither is guessed at, because a wrong re-anchor is worse than a lost entry: it would
 * silently excuse a mutant nobody probed, which is the one failure `mutate-equivalence.json` exists
 * to make impossible.
 *
 * ⚠️ RE-ANCHORING IS NOT RE-VERIFICATION. It asserts only that the identical mutation still exists
 * somewhere in the file. If the surrounding logic changed, a `no-distinguishing-input` verdict may
 * now be wrong — and the honest guard against that is already in place: `mutate.mjs` reports REFUTED
 * the moment a mutant an entry excuses turns up KILLED. This tool moves an entry's address; it never
 * renews its claim.
 *
 * ── THE PROBE, AND WHY A WRITE NOW REQUIRES ONE ──────────────────────────────────────────────
 * That paragraph is the whole reason `--write` sat unused for two months. REFUTED needs a recorded
 * KILL, so re-arming an excuse at a new address re-arms a claim nobody re-probed, and a wrong one
 * stays silent until some sweep happens to kill that mutant. Residue row
 * `2026-10-20-239-drifted-equivalence-entries-wait-on-a-re-anchor-decision` parked the decision there.
 *
 * Owner ruling, board #1549 item 21 (2026-10-26): re-anchor the drifted entries, with a probe for
 * each entry. So the sweep runs NOW, per entry: `--probe` re-tests each movable mutant at its NEW
 * address through `mutate.mjs --only`, and `--write` without `--probe` REFUSES.
 *
 * A probe renews the SURVIVAL half of a claim, never the equivalence half. A survived probe says the
 * suite still cannot see this mutant where it now sits. The `why` and `probe` fields carry the
 * equivalence argument, and no re-anchor touches either.
 *
 * A KILLED probe REFUTES an excusing entry, which then keeps its orphaned address: a move would
 * re-arm a classification this run has just disproved. A class that excuses nothing (`real-gap`)
 * expects the kill, so it moves.
 *
 * The probe list is built from the GENERATED mutant the plan matched, never from the ledger's own
 * text. `codeKey` trims and `selectRecorded` compares bytes, so a ledger entry whose `before` carries
 * stray whitespace matches the plan and would miss the probe — a refusal of the whole file under
 * `--only`, for a difference in spacing.
 *
 * USAGE
 *   node tools/reanchor-equivalence.mjs                    # report only, writes nothing
 *   node tools/reanchor-equivalence.mjs --probe            # re-test every movable entry, write nothing
 *   node tools/reanchor-equivalence.mjs --probe --write    # the only form that moves an anchor
 *   node tools/reanchor-equivalence.mjs --file pulsedex-dsp.js
 *   node tools/reanchor-equivalence.mjs --selftest         # known-answer, no enumeration
 *   node tools/reanchor-equivalence.mjs --verdict-sample   # the verdict object alone, no enumeration
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = isCliEntry(import.meta.url);

const norm = (s) => String(s == null ? '' : s).trim();
export const codeKey = (e) => norm(e.op) + '\0' + norm(e.before);

/* The whole decision, as a pure function so it can be known-answer tested without a sweep.
   Returns one of: {action:'ok'} · {action:'reanchor', line} · {action:'ambiguous', n} ·
   {action:'gone'}. */
export function planEntry(entry, generated) {
  const k = codeKey(entry);
  const exact = generated.find((m) => m.line === entry.line && codeKey(m) === k);
  if (exact) return { action: 'ok' };
  const same = generated.filter((m) => codeKey(m) === k);
  if (same.length === 1) return { action: 'reanchor', line: same[0].line };
  if (same.length > 1) return { action: 'ambiguous', n: same.length };
  return { action: 'gone' };
}

export function planFile(entries, generated) {
  const plan = { ok: [], reanchor: [], ambiguous: [], gone: [] };
  for (const e of entries) {
    const r = planEntry(e, generated);
    plan[r.action].push(Object.assign({ entry: e }, r));
  }
  return plan;
}

// ── the probe ───────────────────────────────────────────────────────────────────────────────
/* The four-field matcher key `mutate.mjs` uses everywhere (`survivorKey`): line, op, before, after.
   An absent `after` reads as the empty string there, so it reads as one here too. */
/* The indent the committed ledger is written at. `JSON.stringify(doc, null, 2)` — what this writer
   used until 2026-10-26 — reformats all 236 KB of it and grows the file by 11 KB, so the one diff
   nobody could read would have been the one that moved 272 anchors. Nothing ran `--write` before
   today, so the reformat had never happened. The selftest pins it against the file itself. */
export const LEDGER_INDENT = 1;

export const key4 = (m) => m.line + '\u0000' + norm(m.op) + '\u0000' + String(m.before == null ? '' : m.before) + '\u0000' + String(m.after == null ? '' : m.after);

/* The classes that EXCUSE a survivor, mirrored from `mutate.mjs`'s own `EXCUSING` set. The mirror
   exists because importing `mutate.mjs` would hand it this process's argv — `--file`, `--only` and
   `--json` are flags IT reads at module scope — so the parity is asserted instead, over its source,
   and `excusingFromSource` returns null rather than a guess when it cannot read the line. */
export const EXCUSING_CLASSES = new Set(['no-distinguishing-input', 'untestable-by-design', 'equivalent']);

export function excusingFromSource(text) {
  const m = String(text == null ? '' : text).match(/const EXCUSING = new Set\(\[([^\]]*)\]\)/);
  if (!m) return null;
  const out = m[1]
    .split(',')
    .map((s) =>
      s
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim()
    )
    .filter(Boolean);
  return out.length ? out.sort() : null;
}

/* Every movable entry with the GENERATED mutant it would move onto, plus the collisions that make a
   move unsafe.

   TWO ENTRIES CAN NAME ONE TARGET. `planEntry` asks that the entry's (op, before) matches exactly one
   GENERATED mutant; it says nothing about how many ENTRIES describe that pair. Both would land on one
   line, and `(line, op, before, after)` is the identity `test_an_identity_is_UNIQUE_within_its_module`
   requires to be unique — so two entries would merge into one and the ledger would lose the other
   silently. Measured 2026-10-26 over all 272 movable entries: 0 collisions. This is a guard against a
   shape the data permits, not a live defect. */
export function probePlan(entries, generated) {
  const byTarget = new Map();
  for (const e of entries) {
    if (planEntry(e, generated).action !== 'reanchor') continue;
    const k = codeKey(e);
    const mutant = generated.filter((m) => codeKey(m) === k)[0];
    const id = key4(mutant);
    if (!byTarget.has(id)) byTarget.set(id, []);
    byTarget.get(id).push({ entry: e, mutant });
  }
  const targets = [];
  const collisions = [];
  for (const group of byTarget.values()) {
    if (group.length === 1) targets.push(group[0]);
    else collisions.push(group);
  }
  return { targets, collisions };
}

/* What a probe result licenses, where `outcome` is what the run RECORDED about that mutant:
     'survived' — the groups tagged for the file ran and none killed it
     'killed'   — a group killed it
     'absent'   — the run reached no verdict for it: invalid, quarantined, or a voided run

   An ABSENT probe never moves an anchor. That is the examined-nothing shape the row warns about,
   and it arrives as a silently smaller denominator rather than as an error. */
export function decideProbed(entry, outcome) {
  if (outcome === 'survived') return { action: 'reanchor', why: 'the probe re-ran this mutant at its new address and no group killed it' };
  if (outcome === 'killed') {
    if (EXCUSING_CLASSES.has(String(entry && entry.class))) return { action: 'refuted', why: 'a group KILLS the mutant this entry excuses, so the classification is wrong and the address stays put' };
    return { action: 'reanchor', why: 'a kill agrees with a `' + String(entry && entry.class) + '` entry, which excuses nothing' };
  }
  return { action: 'unprobed', why: 'the run recorded no verdict for this mutant, so nothing renews its address' };
}

/* The outcome map a `mutate.mjs --json` record licenses. A VOIDED run (canary FAILED) decides
   nothing at all: `killedMutants` is null there, and reading its survivors would turn "the harness
   could not prove it detects anything" into "every one of them survived". */
export function outcomesFromRecord(rec) {
  if (!rec || rec.voided || rec.canary === 'FAILED' || rec.killedMutants == null)
    return { ok: false, killed: new Set(), survived: new Set(), reason: 'the run is VOID — its canary did not die, so it recorded no detection' };
  const killed = new Set((rec.killedMutants || []).map(key4));
  const survived = new Set((rec.survivors || []).map(key4));
  return { ok: true, killed, survived, reason: null };
}

/* PASS is the ledger surviving its own probe. The criterion is pre-stated and it can fail: a kill on
   an excusing entry is a false excuse, measured. */
export function verdictFields(tally) {
  const checked = tally.survived + tally.refuted + tally.agreeing;
  const excluded = tally.unprobed + tally.collided;
  let status = 'PASS';
  let reason = null;
  if (!checked) {
    status = 'NOT_RUN';
    reason = tally.movable ? 'no probe ran: report-only mode examines addresses, never claims' : 'no entry has drifted, so there was nothing to probe';
  } else if (tally.refuted) {
    status = 'FAIL';
    reason = tally.refuted + ' excusing entr(ies) name a mutant a group KILLS — a false excuse, and those addresses stay orphaned';
  } else if (excluded) {
    status = 'SHORTFALL';
    reason = excluded + ' movable entr(ies) reached no verdict (' + tally.unprobed + ' unprobed, ' + tally.collided + ' colliding on one target), so their anchors stay put';
  }
  return {
    status,
    reason,
    population: { checked, eligible: checked + excluded, excluded },
    criterion: { name: 'refuted_excuses', threshold: 0, unit: 'entries', direction: 'lte' },
    result: {
      movable: tally.movable,
      reanchored: tally.survived + tally.agreeing,
      refuted: tally.refuted,
      unprobed: tally.unprobed,
      collided: tally.collided,
      voidedFiles: tally.voidedFiles || []
    }
  };
}

// ── the verdict, built in one place so the sample cannot drift from the real run ────────────
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

function headCommit() {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function sampleTally() {
  return { movable: 3, survived: 2, refuted: 0, agreeing: 1, unprobed: 0, collided: 0, voidedFiles: [] };
}

export function makeVerdict(tally) {
  const f = verdictFields(tally);
  const commit = headCommit();
  return Verdict.make({
    gate: 'reanchor-equivalence',
    status: f.status,
    population: f.population,
    criterion: f.criterion,
    result: f.result,
    evidence: ['tools/reanchor-equivalence.mjs', 'tools/mutate-equivalence.json'],
    reason: f.reason,
    producedBy: commit
      ? { tool: 'tools/reanchor-equivalence.mjs', commit }
      : { tool: 'tools/reanchor-equivalence.mjs', commit: null, commitReason: 'git rev-parse failed here, so there is no commit to stamp' }
  });
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n + (d ? '  — ' + d : ''));
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };
  const G = (line, op, before) => ({ line, op, before });
  const gen = [G(10, 'cmp > → >=', 'if (a > b) {'), G(20, 'num → 0', 'x = 5;'), G(30, 'num → 0', 'x = 5;')];

  ok('an entry still at its recorded line is left alone', planEntry(G(10, 'cmp > → >=', 'if (a > b) {'), gen).action === 'ok');
  const r = planEntry(G(99, 'cmp > → >=', 'if (a > b) {'), gen);
  ok('a MOVED entry with a unique (op, before) is re-anchored', r.action === 'reanchor' && r.line === 10, JSON.stringify(r));
  ok('…and an AMBIGUOUS one is refused, not guessed', planEntry(G(99, 'num → 0', 'x = 5;'), gen).action === 'ambiguous');
  ok('…and a vanished one is reported gone', planEntry(G(99, 'cmp < → <=', 'if (q < r) {'), gen).action === 'gone');
  ok('whitespace in `before` does not orphan an entry', planEntry(G(99, 'cmp > → >=', '   if (a > b) {  '), gen).action === 'reanchor');
  ok('the OP is part of the identity — same text, different op, is not a match', planEntry(G(99, 'bool && → ||', 'if (a > b) {'), gen).action === 'gone');
  /* The load-bearing property: an entry whose line still holds the SAME code is never moved, even
     when that code also occurs elsewhere — otherwise a duplicate line could drag a valid entry. */
  ok('an exact line+code match wins over a duplicate elsewhere', planEntry(G(20, 'num → 0', 'x = 5;'), gen).action === 'ok');

  const plan = planFile([G(10, 'cmp > → >=', 'if (a > b) {'), G(99, 'cmp > → >=', 'if (a > b) {'), G(99, 'num → 0', 'x = 5;'), G(1, 'zzz', 'nope')], gen);
  ok(
    'planFile buckets all four outcomes',
    plan.ok.length === 1 && plan.reanchor.length === 1 && plan.ambiguous.length === 1 && plan.gone.length === 1,
    JSON.stringify(Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])))
  );

  // ── the probe (owner ruling, board #1549 item 21) ────────────────────────────────────────
  const T = (line, op, before, after) => ({ line, op, before, after });
  const gen2 = [T(10, 'cmp > → >=', 'if (a > b) {', 'if (a >= b) {'), T(20, 'num → 0', 'x = 5;', 'x = 0;'), T(30, 'num → 0', 'y = 5;', 'y = 0;')];
  const movable = { line: 99, op: 'cmp > → >=', before: 'if (a > b) {', class: 'no-distinguishing-input' };
  const pp = probePlan([movable], gen2);
  ok('a movable entry carries the GENERATED mutant it would move onto', pp.targets.length === 1 && pp.targets[0].mutant.line === 10, JSON.stringify(pp.targets.map((t) => t.mutant.line)));
  ok('…and the mutant supplies `after`, which the ledger entry never had', pp.targets[0].mutant.after === 'if (a >= b) {');
  const twin = probePlan([movable, { line: 98, op: 'cmp > → >=', before: '  if (a > b) {', class: 'equivalent' }], gen2);
  ok(
    'TWO entries naming ONE target collide, and NEITHER moves',
    twin.targets.length === 0 && twin.collisions.length === 1 && twin.collisions[0].length === 2,
    JSON.stringify({ t: twin.targets.length, c: twin.collisions.length })
  );

  ok('a SURVIVED probe licenses the move', decideProbed(movable, 'survived').action === 'reanchor');
  ok('a KILLED probe REFUTES an excusing entry, and the anchor stays put', decideProbed(movable, 'killed').action === 'refuted');
  ok('…but a kill AGREES with a real-gap entry, which excuses nothing', decideProbed({ class: 'real-gap' }, 'killed').action === 'reanchor');
  ok('an ABSENT verdict never moves an anchor — examined nothing is not survived', decideProbed(movable, 'absent').action === 'unprobed');
  ok('an entry with no class at all is treated as excusing nothing', decideProbed({}, 'killed').action === 'reanchor');

  /* The parity that keeps the mirror honest. A `null` here is the fail-closed answer, and it reds. */
  const mutSrc = (() => {
    try {
      return readFileSync(join(ROOT, 'tools/mutate.mjs'), 'utf8');
    } catch {
      return '';
    }
  })();
  ok('the excusing classes still agree with `mutate.mjs`', JSON.stringify(excusingFromSource(mutSrc)) === JSON.stringify([...EXCUSING_CLASSES].sort()), JSON.stringify(excusingFromSource(mutSrc)));
  ok('…and an unreadable EXCUSING set reads as null, never as an empty allowlist', excusingFromSource('const EXCUSING = somethingElse;') === null);

  ok('a VOID run (canary FAILED) licenses nothing at all', outcomesFromRecord({ voided: true, survivors: [T(10, 'a', 'b', 'c')], killedMutants: [] }).ok === false);
  ok('…and so does a run whose killedMutants is null', outcomesFromRecord({ canary: 'FAILED', survivors: [], killedMutants: null }).ok === false);
  const oc = outcomesFromRecord({ survivors: [T(10, 'num → 0', 'x = 5;', 'x = 0;')], killedMutants: [T(20, 'num → 0', 'y = 5;', 'y = 0;')] });
  ok(
    'a sound record separates killed from survived on the four-field key',
    oc.ok && oc.survived.has(key4(T(10, 'num → 0', 'x = 5;', 'x = 0;'))) && oc.killed.has(key4(T(20, 'num → 0', 'y = 5;', 'y = 0;')))
  );
  ok('an absent `after` reads as the empty string, as `survivorKey` reads it', key4({ line: 1, op: 'o', before: 'b' }) === key4({ line: 1, op: 'o', before: 'b', after: '' }));

  const vf = (t) => verdictFields(Object.assign({ movable: 0, survived: 0, refuted: 0, agreeing: 0, unprobed: 0, collided: 0, voidedFiles: [] }, t));
  ok('every entry surviving its probe is a PASS', vf({ movable: 3, survived: 3 }).status === 'PASS');
  ok('a refuted excuse FAILS, and the reason counts them', vf({ movable: 3, survived: 2, refuted: 1 }).status === 'FAIL');
  ok('an unprobed entry is a SHORTFALL, never a pass over a smaller denominator', vf({ movable: 3, survived: 2, unprobed: 1 }).status === 'SHORTFALL');
  ok('report-only examined no claim, so it is NOT_RUN', vf({ movable: 7 }).status === 'NOT_RUN');
  const pop = vf({ movable: 5, survived: 2, agreeing: 1, unprobed: 1, collided: 1 }).population;
  ok('checked + excluded = eligible, over the movable set', pop.checked + pop.excluded === pop.eligible && pop.checked === 3, JSON.stringify(pop));
  /* The writer's format, pinned against the committed bytes rather than against a belief about them. */
  const ledgerRaw = (() => {
    try {
      return readFileSync(join(ROOT, 'tools/mutate-equivalence.json'), 'utf8');
    } catch {
      return '';
    }
  })();
  ok(
    'the ledger round-trips byte-identically at the indent this tool writes',
    ledgerRaw !== '' && JSON.stringify(JSON.parse(ledgerRaw), null, LEDGER_INDENT) + '\n' === ledgerRaw,
    'len ' + ledgerRaw.length
  );

  const vs = Verdict.validate(makeVerdict(sampleTally()));
  ok('the emitted verdict object validates', vs.ok, (vs.errors || []).join('; '));

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--verdict-sample')) {
  console.log(JSON.stringify(makeVerdict(sampleTally()), null, 1));
  process.exit(0);
}

if (IS_MAIN && !has('--selftest')) {
  const LEDGER = join(ROOT, 'tools/mutate-equivalence.json');
  const doc = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const only = opt('--file', '');
  const files = Object.keys(doc).filter((k) => !k.startsWith('_') && (!only || k === only));
  if (!files.length) {
    console.error('nothing to re-anchor' + (only ? ` — ${only} has no entries` : ''));
    process.exit(2);
  }
  const PROBE = has('--probe');
  const WRITE = has('--write');
  if (WRITE && !PROBE) {
    console.error('--write REFUSED: moving an anchor without a probe re-arms an excuse nobody re-probed.');
    console.error('Owner ruling, board #1549 item 21 (2026-10-26): re-anchor WITH a probe for each entry. Re-run as `--probe --write`.');
    process.exit(2);
  }
  const TODAY = new Date().toISOString().slice(0, 10);
  const COMMIT = headCommit();
  const jobsOpt = opt('--jobs', null);

  /* One probe per file, over exactly the mutants that file's movable entries would move onto. */
  const runProbe = (file, targets) => {
    const list = join(tmpdir(), `reanchor-only-${process.pid}.json`);
    const out = join(tmpdir(), `reanchor-probe-${process.pid}.json`);
    writeFileSync(
      list,
      JSON.stringify(
        targets.map((t) => t.mutant),
        null,
        1
      ) + '\n'
    );
    const args = [join(ROOT, 'tools/mutate.mjs'), '--file', file, '--only', list, '--json'];
    if (jobsOpt) args.push('--jobs', jobsOpt);
    const fd = openSync(out, 'w');
    let status = 0;
    try {
      execFileSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
    } catch (e) {
      status = e && e.status != null ? e.status : -1;
    }
    closeSync(fd);
    /* The record is the one JSON line carrying this file's verdicts; progress shares the stream. */
    let rec = null;
    for (const line of readFileSync(out, 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const o = JSON.parse(line);
        if (o && o.file === file) rec = o;
      } catch {}
    }
    unlinkSync(out);
    unlinkSync(list);
    if (status) return { ok: false, reason: '`mutate.mjs --only` exited ' + status + ' — it refuses a partial re-test rather than report a smaller denominator' };
    if (!rec) return { ok: false, reason: 'the run printed no JSON record for ' + file };
    const o = outcomesFromRecord(rec);
    if (!o.ok) return { ok: false, voided: true, reason: o.reason };
    return { ok: true, killed: o.killed, survived: o.survived, groups: rec.groupsRun, groupCount: rec.groupCount };
  };

  let moved = 0,
    stuck = 0,
    fine = 0;
  const tally = { movable: 0, survived: 0, refuted: 0, agreeing: 0, unprobed: 0, collided: 0, voidedFiles: [] };
  for (const file of files) {
    /* Enumerate through a FILE, never a pipe: a big file's mutant list truncates at ~146 KB through
       a child's stdout, and a truncated enumeration would report live entries as `gone`. */
    const tmp = join(tmpdir(), `reanchor-${process.pid}.json`);
    const fd = openSync(tmp, 'w');
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools/mutate.mjs'), '--file', file, '--dry-run', '--limit', '100000', '--json'], { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
    } catch (_) {
      closeSync(fd);
      console.error(`  ✗ ${file}: could not enumerate mutants — skipped`);
      continue;
    }
    closeSync(fd);
    const generated = JSON.parse(readFileSync(tmp, 'utf8')).files[0].mutants;
    unlinkSync(tmp);

    const plan = planFile(doc[file], generated);
    fine += plan.ok.length;
    stuck += plan.ambiguous.length + plan.gone.length;
    tally.movable += plan.reanchor.length;
    console.log(`▸ ${file}  ${doc[file].length} entr(ies) · ${plan.ok.length} anchored · ${plan.reanchor.length} movable · ${plan.ambiguous.length} ambiguous · ${plan.gone.length} gone`);
    for (const r of plan.ambiguous) console.log(`    ⚠ AMBIGUOUS (${r.n} matches) L${r.entry.line} [${r.entry.op}] — left orphaned deliberately`);
    for (const r of plan.gone) console.log(`    ⊘ GONE L${r.entry.line} [${r.entry.op}] ${norm(r.entry.before).slice(0, 52)}`);

    if (!PROBE) {
      moved += plan.reanchor.length;
      for (const r of plan.reanchor) console.log(`    → L${r.entry.line} would become L${r.line}  [${r.entry.op}] ${norm(r.entry.before).slice(0, 52)}`);
      continue;
    }

    const { targets, collisions } = probePlan(doc[file], generated);
    for (const group of collisions) {
      tally.collided += group.length;
      console.log(
        `    ⚠ COLLISION: ${group.length} entries (L${group.map((g) => g.entry.line).join(', L')}) name ONE target L${group[0].mutant.line} [${norm(group[0].entry.op)}] — none moved, an identity stays unique`
      );
    }
    if (!targets.length) continue;
    const t0 = Date.now();
    console.log(`    ⏳ probing ${targets.length} mutant(s) through \`mutate.mjs --only\``);
    const probe = runProbe(file, targets);
    if (!probe.ok) {
      tally.unprobed += targets.length;
      if (probe.voided) tally.voidedFiles.push(file);
      console.log(`    ⊘ NO PROBE for ${targets.length} entr(ies) — ${probe.reason}`);
      continue;
    }
    for (const t of targets) {
      const k = key4(t.mutant);
      const outcome = probe.killed.has(k) ? 'killed' : probe.survived.has(k) ? 'survived' : 'absent';
      const d = decideProbed(t.entry, outcome);
      if (d.action === 'reanchor') {
        if (outcome === 'killed') tally.agreeing++;
        else tally.survived++;
        moved++;
        console.log(`    → L${t.entry.line} becomes L${t.mutant.line}  [${t.entry.op}] ${norm(t.entry.before).slice(0, 52)}`);
        if (WRITE) {
          t.entry.reanchored = { at: TODAY, from: t.entry.line, commit: COMMIT, outcome, probe: `mutate.mjs --only over the groups tagged ${probe.groups} (${probe.groupCount} group(s))` };
          t.entry.line = t.mutant.line;
        }
      } else if (d.action === 'refuted') {
        tally.refuted++;
        console.log(`    ✗ REFUTED L${t.entry.line} [${t.entry.op}] — ${d.why}`);
      } else {
        tally.unprobed++;
        console.log(`    ⊘ UNPROBED L${t.entry.line} [${t.entry.op}] — ${d.why}`);
      }
    }
    console.log(`    ✓ probed ${targets.length} in ${Math.round((Date.now() - t0) / 1000)}s · ${probe.groupCount} group(s) tagged ${probe.groups}`);
  }

  if (WRITE && moved) {
    writeFileSync(LEDGER, JSON.stringify(doc, null, LEDGER_INDENT) + '\n');
    console.log(`\n✓ re-anchored ${moved} entr(ies), each behind its own probe. Anchors moved; CLAIMS UNCHANGED — a probe renews survival, never equivalence.`);
  } else if (moved) {
    console.log(`\n${moved} entr(ies) can be re-anchored. ` + (PROBE ? 'Re-run with `--probe --write`.' : 'Re-run with `--probe` to probe them, then `--probe --write`.'));
  } else {
    console.log(`\nnothing to move — ${fine} anchored, ${stuck} left orphaned.`);
  }

  const v = makeVerdict(tally);
  const chk = Verdict.validate(v);
  if (!chk.ok) {
    console.error('verdict invalid: ' + (chk.errors || []).join('; '));
    process.exit(1);
  }
  console.log(JSON.stringify(v));
}
