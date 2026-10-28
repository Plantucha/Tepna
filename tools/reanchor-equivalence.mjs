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
 *   node tools/reanchor-equivalence.mjs --settle           # probe every multi-candidate drifted entry
 *   node tools/reanchor-equivalence.mjs --settle --write   # address it, delete it or escalate it
 *   node tools/reanchor-equivalence.mjs --prune            # entries no generated mutant matches, report only
 *   node tools/reanchor-equivalence.mjs --prune --write    # delete them; needs no probe (see the branch)
 *   node tools/reanchor-equivalence.mjs --prune --prune-list <path>   # the per-entry evidence as JSON
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
import { functionRange } from './probe-equivalence.mjs';

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

/* WHETHER A RE-ADDRESSED ENTRY MAY ALSO TAKE A QUALIFIER. The address and the qualifier are two
   decisions: `line` is measured (the probe watched that site survive), while `fn` REPLACES the line
   in the identity, so it is safe only under the same uniqueness condition `qualifyPlan` applies —
   exactly one generated mutant carries `(fn, op, before, after)`. A cohort of two surviving sites
   inside one function fails it by construction, and qualifying both would leave one excuse standing
   for two mutants. `idCnt` is the file's identity histogram, built from the generator. */
export function settleQualifier(mutant, idCnt) {
  if (mutant.fn == null) return { ok: false, verdict: 'refused-top-level', n: 0, reason: 'the site is top level, so no qualifier can name it' };
  const n = idCnt.get(idKey(mutant)) ?? 0;
  if (n === 1) return { ok: true, verdict: 'written', n, reason: null };
  return { ok: false, verdict: 'refused-not-unique', n, reason: `${n} generated mutants share the identity (${mutant.fn}, op, before, after)` };
}

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
  const out = { write: [], collides: [], topLevel: [], legacy: [], drifted: [], already: [], alreadyWide: [], alreadyGone: [] };
  for (const e of entries) {
    if (e.fn != null && e.fn !== '') {
      /* 🔴 AN ALREADY-WRITTEN QUALIFIER IS RE-DECIDED, NEVER TRUSTED. The write-time condition is
         that exactly one generated mutant carries `(fn, op, before, after)`. It was applied once, to
         the generator of that day, and this branch used to accept the field on sight. The only
         standing guard afterwards was the Python invariant
         `test_a_FUNCTION_QUALIFIER_is_unique_within_its_module`, which compares qualified entries to
         EACH OTHER. It fires on a pair sharing one identity. It cannot see a lone entry sitting over
         two sibling mutants, which is the shape a later edit above the site produces. Residue
         `2026-10-28-the-qualifier-uniqueness-test-compares-entries-to-each-other-not-to-the-generator`.
         The histogram above is the generator's own answer, so asking it again costs one lookup.

         The two failures are NOT one quantity. `alreadyWide` (n > 1) is an excuse wider than the
         mutant it was judged over — a false classification. `alreadyGone` (n === 0) names no mutant
         at all, and `resolveEntryAddresses` fails closed on it: the entry keeps its recorded line
         and orphans, which costs a blocked survivor and excuses nothing. §∅ — a dead qualifier is
         reported as the absence it is, never folded into the count of wide ones. */
      const n = cnt.get(idKey(e)) ?? 0;
      if (n === 1) out.already.push(e);
      else if (n === 0) out.alreadyGone.push({ entry: e, n });
      else out.alreadyWide.push({ entry: e, n });
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
   addressable anyway, because its `why` opens `In <function>.` — 391 of the committed 401 do. If
   that name were the recorded function, every drifted entry would carry an address and this tool
   would only have to read it. It is not an address, for two measured reasons.
   (1) IT DRIFTS. The 315 entries carrying BOTH the prose and a machine-read `fn` are the control, and
   the prose named a different function on 11 of them until it was repaired on 2026-10-28: `dfaAlpha1`
   for `dfaAlpha1Segmented`, `countPairs` for `countPairsIn`, `markO2Sentinels` for
   `markO2BeatMarkers`, and `detectClampSaturation` for the `spikeAt` nested inside it. The count is 0
   today and the selftest leg holds it there, so the agreement is an invariant someone MAINTAINS, never
   a property of the field: stale prose beside a freshly stamped `fn` re-opens it, and the leg names
   the entry.
   (2) THE REPAIR DOES NOT REACH THE SET A RESCUE WOULD SERVE. 79 entries carry no `fn` at all, 76 of
   them with prose, and over exactly those entries nothing checks the prose. Placing one by it stakes a
   re-anchor on an unchecked name, and this tool's standing rule is that a wrong re-anchor costs more
   than a lost entry. So the prose is reported as a disagreement count and never consumed.
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

/* ── ASK 1 OF THE 2026-10-28 RULING: AN ENTRY THAT MATCHES NOTHING EXCUSES NOTHING ──────────────
   The owner's ruling, relayed by Kestrel 2026-10-28: delete every entry that produces no candidate
   under the LOOSE key and whose `before` text is absent from its file. Both conditions, and they are
   not the same question. The loose key asks what the GENERATOR emits; the text asks what the FILE
   holds. An entry can fail the first and pass the second — the line is still there and the operator
   no longer fires on it — and that entry is NOT prunable under this rule, because the mutation may
   return with the next generator change while the excuse would already be gone.

   This is not the deletion the 2026-10-05 fleet rule governs. That rule guards a REFUTED verdict:
   never weaken an excuse because a probe killed its mutant, without planting the mutant and watching
   the covering suite fail. Here there is no mutant to plant. `classifySurvivors` matches an entry
   against mutants a run GENERATED, and no generator emits text the file does not contain, so the
   entry cannot excuse anything for as long as the text stays absent. An absence is not a refutation.
   The capture-host ledger reached the same place first (`test_every_EQUIVALENCE_entry_is_still_in_
   its_MODULE`), which is why this reads as a port rather than a new policy. */
export function looseCandidates(entry, generated) {
  const k = codeKey(entry);
  return generated.filter((m) => codeKey(m) === k);
}

/* Whitespace-collapsing, because the ledger stores a source line as it was and a reflow would
   otherwise read as an absence. Three answers rather than one boolean: a whole-line match, a match
   inside a longer line, and a raw byte-level `includes` that normalises nothing. The third is the
   control for the other two — it can only over-report presence, so a `false` there is the strongest
   absence evidence the file can give. */
export function textPresence(src, before) {
  const want = String(before == null ? '' : before)
    .replace(/\s+/g, ' ')
    .trim();
  const out = { exact: [], inside: [], raw: false, want };
  if (want === '') return out;
  const whole = String(src == null ? '' : src);
  const lines = whole.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\s+/g, ' ').trim();
    if (l === want) out.exact.push(i + 1);
    else if (l.includes(want)) out.inside.push(i + 1);
  }
  out.raw = whole.includes(String(before == null ? '' : before));
  return out;
}

/* THREE OUTCOMES, because the two conditions carve out a middle class that must not be cut silently.
   `prune` — no candidate and no text: the entry excuses nothing and cannot start again by itself.
   `textStillThere` — no candidate, text present: unreachable TODAY, and the rule keeps it.
   `live` — the generator still emits its mutation, so the entry is doing its job. */
export function prunePlan(entries, generated, src) {
  const out = { prune: [], textStillThere: [], live: 0 };
  for (const e of entries) {
    const loose = looseCandidates(e, generated).length;
    const t = textPresence(src, e.before);
    const rec = { entry: e, loose, textExact: t.exact, textInside: t.inside, raw: t.raw };
    if (loose > 0) {
      out.live++;
      continue;
    }
    if (t.exact.length === 0 && t.inside.length === 0 && !t.raw) out.prune.push(rec);
    else out.textStillThere.push(rec);
  }
  return out;
}

