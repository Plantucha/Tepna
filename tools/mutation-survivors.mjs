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
 *   node tools/mutation-survivors.mjs orphans [--lane py]
 *   node tools/mutation-survivors.mjs ratchet --expect N
 *   node tools/mutation-survivors.mjs --selftest
 *
 * 🔴 WRITING THE LEDGER IS A LOCAL/SESSION ACTION, NEVER A CI ONE. A CI job that commits this file
 * needs `contents: write`; `mutation.yml` sets `contents: read`, and changing that is an owner
 * workflow edit held out of scope by the brief. CI only READS the committed ledger (`ratchet`).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { makeVerdict } from './verdict-emit.mjs';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { functionSpan, recordedLineState, splitKey, RETIRABLE_STATES } from './mutation-key-core.mjs';

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
export function survivorKey({ lane, module: mod, fn, function: fname, key, occurrence }) {
  // BOTH SPELLINGS, deliberately. A ledger row stores `function`; the ingest path and the tests
  // build `fn`. Reading only one of them is not a style slip — it silently produces a key with
  // `undefined` in it, which matches nothing, so EVERY committed entry reads as orphaned and the
  // ledger quietly empties itself. The selftest below caught exactly that.
  const name = fn ?? fname;
  const base = [lane, mod, name, String(key || '').trim()].join('\u0000');
  // THE OCCURRENCE ORDINAL, and why zero adds NOTHING to the string. Content alone could not
  // separate two identical statements in one function — measured on loss_audit.py: 8 of 27 functions
  // generate a duplicate key, 86 of 2141 mutants, and the second of each pair was folded into the
  // first and reported "already open", i.e. as the same finding rather than a lost one.
  // Appending only when n > 0 means every entry written before this existed keys IDENTICALLY, so the
  // ledger migrates without re-identifying a single row.
  const n = Number(occurrence) || 0;
  return n > 0 ? `${base}\u0000#${n}` : base;
}

/** The human-readable form of a key, for `list` and for `close <key>`. */
export function keyLabel(k) {
  const [lane, mod, fn, key, ord] = String(k).split('\u0000');
  // The ordinal is SHOWN when there is one. Twins print an identical line otherwise, and a list an
  // operator cannot tell apart is a list they have to close by guesswork — which is the failure this
  // whole change is about, moved from the key to the screen.
  return `${lane}:${mod}::${fn}  ${key}${ord ? `  [occurrence ${ord.slice(1)}]` : ''}`;
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
      file_line: s.file_line ?? positionOfSurvivor(s),
      pr,
      run_id: runId,
      merge_sha: mergeSha,
      reported,
      state: 'open'
    });
  }
  // ONE mutant listed twice is one finding; two mutants with identical text are two. De-duplicate
  // by id FIRST, then number what is left — the other order would give a re-listed mutant an ordinal.
  const { kept, dropped } = dedupeByMutant(entries);
  // Numbered against THIS run's own survivors: twins are only twins within one report.
  return { entries: withOccurrences(kept), lowerBound, generated, decided, status, duplicates: dropped };
}

/**
 * The mutated line's position WITHIN ITS FUNCTION, read from the survivor's own unified diff.
 *
 * mutmut discards it: `position.start.line` is computed in `mutation/file_mutation.py` only to
 * filter on pragmas and coverage, `mutmut-stats.json` carries no line, and the mutant NUMBER is not
 * a source-ordered substitute — measured, monotonic in 23 of 27 functions, not 27. But the gate's
 * artifact already diffs each mutant against its original, so the hunk header carries it.
 */
