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
 *   node tools/reanchor-equivalence.mjs --qualify          # what an enclosing-function qualifier is worth
 *   node tools/reanchor-equivalence.mjs --qualify --write  # write the qualifier; moves no address
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
/* A `why` is prose and a terminal line is not. Clipped for the reader only — the object carries it whole. */
const clip = (t, n = 120) => {
  const one = String(t == null ? '' : t)
    .replace(/\s+/g, ' ')
    .trim();
  if (one === '') return 'no recorded reason';
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};
export const codeKey = (e) => norm(e.op) + '\0' + norm(e.before);

/* The whole decision, as a pure function so it can be known-answer tested without a sweep.
   Returns one of: {action:'ok'} · {action:'reanchor', line} · {action:'ambiguous', n} ·
   {action:'gone'}. */
/* EVERY FIELD AN ENTRY ACTUALLY CONSTRAINS, and no more. `op` and `before` are always recorded;
   `after` and `fn` are OPTIONAL, and an absent one constrains nothing — the same back-compatible
   reading the ledger gives a missing `fn`, applied to the field that was missing first.

   This used to filter on (op, before) alone, while the matcher it reports for (`survivorKey`) has
   always carried `after`. The looser key does not endanger anything — it over-counts candidates, so
   the tool orphans where it could have moved — but it misreports, and the report is what a reader
   acts on. Measured 2026-10-26 over the committed ledger: of 106 entries it called AMBIGUOUS, 69 have
   exactly one candidate once `after` is honoured, 2 have none at all and were GONE, and only 35 are
   ambiguous on the matcher's own key. 6 entries carry no `after` at all and keep the loose reading. */
export function candidatesFor(entry, generated) {
  const k = codeKey(entry);
  let c = generated.filter((m) => codeKey(m) === k);
  if (entry.after != null && norm(entry.after) !== '') c = c.filter((m) => norm(m.after) === norm(entry.after));
  if (entry.fn != null && entry.fn !== '') c = c.filter((m) => m.fn === entry.fn);
  return c;
}

export function planEntry(entry, generated) {
  const cands = candidatesFor(entry, generated);
  if (cands.some((m) => m.line === entry.line)) return { action: 'ok' };
  if (cands.length === 1) return { action: 'reanchor', line: cands[0].line };
  if (cands.length > 1) return { action: 'ambiguous', n: cands.length };
  return { action: 'gone' };
}

/* The identity a qualifier creates: the enclosing function plus the mutation, with no line in it.
   `fn` is stamped on every mutant by `mutate.mjs --dry-run --json`, which is the one process holding
   the source — so this tool never re-implements the brace matcher and cannot drift from it. */
export const idKey = (m) => (m.fn == null ? '\u0000top' : m.fn) + '\u0000' + codeKey(m) + '\u0000' + norm(m.after);

/* WHAT A QUALIFIER IS WORTH, ENTRY BY ENTRY — and which entries may safely receive one.
   `write` is the only safe set, and the two conditions that define it are both necessary:

   · the entry is ALREADY exactly anchored, so writing `fn` moves no address and renews no claim. It
     records where the entry already points, which is why this write needs no probe while a
     re-anchor does (PR #3989's ruling).
   · its (fn, op, before, after) identity is UNIQUE among the file's mutants, so the line-free match
     the qualifier enables resolves to that same single mutant. Without this the qualifier would widen
     one excuse onto a sibling mutant nobody probed — the defect #3989 found 33 live instances of.

   The other buckets are refusals, each for its own reason: `collides` fails the uniqueness test,
   `topLevel` sits outside any named function so no qualifier can name it, `legacy` records no `after`
   and a qualifier would have to invent one, and `drifted` is not anchored, so its function could only
   be read off a line already known to be wrong. */