/* The prune decides something, so it owes its own object. The criterion is over the ledger AS THIS
   RUN LEAVES IT: a report-only pass leaves every orphan in place and reads SHORTFALL, and the same
   command with `--write` removes the prunable ones and reads PASS only if none remain. The middle
   class counts as remaining, which is the escalation channel — it reaches a reader as a number in a
   verdict rather than as a sentence in a log. */
/* ══ SETTLING A MULTI-CANDIDATE DRIFTED ENTRY ══════════════════════════════════════════════════
   An entry the qualifier calls `someFn` or `neverPlaced` has drifted AND matches more than one
   generated mutant, and it carries no `fn`, so no name narrows it. `planEntry` refuses it as
   `ambiguous` and the tool leaves it orphaned — correct as a default, and it leaves 19 judgements
   inert in the ledger.

   What breaks the tie is not a better reading of the entry. It is the PROBE: each candidate mutant
   is planted and the covering suite is run, so each site comes back `survived` or `killed`. The
   entries of one cohort — identical in (op, before, after), differing only in a `line` already known
   to be wrong — are interchangeable, so a decision is about the cohort and the SITES, never about
   which entry object is which.

   Five rules over (n entries, S surviving sites, K killed sites). They are a POLICY, written after
   the probe of 2026-10-28 and open to the owner's overrule; the measurement under them is not.
     0 · any candidate without a verdict → ESCALATE. An absence is not a survival (§∅).
     1 · |S| = 0 → DELETE all n. Every site the entry could name was killed, so the excuse is
         refuted wherever it could live; the probe IS the plant-and-watch control the fleet rule of
         2026-10-05 demands before weakening an equivalence entry.
     2 · |S| = n → ADDRESS each entry to one survivor in line order. A bijection, so every entry
         names a real distinct site and none can land on a killed one.
     3 · |S| < n → ADDRESS |S| of them, DELETE the surplus. Which object is deleted is a relabeling.
     4 · |S| > n with K empty → ADDRESS to the first n survivors. Every candidate survived, so the
         choice is consequence-free.
     5 · |S| > n with K non-empty → ESCALATE. A killed site exists, so the address matters, and the
         data does not say which site the entry judged. This is the one shape the probe cannot settle.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
export function settleCohorts(entries, generated) {
  const q = qualifyPlan(entries, generated);
  const byKey = new Map();
  for (const d of q.drifted) {
    if (d.would !== 'someFn' && d.would !== 'neverPlaced') continue;
    const e = d.entry;
    const k = codeKey(e) + '\u0000' + norm(e.after);
    if (!byKey.has(k)) {
      /* The candidate set is read WITHOUT the entry's `fn` — these entries have none, and reading a
         name off a drifted line would read it off an address already known to be wrong. */
      byKey.set(k, { key: k, would: d.would, entries: [], candidates: candidatesFor({ op: e.op, before: e.before, after: e.after }, generated).slice() });
    }
    byKey.get(k).entries.push(e);
  }
  const byLine = (a, b) => a.line - b.line;
  return [...byKey.values()].map((c) => ({ ...c, entries: c.entries.slice().sort(byLine), candidates: c.candidates.sort(byLine) }));
}

export function settleDecide(cohort, outcomeOf) {
  const out = { rule: null, decisions: [], survivors: [], killed: [], unknown: [] };
  for (const m of cohort.candidates) {
    const o = outcomeOf(m);
    if (o === 'survived') out.survivors.push(m);
    else if (o === 'killed') out.killed.push(m);
    else out.unknown.push(m);
  }
  const n = cohort.entries.length;
  const S = out.survivors;
  const K = out.killed;
  const all = cohort.candidates.length;
  const escalate = (reason) => {
    for (const e of cohort.entries) out.decisions.push({ entry: e, action: 'escalate', reason });
  };
  if (out.unknown.length) {
    out.rule = 0;
    escalate(`${out.unknown.length} of ${all} candidate site(s) came back with no verdict, and an absence is not a survival`);
    return out;
  }
  if (S.length === 0) {
    out.rule = 1;
    for (const e of cohort.entries)
      out.decisions.push({ entry: e, action: 'delete', reason: `all ${K.length} site(s) this entry could name were KILLED, so the excuse is refuted wherever it could live` });
    return out;
  }
  if (S.length === n) {
    out.rule = 2;
    cohort.entries.forEach((e, i) =>
      out.decisions.push({ entry: e, action: 'address', mutant: S[i], reason: `${n} entr(ies) over ${n} surviving site(s) of ${all}: a bijection, so this entry names a real distinct site` })
    );
    return out;
  }
  if (S.length < n) {
    out.rule = 3;
    cohort.entries.forEach((e, i) => {
      if (i < S.length) out.decisions.push({ entry: e, action: 'address', mutant: S[i], reason: `${S.length} of ${all} site(s) survived, and this entry takes one of them` });
      else out.decisions.push({ entry: e, action: 'delete', reason: `the cohort holds ${n} interchangeable entr(ies) and only ${S.length} of ${all} site(s) survived, so the surplus is refuted` });
    });
    return out;
  }
  if (K.length === 0) {
    out.rule = 4;
    cohort.entries.forEach((e, i) =>
      out.decisions.push({ entry: e, action: 'address', mutant: S[i], reason: `every one of the ${all} candidate site(s) survived, so which one this entry takes is consequence-free` })
    );
    return out;
  }
  out.rule = 5;
  escalate(`${S.length} of ${all} site(s) survived and ${K.length} were killed, over ${n} entr(ies): the address matters and the data does not say which site this entry judged`);
  return out;
}

/* ══ RULE 5-BIS — THE PROBE FIELD NAMES THE RANGE THE VERDICT CAME FROM ═════════════════
   Rule 5 escalates because "the data does not say which site this entry judged". For an entry the
   PROBE engine emitted, the data does say it, and the entry has carried it all along.

   `tools/probe-equivalence.mjs` composes `probe` from `fam.name` — machine-written, never prose —
   and that engine picks a family's survivors by SOURCE RANGE: `inRange = (m) => m.line >= range.start
   && m.line <= range.end` over `functionRange(SRC, fam.fn)`. An emitted entry's family therefore
   names a function whose range CONTAINED the mutant that was judged. Narrowing a cohort's candidates
   by that same range reproduces the engine's own selection instead of inventing a second one, and
   `functionRange` refuses an absent or AMBIGUOUS declaration, so the narrowing fails closed wherever
   the name no longer resolves.

   ⚠️ IT READS A RANGE, NOT A NAME, and that is measured rather than chosen. Over the committed
   ledger on 2026-10-28, 309 entries carry both a machine-read `fn` and a parseable probe family, and
   the two disagree on 11: `spikeAt` under family `detectClampSaturation` (nested inside it),
   `countPairsIn` under `countPairs` and `markO2BeatMarkers` under `markO2Sentinels` (both renamed
   since, so those families resolve to null today), and `dfaAlpha1Segmented` under `dfaAlpha1` (whose
   range has since shrunk past it). Every one is a containment or a rename, because `fn` is the
   INNERMOST named function while the family is the one the battery drove.

   The narrowing can only ever make a cohort SMALLER, and only a cohort rule 5 already escalated is
   offered to it, so its failure mode is an entry left exactly as it was — the recoverable direction
   this ledger's rules demand. It refuses outright when a cohort's entries name different families,
   because entries are interchangeable only inside the family that judged them. */
export function probeFamilyFn(entry) {
  const p = entry == null ? null : entry.probe;
  if (typeof p !== 'string') return { ok: false, fn: null, reason: 'the entry carries no probe field, so no family named it' };
  const m = /^([A-Za-z_$][A-Za-z0-9_$]*) · [^:]*: \d+ inputs, \d+ distinct baseline answers;/.exec(p);
  if (!m) return { ok: false, fn: null, reason: 'the probe field is not in the engine-written `<family> · <axis>: N inputs, M distinct baseline answers;` form' };
  return { ok: true, fn: m[1], reason: null };
}