export function positionOfSurvivor(s) {
  const m = /^@@ -(\d+)/m.exec(String((s && s.diff) || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Drop survivors that are the SAME MUTANT listed twice, and say how many were dropped.
 *
 * 🔴 THIS EXISTS BECAUSE THE ORDINAL REMOVED A MASK. The gate scopes survivors to one glob
 * (`mutate_diff.py`: `in_glob_scope(name, g)`, the fix in #3167 after one run emitted 26 entries for
 * 12 distinct mutants), so a duplicate should not reach here. But before the occurrence ordinal, a
 * duplicate that DID reach here collapsed harmlessly onto the identical key; now it would be
 * numbered 0 and 1 and become TWO ledger entries for ONE mutant — de-duplication at one layer and
 * twin-folding at the other are the same collision, and fixing the second unmasked the first.
 *
 * The discriminator is the mutant id: one mutant listed twice carries the SAME id, whereas genuine
 * twins are different mutants (`…__mutmut_55` and `…__mutmut_67`) that merely mutate identical text.
 * Entries with no id are left alone rather than merged — absent is not equal (§∅).
 *
 * Counted, never silently dropped, which is the rule the gate loop this guards states about itself:
 * a filter that does not publish what it removed is the shape it exists to refuse.
 */
export function dedupeByMutant(entries) {
  const seen = new Set();
  const kept = [];
  let dropped = 0;
  for (const e of entries) {
    if (!e.mutant) {
      kept.push(e);
      continue;
    }
    if (seen.has(e.mutant)) {
      dropped++;
      continue;
    }
    seen.add(e.mutant);
    kept.push(e);
  }
  return { kept, dropped };
}

/**
 * Number each survivor among its OWN twins — same lane, module, function and mutation text — in
 * position order, and leave everything else at 0.
 *
 * 🔴 THE ORDINAL, NOT THE RAW LINE, GOES IN THE KEY, and the difference is the whole point of
 * keying on content in the first place. A line index shifts whenever anything above it inside the
 * function changes, so putting it in the key would orphan every entry on the next unrelated edit —
 * re-creating, from the other side, the instability that made `__mutmut_N` unusable as a name. The
 * ordinal moves only when a TWIN is added or removed, which is the one event that genuinely changes
 * which occurrence is which. The line is still recorded, as `file_line`, because it is what a reader
 * needs to find the thing; it is a breadcrumb, never the identity.
 *
 * A survivor with no readable position sorts last and keeps a deterministic ordinal, because a
 * missing position must not silently merge it into a twin (§∅).
 */
export function withOccurrences(entries) {
  const groups = new Map();
  for (const e of entries) {
    const g = [e.lane, e.module, e.fn ?? e.function, String(e.key || '').trim()].join('\u0000');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const out = [];
  for (const g of groups.values()) {
    const ranked = g.map((e, i) => ({ e, i, pos: e.file_line == null ? Number.POSITIVE_INFINITY : Number(e.file_line) })).sort((a, b) => a.pos - b.pos || a.i - b.i);
    ranked.forEach((r, n) => out.push({ ...r.e, occurrence: n }));
  }
  return out;
}

/**
 * The entries a `close` label selects: the entry's own `mutant` id when the label names one exactly,
 * otherwise a substring match over the printed label.
 *
 * 🔴 TEXT ALONE CANNOT ADDRESS EVERY ENTRY, which is why the id comes first. Two survivors that
 * share a one-line mutation — `- continue | + break` is the common one — print the same tail, so a
 * text label either matches both (refused) or forces the operator to paste the whole function-
 * qualified line. Measured on capture-host/loss_audit.py: 8 of its 27 functions generate a DUPLICATE
 * mutation text, 28 distinct colliding texts over 86 of 2141 mutants. The `mutant` id is already on
 * every entry and is unique within a run, so it is the handle.
 *
 * The id is deliberately NOT the stored identity — mutmut renumbers on every generation, which is
 * why `survivorKey` is content-based. It is a HANDLE for addressing a row today, not a name for it.
 */
export function selectForClose(entries, label) {
  const want = String(label || '').trim();
  if (!want) return { hits: [], reason: 'an empty label selects nothing' };
  const byId = entries.filter((e) => e.mutant === want);
  if (byId.length === 1) return { hits: byId, by: 'mutant id' };
  if (byId.length > 1) {
    return { hits: byId, reason: `the mutant id ${want} is on ${byId.length} entries, which should be impossible — the ledger is inconsistent` };
  }
  const byText = entries.filter((e) => keyLabel(survivorKey(e)).includes(want));
  if (byText.length === 1) return { hits: byText, by: 'label text' };
  if (byText.length === 0) return { hits: [], reason: `no entry matches ${JSON.stringify(want)}` };
  // NAME THEM, AND SAY BOTH WAYS OUT. "matched 2 entries" told the operator nothing about WHICH
  // two, and — the actual cause of the only report of this — never mentioned that the label may be
  // QUALIFIED: `keyLabel` already carries `lane:module::function  key`, so passing the bare key tail
  // is what made two entries look unaddressable when they were not. Printing each candidate's full
  // label shows the qualification directly, and the mutant id beside it is the shorter handle.
  const names = byText.map((e) => `    ${e.mutant || '(no mutant id)'}  ${keyLabel(survivorKey(e))}`).join('\n');
  return {
    hits: byText,
    reason: `${JSON.stringify(want)} matches ${byText.length} entries. Pass a QUALIFIED label (a full line below) or the mutant id:\n${names}`
  };
}

/**
 * The commit a closure actually landed on, and how we know.
 *
 * 🔴 THE SESSION HEAD ALONE IS A TRAP IN THIS REPO, and shipping it would have killed the signal it
 * is meant to sharpen. Closures are made on a branch; the branch is SQUASH-merged, so the recorded
 * branch sha is never an ancestor of any later `main`. Every entry closed that way would read
 * "stale" forever and no regression would ever be reported again — silently, and worse than the
 * false alarms this whole change exists to remove. The PR number survives the squash (`… (#N)` is
 * the merge subject), so it is resolved FIRST and the branch sha is only the fallback before that
 * PR has landed.
 */
export function resolveClosingCommit(entry, mergeShaOfPr) {
  if (entry.closed_pr) {
    const merged = mergeShaOfPr(entry.closed_pr);
    if (merged) return { commit: merged, source: `merge of #${entry.closed_pr}` };
  }
  if (entry.closed_commit) return { commit: entry.closed_commit, source: entry.closed_commit_source || 'recorded at close' };
  return { commit: null, source: null };
}

/**
 * What a re-appearing CLOSED mutant means, given the commit the verdict was produced at.
 *
 * `regression` — the run's code CONTAINS the closure and the mutant survived anyway: the kill
 *                stopped working, which is the fact worth interrupting someone for.
 * `stale`      — the run predates the closure, so it says nothing about whether the closure holds.
 *                NOT_APPLICABLE: examined, and the rule does not bind (§🧾). This is the whole
 *                residue row — the old code reported these as regressions because it compared
 *                CONTENT and never recency.
 * `unknown`    — the closing commit cannot be resolved (the closing PR has not landed and no branch
 *                sha was recorded). §∅: a question we cannot answer is not answered either way, and
 *                it is certainly not a regression.
 *
 * ⚠️ A run on a branch cut from an OLD main also reads `stale`, and that is correct rather than a
 * limitation: its code predates the closure, so a survivor there is evidence about the old code.
 */
export function classifyReingest(entry, verdictCommit, { closingCommit, source, isAncestor }) {
  if (!closingCommit) {
    return { kind: 'unknown', reason: `no closing commit recorded for an entry closed as ${entry.state} — cannot tell a stale run from a real regression, so neither is claimed` };
  }
  if (isAncestor(closingCommit, verdictCommit)) {
    return { kind: 'regression', reason: `was ${entry.state} and survives again at ${verdictCommit.slice(0, 8)}, which contains ${source}` };
  }
  return {
    kind: 'stale',
    reason: `stale artifact: verdict from ${verdictCommit.slice(0, 8)} predates ${source} (${String(closingCommit).slice(0, 8)}) — it cannot speak to a closure it does not contain`
  };
}

/** The verdict's own commit, or a REFUSAL naming the field. Never "assume current" (§∅). */
export function verdictCommitOf(doc) {
  const pb = ((doc || {}).verdict || {}).producedBy || {};
  if (typeof pb.commit === 'string' && /^[0-9a-f]{7,40}$/.test(pb.commit)) return { commit: pb.commit };
  const why = pb.commit === null ? `producedBy.commit is null (${pb.commitReason || 'no reason given'})` : 'producedBy.commit is absent';
  return { refused: `${why} — a verdict that does not say which code it judged cannot be placed against a closure, and assuming "current" would manufacture the answer` };
}

/**
 * Fold new entries into the ledger. Idempotent on re-ingest of the same run, and a re-appearing
 * CLOSED key is a REGRESSION that is reported rather than silently reopened or silently dropped:
 * a mutant recorded `killed #N` that survives again means that kill stopped working, which is a
 * louder fact than a new survivor and must not be absorbed by an upsert.
 */
export function mergeEntries(ledger, incoming, opts = {}) {
  const { verdictCommit = null, mergeShaOfPr = () => null, isAncestor = () => false } = opts;
  const rows = (ledger && ledger.entries) || [];
  const index = new Map(rows.map((e) => [survivorKey(e), e]));
  const added = [];
  const regressed = [];
  const stale = [];
  const unknown = [];
  const unchanged = [];
  for (const e of incoming) {
    const k = survivorKey(e);
    const prev = index.get(k);
    if (!prev) {
      index.set(k, e);
      added.push(e);
    } else if (prev.state !== 'open') {
      // A closed entry seen again is only a REGRESSION if the run's code contains the closure.
      const { commit, source } = resolveClosingCommit(prev, mergeShaOfPr);
      const c = classifyReingest(prev, verdictCommit, { closingCommit: commit, source, isAncestor });
      const row = { ...prev, seen_again_pr: e.pr, why: c.reason };
      if (c.kind === 'regression') regressed.push(row);
      else if (c.kind === 'stale') stale.push(row);
      else unknown.push(row);
    } else {
      unchanged.push(prev);
    }
  }
  return { entries: [...index.values()], added, regressed, stale, unknown, unchanged };
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

/* THE OTHER WAY AN ENTRY ORPHANS — and the only one a session can check with no mutmut run.
 *
 * `orphanedEntries` above needs the keys a RUN generated, so it can answer only while a verdict is
 * being ingested. An entry also orphans BETWEEN runs: the mutated line is edited away, and no
 * invocation of mutmut can generate that diff again. Measured 2026-11-01 over the committed ledger —
 * 3 of the 30 open `nightqc.py::summarize` entries record a line the module no longer carries, among
 * them `before = [s for s in others if s[1] <= cur[0]]`, whose partition now reads `excluded` and
 * `_judged_start`. The drafting program already reports each as GONE on every pass (`v: 'GONE'`) and
 * nothing could close one, so all three were re-read by every night run and drafted against never.
 *
 * IT FAILS CLOSED, because the cost of a wrong `absent: true` is retiring a live finding. Anything
 * this cannot read — an unresolvable module, a lane whose bodies it cannot delimit, a name that is
 * not a top-level `def` — answers `absent: false` WITH A REASON, never silence (§4c: a check that
 * could not look says so instead of returning a verdict). A deleted or renamed function is the one
 * absence it does assert, which is the brief's own case: "an entry whose function is renamed WILL
 * orphan, and it must be reported as orphaned rather than silently dropped".
 */
export const ABSENCE_LANES = ['py'];

export function recordedLineAbsence(entry, root) {
  const fname = entry.function || entry.fn;
  if (!ABSENCE_LANES.includes(entry.lane)) {
    return { absent: false, state: 'no-reader', reason: `the ${entry.lane} lane has no body reader here \u2014 only ${ABSENCE_LANES.join(', ')}` };
  }
  /* SPLIT ON THE SEPARATOR, NEVER ON `|` \u2014 a python annotation carries its own pipes, and one of
     the three this measured is keyed `- _cur_end: float | None = None | + _cur_end: float | None = ""`.
     `splitKey` is the drafter's own split, shared so the two tools cannot disagree about a key. */
  const halves = splitKey(String(entry.key || '').trimStart());
  if (!halves) {
    return { absent: false, state: 'no-key', reason: 'the key is not a `- old | + new` pair, so it names no line to look for' };
  }
  /* TWO SPELLINGS, BOTH COMMITTED: the ledger holds `nightqc.py` and `capture-host/loss_audit.py`,
     so a module is repo-relative on one entry and capture-host-relative on the next. Both are tried
     and neither is assumed. */
  const resolved = [entry.module, path.join('capture-host', String(entry.module || ''))].map((r) => path.join(root, r)).find((f) => fs.existsSync(f));
  if (!resolved) return { absent: false, state: 'no-module', reason: `the module ${entry.module} resolves to no file under ${root}` };
  /* ONE READER, SIX STATES, AND ONLY TWO OF THEM RETIRE. `absent` is `RETIRABLE_STATES`, never
     "the line did not match": an EDITED line matched nothing either, and it owes a re-recorded
     mutant id rather than a retirement, so its state and reason travel out with it. */
  const st = recordedLineState(fs.readFileSync(resolved, 'utf8'), fname, halves.before);
  return {
    absent: RETIRABLE_STATES.includes(st.state),
    state: st.state,
    reason: st.reason,
    resolved,
    line: String(halves.before).trim(),
    // `null` on every state but `edited`, because no other state HAS a containing line — never '',
    // which would read as "today's line is empty" (∅).
    todayLine: st.text || null
  };
}

/* ── THE THIRD STATE, AND THE ONLY CLOSURE THAT FITS IT ──────────────────────────────────────────
 *
 * An entry whose recorded line was EDITED can be closed by nobody. `--killed` wants a run, and no
 * invocation of mutmut can generate that diff again. `--equivalent` wants a probe, and the finding may
 * still be real. `--orphaned` checks today's source and REFUSES, correctly: the line is live. So the
 * entry sat `open` forever and the ratchet counted it as debt a session could discharge.
 *
 * ∅ `stale-line` is neither open debt nor a kill. It says the mutant this entry names cannot be
 * produced again, and the finding is unjudged — so the ratchet EXCLUDES it and the verdict's population
 * says so, rather than the count quietly shrinking as though something had been answered.
 *
 * It fails closed in the same shape `--orphaned` does: the operator asserts nothing, and the one state
 * that admits the closure is read from today's source. Measured 2026-11-01 over the committed ledger:
 * exactly one of the 27 open entries reads `edited`.
 */
export const STALE_LINE_STATE = 'edited';

export function staleLineDecision(ab) {
  const st = (ab && ab.state) || 'unreadable';
  if (st === STALE_LINE_STATE) return { ok: true, reason: null };
  if (st === 'present') return { ok: false, reason: "the recorded line is still in today's source verbatim, so the entry is live" };
  if (RETIRABLE_STATES.includes(st)) return { ok: false, reason: `the recorded line reads ${st}, which retires the entry outright — use --orphaned` };
  return { ok: false, reason: `the recorded line reads ${st}, so this could not tell an edit from anything else${ab && ab.reason ? ` — ${ab.reason}` : ''}` };
}

// ── I/O ────────────────────────────────────────────────────────────────────────────────────────
const EMPTY = {
  _README:
    'The mutation survivor ledger. Keyed on lane + module + function + the mutant diff pair — NEVER __mutmut_N. ' +
    'Written by tools/mutation-survivors.mjs only (rows are never hand-edited); CI READS it for the ratchet and ' +
    'must never write it. See briefs/MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md.',
  entries: []
};

function git(args) {
  try {
    return (
      execFileSync('git', args, {
        cwd: path.join(HERE, '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || null
    );
  } catch {
    return null; // not a checkout, or the ref is unknown — the caller treats that as "cannot tell"
  }
}

/** The squash-merge commit of PR N on main, found by the `… (#N)` subject this repo merges with. */
export const mergeShaOfPr = (n) => git(['log', '--format=%H', '-1', `--grep=(#${Number(n)})$`, 'origin/main']);

/** Is `a` an ancestor of `b`? False when either ref is unknown here — never an assumed yes. */
export function isAncestor(a, b) {
  if (a == null || b == null) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: path.join(HERE, '..'), stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = entriesFromVerdict(doc, {
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
  const vc = verdictCommitOf(doc);
  if (vc.refused) {
    console.error(`mutation-survivors: NOT_RUN — ${vc.refused}`);
    return 2;
  }
  const ledger = readLedger();
  const m = mergeEntries(ledger, r.entries, { verdictCommit: vc.commit, mergeShaOfPr, isAncestor });
  writeLedger({ ...ledger, entries: m.entries });
  console.log(`ingested ${r.entries.length} survivor(s): ${m.added.length} new, ${m.unchanged.length} already open`);
  if (r.duplicates) {
    console.log(`  ⚠ ${r.duplicates} survivor(s) were the same mutant listed more than once — counted once, not as twins`);
  }
  if (r.lowerBound) {
    console.log(`  ⚠ LOWER BOUND: ${r.decided} of ${r.generated} mutants reached a verdict — this list is not all of them`);
  }
  for (const g of m.regressed) console.log(`  🔴 REGRESSION: ${keyLabel(survivorKey(g))} — ${g.why}`);
  for (const g of m.stale) console.log(`  ⊘ NOT_APPLICABLE: ${keyLabel(survivorKey(g))} — ${g.why}`);
  for (const g of m.unknown) console.log(`  ? UNKNOWN: ${keyLabel(survivorKey(g))} — ${g.why}`);
  const nowOpen = openCount({ entries: m.entries });
  console.log(`open: ${nowOpen}`);
  // SAY WHAT THE BAR MUST BECOME. The ratchet is two-sided, so an ingest that raises the open count
  // and does not raise `--expect` in the SAME PR lands a red on main — which is exactly what #3188
  // did, and nothing in this output told it to. A number that must move with a change belongs in the
  // output of the thing that moves it.
  if (nowOpen !== openCount(ledger)) {
    console.log(`  ⚠ the open count MOVED — set \`ratchet --expect ${nowOpen}\` in package.json IN THIS PR, or main reds`);
  }
  // Only a REAL regression is worth a red. A stale artifact examined nothing that binds here, and an
  // unresolvable closure is a question, not a finding.
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
  const orphaned = argv.includes('--orphaned');
  const staleLine = argv.includes('--stale-line');
  if (!label || (!killed && !equiv && !orphaned && !staleLine)) {
    console.error('close <mutant-id | label text> --killed N | --equivalent "<probe>" | --orphaned | --stale-line');
    return 2;
  }
  const ledger = readLedger();
  const sel = selectForClose(ledger.entries || [], label);
  if (sel.hits.length !== 1) {
    console.error(`mutation-survivors: REFUSING — ${sel.reason}`);
    return 2;
  }
  const hits = sel.hits;
  /* THE OPERATOR DOES NOT GET TO ASSERT THIS ONE. `--killed` is backed by a run and `--equivalent`
     by a probe the reviewer reads, but "the line is gone" is a fact about today's source, so the
     tool checks it and refuses its own flag when the line is still there. */
  if (orphaned) {
    const gone = recordedLineAbsence(hits[0], path.join(HERE, '..'));
    if (!gone.absent) {
      console.error(`mutation-survivors: REFUSING — ${gone.reason || "the recorded line is still in today's source, so the entry is live"}`);
      return 2;
    }
    hits[0].orphan_evidence = gone.reason || `${hits[0].module} no longer carries the recorded line`;
  }
  /* SAME RULE, DIFFERENT STATE: the operator does not get to assert this one either. The evidence
     records BOTH texts, because that pair is what a later run needs to re-record the mutant id —
     and a closure that keeps only the verdict leaves the next session to find the line again. */
  if (staleLine) {
    const ab = recordedLineAbsence(hits[0], path.join(HERE, '..'));
    const d = staleLineDecision(ab);
    if (!d.ok) {
      console.error(`mutation-survivors: REFUSING — ${d.reason}`);
      return 2;
    }
    hits[0].stale_line_evidence = ab.reason;
    hits[0].recorded_line = ab.line;
    hits[0].today_line = ab.todayLine;
  }
  hits[0].state = killed ? `killed #${Number(killed)}` : orphaned ? 'orphaned' : staleLine ? 'stale-line' : 'equivalent';
  if (equiv) hits[0].probe = equiv;
  // WHERE the closure was made, so a later run can be placed before or after it. The PR number is
  // what survives a squash merge; the branch sha is only the fallback until that PR lands.
  const closedPr = Number(killed || arg('--pr', argv)) || null;
  if (closedPr) hits[0].closed_pr = closedPr;
  const head = git(['rev-parse', 'HEAD']);
  if (head) {
    hits[0].closed_commit = head;
    hits[0].closed_commit_source = 'session HEAD at close (pre-squash)';
  }
  writeLedger(ledger);
  console.log(`closed by ${sel.by}: ${keyLabel(survivorKey(hits[0]))} → ${hits[0].state}`);
  return 0;
}

/** The ONE verdict object this tool emits. Shared by `ratchet` and `--verdict-sample` so the
 * sample cannot drift from the thing it is a sample of — a sample that is not the real shape is
 * exactly the partial adoption `verdict-adoption` exists to catch. */
export function ratchetVerdictObject({ expect, actual, eligible, noPr, orphaned = 0, staleLine = 0 }) {
  const v = ratchetVerdict(expect, actual, noPr);
  // 🔴 THE POPULATION IS EVERY ENTRY, NOT THE OPEN ONES. It was `checked: actual` (the open count),
  // which is a modelling error the verdict contract caught the first time a drain answered ALL of
  // them: `checked` fell to 0 and `makeVerdict` refused a PASS over the examined-nothing shape. Every
  // entry IS examined to decide whether it is open — the open count is the RESULT, not the population.
  // And an EMPTY ledger genuinely examines nothing, so it is NOT_APPLICABLE with a reason rather than
  // a green over zero (§🧾: examined and the rule does not bind).
  const status = eligible === 0 ? 'NOT_APPLICABLE' : v.status;
  const reason = eligible === 0 ? 'the ledger holds no entries — there is nothing to ratchet' : v.reason;
  return makeVerdict({
    gate: 'mutation-survivor-ratchet',
    tool: 'tools/mutation-survivors.mjs',
    status,
    scope: 'internal',
    /* ∅ A `stale-line` ENTRY IS EXAMINED AND UNJUDGEABLE, so it is an EXCLUSION rather than a
       silent shrink. No run can produce its mutant again, so the criterion cannot bind on it — and a
       reader who sees only a lower count cannot tell that from a survivor somebody killed. */
    population: { checked: eligible - staleLine, eligible, excluded: staleLine },
    criterion: { name: 'open_survivors', threshold: expect, unit: 'entries', direction: 'lte' },
    // NOT_APPLICABLE carries result: null — the criterion does not bind, so there IS no result.
    // (The contract refused this too; both refusals are the type system doing the reviewing.)
    /* `answered` STAYS "killed or declared equivalent", so the orphans come off it rather than
       inflating it: an entry retired because its line was edited away answered nothing about the
       code, and a reader comparing the two numbers is reading the difference that matters. */
    result: eligible === 0 ? null : { open: actual, expected: expect, answered: eligible - actual - orphaned - staleLine, orphaned, staleLine },
    evidence: ['mutation-survivors.json'],
    reason
  });
}

/**
 * Give every stored entry an occurrence ordinal, and REFUSE if that would re-identify any of them.
 *
 * The safety property is the whole migration: an entry written before ordinals existed must key
 * EXACTLY as it did, or the ledger silently forgets what it had answered. Ordinal 0 contributes
 * nothing to the key string, so a ledger with no twins migrates to a byte-identical key set — and
 * this checks that rather than assuming it, because "it should be unchanged" is the assumption that
 * loses data quietly.
 */
export function migrateOccurrences(entries) {
  const before = entries.map((e) => survivorKey(e));
  const after = withOccurrences(entries);
  const afterKeys = after.map((e) => survivorKey(e));
  const moved = [];
  for (let i = 0; i < before.length; i++) {
    const still = afterKeys.includes(before[i]);
    if (!still) moved.push({ entry: entries[i], from: before[i] });
  }
  const dupes = afterKeys.length - new Set(afterKeys).size;
  return { entries: after, moved, dupes, changed: after.filter((e) => (e.occurrence || 0) > 0).length };
}

function cmdMigrate(argv) {
  const ledger = readLedger();
  const m = migrateOccurrences(ledger.entries || []);
  if (m.moved.length) {
    console.error(`mutation-survivors: REFUSING — ${m.moved.length} existing entr(ies) would change identity:`);
    for (const x of m.moved) console.error(`    ${keyLabel(x.from)}`);
    return 2;
  }
  if (m.dupes) {
    console.error(`mutation-survivors: REFUSING — ${m.dupes} duplicate key(s) remain after numbering`);
    return 2;
  }
  if (argv.includes('--check')) {
    console.log(`migrate --check: ${m.entries.length} entries, ${m.changed} would take a non-zero ordinal, 0 re-identified`);
    return 0;
  }
  writeLedger({ ...ledger, entries: m.entries });
  console.log(`migrated ${m.entries.length} entries — ${m.changed} took a non-zero ordinal, none re-identified`);
  return 0;
}

/* The census the close path acts on, so finding an orphan needs neither a model nor a mutmut run.
   A REPORT: it exits 0 whatever it finds, because an orphan is not a failure — it is debt that can
   now be retired, and the gate that reads the consequence is the ratchet once the count moves. */
function cmdOrphans(argv) {
  const ledger = readLedger();
  const lane = arg('--lane', argv);
  const open = (ledger.entries || []).filter((e) => e.state === 'open' && (!lane || e.lane === lane));
  const root = path.join(HERE, '..');
  let gone = 0;
  let edited = 0;
  let unexamined = 0;
  for (const e of open) {
    const ab = recordedLineAbsence(e, root);
    if (ab.absent) {
      gone++;
      console.log(`ORPHANED   ${e.mutant || '(no id)'}  ${keyLabel(survivorKey(e))}`);
      console.log(`           ${ab.reason || "the recorded line is gone from today's source"}`);
    } else if (ab.state === 'edited') {
      /* NOT AN ORPHAN AND NOT LIVE. The recorded text survives inside a longer line, so the mutant
         this entry names cannot be generated again either — but the finding may still be real, and
         only a fresh run can say. Retiring it would discard a live survivor. */
      edited++;
      console.log(`EDITED     ${e.mutant || '(no id)'}  ${keyLabel(survivorKey(e))}`);
      console.log(`           ${ab.reason}`);
    } else if (ab.reason) {
      unexamined++;
      console.log(`UNEXAMINED ${e.mutant || '(no id)'}  ${ab.reason}`);
    }
  }
  console.log(`\n${gone} of ${open.length} open entr(ies) record a line today's source no longer carries · ${edited} edited · ${unexamined} unexamined`);
  if (gone) console.log('  close each: node tools/mutation-survivors.mjs close <mutant-id> --orphaned');
  if (edited) {
    console.log('  close each: node tools/mutation-survivors.mjs close <mutant-id> --stale-line');
    console.log('  that EXCLUDES it from the ratchet and keeps both texts — re-recording the id still needs a fresh run');
  }
  return 0;
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
  const orphaned = (ledger.entries || []).filter((e) => e.state === 'orphaned').length;
  const staleLine = (ledger.entries || []).filter((e) => e.state === 'stale-line').length;
  const obj = ratchetVerdictObject({ expect, actual, eligible: (ledger.entries || []).length, noPr, orphaned, staleLine });
  console.log(JSON.stringify(obj));
  return obj.status === 'PASS' ? 0 : 1;
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let fail = 0;
  let ran = 0; // incremented by the assertion helper itself — a count is computed, never typed
  const ck = (what, got, want) => {
    ran++;
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
  const closed = once.entries.map((e) => ({ ...e, state: 'killed #8', closed_pr: 8, closed_commit: 'cccccccc' }));
  const AT_OR_AFTER = { verdictCommit: 'vvvvvvvv', mergeShaOfPr: () => 'mmmmmmmm', isAncestor: () => true };
  const again = mergeEntries({ entries: closed }, e1, AT_OR_AFTER);
  ck('a killed mutant that survives again IN CODE THAT CONTAINS THE CLOSURE is a regression', [again.added.length, again.regressed.length], [0, 1]);
  ck('…and the ledger is not quietly rewritten to open', again.entries[0].state, 'killed #8');

  console.log('\na STALE artifact is not a regression — it examined code without the closure');
  const BEFORE = { verdictCommit: 'oldoldold', mergeShaOfPr: () => 'mmmmmmmm', isAncestor: () => false };
  const old = mergeEntries({ entries: closed }, e1, BEFORE);
  ck('a verdict predating the closure reports STALE, never REGRESSION', [old.regressed.length, old.stale.length], [0, 1]);
  ck('…and says which closure it predates', /predates merge of #8/.test(old.stale[0].why), true);
  ck('…and still does not reopen the entry', old.entries[0].state, 'killed #8');
  const NOCLOSE = { verdictCommit: 'vvvvvvvv', mergeShaOfPr: () => null, isAncestor: () => true };
  const orphanClose = mergeEntries({ entries: once.entries.map((e) => ({ ...e, state: 'equivalent' })) }, e1, NOCLOSE);
  ck('an entry with NO closing commit is UNKNOWN, not a regression', [orphanClose.regressed.length, orphanClose.unknown.length], [0, 1]);

  console.log('\nthe closing commit survives a SQUASH merge');
  ck('the PR number wins over the pre-squash branch sha', resolveClosingCommit({ closed_pr: 8, closed_commit: 'branchsha' }, () => 'squashed1').commit, 'squashed1');
  ck('…and the branch sha is the fallback until that PR lands', resolveClosingCommit({ closed_pr: 8, closed_commit: 'branchsha' }, () => null).commit, 'branchsha');
  ck('…and with neither there is no closing commit to compare against', resolveClosingCommit({}, () => null).commit, null);

  console.log('\na verdict that does not say which code it judged is REFUSED');
  ck('an absent producedBy.commit refuses', !!verdictCommitOf({ verdict: {} }).refused, true);
  ck(
    'a null commit refuses AND repeats its own stated reason',
    /not a checkout/.test(verdictCommitOf({ verdict: { producedBy: { commit: null, commitReason: 'not a checkout' } } }).refused || ''),
    true
  );
  ck('a non-sha refuses rather than being compared', !!verdictCommitOf({ verdict: { producedBy: { commit: 'HEAD' } } }).refused, true);
  ck('a real sha is taken', verdictCommitOf({ verdict: { producedBy: { commit: '3c0dbdec' } } }).commit, '3c0dbdec');

  console.log('\nCONTENT + POSITION — twins in one function are separate findings');
  {
    const dif = (ln) => `--- m.py\n+++ m.py\n@@ -${ln},7 +${ln},7 @@\n-    continue\n+    break\n`;
    ck("the position comes from the survivor's own diff", positionOfSurvivor({ diff: dif(36) }), 36);
    ck('…and a survivor without one says so rather than guessing 0', positionOfSurvivor({ diff: '' }), null);
    const twins = [
      { lane: 'py', module: 'm.py', function: 'read_journal', key: '- continue | + break', file_line: 44 },
      { lane: 'py', module: 'm.py', function: 'read_journal', key: '- continue | + break', file_line: 36 },
      { lane: 'py', module: 'm.py', function: 'read_journal', key: '- continue | + break', file_line: 42 }
    ];
    const n = withOccurrences(twins);
    ck(
      'twins are numbered in POSITION order, not arrival order',
      n.map((e) => [e.file_line, e.occurrence]),
      [
        [36, 0],
        [42, 1],
        [44, 2]
      ]
    );
    ck('…so three real twins are three keys, not one', new Set(n.map(survivorKey)).size, 3);
    ck(
      'the FIRST twin keys exactly as it did before ordinals existed',
      survivorKey(n.find((e) => e.occurrence === 0)),
      survivorKey({ lane: 'py', module: 'm.py', function: 'read_journal', key: '- continue | + break' })
    );
    const lone = withOccurrences([{ lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: 9 }]);
    ck('a mutation with no twin takes ordinal 0 and is untouched', lone[0].occurrence, 0);
    const noPos = withOccurrences([
      { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: null },
      { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: null }
    ]);
    ck('two twins with NO position stay two findings — a missing line must not merge them (§∅)', new Set(noPos.map(survivorKey)).size, 2);
    ck(
      '…and a positioned twin sorts before an unpositioned one',
      withOccurrences([
        { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: null },
        { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: 5 }
      ]).find((e) => e.occurrence === 0).file_line,
      5
    );
    ck(
      'a different mutation on the SAME line is a different key already',
      survivorKey({ lane: 'py', module: 'm.py', function: 'f', key: '- x | + y', occurrence: 0 }) !== survivorKey({ lane: 'py', module: 'm.py', function: 'f', key: '- x | + z', occurrence: 0 }),
      true
    );
    ck(
      'the label shows an ordinal when there is one, and hides it when there is not',
      [keyLabel(survivorKey(n[1])).includes('[occurrence 1]'), keyLabel(survivorKey(n[0])).includes('occurrence')],
      [true, false]
    );
  }

  console.log('\nONE mutant reached twice is one finding; two twins are two');
  {
    const dif = (ln) => `@@ -${ln},7 +${ln},7 @@\n-    continue\n+    break\n`;
    const SAME = { mutant: 'm.x_f__mutmut_55', module: 'm.py', key: '- continue | + break', diff: dif(36) };
    const doc = (sv) => ({ verdict: { status: 'FAIL', result: { generated: 9, decided: 9 } }, survivors: sv });
    // A survivor listed by two globs: the SAME id twice.
    const twice = entriesFromVerdict(doc([SAME, { ...SAME }]), { lane: 'py', pr: 1 });
    ck('the same mutant listed twice is ONE entry', twice.entries.length, 1);
    ck('…and the duplicate is REPORTED, not silently dropped', twice.duplicates, 1);
    ck('…and it does not get an ordinal, which would make it a twin', twice.entries[0].occurrence, 0);
    // Two genuine twins: different mutants, identical text, different positions.
    const twins = entriesFromVerdict(
      doc([
        { mutant: 'm.x_f__mutmut_55', module: 'm.py', key: '- continue | + break', diff: dif(36) },
        { mutant: 'm.x_f__mutmut_67', module: 'm.py', key: '- continue | + break', diff: dif(42) }
      ]),
      { lane: 'py', pr: 1 }
    );
    ck('two genuine twins are TWO entries', twins.entries.length, 2);
    ck('…with no duplicate reported', twins.duplicates, 0);
    ck('…and two distinct keys', new Set(twins.entries.map(survivorKey)).size, 2);
    // The discriminator is the id, not the text or the position.
    ck('an entry with NO mutant id is never merged into another (§∅)', dedupeByMutant([{ key: 'a' }, { key: 'a' }]).kept.length, 2);
    ck(
      '…and de-dup keeps the FIRST occurrence, not the last',
      dedupeByMutant([
        { mutant: 'x', file_line: 1 },
        { mutant: 'x', file_line: 9 }
      ]).kept[0].file_line,
      1
    );
  }

  console.log('\nthe migration may not re-identify a single stored entry');
  {
    const old = [
      { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', state: 'killed #1' },
      { lane: 'py', module: 'm.py', function: 'g', key: '- c | + d', state: 'equivalent' }
    ];
    const m = migrateOccurrences(old);
    ck('a ledger with no twins migrates to a byte-identical key set', [m.moved.length, m.changed, m.dupes], [0, 0, 0]);
    ck('…and every state survives', m.entries.map((e) => e.state).sort(), ['equivalent', 'killed #1']);
    const withTwins = migrateOccurrences([
      { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: 3 },
      { lane: 'py', module: 'm.py', function: 'f', key: '- a | + b', file_line: 9 }
    ]);
    ck('twins already in the ledger separate WITHOUT the first one moving', [withTwins.moved.length, withTwins.changed, withTwins.dupes], [0, 1, 0]);
  }

  console.log('\na SHARED mutation text is addressable by the mutant id');
  {
    const shared = '- continue | + break';
    const two = [
      { lane: 'py', module: 'm.py', function: 'scan_night', key: shared, mutant: 'm.x_scan_night__mutmut_38', state: 'open' },
      { lane: 'py', module: 'm.py', function: 'file_last_row_floating_s', key: shared, mutant: 'm.x_file_last_row_floating_s__mutmut_7', state: 'open' }
    ];
    ck('the shared text alone selects BOTH, so it is refused', selectForClose(two, shared).hits.length, 2);
    ck('…and the refusal NAMES them, which is what the operator needs', /x_scan_night__mutmut_38[\s\S]*x_file_last_row_floating_s__mutmut_7/.test(selectForClose(two, shared).reason), true);
    ck(
      '…and says BOTH ways out — qualify the label, or use the id (the bare key tail was the real cause)',
      /QUALIFIED label/.test(selectForClose(two, shared).reason) && /mutant id/.test(selectForClose(two, shared).reason),
      true
    );
    const one = selectForClose(two, 'm.x_scan_night__mutmut_38');
    ck('the mutant id selects exactly one', [one.hits.length, one.by], [1, 'mutant id']);
    ck('…the right one', one.hits[0].function, 'scan_night');
    ck('the OTHER id selects the other', selectForClose(two, 'm.x_file_last_row_floating_s__mutmut_7').hits[0].function, 'file_last_row_floating_s');
    // CONTROL: the text path is unchanged wherever it already resolved to one entry.
    const uniq = selectForClose(two, 'scan_night  - continue');
    ck('a text label that still matches one entry keeps working', [uniq.hits.length, uniq.by], [1, 'label text']);
    ck('a label matching nothing says so rather than closing something', selectForClose(two, 'nope').hits.length, 0);
    ck('an empty label selects nothing', selectForClose(two, '   ').hits.length, 0);
    // An id must never be ambiguous; if it is, the LEDGER is wrong and the tool says that.
    const dup = [
      { mutant: 'x__mutmut_1', key: 'a', state: 'open' },
      { mutant: 'x__mutmut_1', key: 'b', state: 'open' }
    ];
    ck('a duplicated mutant id is reported as an inconsistent ledger, not silently resolved', /should be impossible/.test(selectForClose(dup, 'x__mutmut_1').reason), true);
  }

  console.log('\nthe verdict OBJECT models its population correctly');
  {
    const all = ratchetVerdictObject({ expect: 0, actual: 0, eligible: 12, noPr: 0 });
    ck('every entry answered is still a PASS over a real population — not examined-nothing', [all.status, all.population.checked, all.result.open, all.result.answered], ['PASS', 12, 0, 12]);
    const none = ratchetVerdictObject({ expect: 0, actual: 0, eligible: 0, noPr: 0 });
    ck('an EMPTY ledger examines nothing, so it does not report a green', none.status, 'NOT_APPLICABLE');
    ck('…and says why', /nothing to ratchet/.test(none.reason), true);
  }

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

  console.log('\nan entry ALSO orphans when its LINE is edited away, and that one needs no run');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'survivor-absence-'));
  const MOD = [
    'import os',
    '',
    'def summarize(night_dir, devices):',
    '    span = None',
    '    _cur_end: float | None = None',
    '    _span_reason = None if span else "under the minimum judgeable span"',
    '',
    '    def inner(x):',
    '        return x',
    '',
    '    return {"span": span}',
    '',
    'basis = "measured"',
    '',
    'def other():',
    '    before = [s for s in others if s[1] <= cur[0]]',
    '    return before',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(tmp, 'nightqc.py'), MOD);
  const ent = (key, fn = 'summarize', over = {}) => ({ lane: 'py', module: 'nightqc.py', function: fn, key, ...over });
  /* EVERY `absent: false` BELOW IS A CONTROL THAT BITES: an implementation answering `true`
     whenever it could not find the line — the obvious way to write this — reds SEVEN of them
     (MEASURED 2026-11-01 by returning `absent: true` from every non-`present` branch of
     `recordedLineAbsence` and `recordedLineState` and re-running this file). Two of the seven are the
     states #4214 could not name: an EDITED line and a module-level twin, both of which that version
     answered `absent: false, reason: null` — not retired, and not reported either. */
  ck('a line still in the body is NOT absent', recordedLineAbsence(ent('- span = None | + span = ""'), tmp).absent, false);
  ck(
    '…and an ANNOTATED line splits on the separator, not on its own pipes',
    recordedLineAbsence(ent('- _cur_end: float | None = None | + _cur_end: float | None = ""'), tmp).line,
    '_cur_end: float | None = None'
  );
  ck('a line edited away IS absent', recordedLineAbsence(ent('- sessions = merge(x) | + sessions = merge(None)'), tmp).absent, true);
  ck(
    'a line that now lives in ANOTHER top-level function is absent from this one',
    recordedLineAbsence(ent('- before = [s for s in others if s[1] <= cur[0]] | + before = [s for s in others if s[1] <= cur[1]]'), tmp).absent,
    true
  );
  ck('a function the module no longer defines orphans the entry', recordedLineAbsence(ent('- span = None | + span = ""', 'vanished'), tmp).absent, true);
  ck('an indented-only name is UNEXAMINED, never absent', recordedLineAbsence(ent('- return x | + return None', 'inner'), tmp).absent, false);
  ck('…and it says which way it could not look', /only indented/.test(recordedLineAbsence(ent('- return x | + return None', 'inner'), tmp).reason), true);
  ck('a module that resolves to nothing is UNEXAMINED', recordedLineAbsence(ent('- span = None | + span = ""', 'summarize', { module: 'absent.py' }), tmp).absent, false);
  ck('a lane with no body reader is UNEXAMINED', recordedLineAbsence(ent('- span = None | + span = ""', 'summarize', { lane: 'js' }), tmp).absent, false);
  ck('a key that is not a pair names no line to look for', recordedLineAbsence(ent('not a pair'), tmp).absent, false);
  ck('a pair whose original half is empty names nothing either', recordedLineAbsence(ent('-  | + x'), tmp).absent, false);
  /* THE TWO STATES #4214 COLLAPSED. Both answer `absent: false`, like every control above, but a
     silent `false` is what told the operator an edited entry was live, so each owes its own reason. */
  const edited = recordedLineAbsence(ent('- _span_reason = None | + _span_reason = ""'), tmp);
  ck('a line that merely GREW is not absent', edited.absent, false);
  ck('…and it is reported as edited, never as live', edited.state, 'edited');
  ck('…and its reason asks for a re-recorded id, not a retirement', /re-recording/.test(edited.reason), true);
  const twin = recordedLineAbsence(ent('- basis = "measured" | + basis = ""'), tmp);
  ck('a module-level twin of the recorded text never retires the entry', twin.absent, false);
  ck('…and it is not reported as present either', twin.state === 'present', false);
  /* The span reader itself, which the core now owns for both tools. */
  const LN = MOD.split('\n');
  const SPAN = functionSpan(LN, 'summarize');
  ck(
    'a top-level body stops at the next top-level def',
    LN.slice(SPAN[0], SPAN[1]).some((l) => l.startsWith('def other')),
    false
  );
  ck(
    '…and keeps a nested def INSIDE the body',
    LN.slice(SPAN[0], SPAN[1]).some((l) => l.includes('def inner(')),
    true
  );
  ck('a name the module lacks has no span at all', functionSpan(LN, 'vanished'), null);
  ck('a name that is only ever indented reads as indented-only', recordedLineState(MOD, 'inner', 'return x').state, 'indented-only');
  ck('only a gone line and a gone function retire an entry', RETIRABLE_STATES, ['gone', 'no-function']);

  /* THE CLOSURE FOR THE ONE STATE NOBODY COULD STATE. Every leg below that reads `ok: false` is a
     control: an implementation that admitted it would retire a live finding, or claim a kill. */
  console.log('\nan edited line closes to stale-line, and nothing else does');
  ck('the containing line travels out with the edited state', edited.todayLine, '_span_reason = None if span else "under the minimum judgeable span"');
  ck('…so an edited line admits the closure', staleLineDecision(edited).ok, true);
  const live = recordedLineAbsence(ent('- span = None | + span = ""'), tmp);
  ck('a line still carried verbatim refuses it', staleLineDecision(live).ok, false);
  ck('…and says the entry is live', /is live/.test(staleLineDecision(live).reason), true);
  const goneAb = recordedLineAbsence(ent('- before = [s for s in others if s[1] <= cur[0]] | + before = None'), tmp);
  ck('a gone line refuses it too', staleLineDecision(goneAb).ok, false);
  ck('…and is sent to --orphaned instead', /--orphaned/.test(staleLineDecision(goneAb).reason), true);
  ck('a state this could not read fails closed', staleLineDecision({ state: 'no-module', reason: 'resolves to no file' }).ok, false);
  ck('…and so does an absence it was never given', staleLineDecision(undefined).ok, false);
  ck('the one admitting state is named, never inferred', STALE_LINE_STATE, 'edited');
  fs.rmSync(tmp, { recursive: true, force: true });
  ck('a stale-line entry is not an open one', openCount({ entries: [{ state: 'stale-line' }, { state: 'open' }] }), 1);
  /* ∅ THE EXCLUSION IS THE POINT: a lower count with no exclusion reads as a survivor somebody
     killed, which is the one thing a stale line does NOT mean. */
  ck('the ratchet excludes a stale line rather than banking it', ratchetVerdictObject({ expect: 1, actual: 1, eligible: 4, noPr: 0, orphaned: 1, staleLine: 1 }).population, {
    checked: 3,
    eligible: 4,
    excluded: 1
  });
  ck('…and `answered` counts neither the orphans nor the stale lines', ratchetVerdictObject({ expect: 1, actual: 1, eligible: 4, noPr: 0, orphaned: 1, staleLine: 1 }).result, {
    open: 1,
    expected: 1,
    answered: 1,
    orphaned: 1,
    staleLine: 1
  });
  ck('an orphaned entry is not an open one', openCount({ entries: [{ state: 'orphaned' }, { state: 'open' }] }), 1);
  ck('the ratchet keeps `answered` clear of the orphans', ratchetVerdictObject({ expect: 1, actual: 1, eligible: 4, noPr: 0, orphaned: 2 }).result, {
    open: 1,
    expected: 1,
    answered: 1,
    orphaned: 2,
    staleLine: 0
  });

  console.log(fail ? `${fail} failed of ${ran}` : `all ${ran} selftests passed`);
  return fail ? 1 : 0;
}

const CMDS = { ingest: cmdIngest, list: cmdList, close: cmdClose, orphans: cmdOrphans, ratchet: cmdRatchet, migrate: cmdMigrate };

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  /* The subcommand table below refuses an unknown POSITIONAL; an unknown flag reached the defaults.
     `ingest` without a readable `--pr` is the attribution the header refuses, so a typo there must
     not read as absence. */
  refuseUnknownArgvOrExit(
    argv,
    {
      valued: ['--pr', '--lane', '--run-id', '--sha', '--killed', '--equivalent', '--expect'],
      boolean: ['--selftest', '--verdict-sample', '--open', '--check', '--orphaned', '--stale-line'],
      positional: true
    },
    { tool: 'mutation-survivors' }
  );
  if (argv.includes('--selftest')) process.exit(selftest());
  if (argv.includes('--verdict-sample')) {
    // A SAMPLE, not a measurement: it reports on a two-entry stand-in, never on the committed
    // ledger, so running it can neither pass nor fail the real ratchet.
    console.log(JSON.stringify(ratchetVerdictObject({ expect: 0, actual: 0, eligible: 3, noPr: 0 })));
    process.exit(0);
  }
  const fn = CMDS[argv[0]];
  if (!fn) {
    console.error('usage: mutation-survivors.mjs ingest <verdict.json> --pr N --lane py|js | list | close | orphans [--lane py] | ratchet --expect N | migrate [--check] | --selftest');
    process.exit(2);
  }
  process.exit(fn(argv));
}