export function qualifyPlan(entries, generated) {
  const cnt = new Map();
  for (const m of generated) {
    const k = idKey(m);
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const out = { write: [], collides: [], topLevel: [], legacy: [], drifted: [], already: [] };
  for (const e of entries) {
    if (e.fn != null && e.fn !== '') {
      out.already.push(e);
      continue;
    }
    if (e.after == null) {
      out.legacy.push(e);
      continue;
    }
    const plan = planEntry(e, generated);
    if (plan.action !== 'ok') {
      /* WHAT A QUALIFIER WOULD HAVE BOUGHT, for an entry that never carried one. The recorded
         function is unknowable — the entry has no `fn` and its line has drifted, so reading one off
         that line would read it off an address already known to be wrong. What IS decidable is
         whether the answer depends on it: group the candidates by their own function, and if every
         group holds exactly one mutant, resolution is unique WHICHEVER function was recorded. One
         group of two or more makes it conditional on the recorded name, and a single group of two or
         more makes it impossible — the same mutation twice inside one function, which no qualifier
         can separate. */
      const cands = generated.filter((m) => codeKey(m) === codeKey(e) && (e.after == null || norm(e.after) === '' || norm(m.after) === norm(e.after)));
      const groups = new Map();
      for (const m of cands) groups.set(m.fn == null ? '\u0000top' : m.fn, (groups.get(m.fn == null ? '\u0000top' : m.fn) || 0) + 1);
      const sizes = [...groups.values()];
      const would = cands.length === 0 ? 'gone' : sizes.every((n) => n === 1) ? 'anyFn' : sizes.some((n) => n === 1) ? 'someFn' : 'neverPlaced';
      out.drifted.push({ entry: e, action: plan.action, would });
      continue;
    }
    const m = candidatesFor(e, generated).find((x) => x.line === e.line);
    if (m.fn == null) {
      out.topLevel.push(e);
      continue;
    }
    if (cnt.get(idKey(m)) !== 1) {
      out.collides.push(e);
      continue;
    }
    out.write.push({ entry: e, fn: m.fn });
  }
  return out;
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
    /* THE TARGET IS THE CANDIDATE `planEntry` APPROVED, UNDER THE KEY IT DECIDED WITH. Taking the
       first mutant carrying the entry's (op, before) instead picks a SIBLING when one line holds two
       mutants of one operator — `if (i < n && j < m)` generates one mutant per `<`, same line, same
       `before`, different `after`. Measured 2026-10-27 over the 102 movable entries: 35 got a target
       whose `after` was not their own, and 51 read as colliding because the loose lookup collapsed
       those siblings onto one target. Under this key the same 102 give 102 targets and 0 collisions.
       The loose lookup was invisible until #3991 taught `planEntry` to read `after`: before that, an
       entry whose (op, before) matched two mutants read as ambiguous and never arrived here. */
    const cands = candidatesFor(e, generated);
    if (cands.length !== 1) continue;
    const mutant = cands[0];
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
    /* Three states hide behind "nothing was checked", and the contract's table gives each its own
       word. Nothing is eligible: the gate read every entry and the false-excuse rule does not bind
       (NOT_APPLICABLE). Entries are eligible and the invocation declared no probe: the criterion
       never executed (NOT_RUN). Entries are eligible, probes ran, and not one reached a verdict:
       the gate ran and could not decide (UNKNOWN). The first two carry `result: null`, because
       the contract gives a result only to a criterion that was evaluated — a census is not a
       decision, and the counts stay in the printed output. */
    if (!tally.movable) {
      status = 'NOT_APPLICABLE';
      reason = 'no entry has drifted, so no excuse is up for refutation and the criterion does not bind';
    } else if (!excluded) {
      status = 'NOT_RUN';
      reason = 'report-only mode examines addresses and probes no claim, so the criterion never ran over the ' + tally.movable + ' movable entr(ies)';
    } else {
      status = 'UNKNOWN';
      reason = 'every one of the ' + excluded + ' probed entr(ies) reached no verdict (' + tally.unprobed + ' unprobed, ' + tally.collided + ' colliding on one target), so the run decided nothing';
    }
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
    result:
      status === 'NOT_RUN' || status === 'NOT_APPLICABLE'
        ? null
        : {
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

/* WHAT A DRIFTED ENTRY CAN STILL BE REACHED BY, per entry rather than per tally.
   `qualifyPlan` already decides the question (its `would` tag); until this function existed the
   answer was aggregated into four counts and no entry was ever NAMED. An entry tagged
   `neverPlaced` or `gone` has no address any mechanism in this tool can give it: the first
   repeats one mutation inside one function, which no qualifier separates, and the second names a
   mutation the generator no longer produces. `someFn` is weaker — placeable, but only if the
   unrecorded function happened to be one of the names whose group holds a single mutant — so it is
   reported beside the set rather than inside it.
   Each row carries what the entry stopped excusing (`class` + `why`), because an orphaned entry
   is not merely unplaceable: it still records a judged mutant, and deleting it drops that judgement.
   Residue 2026-10-27-thirty-eight-drifted-entries-have-no-address-a-mechanism-can-reach. */
const UNADDRESSED_REASON = {
  neverPlaced: 'one mutation repeated inside one function — no qualifier can separate the two',
  gone: 'no candidate mutant at all — the generator no longer produces this mutation',
  someFn: 'placeable only for some of the functions it could have named'
};

/* 🔴 THE RESCUE THAT DOES NOT WORK, MEASURED RATHER THAN ASSUMED. An entry with no `fn` looks
   addressable anyway, because its `why` opens `In <function>.` — 421 of the committed 434 do. If
   that name were the recorded function, every drifted entry would carry an address and this tool
   would only have to read it.
   It is not an address. The 320 entries that DO carry a machine-read `fn` are the control, and on
   10 of them the prose names a different function: `dfaAlpha1` for `dfaAlpha1Segmented`,
   `countPairs` for `countPairsIn`, `markO2Sentinels` for `markO2BeatMarkers`. The prose names an
   enclosing, neighbouring or since-renamed function, so placing an entry by it would mis-anchor
   about one in 32 — and this tool's standing rule is that a wrong re-anchor is worse than a lost
   entry. So the prose is reported as a disagreement rate and never consumed.
   `fnFromProse` is exported for the control, not for placement; nothing in the write path calls it. */
export function fnFromProse(why) {
  const m = /^In ([A-Za-z_$][\w$]*)[.,:; ]/.exec(String(why == null ? '' : why).trim());
  return m ? m[1] : null;
}

export function proseFnAgreement(doc) {
  let entries = 0,
    named = 0,
    checkable = 0,
    agree = 0;
  const disagree = [];
  for (const f of Object.keys(doc)) {
    if (f.startsWith('_')) continue;
    for (const e of doc[f]) {
      entries++;
      const p = fnFromProse(e.why);
      if (p) named++;
      if (!p || e.fn == null || e.fn === '') continue;
      checkable++;
      if (e.fn === p) agree++;
      else disagree.push({ file: f, line: e.line, op: e.op, fn: e.fn, prose: p });
    }
  }
  return { entries, named, checkable, agree, disagree };
}

export function unaddressed(drifted) {
  const row = (d) => ({
    line: d.entry.line,
    op: d.entry.op,
    before: d.entry.before == null ? null : String(d.entry.before),
    after: d.entry.after == null ? null : String(d.entry.after),
    cls: d.entry.class == null ? null : d.entry.class,
    why: d.entry.why == null ? null : d.entry.why,
    would: d.would,
    reason: UNADDRESSED_REASON[d.would] || null
  });
  return {
    noAddress: drifted.filter((d) => d.would === 'neverPlaced' || d.would === 'gone').map(row),
    conditional: drifted.filter((d) => d.would === 'someFn').map(row)
  };
}

/* The qualifier pass decides something of its own — which entries may carry a function qualifier —
   so it owes its own object rather than borrowing the re-anchor criterion.

   🔴 THE CRITERION MOVED, AND THE OLD ONE IS WHY. It read
   `qualifiers_resolving_to_other_than_one_mutant <= 0`, measured by a `result.ambiguousWritten`
   written as the literal `0`. The tool cannot write such a qualifier — `qualifyPlan` routes a
   colliding identity to `collides` and never to `write` — so the quantity judged was a constant,
   the gate could only read PASS, and it did: PASS over a ledger whose 104 drifted entries included
   38 with no address any mechanism here can give them (measured 2026-10-27 at `3791af39a`, 434
   entries). A green verdict about a question nobody asked is the §4b family — success reported about
   something never examined.

   So the pre-stated criterion is now the one the ledger can actually fail:
   `drifted_entries_with_no_reachable_address <= 0`, over the `neverPlaced` and `gone` tags
   `qualifyPlan` already computes. The old invariant is kept and strengthened rather than dropped —
   `ambiguousWritten` is still carried in `result`, and a non-zero one is FAIL, which outranks the
   SHORTFALL, because a widened excuse is a false classification and an orphan is only an unreachable
   one. Residue 2026-10-27-thirty-eight-drifted-entries-have-no-address-a-mechanism-can-reach. */
export function makeQualifyVerdict(tq) {
  const commit = headCommit();
  const checked = tq.entries;
  const noAddress = (tq.wouldNever || 0) + (tq.wouldGone || 0);
  return Verdict.make({
    gate: 'reanchor-equivalence-qualify',
    status: !checked ? 'NOT_RUN' : tq.ambiguousWritten ? 'FAIL' : noAddress ? 'SHORTFALL' : 'PASS',
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'drifted_entries_with_no_reachable_address', threshold: 0, unit: 'entries', direction: 'lte' },
    /* Same rule as the re-anchor object above: NOT_RUN examined no entry, so it carries no result.
       Latent against today's 434-entry ledger and reachable the moment the ledger is empty. */
    result: !checked
      ? null
      : {
          qualifiable: tq.write,
          identityCollides: tq.collides,
          topLevel: tq.topLevel,
          noAfterRecorded: tq.legacy,
          drifted: tq.drifted,
          alreadyQualified: tq.already,
          ambiguousWritten: tq.ambiguousWritten || 0,
          driftWithNoReachableAddress: noAddress,
          /* The retrospective: of the already-drifted entries, how many a qualifier would place. */
          driftPlacedForAnyFn: tq.wouldAnyFn,
          driftPlacedOnlyForSomeFn: tq.wouldSomeFn,
          driftNeverPlaceable: tq.wouldNever,
          driftMutationGone: tq.wouldGone
        },
    evidence: ['tools/reanchor-equivalence.mjs', 'tools/mutate-equivalence.json'],
    reason: !checked
      ? 'no ledger entry was examined, so nothing was decided'
      : tq.ambiguousWritten
        ? `${tq.ambiguousWritten} written qualifier(s) resolve to more than one mutant, so the excuse they carry is wider than the mutant it was judged over`
        : noAddress
          ? `${noAddress} drifted entr(ies) have no address this tool can reach: ${tq.wouldNever} repeat one mutation inside one function and ${tq.wouldGone} name a mutation the generator no longer produces; a further ${tq.wouldSomeFn} place only for some of the names they could have carried`
          : null,
    producedBy: commit
      ? { tool: 'tools/reanchor-equivalence.mjs', commit }
      : { tool: 'tools/reanchor-equivalence.mjs', commit: null, commitReason: 'git rev-parse failed here, so there is no commit to stamp' }
  });
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

  /* One line, two mutants of one operator (`2026-10-27-the-probe-target-came-off-a-looser-key`). */
  const gen3 = [T(40, 'cmp < → <=', 'if (i < n && j < m) {', 'if (i <= n && j < m) {'), T(40, 'cmp < → <=', 'if (i < n && j < m) {', 'if (i < n && j <= m) {')];
  const E = (after) => ({ line: 97, op: 'cmp < → <=', before: 'if (i < n && j < m) {', after, class: 'no-distinguishing-input' });
  const second = probePlan([E('if (i < n && j <= m) {')], gen3);
  ok(
    "a SIBLING at the same line does not become the target — the entry's own `after` picks it",
    second.targets.length === 1 && second.targets[0].mutant.after === 'if (i < n && j <= m) {',
    JSON.stringify(second.targets.map((t) => t.mutant.after))
  );
  const both = probePlan([E('if (i <= n && j < m) {'), E('if (i < n && j <= m) {')], gen3);
  ok(
    'two entries over two siblings give two targets and no collision',
    both.targets.length === 2 && both.collisions.length === 0,
    JSON.stringify({ t: both.targets.length, c: both.collisions.length })
  );
  const noAfter = probePlan([{ line: 97, op: 'cmp < → <=', before: 'if (i < n && j < m) {', class: 'no-distinguishing-input' }], gen3);
  ok(
    'an entry recording NO `after` is refused, never probed against a guessed sibling',
    noAfter.targets.length === 0 && noAfter.collisions.length === 0,
    JSON.stringify({ t: noAfter.targets.length, c: noAfter.collisions.length })
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
  ok(
    'report-only never ran the criterion, so it is NOT_RUN carrying no result',
    vf({ movable: 7 }).status === 'NOT_RUN' && vf({ movable: 7 }).result === null,
    vf({ movable: 7 }).status + ' result=' + JSON.stringify(vf({ movable: 7 }).result)
  );
  ok('a ledger with nothing drifted is NOT_APPLICABLE, never NOT_RUN — the gate read every entry', vf({}).status === 'NOT_APPLICABLE' && vf({}).result === null, vf({}).status);
  ok(
    'probes that all reached no verdict are UNKNOWN, never report-only — the gate ran and decided nothing',
    vf({ movable: 3, unprobed: 2, collided: 1 }).status === 'UNKNOWN',
    vf({ movable: 3, unprobed: 2, collided: 1 }).status
  );
  const pop = vf({ movable: 5, survived: 2, agreeing: 1, unprobed: 1, collided: 1 }).population;
  ok('checked + excluded = eligible, over the movable set', pop.checked + pop.excluded === pop.eligible && pop.checked === 3, JSON.stringify(pop));
  /* 🔴 THE LEG THAT WAS MISSING. The four legs above read `.status` alone, and the one object this
     selftest validated came from `sampleTally()`, which is a PASS. So the suite stayed green over an
     object the shipped path could not emit: report-only built a NOT_RUN carrying a result, and
     `validate()` refuses that shape, so the bare run printed its whole census and exited 1. Every
     arm now validates as a whole object. Residue
     2026-10-27-the-report-only-census-emits-an-invalid-verdict. */
  const arms = [
    ['PASS', { movable: 3, survived: 3 }],
    ['FAIL', { movable: 3, survived: 2, refuted: 1 }],
    ['SHORTFALL', { movable: 3, survived: 2, unprobed: 1 }],
    ['NOT_RUN', { movable: 7 }],
    ['NOT_APPLICABLE', {}],
    ['UNKNOWN', { movable: 3, unprobed: 2, collided: 1 }]
  ];
  for (const [want, t] of arms) {
    const obj = makeVerdict(Object.assign({ movable: 0, survived: 0, refuted: 0, agreeing: 0, unprobed: 0, collided: 0, voidedFiles: [] }, t));
    const chkArm = Verdict.validate(obj);
    ok('the ' + want + ' arm emits an object the contract accepts, not only the right word', obj.status === want && chkArm.ok === true, obj.status + ' · ' + (chkArm.errors || []).join('; '));
  }
  /* The qualifier object takes the same rule: an empty ledger examines no entry. */
  const vqEmpty = makeQualifyVerdict({ entries: 0, write: 0, collides: 0, topLevel: 0, legacy: 0, drifted: 0, already: 0, wouldAnyFn: 0, wouldSomeFn: 0, wouldNever: 0, wouldGone: 0 });
  const chkQ = Verdict.validate(vqEmpty);
  ok(
    'an empty ledger makes the qualifier NOT_RUN with no result, and the object validates',
    vqEmpty.status === 'NOT_RUN' && vqEmpty.result === null && chkQ.ok === true,
    vqEmpty.status + ' · ' + (chkQ.errors || []).join('; ')
  );
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
  /* ── the enclosing-function qualifier ──────────────────────────────────────────────────────────
     Residue 2026-10-26-a-line-keyed-equivalence-entry-that-drifts-ambiguously-cannot-be-placed. */
  const Q = (line, op, before, after, fn) => ({ line, op, before, after, fn });
  const qgen = [
    Q(10, 'num → 0', 'x = 5;', 'x = 0;', 'alpha'),
    Q(20, 'num → 0', 'x = 5;', 'x = 0;', 'beta'),
    Q(30, 'num → 0', 'x = 5;', 'x = 1;', 'beta'),
    Q(40, 'cmp > → >=', 'if (a > b) {', 'if (a >= b) {', null)
  ];
  ok('`after` narrows a candidate set the old key called ambiguous', candidatesFor({ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 1;' }, qgen).length === 1);
  ok('…so the entry is MOVABLE where the loose key reported ambiguity', planEntry({ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 1;' }, qgen).action === 'reanchor');
  ok('an entry recording NO `after` keeps the loose reading rather than matching nothing', planEntry({ line: 99, op: 'num → 0', before: 'x = 5;' }, qgen).action === 'ambiguous');
  ok('a qualifier picks between two mutants `after` cannot separate', planEntry({ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', fn: 'beta' }, qgen).action === 'reanchor');
  ok('…and names the right one', planEntry({ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', fn: 'beta' }, qgen).line === 20);
  ok('a qualifier naming no candidate is GONE, never guessed around', planEntry({ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', fn: 'gamma' }, qgen).action === 'gone');
  /* qualifyPlan — which entries may RECEIVE a qualifier, and why each refusal is a refusal. */
  const qp = qualifyPlan(
    [
      { line: 10, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' },
      { line: 40, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
      { line: 10, op: 'num → 0', before: 'x = 5;' },
      { line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 1;' },
      { line: 20, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', fn: 'beta' }
    ],
    qgen
  );
  ok('an anchored entry with a unique identity is qualifiable', qp.write.length === 1 && qp.write[0].fn === 'alpha', JSON.stringify(qp.write));
  ok('a TOP-LEVEL mutant can carry no qualifier', qp.topLevel.length === 1);
  ok('an entry recording no `after` is refused — a qualifier would have to invent one', qp.legacy.length === 1);
  ok('a DRIFTED entry is refused — its function could only be read off a wrong line', qp.drifted.length === 1);
  ok('an entry that already carries one is left alone', qp.already.length === 1);
  const coll = qualifyPlan([{ line: 20, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' }], [qgen[1], { ...qgen[2], after: 'x = 0;' }]);
  ok('an identity that names two mutants in ONE function is refused, not written', coll.collides.length === 1 && coll.write.length === 0);
  /* the retrospective: what a qualifier would have bought an entry that never carried one */
  ok(
    'a drifted entry whose candidates are one-per-function is placed whichever name was recorded',
    qualifyPlan([{ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' }], qgen).drifted[0].would === 'anyFn'
  );
  ok(
    '…one with a two-mutant group is placed only for SOME name',
    qualifyPlan([{ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' }], [qgen[0], qgen[1], { ...qgen[2], after: 'x = 0;' }]).drifted[0].would === 'someFn'
  );
  ok(
    '…and one whose mutation repeats inside a single function is NEVER placeable',
    qualifyPlan([{ line: 99, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' }], [qgen[1], { ...qgen[2], after: 'x = 0;' }]).drifted[0].would === 'neverPlaced'
  );
  ok('…and one with no candidate at all is reported as gone, not as placeable', qualifyPlan([{ line: 99, op: 'num → 0', before: 'nothing', after: 'nothing' }], qgen).drifted[0].would === 'gone');
  /* THE COMMITTED LEDGER ITSELF: every qualifier written must be a plain identifier. */
  const _led = JSON.parse(readFileSync(join(ROOT, 'tools/mutate-equivalence.json'), 'utf8'));
  let _fnBad = 0,
    _fnSeen = 0;
  for (const f of Object.keys(_led)) {
    if (f === '_README') continue;
    for (const e of _led[f]) {
      if (e.fn == null) continue;
      _fnSeen++;
      if (typeof e.fn !== 'string' || !/^\w+$/.test(e.fn)) _fnBad++;
    }
  }
  ok('the committed ledger carries qualifiers', _fnSeen > 0, _fnSeen + ' qualified');
  ok('…and every one of them is a plain identifier', _fnBad === 0);
  /* ── the entries with no reachable address ─────────────────────────────────────────────────────
     Residue 2026-10-27-thirty-eight-drifted-entries-have-no-address-a-mechanism-can-reach. */
  const D = (would, extra) => ({
    entry: Object.assign({ line: 7, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', class: 'no-distinguishing-input', why: 'In alpha. Identical output.' }, extra),
    action: 'ambiguous',
    would
  });
  const un = unaddressed([D('anyFn'), D('someFn'), D('neverPlaced'), D('gone'), D('anyFn')]);
  ok(
    'the two tags no mechanism can reach are the set, and the placeable ones are not in it',
    un.noAddress.length === 2 && un.noAddress.every((u) => u.would === 'neverPlaced' || u.would === 'gone'),
    JSON.stringify(un.noAddress.map((u) => u.would))
  );
  ok('a conditional entry is reported BESIDE the set, never inside it', un.conditional.length === 1 && un.conditional[0].would === 'someFn');
  ok(
    'every reported entry names what it stopped excusing, not only its address',
    un.noAddress.every((u) => u.cls === 'no-distinguishing-input' && /Identical output/.test(u.why)),
    JSON.stringify(un.noAddress[0])
  );
  ok(
    'each one carries its own reason rather than one shared word',
    un.noAddress[0].reason !== un.noAddress[1].reason && un.noAddress.every((u) => typeof u.reason === 'string' && u.reason.length > 10)
  );
  ok(
    'an entry recording no class or reason reports the absence rather than a blank',
    unaddressed([D('gone', { class: null, why: null })]).noAddress[0].cls === null && clip(null) === 'no recorded reason'
  );
  /* THE LEG THE OLD CRITERION COULD NOT HAVE: a ledger that places every drifted entry passes, and
     one that holds a single unplaceable entry does NOT. Under the retired criterion both read PASS. */
  const TQ = (extra) =>
    Object.assign({ entries: 10, write: 0, collides: 0, topLevel: 0, legacy: 0, drifted: 1, already: 9, wouldAnyFn: 1, wouldSomeFn: 0, wouldNever: 0, wouldGone: 0, ambiguousWritten: 0 }, extra);
  const vqOk = makeQualifyVerdict(TQ({}));
  ok(
    'a ledger whose every drifted entry places reads PASS, with the count measured',
    vqOk.status === 'PASS' && vqOk.result.driftWithNoReachableAddress === 0 && Verdict.validate(vqOk).ok,
    vqOk.status
  );
  const vqShort = makeQualifyVerdict(TQ({ wouldAnyFn: 0, wouldGone: 1 }));
  ok(
    'one entry with no reachable address makes it SHORTFALL, where the retired criterion read PASS',
    vqShort.status === 'SHORTFALL' && vqShort.result.driftWithNoReachableAddress === 1 && Verdict.validate(vqShort).ok,
    vqShort.status
  );
  ok(
    '…and the reason splits the set by cause rather than quoting one total',
    /no address this tool can reach/.test(vqShort.reason) && /generator no longer produces/.test(vqShort.reason),
    String(vqShort.reason)
  );
  const vqSome = makeQualifyVerdict(TQ({ wouldAnyFn: 0, wouldSomeFn: 1 }));
  ok('a conditional entry alone is not a shortfall — it has an address, for some name', vqSome.status === 'PASS' && vqSome.result.driftPlacedOnlyForSomeFn === 1, vqSome.status);
  const vqFail = makeQualifyVerdict(TQ({ wouldGone: 1, ambiguousWritten: 1 }));
  ok(
    'a widened excuse outranks an unreachable one: FAIL, not SHORTFALL',
    vqFail.status === 'FAIL' && /wider than the mutant/.test(vqFail.reason) && Verdict.validate(vqFail).ok,
    vqFail.status + ' · ' + String(vqFail.reason)
  );
  ok(
    'the criterion is the one the ledger can fail, stated before the data',
    vqOk.criterion.name === 'drifted_entries_with_no_reachable_address' && vqOk.criterion.threshold === 0 && vqOk.criterion.direction === 'lte',
    JSON.stringify(vqOk.criterion)
  );
  ok(
    'a leading "In <fn>." in the prose is read, and anything else is not a name',
    fnFromProse('In parsePPG. Original and mutant agreed.') === 'parsePPG' && fnFromProse('Original and mutant agreed.') === null && fnFromProse(null) === null
  );
  const agS = proseFnAgreement({
    _README: ['prose, not an entry'],
    'a.js': [
      { line: 1, op: 'num → 0', why: 'In alpha. Identical.', fn: 'alpha' },
      { line: 2, op: 'num → 0', why: 'In alpha. Identical.', fn: 'alphaInner' },
      { line: 3, op: 'num → 0', why: 'Identical.', fn: 'beta' },
      { line: 4, op: 'num → 0', why: 'In gamma. Identical.' }
    ]
  });
  ok('the control counts only the entries a written qualifier can check, and skips the README', agS.entries === 4 && agS.named === 3 && agS.checkable === 2 && agS.agree === 1, JSON.stringify(agS));
  ok(
    '…and it NAMES each disagreement rather than reporting a rate alone',
    agS.disagree.length === 1 && agS.disagree[0].fn === 'alphaInner' && agS.disagree[0].prose === 'alpha',
    JSON.stringify(agS.disagree)
  );
  /* The committed ledger is the measurement the comment above quotes; pin it as a floor, not a literal. */
  const agLive = proseFnAgreement(_led);
  ok(
    'the committed prose disagrees with a written qualifier at least once, so it is not an address',
    agLive.disagree.length > 0 && agLive.checkable > 100,
    agLive.disagree.length + ' of ' + agLive.checkable
  );
  ok(
    'no write path consumes the prose',
    /fnFromProse/.test(
      readFileSync(new URL(import.meta.url))
        .toString()
        .split('if (WRITE)')[1] || ''
    ) === false
  );
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
  const QUALIFY = has('--qualify');
  if (QUALIFY && PROBE) {
    console.error('--qualify --probe REFUSED: a qualifier write moves no address, so a probe has nothing to renew. Run them as separate passes.');
    process.exit(2);
  }
  if (WRITE && !PROBE && !QUALIFY) {
    console.error('--write REFUSED: moving an anchor without a probe re-arms an excuse nobody re-probed.');
    console.error('Owner ruling, board #1549 item 21 (2026-10-26): re-anchor WITH a probe for each entry. Re-run as `--probe --write`.');
    process.exit(2);
  }
  /* Enumerate through a FILE, never a pipe: a big file's mutant list truncates at ~146 KB through a
     child's stdout, and a truncated enumeration would report live entries as `gone`. Returns null on
     a failed enumeration so a caller skips the file rather than reading an empty one as empty. */
  const enumerate = (file) => {
    const tmp = join(tmpdir(), `reanchor-${process.pid}.json`);
    const fd = openSync(tmp, 'w');
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools/mutate.mjs'), '--file', file, '--dry-run', '--limit', '100000', '--json'], { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
    } catch (_) {
      closeSync(fd);
      console.error(`  ✗ ${file}: could not enumerate mutants — skipped`);
      return null;
    }
    closeSync(fd);
    const g = JSON.parse(readFileSync(tmp, 'utf8')).files[0].mutants;
    unlinkSync(tmp);
    return g;
  };

  if (QUALIFY) {
    /* THE QUALIFIER PASS. It writes `fn` on entries that are already exactly anchored and whose
       (fn, op, before, after) identity is unique in the file, and it moves no address — so it needs
       no probe, where a re-anchor does. The control for that claim is in the code below, not in this
       comment: every line is snapshotted before the write and compared after. */
    const tq = { write: 0, collides: 0, topLevel: 0, legacy: 0, drifted: 0, already: 0, entries: 0, files: 0, wouldAnyFn: 0, wouldSomeFn: 0, wouldNever: 0, wouldGone: 0, ambiguousWritten: 0 };
    const before = new Map();
    for (const file of files) {
      const generated = enumerate(file);
      if (!generated) continue;
      tq.files++;
      for (const e of doc[file]) before.set(e, e.line);
      const q = qualifyPlan(doc[file], generated);
      tq.entries += doc[file].length;
      tq.write += q.write.length;
      tq.collides += q.collides.length;
      tq.topLevel += q.topLevel.length;
      tq.legacy += q.legacy.length;
      tq.drifted += q.drifted.length;
      tq.already += q.already.length;
      for (const d of q.drifted) {
        if (d.would === 'anyFn') tq.wouldAnyFn++;
        else if (d.would === 'someFn') tq.wouldSomeFn++;
        else if (d.would === 'neverPlaced') tq.wouldNever++;
        else tq.wouldGone++;
      }
      console.log(
        `▸ ${file}  ${doc[file].length} entr(ies) · ${q.write.length} qualifiable · ${q.collides.length} identity-collides · ${q.topLevel.length} top-level · ${q.legacy.length} no-after · ${q.drifted.length} drifted · ${q.already.length} already`
      );
      for (const c of q.collides) console.log(`    ⚠ COLLIDES L${c.line} [${c.op}] — its (fn, op, before, after) names more than one mutant, so a qualifier would widen the excuse`);
      /* An aggregate cannot be acted on. Each entry with no reachable address is printed with what
         it stopped excusing, so a deletion list is read off the run rather than reconstructed. */
      const un = unaddressed(q.drifted);
      for (const u of un.noAddress) console.log(`    ✗ NO ADDRESS L${u.line} [${u.op}] (${u.would}) — ${u.reason}; it excused ${u.cls || 'an unrecorded class'}: ${clip(u.why)}`);
      for (const u of un.conditional) console.log(`    ~ CONDITIONAL L${u.line} [${u.op}] — ${u.reason}; it excuses ${u.cls || 'an unrecorded class'}: ${clip(u.why)}`);
      if (WRITE) for (const w of q.write) w.entry.fn = w.fn;
    }
    if (WRITE) {
      /* THE CONTROL. A qualifier write that moved an address would be a re-anchor wearing another
         flag's name, and PR #3989's ruling would apply to it. Refuse before touching the file. */
      const movedLines = [...before.entries()].filter(([e, l]) => e.line !== l);
      if (movedLines.length) {
        console.error(`--qualify --write REFUSED: ${movedLines.length} address(es) moved. A qualifier write must move none; that is why it needs no probe.`);
        process.exit(2);
      }
      writeFileSync(LEDGER, JSON.stringify(doc, null, LEDGER_INDENT) + '\n');
      console.log(`\n✓ qualified ${tq.write} entr(ies) with their enclosing function. NO address moved — verified over all ${before.size} entr(ies), not asserted.`);
    } else {
      console.log(`\n${tq.write} of ${tq.entries} entr(ies) can carry a qualifier. Re-run with \`--qualify --write\`.`);
      console.log(
        `  of the ${tq.drifted} already-drifted: ${tq.wouldAnyFn} would be placed whichever function was recorded, ${tq.wouldSomeFn} only for some, ${tq.wouldNever} never (one mutation repeated inside one function), ${tq.wouldGone} have no candidate at all.`
      );
      console.log(
        `  ${tq.wouldNever + tq.wouldGone} entr(ies) therefore have NO address this tool can reach — each named above. Deleting one drops a judgement, so the list is the owner's to rule on.`
      );
      const ag = proseFnAgreement(doc);
      console.log(
        `  control · the prose rescue: ${ag.named} of ${ag.entries} entr(ies) open "In <function>", and over the ${ag.checkable} with a machine-read qualifier to check against it disagrees ${ag.disagree.length} time(s) — so the prose is not an address.`
      );
      for (const d of ag.disagree) console.log(`    ⚠ PROSE MISNAMES ${d.file} L${d.line} [${d.op}] — fn=${d.fn}, prose=${d.prose}`);
    }
    const vq = makeQualifyVerdict(tq);
    const cq = Verdict.validate(vq);
    if (!cq.ok) {
      console.error('verdict invalid: ' + (cq.errors || []).join('; '));
      process.exit(1);
    }
    console.log(JSON.stringify(vq));
    process.exit(0);
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
    const generated = enumerate(file);
    if (!generated) continue;

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