export function narrowToProbedFamily(cohort, src, rangeOf = functionRange) {
  const names = new Set();
  for (const e of cohort.entries) {
    const f = probeFamilyFn(e);
    if (!f.ok) return { ok: false, candidates: null, fn: null, range: null, reason: f.reason };
    names.add(f.fn);
  }
  if (names.size !== 1)
    return {
      ok: false,
      candidates: null,
      fn: null,
      range: null,
      reason: `the cohort's entries name ${names.size} probe families (${[...names].join(', ')}), and an entry is interchangeable only inside the family that judged it`
    };
  const fn = [...names][0];
  const range = rangeOf(String(src == null ? '' : src), fn);
  if (!range) return { ok: false, candidates: null, fn, range: null, reason: `\`${fn}\` does not resolve to one unambiguous declaration here, so its range can narrow nothing` };
  const candidates = cohort.candidates.filter((m) => m.line >= range.start && m.line <= range.end);
  if (!candidates.length) return { ok: false, candidates: null, fn, range, reason: `no candidate site lies inside \`${fn}\` at L${range.start}–${range.end}, so the probed family names none of them` };
  if (candidates.length === cohort.candidates.length) return { ok: false, candidates: null, fn, range, reason: `every candidate already lies inside \`${fn}\`, so the range narrows nothing` };
  return { ok: true, candidates, fn, range, reason: null };
}

export function makeSettleVerdict(ts) {
  const commit = headCommit();
  const checked = ts.entries;
  const unsettled = ts.escalated + ts.unprobed;
  const reason = !checked
    ? 'no multi-candidate drifted entry was examined, so nothing was decided'
    : unsettled === 0
      ? null
      : `${unsettled} probed entr(ies) are not settled: ${ts.escalated} escalated because a killed site makes the address matter, and ${ts.unprobed} were never probed`;
  return Verdict.make({
    gate: 'reanchor-equivalence-settle',
    status: !checked ? 'NOT_RUN' : unsettled ? 'SHORTFALL' : 'PASS',
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'probed_entries_left_unsettled', threshold: 0, unit: 'entries', direction: 'lte' },
    result: !checked
      ? null
      : {
          entries: checked,
          cohorts: ts.cohorts,
          files: ts.files,
          addressed: ts.addressed,
          deleted: ts.deleted,
          escalated: ts.escalated,
          unprobed: ts.unprobed,
          lineKeyed: ts.lineKeyed ?? 0,
          byRule: ts.byRule,
          written: ts.written
        },
    evidence: ['tools/reanchor-equivalence.mjs', 'tools/mutate-equivalence.json'],
    reason,
    producedBy: commit
      ? { tool: 'tools/reanchor-equivalence.mjs', commit }
      : { tool: 'tools/reanchor-equivalence.mjs', commit: null, commitReason: 'git rev-parse failed here, so there is no commit to stamp' }
  });
}

export function makePruneVerdict(tp) {
  const commit = headCommit();
  const checked = tp.entries;
  const remaining = tp.prune + tp.textStillThere - tp.pruned;
  const reason = !checked
    ? 'no ledger entry was examined, so nothing was decided'
    : remaining === 0
      ? null
      : remaining +
        ' entr(ies) match no generated mutant: ' +
        (tp.prune - tp.pruned) +
        ' with their source text absent (prunable under the 2026-10-28 rule) and ' +
        tp.textStillThere +
        ' whose text is still in the file, which the rule keeps';
  return Verdict.make({
    gate: 'reanchor-equivalence-prune',
    status: !checked ? 'NOT_RUN' : remaining ? 'SHORTFALL' : 'PASS',
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'entries_matching_no_generated_mutant', threshold: 0, unit: 'entries', direction: 'lte' },
    result: !checked
      ? null
      : {
          entries: checked,
          files: tp.files,
          live: tp.live,
          orphansFound: tp.prune + tp.textStillThere,
          prunableBothProofs: tp.prune,
          unreachableTextStillPresent: tp.textStillThere,
          pruned: tp.pruned,
          remaining
        },
    evidence: ['tools/reanchor-equivalence.mjs', 'tools/mutate-equivalence.json'],
    reason,
    producedBy: commit
      ? { tool: 'tools/reanchor-equivalence.mjs', commit }
      : { tool: 'tools/reanchor-equivalence.mjs', commit: null, commitReason: 'git rev-parse failed here, so there is no commit to stamp' }
  });
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
   one. Residue 2026-10-27-thirty-eight-drifted-entries-have-no-address-a-mechanism-can-reach.

   ⚠️ AND IT WAS STILL A CONSTANT. The criterion moved, the old quantity stayed — nothing incremented
   `ambiguousWritten`, so the FAIL arm could not be reached by any ledger. `qualifyPlan` now
   re-decides every already-written qualifier against the generator's identity histogram, and this
   object reads that count. Measured 2026-10-28 over the 322 qualified entries at `5527cfef4`: every
   one names exactly one generated mutant, so the quantity is 0 because it was asked, not because it
   was asserted. `alreadyNamingNoMutant` rides beside it and is deliberately NOT in the status: a
   dead qualifier orphans its entry and excuses nothing, so it is a reported absence, not a FAIL.
   Residue 2026-10-28-the-qualifier-uniqueness-test-compares-entries-to-each-other-not-to-the-generator. */
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
          alreadyNamingNoMutant: tq.alreadyGone || 0,
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
  ok('an entry that already carries one is RE-DECIDED and kept', qp.already.length === 1 && qp.alreadyWide.length === 0 && qp.alreadyGone.length === 0);
  /* The already-written qualifier, re-decided. These two legs are the ones the Python invariant
     cannot reach: one entry, no pair to compare it with, and the generator is the only witness. */
  const qWide = qualifyPlan([{ line: 20, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', fn: 'beta' }], [qgen[1], { ...qgen[2], after: 'x = 0;' }]);
  ok(
    'a LONE already-qualified entry over two sibling mutants is WIDE, with the count that decided it',
    qWide.alreadyWide.length === 1 && qWide.alreadyWide[0].n === 2 && qWide.already.length === 0,
    JSON.stringify(qWide.alreadyWide)
  );
  const qDead = qualifyPlan([{ line: 20, op: 'num → 0', before: 'x = 5;', after: 'x = 0;', fn: 'gamma' }], qgen);
  ok(
    '…and one naming NO generated mutant is DEAD, counted apart from the wide ones',
    qDead.alreadyGone.length === 1 && qDead.alreadyGone[0].n === 0 && qDead.alreadyWide.length === 0,
    JSON.stringify(qDead.alreadyGone)
  );
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
  /* The quantity above is now MEASURED by `qualifyPlan`, so these two legs pin what each failure
     costs: a wide qualifier FAILS on its own, and a dead one is carried without touching the status. */
  const vqWide = makeQualifyVerdict(TQ({ ambiguousWritten: 1 }));
  ok('a wide qualifier FAILS on its own, with no unreachable entry beside it', vqWide.status === 'FAIL' && Verdict.validate(vqWide).ok, vqWide.status);
  const vqDead = makeQualifyVerdict(TQ({ alreadyGone: 1 }));
  ok(
    '…while a DEAD qualifier is reported in `result` and leaves the status alone — it orphans its entry and excuses nothing',
    vqDead.status === 'PASS' && vqDead.result.alreadyNamingNoMutant === 1 && Verdict.validate(vqDead).ok,
    vqDead.status + ' · ' + JSON.stringify(vqDead.result.alreadyNamingNoMutant)
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
  /* The committed ledger is the measurement the comment above quotes. The prose was repaired to agree
     on 2026-10-28, so this leg pins the disagreement count at 0 rather than at "it drifts": stale
     prose beside a freshly stamped `fn` reds it, the message names the entry, and the fix is the
     prose. The `checkable` floor is there so the leg cannot pass over a ledger it failed to read. */
  const agLive = proseFnAgreement(_led);
  ok(
    'every committed entry carrying both a prose name and a written qualifier names ONE function',
    agLive.disagree.length === 0 && agLive.checkable > 100,
    agLive.disagree.length + ' disagreement(s) over ' + agLive.checkable + ' checkable · ' + JSON.stringify(agLive.disagree.slice(0, 3))
  );
  ok(
    'no write path consumes the prose',
    /fnFromProse/.test(
      readFileSync(new URL(import.meta.url))
        .toString()
        .split('if (WRITE)')[1] || ''
    ) === false
  );

  /* ── the prune pass ───────────────────────────────────────────────────────────────────────
     The two conditions are measured separately here, because the whole ruling rests on them
     asking different questions: `looseCandidates` asks what the GENERATOR emits at this
     (op, before), `textPresence` asks what the FILE holds. A leg for each, then a leg for the
     middle class — no candidate, text still present — which must be KEPT, not pruned. */
  const genL = [
    { line: 10, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
    { line: 44, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a > b + 1) {' },
    { line: 20, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' }
  ];
  ok(
    'the loose key ignores `after`, so one (op, before) can answer for several generated mutants',
    looseCandidates({ line: 999, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' }, genL).length === 2,
    JSON.stringify(looseCandidates({ line: 999, op: 'cmp > → >=', before: 'if (a > b) {' }, genL).map((m) => m.line))
  );
  ok('…and it is still keyed on the op, so the same text under another op matches nothing', looseCandidates({ line: 10, op: 'bool && → ||', before: 'if (a > b) {' }, genL).length === 0);
  const srcL = 'const a = 1;\n   if (a > b) {   \n  foo(if (a > b) { );\n';
  const tpE = textPresence(srcL, 'if (a > b) {');
  ok('a whole line matches its entry text through any indentation, and reports the 1-based line', tpE.exact.length === 1 && tpE.exact[0] === 2, JSON.stringify(tpE));
  ok('…and a line that merely CONTAINS the text is reported apart from an exact match', tpE.inside.length === 1 && tpE.inside[0] === 3, JSON.stringify(tpE.inside));
  const tpA = textPresence(srcL, 'if (q < r) {');
  ok('absent text reports absent on all three readings, which is the condition a prune needs', tpA.exact.length === 0 && tpA.inside.length === 0 && tpA.raw === false);
  ok('an empty `before` is never read as present — it would make every entry prunable', textPresence(srcL, '').raw === false && textPresence(srcL, null).exact.length === 0);
  /* The raw leg is the control on the whitespace-collapsing one: a `before` that only matches once
     the collapse has run is NOT a byte-level absence, and the prune refuses on either reading. */
  ok(
    'the raw byte reading is kept beside the collapsed one as its control',
    textPresence('  if (a  >  b) {\n', 'if (a > b) {').exact.length === 1 && textPresence('  if (a  >  b) {\n', 'if (a > b) {').raw === false
  );

  const plE = prunePlan(
    [
      { line: 10, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
      { line: 77, op: 'bool && → ||', before: 'if (a > b) {', after: 'if (a || b) {' },
      { line: 88, op: 'num → 0', before: 'z = 9;', after: 'z = 0;' }
    ],
    genL,
    srcL
  );
  ok(
    'prunePlan separates all three outcomes: live, prunable, and unreachable-but-still-written',
    plE.live === 1 && plE.prune.length === 1 && plE.textStillThere.length === 1,
    JSON.stringify({ live: plE.live, prune: plE.prune.length, kept: plE.textStillThere.length })
  );
  ok(
    '…and the one it prunes is the one whose text is GONE, not the one whose operator stopped firing',
    plE.prune[0].entry.line === 88 && plE.textStillThere[0].entry.line === 77,
    JSON.stringify([plE.prune[0].entry.line, plE.textStillThere[0].entry.line])
  );
  ok(
    'a kept entry carries the lines its text still occupies, so the keep is readable rather than asserted',
    plE.textStillThere[0].textExact.length + plE.textStillThere[0].textInside.length > 0,
    JSON.stringify(plE.textStillThere[0])
  );

  const TP = (o) => ({ entries: 0, files: 0, live: 0, prune: 0, textStillThere: 0, pruned: 0, ...o });
  const vpNone = makePruneVerdict(TP({ entries: 5, files: 1, live: 5 }));
  ok(
    'a ledger with no orphan passes, and the object validates whole',
    vpNone.status === 'PASS' && vpNone.reason === null && Verdict.validate(vpNone).ok,
    vpNone.status + ' · ' + (Verdict.validate(vpNone).errors || []).join('; ')
  );
  const vpDry = makePruneVerdict(TP({ entries: 5, files: 1, live: 3, prune: 2 }));
  ok(
    'a dry run that FOUND orphans and deleted none is a SHORTFALL, not a pass',
    vpDry.status === 'SHORTFALL' && vpDry.result.remaining === 2 && Verdict.validate(vpDry).ok,
    vpDry.status + ' · ' + String(vpDry.reason)
  );
  const vpWrote = makePruneVerdict(TP({ entries: 5, files: 1, live: 3, prune: 2, pruned: 2 }));
  ok(
    '…and the same run after the write passes, because nothing unmatched is left',
    vpWrote.status === 'PASS' && vpWrote.reason === null && vpWrote.result.pruned === 2 && Verdict.validate(vpWrote).ok,
    vpWrote.status
  );
  const vpKept = makePruneVerdict(TP({ entries: 5, files: 1, live: 4, textStillThere: 1 }));
  ok(
    'the middle class keeps the verdict short of a pass, and the reason says the rule KEPT it',
    vpKept.status === 'SHORTFALL' && /whose text is still in the file, which the rule keeps/.test(vpKept.reason) && Verdict.validate(vpKept).ok,
    String(vpKept.reason)
  );
  const vpNil = makePruneVerdict(TP({}));
  ok(
    'a run over no entry is NOT_RUN with a reason, never a pass over nothing examined',
    vpNil.status === 'NOT_RUN' && vpNil.result === null && typeof vpNil.reason === 'string' && Verdict.validate(vpNil).ok,
    vpNil.status + ' · ' + (Verdict.validate(vpNil).errors || []).join('; ')
  );
  ok(
    'the prune criterion is pre-stated and names the population it judges',
    vpDry.criterion.name === 'entries_matching_no_generated_mutant' &&
      vpDry.criterion.threshold === 0 &&
      vpDry.criterion.direction === 'lte' &&
      vpDry.population.checked + vpDry.population.excluded === vpDry.population.eligible,
    JSON.stringify(vpDry.criterion)
  );

  /* ── the settle pass ──────────────────────────────────────────────────────────────────────
     One leg per rule, each built so the rule it names is the only one that can fire. The
     outcome function stands in for a probe, which is what makes the five rules testable without
     one — the rules read a verdict per site, never a count of mutants. */
  const C = (lines, cands) => ({
    key: 'k',
    would: 'neverPlaced',
    entries: lines.map((l) => ({ line: l, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' })),
    candidates: cands.map((l) => ({ line: l, fn: 'f', op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' }))
  });
  const OUT = (map) => (m) => map[m.line];
  const d1 = settleDecide(C([9, 11], [40, 50]), OUT({ 40: 'killed', 50: 'killed' }));
  ok(
    'rule 1 · every site killed deletes the whole cohort, which is the probe acting as the plant-and-watch control',
    d1.rule === 1 && d1.decisions.every((x) => x.action === 'delete') && d1.decisions.length === 2,
    JSON.stringify(d1.decisions.map((x) => x.action))
  );
  const d2 = settleDecide(C([9, 11], [40, 50]), OUT({ 40: 'survived', 50: 'survived' }));
  ok(
    'rule 2 · as many survivors as entries is a bijection, and each entry takes a DISTINCT site in line order',
    d2.rule === 2 && d2.decisions.map((x) => x.mutant.line).join(',') === '40,50' && new Set(d2.decisions.map((x) => x.mutant.line)).size === 2,
    JSON.stringify(d2.decisions.map((x) => x.mutant.line))
  );
  const d3 = settleDecide(C([9, 11], [40, 50]), OUT({ 40: 'killed', 50: 'survived' }));
  ok(
    'rule 3 · fewer survivors than entries addresses the survivors and deletes the surplus — and never addresses a KILLED site',
    d3.rule === 3 &&
      d3.decisions.filter((x) => x.action === 'address').length === 1 &&
      d3.decisions.filter((x) => x.action === 'delete').length === 1 &&
      d3.decisions.find((x) => x.action === 'address').mutant.line === 50,
    JSON.stringify(d3.decisions.map((x) => x.action + ':' + (x.mutant ? x.mutant.line : '-')))
  );
  const d4 = settleDecide(C([9], [40, 50, 60]), OUT({ 40: 'survived', 50: 'survived', 60: 'survived' }));
  ok(
    'rule 4 · more survivors than entries with nothing killed is consequence-free, so it takes the lowest line',
    d4.rule === 4 && d4.decisions.length === 1 && d4.decisions[0].mutant.line === 40,
    JSON.stringify(d4.decisions[0].mutant)
  );
  const d5 = settleDecide(C([9], [40, 50, 60]), OUT({ 40: 'survived', 50: 'survived', 60: 'killed' }));
  ok(
    'rule 5 · a killed site among more survivors than entries ESCALATES — the one shape a probe cannot settle',
    d5.rule === 5 && d5.decisions.every((x) => x.action === 'escalate') && /does not say which site/.test(d5.decisions[0].reason),
    JSON.stringify(d5.decisions.map((x) => x.action))
  );
  const d0 = settleDecide(C([9], [40, 50]), OUT({ 40: 'survived' }));
  ok(
    'rule 0 · a site with no verdict escalates, because an absence is not a survival',
    d0.rule === 0 && d0.decisions[0].action === 'escalate' && d0.unknown.length === 1,
    JSON.stringify({ rule: d0.rule, unknown: d0.unknown.length })
  );
  /* ── rule 5-bis ─────────────────────────────────────────────────────────────────────
     The DECOY runs first: the same cohort, unnarrowed, must escalate — otherwise a leg below would
     pass on a shape rule 5 never reached. */
  const PRB = (fam) => `${fam} · string/parsing: 61 inputs, 27 distinct baseline answers; 11/11 same-function controls separated. tools/probe-equivalence.mjs --file ppgdex-dsp.js`;
  const Cp = (lines, cands, fams) => {
    const c = C(lines, cands);
    c.entries.forEach((e, i) => {
      e.probe = PRB(fams[i] ?? fams[0]);
    });
    return c;
  };
  const RANGE = (a, b) => () => ({ start: a, end: b });
  /* The real shape this rule was written for: MORE surviving sites than entries, plus a killed one,
     which is exactly `ppgdex-dsp.js` on 2026-10-28 — 2 entries over 5 surviving sites and `pearson`
     killed. Two survivors sit inside the probed family and two do not. */
  const cohB = Cp([9, 11], [40, 50, 90, 95], ['parsePPG', 'parsePPG']);
  const outB = OUT({ 40: 'survived', 50: 'survived', 90: 'survived', 95: 'killed' });
  ok('rule 5-bis DECOY · the cohort escalates before any narrowing, so the legs below are not testing rule 2', settleDecide(cohB, outB).rule === 5);
  ok('the probe field yields the family the engine wrote into it', probeFamilyFn(cohB.entries[0]).fn === 'parsePPG', JSON.stringify(probeFamilyFn(cohB.entries[0])));
  ok(
    'a `why`-style prose field is NOT read as a family — only the engine-written shape is',
    probeFamilyFn({ probe: 'In parsePPG. Original and mutant produced byte-identical output.' }).ok === false && probeFamilyFn({}).ok === false
  );
  const narB = narrowToProbedFamily(cohB, 'ignored', RANGE(30, 60));
  ok(
    'narrowing keeps only the candidates inside the probed family’s range, and can only SHRINK the cohort',
    narB.ok && narB.candidates.map((m) => m.line).join(',') === '40,50' && narB.candidates.every((m) => cohB.candidates.includes(m)),
    JSON.stringify(narB)
  );
  const dB = settleDecide({ ...cohB, candidates: narB.candidates }, outB);
  ok(
    'rule 5-bis · inside the family the escalated cohort becomes a BIJECTION, and no address lands on the killed site',
    dB.rule === 2 && dB.decisions.every((x) => x.action === 'address' && outB(x.mutant) === 'survived') && dB.decisions.map((x) => x.mutant.line).join(',') === '40,50',
    JSON.stringify(dB.decisions.map((x) => x.mutant.line))
  );
  ok(
    'two families in one cohort REFUSE — an entry is interchangeable only inside the family that judged it',
    narrowToProbedFamily(Cp([9, 11], [40, 50, 90, 95], ['parsePPG', 'lombScargle']), 'x', RANGE(30, 60)).ok === false
  );
  ok('a family whose declaration no longer resolves REFUSES rather than guessing a range', narrowToProbedFamily(cohB, 'x', () => null).ok === false);
  ok('a range holding no candidate REFUSES, so the probed family never excuses a site it does not contain', narrowToProbedFamily(cohB, 'x', RANGE(1000, 2000)).ok === false);
  ok('a range holding EVERY candidate declines, because narrowing nothing is not evidence', narrowToProbedFamily(cohB, 'x', RANGE(1, 9999)).ok === false);
  /* The default `rangeOf` is the probe engine’s own `functionRange`, wired here over a real source
     so the leg fails if that import ever stops resolving. */
  const srcFam = ['function other(a) {', '  return a;', '}', 'function parsePPG(t) {', '  let n = 0;', '  for (let i = 0; i < n; i++) {}', '  return n;', '}'].join('\n');
  const narReal = narrowToProbedFamily(Cp([9], [2, 6], ['parsePPG']), srcFam);
  ok(
    'the default range resolver is the probe engine’s own, so the narrowing reproduces its selection',
    narReal.ok && narReal.candidates.map((m) => m.line).join(',') === '6' && narReal.range.start === 4,
    JSON.stringify(narReal)
  );

  /* The load-bearing property across all five: a write only ever moves an address onto a site this
     run watched survive. Asserted over every rule at once rather than per leg. */
  for (const [nm, d] of [
    ['rule 1', d1],
    ['rule 2', d2],
    ['rule 3', d3],
    ['rule 4', d4],
    ['rule 5', d5],
    ['rule 0', d0]
  ]) {
    const bad = d.decisions.filter((x) => x.action === 'address' && !d.survivors.some((s) => s.line === x.mutant.line));
    ok(
      `${nm} addresses only a site that SURVIVED`,
      bad.length === 0,
      bad.length ? JSON.stringify(bad.map((x) => x.mutant.line)) : `${d.decisions.filter((x) => x.action === 'address').length} address(es)`
    );
  }

  const genS = [
    { line: 40, fn: 'f', op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
    { line: 50, fn: 'f', op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
    { line: 60, fn: 'g', op: 'num → 0', before: 'x = 5;', after: 'x = 0;' },
    { line: 70, fn: 'h', op: 'num → 0', before: 'x = 5;', after: 'x = 0;' }
  ];
  const cohS = settleCohorts(
    [
      { line: 9, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
      { line: 11, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' },
      { line: 12, op: 'num → 0', before: 'x = 5;', after: 'x = 0;' },
      { line: 40, op: 'cmp > → >=', before: 'if (a > b) {', after: 'if (a >= b) {' }
    ],
    genS
  );
  ok(
    'a cohort is the entries sharing one (op, before, after), and only where a qualifier could not place them',
    cohS.length === 1 && cohS[0].entries.length === 2 && cohS[0].candidates.length === 2,
    JSON.stringify(cohS.map((c) => ({ n: c.entries.length, cands: c.candidates.map((m) => m.line), would: c.would })))
  );
  ok(
    '…so an entry a NAME would place is left to the qualifier, and an already-anchored one is untouched',
    !cohS.some((c) => c.entries.some((e) => e.line === 12 || e.line === 40)),
    JSON.stringify(cohS[0].entries.map((e) => e.line))
  );

  const TS = (o) => ({ entries: 0, cohorts: 0, files: 0, addressed: 0, deleted: 0, escalated: 0, unprobed: 0, written: false, byRule: {}, ...o });
  const vsAll = makeSettleVerdict(TS({ entries: 19, cohorts: 12, files: 4, addressed: 13, deleted: 4, escalated: 2 }));
  ok(
    'a settle run that escalates is SHORTFALL, and the object validates whole',
    vsAll.status === 'SHORTFALL' && vsAll.result.escalated === 2 && Verdict.validate(vsAll).ok,
    vsAll.status + ' · ' + String(vsAll.reason)
  );
  const vsDone = makeSettleVerdict(TS({ entries: 19, cohorts: 12, files: 4, addressed: 15, deleted: 4 }));
  ok('…and one that leaves nothing unsettled passes with no reason', vsDone.status === 'PASS' && vsDone.reason === null && Verdict.validate(vsDone).ok, vsDone.status);
  const vsVoid = makeSettleVerdict(TS({ entries: 5, cohorts: 2, files: 1, unprobed: 5 }));
  ok(
    'a voided probe is unsettled, not settled — it examined nothing and says so',
    vsVoid.status === 'SHORTFALL' && /never probed/.test(vsVoid.reason) && Verdict.validate(vsVoid).ok,
    String(vsVoid.reason)
  );
  const vsNil = makeSettleVerdict(TS({}));
  ok(
    'a run with no eligible entry is NOT_RUN with a reason, never a pass over nothing',
    vsNil.status === 'NOT_RUN' && vsNil.result === null && typeof vsNil.reason === 'string' && Verdict.validate(vsNil).ok,
    vsNil.status
  );
  /* THE QUALIFIER REFUSAL. A re-address and a qualifier are two decisions, and the second one is
     available far less often than the first: the generator's own identity histogram decides it. */
  const H = (pairs) => new Map(pairs.map(([fn, op, before, after, n]) => [idKey({ fn, op, before, after }), n]));
  const mSolo = { fn: 'alpha', op: 'cmp < → <=', before: 'if (a < b) {', after: 'if (a <= b) {', line: 10 };
  const mTwin = { fn: 'beta', op: 'cmp < → <=', before: 'for (i = 0; i < n; i++) {', after: 'for (i = 0; i <= n; i++) {', line: 20 };
  const hist = H([
    ['alpha', mSolo.op, mSolo.before, mSolo.after, 1],
    ['beta', mTwin.op, mTwin.before, mTwin.after, 2]
  ]);
  const qSolo = settleQualifier(mSolo, hist);
  ok('a re-addressed site whose identity names ONE generated mutant takes the qualifier', qSolo.ok && qSolo.verdict === 'written' && qSolo.n === 1 && qSolo.reason === null, JSON.stringify(qSolo));
  const qTwin = settleQualifier(mTwin, hist);
  ok(
    'a site whose identity names TWO is refused and stays line-keyed — one excuse may not stand for two mutants',
    !qTwin.ok && qTwin.verdict === 'refused-not-unique' && qTwin.n === 2 && /2 generated mutants share/.test(qTwin.reason),
    JSON.stringify(qTwin)
  );
  const qTop = settleQualifier({ fn: null, op: mSolo.op, before: mSolo.before, after: mSolo.after, line: 3 }, hist);
  ok('a top-level site is refused for a different, named reason, never silently', !qTop.ok && qTop.verdict === 'refused-top-level' && /top level/.test(qTop.reason), JSON.stringify(qTop));
  const qAbsent = settleQualifier(mSolo, new Map());
  ok('an identity the generator does not carry counts 0, so the qualifier is refused, not written over an absence', !qAbsent.ok && qAbsent.n === 0, JSON.stringify(qAbsent));
  ok(
    'the refusal is the SAME condition qualifyPlan applies, so the two passes cannot diverge',
    (() => {
      const gen = [mSolo, mTwin, { ...mTwin, line: 30 }];
      const cnt = new Map();
      for (const m of gen) cnt.set(idKey(m), (cnt.get(idKey(m)) || 0) + 1);
      const qp = qualifyPlan(
        [
          { line: 10, op: mSolo.op, before: mSolo.before, after: mSolo.after },
          { line: 20, op: mTwin.op, before: mTwin.before, after: mTwin.after }
        ],
        gen
      );
      return qp.write.length === 1 && qp.collides.length === 1 && settleQualifier(mSolo, cnt).ok && !settleQualifier(mTwin, cnt).ok;
    })()
  );
  const vsLK = makeSettleVerdict(TS({ entries: 19, cohorts: 12, files: 4, addressed: 15, deleted: 4, lineKeyed: 11 }));
  ok('the verdict reports the refusals it made, so a line-keyed address is visible and not silent', vsLK.result.lineKeyed === 11 && Verdict.validate(vsLK).ok, JSON.stringify(vsLK.result));
  ok('a settle tally that never refused reports 0 rather than omitting the field', makeSettleVerdict(TS({ entries: 3, cohorts: 1, files: 1, addressed: 3 })).result.lineKeyed === 0);

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
  const PRUNE = has('--prune');
  const SETTLE = has('--settle');
  if (QUALIFY && PROBE) {
    console.error('--qualify --probe REFUSED: a qualifier write moves no address, so a probe has nothing to renew. Run them as separate passes.');
    process.exit(2);
  }
  if (PRUNE && (PROBE || QUALIFY)) {
    console.error('--prune REFUSED alongside --probe/--qualify: a prune deletes entries, the others move or annotate them. Run them as separate passes.');
    process.exit(2);
  }
  if (SETTLE && (PROBE || QUALIFY || PRUNE)) {
    console.error('--settle REFUSED alongside --probe/--qualify/--prune: it probes on its own account and decides per cohort. Run them as separate passes.');
    process.exit(2);
  }
  if (WRITE && !PROBE && !QUALIFY && !PRUNE && !SETTLE) {
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

  if (PRUNE) {
    /* THE PRUNE PASS. It DELETES entries, and it is the one write in this tool that needs no probe,
       because there is nothing to probe: `classifySurvivors` matches an entry against the mutants a
       run GENERATED, and no generator emits text the file does not hold. A plant-and-watch control —
       the fleet rule of 2026-10-05 for a REFUTED verdict — cannot be built over a mutation that
       cannot be produced. A probe here would examine nothing and report a pass about it (§4b).

       Both of the owner's conditions must hold (ruling 2026-10-28), because they ask different
       questions. The loose key asks what the GENERATOR emits at this (op, before); the text asks
       what the FILE still holds. An entry with no candidate whose text IS still present is the
       middle class: the operator stopped firing there, the code it judged did not move, and the
       mutation may return while the excuse would already be gone. That class is REPORTED and KEPT. */
    const PRUNE_LIST = opt('--prune-list', '');
    const tp = { entries: 0, files: 0, live: 0, prune: 0, textStillThere: 0, pruned: 0 };
    const rows = [];
    for (const file of files) {
      const generated = enumerate(file);
      if (!generated) continue;
      let src = '';
      try {
        src = readFileSync(join(ROOT, file), 'utf8');
      } catch (_) {
        /* No source, no text proof. Reporting these as prunable would delete an entry on one leg. */
        console.error(`  \u2717 ${file}: source unreadable — skipped, so none of its entries are judged`);
        continue;
      }
      tp.files++;
      tp.entries += doc[file].length;
      const pl = prunePlan(doc[file], generated, src);
      tp.live += pl.live;
      tp.prune += pl.prune.length;
      tp.textStillThere += pl.textStillThere.length;
      console.log(
        `\u25b8 ${file}  ${doc[file].length} entr(ies) \u00b7 ${pl.live} match a generated mutant \u00b7 ${pl.prune.length} prunable on BOTH proofs \u00b7 ${pl.textStillThere.length} unreachable but their text is still here`
      );
      for (const r of pl.prune) {
        console.log(
          `    \u2717 PRUNE L${r.entry.line} [${r.entry.op}] \u2014 0 generated mutant(s) at this (op, before) AND its text is absent; it excused ${r.entry.class || 'an unrecorded class'}: ${clip(r.entry.why)}`
        );
        rows.push({
          file,
          line: r.entry.line,
          op: r.entry.op,
          before: r.entry.before,
          after: r.entry.after,
          class: r.entry.class ?? null,
          why: r.entry.why ?? null,
          looseCandidates: 0,
          textExact: [],
          textInside: [],
          rawSubstring: false,
          decision: 'prune'
        });
      }
      for (const r of pl.textStillThere) {
        console.log(
          `    ~ KEPT L${r.entry.line} [${r.entry.op}] \u2014 no generated mutant, but its text is still in the file (exact ${JSON.stringify(r.textExact)}, inside ${JSON.stringify(r.textInside)}); the operator stopped firing, the code did not move`
        );
        rows.push({
          file,
          line: r.entry.line,
          op: r.entry.op,
          before: r.entry.before,
          after: r.entry.after,
          class: r.entry.class ?? null,
          why: r.entry.why ?? null,
          looseCandidates: 0,
          textExact: r.textExact,
          textInside: r.textInside,
          rawSubstring: r.raw,
          decision: 'kept-text-present'
        });
      }
      if (WRITE && pl.prune.length) {
        const drop = new Set(pl.prune.map((r) => r.entry));
        doc[file] = doc[file].filter((e) => !drop.has(e));
        tp.pruned += pl.prune.length;
      }
    }
    if (PRUNE_LIST) {
      writeFileSync(PRUNE_LIST, JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), commit: headCommit(), rows }, null, 1) + '\n');
      console.log(`\n  evidence for ${rows.length} entr(ies) written to ${PRUNE_LIST}`);
    }
    if (WRITE) {
      writeFileSync(LEDGER, JSON.stringify(doc, null, LEDGER_INDENT) + '\n');
      console.log(
        `\n\u2713 pruned ${tp.pruned} entr(ies) that match no generated mutant and whose source text is absent. ${tp.textStillThere} unreachable entr(ies) were KEPT, because their text is still in the file.`
      );
    } else {
      console.log(
        `\n${tp.prune} of ${tp.entries} entr(ies) are prunable on both proofs; ${tp.textStillThere} are unreachable with their text still present and are kept. Re-run with \`--prune --write\`.`
      );
    }
    const vp = makePruneVerdict(tp);
    const cp = Verdict.validate(vp);
    if (!cp.ok) {
      console.error('verdict invalid: ' + (cp.errors || []).join('; '));
      process.exit(1);
    }
    console.log(JSON.stringify(vp));
    process.exit(0);
  }

  if (QUALIFY) {
    /* THE QUALIFIER PASS. It writes `fn` on entries that are already exactly anchored and whose
       (fn, op, before, after) identity is unique in the file, and it moves no address — so it needs
       no probe, where a re-anchor does. The control for that claim is in the code below, not in this
       comment: every line is snapshotted before the write and compared after. */
    const tq = {
      write: 0,
      collides: 0,
      topLevel: 0,
      legacy: 0,
      drifted: 0,
      already: 0,
      entries: 0,
      files: 0,
      wouldAnyFn: 0,
      wouldSomeFn: 0,
      wouldNever: 0,
      wouldGone: 0,
      ambiguousWritten: 0,
      alreadyGone: 0
    };
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
      /* `ambiguousWritten` is the quantity `makeQualifyVerdict` FAILS on, and it used to be this
         object's initialiser read back out — a constant, which is the §4b family the verdict's own
         comment was written about. It is now MEASURED: the already-qualified entries whose identity
         no longer names exactly one generated mutant. */
      tq.ambiguousWritten += q.alreadyWide.length;
      tq.alreadyGone += q.alreadyGone.length;
      for (const d of q.drifted) {
        if (d.would === 'anyFn') tq.wouldAnyFn++;
        else if (d.would === 'someFn') tq.wouldSomeFn++;
        else if (d.would === 'neverPlaced') tq.wouldNever++;
        else tq.wouldGone++;
      }
      console.log(
        `▸ ${file}  ${doc[file].length} entr(ies) · ${q.write.length} qualifiable · ${q.collides.length} identity-collides · ${q.topLevel.length} top-level · ${q.legacy.length} no-after · ${q.drifted.length} drifted · ${q.already.length} already (re-decided) · ${q.alreadyWide.length} wide · ${q.alreadyGone.length} dead`
      );
      for (const c of q.collides) console.log(`    ⚠ COLLIDES L${c.line} [${c.op}] — its (fn, op, before, after) names more than one mutant, so a qualifier would widen the excuse`);
      /* An aggregate cannot be acted on here either: a wide qualifier is a live false excuse and a
         dead one is a silently unreachable entry, so each is named with the count that decided it. */
      for (const w of q.alreadyWide)
        console.log(`    ✗ WIDE QUALIFIER L${w.entry.line} [${w.entry.op}] fn=${w.entry.fn} — its identity names ${w.n} generated mutants, so the excuse is wider than the mutant it was judged over`);
      for (const g of q.alreadyGone)
        console.log(`    ⊘ DEAD QUALIFIER L${g.entry.line} [${g.entry.op}] fn=${g.entry.fn} — its identity names no generated mutant, so the entry keeps its recorded line and orphans`);
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
        `  control · the prose rescue: ${ag.named} of ${ag.entries} entr(ies) open "In <function>", and over the ${ag.checkable} with a machine-read qualifier to check against it disagrees ${ag.disagree.length} time(s) — pinned at 0 since 2026-10-28, which is maintained agreement and not an address. The ${ag.entries - ag.checkable} entr(ies) this control cannot check are the ones a prose rescue would have to serve.`
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

  if (SETTLE) {
    /* THE SETTLE PASS. One probe per file over the union of its cohorts' candidate sites, then
       `settleDecide` per cohort. It writes only behind that probe, which is why it is exempt from
       the `--write` refusal above: the refusal exists to stop an address moving onto a mutant
       nobody re-tested, and here every address a write takes came back `survived` in this run. */
    const ts = { entries: 0, cohorts: 0, files: 0, addressed: 0, deleted: 0, escalated: 0, unprobed: 0, lineKeyed: 0, written: false, byRule: {} };
    const deletions = new Map();
    const settleList = opt('--settle-list', '');
    const rows = [];
    for (const file of files) {
      const generated = enumerate(file);
      if (!generated) continue;
      const cohorts = settleCohorts(doc[file], generated);
      if (!cohorts.length) continue;
      /* Rule 5-bis reads function RANGES out of the live source. An unreadable file leaves `src`
         empty, `functionRange` then resolves nothing, and every narrowing declines — which is the
         escalation rule 5 would have reached anyway. */
      let src = '';
      try {
        src = readFileSync(join(ROOT, file), 'utf8');
      } catch (_) {
        console.log(`    ⚠ ${file}: source unreadable, so no cohort can be narrowed to its probed family`);
      }
      /* THE QUALIFIER IS A SECOND DECISION, AND IT IS NOT THE ADDRESS. A re-address moves `line`,
         which is measured: the probe watched that very site survive. Stamping `fn` as well converts
         the identity to the LINE-FREE `(fn, op, before, after)`, so it is safe only under
         `qualifyPlan`'s own uniqueness condition — exactly one generated mutant carries that
         identity. Two surviving sites of one cohort inside ONE function fail it: each entry is a
         distinct site by line, and qualifying both collapses them to one identity, which is one
         excuse standing for two mutants (capture-host
         `tests/test_equivalence_ledger.py::test_a_FUNCTION_QUALIFIER_is_unique_within_its_module`,
         which measured 3 such pairs in this tool's first settle run). The refusal keeps the
         measured line and drops the qualifier, so the entry stays line-keyed and exactly anchored. */
      const idCnt = new Map();
      for (const m of generated) idCnt.set(idKey(m), (idCnt.get(idKey(m)) || 0) + 1);
      ts.files++;
      const nEntries = cohorts.reduce((a, c) => a + c.entries.length, 0);
      const targets = [];
      for (const c of cohorts) for (const m of c.candidates) targets.push({ entry: c.entries[0], mutant: m });
      console.log(`▸ ${file}  ${cohorts.length} cohort(s) · ${nEntries} entr(ies) · ${targets.length} candidate site(s) to probe`);
      const t0 = Date.now();
      const probe = runProbe(file, targets);
      if (!probe.ok) {
        ts.entries += nEntries;
        ts.cohorts += cohorts.length;
        ts.unprobed += nEntries;
        console.log(`    ⊘ NO PROBE for ${nEntries} entr(ies) — ${probe.reason}`);
        continue;
      }
      const outcomeOf = (m) => {
        const k = key4(m);
        return probe.killed.has(k) ? 'killed' : probe.survived.has(k) ? 'survived' : 'absent';
      };
      const probeNote = `mutate.mjs --only over the groups tagged ${probe.groups} (${probe.groupCount} group(s))`;
      for (const c of cohorts) {
        let d = settleDecide(c, outcomeOf);
        if (d.rule === 5) {
          const nar = narrowToProbedFamily(c, src);
          if (!nar.ok) console.log(`      rule 5-bis declined — ${nar.reason}`);
          else {
            const d2 = settleDecide({ ...c, candidates: nar.candidates }, outcomeOf);
            /* ONLY AN ADDRESSING OUTCOME IS TAKEN. Rules 2 and 4 move a line onto a site this run
               watched survive; rules 1 and 3 would DELETE an entry on the strength of a narrowing,
               and a narrowing is evidence about which site was judged, not about whether the excuse
               is refuted. A re-decision that escalates again changes nothing, so rule 5 stands. */
            if (d2.rule === 2 || d2.rule === 4) {
              const note = `, and the candidates were narrowed to the probed family \`${nar.fn}\` at L${nar.range.start}–${nar.range.end} — the same source range the probe engine selected the judged mutant by`;
              for (const dec of d2.decisions) dec.reason += note;
              d2.rule = '5b';
              d = d2;
              console.log(`      rule 5-bis — narrowed to \`${nar.fn}\` L${nar.range.start}–${nar.range.end}: ${nar.candidates.length} of ${c.candidates.length} candidate site(s)`);
            } else console.log(`      rule 5-bis declined — inside \`${nar.fn}\` the cohort still decides by rule ${d2.rule}`);
          }
        }
        ts.cohorts++;
        ts.entries += c.entries.length;
        ts.byRule['rule' + d.rule] = (ts.byRule['rule' + d.rule] || 0) + c.entries.length;
        const sites = c.candidates.map((m) => `${m.fn == null ? 'top' : m.fn}@${m.line}=${outcomeOf(m)}`).join('  ');
        console.log(`  · ${c.would} cohort [${norm(c.entries[0].op)}] n=${c.entries.length} L${c.entries.map((e) => e.line).join(',L')} → rule ${d.rule}`);
        console.log(`      ${sites}`);
        for (const dec of d.decisions) {
          const base = {
            file,
            line: dec.entry.line,
            op: dec.entry.op,
            before: dec.entry.before,
            after: dec.entry.after,
            class: dec.entry.class ?? null,
            why: dec.entry.why ?? null,
            would: c.would,
            rule: d.rule,
            action: dec.action,
            reason: dec.reason,
            sites: c.candidates.map((m) => ({ fn: m.fn ?? null, line: m.line, outcome: outcomeOf(m) }))
          };
          if (dec.action === 'address') {
            ts.addressed++;
            /* ⚠️ THE QUALIFIER IS COMPUTED BEFORE IT IS REPORTED. The evidence row carries `q`, so
               building the row above the `const` made the FIRST address decision of every settle run
               throw `ReferenceError: Cannot access 'q' before initialization` — a guaranteed TDZ that
               no gate here could see: `--selftest` never enters this branch, and `biome.json` sets
               `recommended: false` with an allow-list that omits `noInvalidUseBeforeDeclaration`. */
            const q = settleQualifier(dec.mutant, idCnt);
            rows.push({ ...base, toLine: dec.mutant.line, toFn: dec.mutant.fn ?? null, qualifier: q.verdict, identityMutants: q.n });
            console.log(`      → ADDRESS L${dec.entry.line} becomes L${dec.mutant.line} in ${dec.mutant.fn == null ? 'top level' : dec.mutant.fn} — ${dec.reason}`);
            if (!q.ok) {
              ts.lineKeyed++;
              console.log(`        · stays line-keyed — ${q.reason}`);
            }
            if (WRITE) {
              dec.entry.reanchored = {
                at: TODAY,
                from: dec.entry.line,
                commit: COMMIT,
                outcome: 'survived',
                probe: probeNote,
                rule: `settle rule ${d.rule}` + (q.ok ? '' : ' (line-keyed: the qualifier would not be unique)')
              };
              dec.entry.line = dec.mutant.line;
              if (q.ok) dec.entry.fn = dec.mutant.fn;
              else delete dec.entry.fn;
            }
          } else if (dec.action === 'delete') {
            ts.deleted++;
            rows.push({ ...base, toLine: null, toFn: null });
            console.log(`      ✗ DELETE L${dec.entry.line} — ${dec.reason}`);
            if (WRITE) {
              if (!deletions.has(file)) deletions.set(file, new Set());
              deletions.get(file).add(dec.entry);
            }
          } else {
            ts.escalated++;
            rows.push({ ...base, toLine: null, toFn: null });
            console.log(`      ↑ ESCALATE L${dec.entry.line} — ${dec.reason}`);
          }
        }
      }
      console.log(`    ✓ probed ${targets.length} site(s) in ${Math.round((Date.now() - t0) / 1000)}s · ${probe.groupCount} group(s) tagged ${probe.groups}`);
    }
    if (settleList) {
      writeFileSync(settleList, JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), commit: COMMIT, rows }, null, 1) + '\n');
      console.log(`\n  evidence for ${rows.length} entr(ies) written to ${settleList}`);
    }
    if (WRITE && (ts.addressed || ts.deleted)) {
      for (const [file, drop] of deletions) doc[file] = doc[file].filter((e) => !drop.has(e));
      writeFileSync(LEDGER, JSON.stringify(doc, null, LEDGER_INDENT) + '\n');
      ts.written = true;
      console.log(
        `\n✓ settled ${ts.addressed + ts.deleted} entr(ies): ${ts.addressed} addressed to a site this run watched SURVIVE, ${ts.deleted} deleted as refuted. ${ts.escalated} escalated — left exactly as they were.`
      );
    } else {
      console.log(`\n${ts.addressed} entr(ies) would be addressed, ${ts.deleted} deleted and ${ts.escalated} escalated. Re-run with \`--settle --write\`.`);
    }
    const vs2 = makeSettleVerdict(ts);
    const cs2 = Verdict.validate(vs2);
    if (!cs2.ok) {
      console.error('verdict invalid: ' + (cs2.errors || []).join('; '));
      process.exit(1);
    }
    console.log(JSON.stringify(vs2));
    process.exit(0);
  }

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
