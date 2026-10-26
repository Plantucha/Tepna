#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// corpus-scope.mjs — count a file pattern across EVERY corpus root, and say which roots were searched.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: AN ABSENCE MEASURED OVER THE WRONG SCOPE READS EXACTLY LIKE AN ABSENCE MEASURED
// OVER THE RIGHT ONE. Residue `2026-09-05-triage-stamps-searched-the-repo-tree-only`: two triage
// stamps merged to main asserting this machine held "**zero** `_ECG.txt`" and "only **2** `_PPG.txt`".
// Measured under /srv/data/tepna-corpus the same week: **1131 `_ECG.txt`** and **8760 `_PPG.txt`
// (5633 Verity)**. Both had counted only the repo's `uploads/` tree, where the raw corpus never lives
// — the same error twice in one pass, and the second one shipped. It licensed a "blocked on data
// locality" verdict that stopped work on FOUR briefs.
//
// The defect is not "a wrong number". A `0` from the wrong root is indistinguishable, on the page,
// from a `0` from the right one — so the bar is the negation of that: **a count that does not name the
// roots it searched, and does not distinguish "0 files here" from "this root is not on this machine",
// is not a count.** Both halves are printed, always.
//
// ⚠️ THE EXISTING HELPER DOES NOT COVER THIS, and that is worth knowing before reaching for it:
// `corpusSearch()` in tools/regen-goldens-core.mjs resolves $DEX_UPLOADS -> the primary checkout's
// `uploads/` -> this checkout's. Every candidate it has is an `uploads/` tree, which is the exact
// scope the 09-01 stamps searched. It is correct for its job (finding the fixture corpus) and wrong
// for "is there any ECG data on this machine".
//
// Roots come from docs/CORPUS-LOCATIONS.md, parsed, so the doc stays the single source. A row whose
// path is elided (`/run/media/…/Ecg nightly`) or remote (`vigil:/srv/tepna/captures`) is reported as
// NOT COUNTABLE HERE by name — never silently dropped, because a dropped root is how the scope
// narrowed in the first place.
//
// Usage:
//   node tools/corpus-scope.mjs '*_ECG.txt'
//   node tools/corpus-scope.mjs '*Verity*_PPG.txt' --json
//   node tools/corpus-scope.mjs --selftest
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { positionalArgs, refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const DOC = 'docs/CORPUS-LOCATIONS.md';

/* A root that cannot be counted from this machine is NOT a zero (§∅). Three reasons, each named:
     'elided'   the doc writes a placeholder (…) instead of a path — a human-readable row, not a path
     'remote'   `host:/path` — reachable over ssh, not by this process
     'absent'   a real absolute path that is not on this filesystem
   Only 'absent' is a fact about THIS machine; the first two are facts about the row. */
export function classifyRoot(raw) {
  const p = String(raw).trim();
  if (/[…]/.test(p) || /<[^>]+>/.test(p)) return { path: p, countable: false, why: 'elided' };
  if (/^[A-Za-z0-9_.-]+:\//.test(p)) return { path: p, countable: false, why: 'remote' };
  if (!p.startsWith('/')) return { path: p, countable: false, why: 'not-absolute' };
  return { path: p, countable: true, why: null };
}

/** Pull every backticked absolute-looking path that opens a table row out of the doc. PURE. */
export function parseRoots(docText) {
  const out = [];
  for (const line of String(docText).split('\n')) {
    const m = /^\|\s*\*{0,2}`([^`]+)`\*{0,2}\s*\|/.exec(line);
    if (!m) continue;
    const p = m[1].trim();
    // a row whose first cell is a repo file (tools/x.mjs) is documentation, not a corpus root
    if (!/^[/<]|^[A-Za-z0-9_.-]+:\//.test(p)) continue;
    if (out.some((r) => r.path === p)) continue;
    out.push(classifyRoot(p));
  }
  return out;
}

/** Count files matching `pattern` under one root. Returns null — never 0 — when the root is not a
 *  directory here, because "not on this machine" and "empty" are different facts (§∅). */
export function countUnder(root, pattern) {
  try {
    if (!statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    const out = execFileSync('find', ['-L', root, '-name', pattern, '-type', 'f'], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).length;
  } catch (e) {
    // `find` exits non-zero on an unreadable subtree while still printing what it saw
    const printed = String(e.stdout || '')
      .split('\n')
      .filter(Boolean).length;
    return printed || null;
  }
}

/* ⚠️ THE DOC LISTS THE SAME TREE TWICE, AND SUMMING ROOTS DOUBLE-COUNTS IT. Measured on this tool's
   first real run: `/home/michal/tepna-smoketest/captures` and `/srv/data/tepna-corpus/smoketest-captures/`
   both reported 554 `_ECG.txt` — one is a symlink to the other, and the total read 1761 when the true
   figure is 1207. That is this tool's own failure class one level up: a number whose scope is not
   stated, where the unstated part is that two of the scopes are the same scope. So roots are resolved
   to their real path and a root that IS another, or sits INSIDE another, is reported and NOT summed.
   PURE given the resolver, which is injected so the rule is testable without a filesystem. */
export function dedupeRoots(rows, resolver) {
  const seen = [];
  return rows.map((r) => {
    if (r.count === null) return r;
    let real;
    try {
      real = resolver(r.root);
    } catch {
      real = r.root;
    }
    const same = seen.find((s) => s.real === real);
    if (same) return { ...r, count: r.count, counted: false, why: `alias-of ${same.root}` };
    const inside = seen.find((s) => real.startsWith(s.real.endsWith('/') ? s.real : s.real + '/'));
    if (inside) return { ...r, counted: false, why: `nested-in ${inside.root}` };
    seen.push({ root: r.root, real });
    return { ...r, counted: true };
  });
}

/** The census as ONE tepna.verdict/1 object. `population` is ROOTS: checked = roots counted here,
 *  excluded = roots this machine cannot count (elided · remote · absent), and the equality is what
 *  makes a narrowed scope visible instead of invisible. */
export function censusVerdict(pattern, rows, { commit = null, commitReason = null } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const counted = rows.filter((r) => r.count !== null);
  /* A root that aliases another is COUNTED but not SUMMED — it is still shown, because hiding it
     would make the scope smaller than the doc says it is. */
  const summed = counted.filter((r) => r.counted !== false);
  const total = summed.reduce((a, r) => a + r.count, 0);
  const excluded = rows.length - counted.length;
  let status;
  let reason;
  if (rows.length === 0) {
    status = 'NOT_RUN';
    reason = `${DOC} listed no corpus roots — the doc could not be parsed`;
  } else if (counted.length === 0) {
    status = 'UNDERPOWERED';
    reason = `none of the ${rows.length} documented root(s) is countable from this machine, so this run cannot distinguish absence from unreachability`;
  } else if (total === 0) {
    status = 'PASS';
    reason = null; // a real zero, over a named scope — the only kind worth quoting
  } else {
    status = 'PASS';
    reason = null;
  }
  const v = Verdict.make({
    gate: 'corpus-scope',
    status,
    scope: 'internal',
    population: { checked: counted.length, eligible: rows.length, excluded },
    criterion: { name: 'documented_roots_counted', threshold: rows.length, unit: '', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { pattern, files: total, summedRoots: summed.length, byRoot: rows },
    evidence: ['tools/corpus-scope.mjs', DOC],
    reason,
    producedBy: producedByOf('tools/corpus-scope.mjs', commit, commitReason)
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`corpus-scope: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

/* ── POPULATION STABILITY — a night can ARRIVE while a measurement runs ─────────────────────────
   A daily job re-syncs the box captures root with mtimes PRESERVED, so an arriving night moves
   `ctime` alone and the directory's own mtime does not move at all. Residue
   `2026-10-20-a-daily-corpus-resync-moves-the-population-mid-measurement`: two legs of one tool
   60 seconds apart read 93 night directories and 97, one night that the first pair refused for
   absent H10 inputs scored for the second, and the added directories carried mtimes preserved from
   weeks earlier. A reader that trusts a listing from minutes ago sees nothing.

   ⚠️ SO THE TEST IS THE NAME SET, NEVER A TIMESTAMP. A time-keyed detector is precisely the one a
   preserving copy defeats, and `maxCtimeMs` below is carried as a DIAGNOSTIC that no branch reads.
   The remedy a measurement owes is the INTERSECTION of the set it started with and the set it ended
   with: one continuous population, with the arrivals named rather than averaged in. */

export const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A stable digest of a night set — the stamp a published number can carry so a later reader can ask
 *  whether it was cut over this population. The sort is inside, so the digest names the SET and two
 *  runs that enumerated the same nights in a different order agree. Without it the stamp answers
 *  "did these names arrive in this order", which is not a question anyone is asking: a caller
 *  holding an unsorted list would get a digest that differs from a stored one over the same set. */
export function digestNights(nights) {
  return createHash('sha256')
    .update([...nights].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/** Enumerate the night directories under `root`. An unreadable root returns `ok: false` and NEVER an
 *  empty population — an absent root is not a zero (§∅), and a zero here would read as "the corpus
 *  emptied mid-run".
 *
 *  🔴 A CALLER'S OWN RULE IS APPLIED INSIDE THIS WALK, SO THE SNAPSHOT IT RETURNS IS ALREADY THE
 *  NARROWED SET. That is the whole hazard of residue
 *  `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`: a reader of the verdict
 *  downstream cannot tell a root scored in full from a root where the rule rejected six nights, and
 *  cannot tell either from a root where a rule wider than `NIGHT_RE` counted a non-night directory
 *  IN. The rule is a decision, so the snapshot records it and records what it did, against the one
 *  fixed yardstick both directions need — `NIGHT_RE` over the same listing:
 *
 *    rejectedNightShaped  night-shaped names the rule REFUSED  (a narrower rule; invisible before)
 *    admittedNonNight     non-night names the rule ADMITTED    (a wider rule; counted as nights)
 *    passedOver           names NOTHING counted: the remainder of the listing, files included
 *
 *  All three are NAMES, not counts, because a count cannot be chased. `ruleIsDefault` says whether
 *  the first two questions bind at all; `passedOver` binds under EVERY rule, the default one
 *  included.
 *
 *  🔴 `ruleIsDefault` IS A NIGHT-RULE ANSWER, so an entries walk has none to give and the field
 *  reads `null` there (§∅ at the verdict layer). `true` meant "the default NIGHT rule applied",
 *  which is a claim about a comparison nobody ran for a population that is not keyed on dates at
 *  all, and it read as a measurement while standing in for not-applicable. `passedOver` two lines
 *  below in the same literal already reads `null` for the same reason, so the two fields now
 *  agree (row 2026-10-26-the-entries-walk-asserts-a-night-rule-answer-it-never-computed).
 *
 *  🔴 THE DEFAULT RULE HAD NO ACCOUNT OF WHAT IT PASSED OVER, so a root holding `sub-01`, `sub-02`
 *  and `sub-03` answered `ok: true, n: 0` under the same digest as a genuinely empty root, and the
 *  verdict one level up then published a record-keyed corpus as an emptied one (row
 *  2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population). `passedOver` closes
 *  that by PARTITIONING the listing: every name `readdirSync` returned sits in exactly one of
 *  `nights`, `rejectedNightShaped` and `passedOver`, whatever the rule, because the third bin is
 *  defined as the remainder. The walk's own directory filter is inside that remainder, so a
 *  record-keyed root of FILES is named as well. `admittedNonNight` is not a fourth bin — it is the
 *  subset of `nights` the default yardstick would have refused.
 *
 *  None of this changes `nights`, so no caller's scored set moves. */
export function snapshotNights(root, { re = NIGHT_RE, at = null } = {}) {
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let names;
  let dirNames;
  let entryNames;
  try {
    const ents = readdirSync(root, { withFileTypes: true });
    /* The walk's own filter is a decision too, so the full listing is kept: a record-keyed root
       holds FILES, and a bin built from directories alone could not name them. */
    entryNames = ents.map((d) => d.name);
    dirNames = ents.filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);
    names = dirNames.filter((n) => re.test(n));
  } catch (e) {
    return {
      ok: false,
      root,
      reason: `root not enumerable: ${e.code || e.message}`,
      n: 0,
      nights: [],
      digest: null,
      maxCtimeMs: null,
      at: stamp,
      rule: String(re),
      ruleIsDefault: String(re) === String(NIGHT_RE),
      /* ∅: the walk failed, so the rule's effect was never measured. An empty list here would read
         as "the rule rejected nothing", which is a different statement from "nobody looked". */
      rejectedNightShaped: null,
      admittedNonNight: null,
      passedOver: null
    };
  }
  const nights = names.sort();
  const ruleIsDefault = String(re) === String(NIGHT_RE);
  const admitted = new Set(nights);
  const rejectedNightShaped = ruleIsDefault ? [] : dirNames.filter((n) => NIGHT_RE.test(n) && !admitted.has(n)).sort();
  const admittedNonNight = ruleIsDefault ? [] : nights.filter((n) => !NIGHT_RE.test(n));
  /* Unconditional, because the DEFAULT rule is the one whose silence published a record-keyed root
     as an emptied corpus. Defined as the REMAINDER of the listing, so the three bins partition it by
     construction rather than by a regex coincidence. */
  const refusedSet = new Set(rejectedNightShaped);
  const passedOver = entryNames.filter((n) => !admitted.has(n) && !refusedSet.has(n)).sort();
  let maxCtimeMs = null;
  for (const n of nights) {
    try {
      const ms = statSync(join(root, n)).ctimeMs;
      if (maxCtimeMs === null || ms > maxCtimeMs) maxCtimeMs = ms;
    } catch {
      /* A night that vanishes between the listing and the stat IS a population change, and the name
         set above already carries it. The stat is the diagnostic, so it stays silent. */
    }
  }
  return {
    ok: true,
    root,
    reason: null,
    n: nights.length,
    nights,
    digest: digestNights(nights),
    maxCtimeMs,
    at: stamp,
    rule: String(re),
    ruleIsDefault,
    rejectedNightShaped,
    admittedNonNight,
    passedOver
  };
}

/** A population whose unit is NOT a night directory: the caller's own lister IS the enumeration, and
 *  the names it returns are the members. The shape matches `snapshotNights` so one verdict builder
 *  serves both, with two deliberate differences — the names ride `members` and never a key called
 *  `nights`, and `unit` says what was counted.
 *
 *  🔴 THE NIGHT PRIMITIVE WOULD HAVE PUBLISHED A POPULATION THAT EXAMINED NOTHING.
 *  `tools/stage-lab.mjs` held the heaviest unwired weight in `tools/corpus-reads.mjs` (12
 *  enumerations) through four wiring units, and not one of them walks a night folder: its cohorts are
 *  external PSG archives keyed `sub-NNN`, `ucddbNNN.rec`, `edfs/<visit>/*.edf`. `snapshotNights` over
 *  any of those roots returns `ok: true, n: 0`, which reads as "this dataset is empty" — the ∅ defect
 *  wearing the fix's clothes (measured 2026-10-25, row
 *  2026-10-21-forty-one-corpus-enumerators-report-no-population). So the UNIT is a decision the
 *  snapshot records, exactly as a night rule is.
 *
 *  A lister that throws returns `ok: false` with the reason and NEVER an empty population: an
 *  unreadable root is not a dataset of zero records. The night rule's two measurements do not apply
 *  here — there is no yardstick for "record-shaped" — so they are `null` rather than `[]`, the same
 *  distinction `snapshotNights` draws on a failed walk: nobody looked, as against nothing found. */
export function snapshotEntries(root, { list, unit = 'records', at = null } = {}) {
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (typeof list !== 'function') throw new Error('snapshotEntries: a `list` function IS the enumeration — without one there is no population to snapshot');
  /* THE CALLER'S LISTER IS THE RULE for this unit, so the snapshot NAMES it. The header above
     promises names rather than counts because nobody can chase a count, and `rule: null` dropped the
     one decision this primitive's caller makes. An inline arrow carries no name, and `null` then says
     so rather than inventing one (§∅). Row 2026-10-26-the-entries-walk-drops-the-lister-that-chose-it.
     🔴 `list.name` IS NOT A NAME THE CALLER CHOSE. JS infers a function's name from the property it
     is assigned to, so `{ list: (d) => ... }` reads `list` — the parameter's own key, which names no
     lister and would publish a rule nobody wrote. A function genuinely called `list` is
     indistinguishable from that, so both read `null` and the note says why. Measured over the two
     live callers: `ppg-gap-bridge-scan.mjs` passes `listPpgFiles` and `stage-lab.mjs` passes an
     inline arrow, so the two live populations fall on opposite sides of this line. */
  const ruleName = list.name && list.name !== 'list' ? list.name : null;
  let members;
  try {
    members = [...list(root)].map(String).sort();
  } catch (e) {
    return {
      ok: false,
      root,
      reason: `root not enumerable: ${e.code || e.message}`,
      n: 0,
      unit,
      members: [],
      digest: null,
      maxCtimeMs: null,
      at: stamp,
      rule: ruleName,
      /* ∅: no night rule ran, so there is no default to be at. See the header. */
      ruleIsDefault: null,
      rejectedNightShaped: null,
      admittedNonNight: null,
      passedOver: null
    };
  }
  return {
    ok: true,
    root,
    reason: null,
    n: members.length,
    unit,
    members,
    digest: digestNights(members),
    maxCtimeMs: null,
    at: stamp,
    rule: ruleName,
    /* ∅: no night rule ran, so there is no default to be at. See the header. */
    ruleIsDefault: null,
    rejectedNightShaped: null,
    admittedNonNight: null,
    /* ∅: the unit is not a directory name, so no night rule ran and no name was passed over. `[]`
       would read as "the walk looked and found nothing to pass over". */
    passedOver: null
  };
}

/** The member names a snapshot counts, whatever its unit. A night snapshot carries `nights`, a record
 *  snapshot `members`, and every piece of set arithmetic below reads THIS — so a record population is
 *  never addressed through a key named for a unit it does not have. */
function membersOf(s) {
  return (s && (s.members || s.nights)) || [];
}

/** The population's unit, as both the criterion and the prose need it. A snapshot that names no unit
 *  is a NIGHT snapshot: that was this module's only unit, and `nights_added_or_removed` is a key
 *  published verdicts are already indexed on, so the default must keep producing it byte for byte. */
function unitWords(before, after) {
  const unit = (before && before.unit) || (after && after.unit) || 'nights';
  const one = unit.endsWith('s') ? unit.slice(0, -1) : unit;
  return { unit, one, thing: unit === 'nights' ? 'night directory' : one, criterion: `${unit}_added_or_removed` };
}

/** The intersection of two snapshots, with what arrived and what left named. */
export function intersectSnapshots(before, after) {
  const b = new Set(membersOf(before));
  const a = new Set(membersOf(after));
  const added = membersOf(after).filter((n) => !b.has(n));
  const removed = membersOf(before).filter((n) => !a.has(n));
  const nights = membersOf(before).filter((n) => a.has(n));
  return { nights, members: nights, n: nights.length, added, removed, stable: added.length === 0 && removed.length === 0, digest: digestNights(nights) };
}

/** The stability of one measurement's population as ONE tepna.verdict/1 object.
 *
 *  `population` is NIGHTS: `eligible` is the UNION the run saw, `checked` the intersection it can
 *  honestly report over, `excluded` what arrived or left. The equality is what makes a moved
 *  population visible instead of invisible.
 *
 *  A move is SHORTFALL rather than FAIL deliberately: the run still describes one continuous
 *  population, the intersection, so this annotates reduced coverage instead of refusing a figure
 *  (owner ruling 2026-09-17, `CLAUDE.md` §∅ — a discontinuity refuses, reduced coverage annotates).
 *  A caller that must not narrow treats SHORTFALL as its own refusal. */
export function populationVerdict(before, after, { commit = null, commitReason = null, at = null, tool = 'tools/corpus-scope.mjs', evidence = [] } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const ev = ['tools/corpus-scope.mjs', DOC, ...evidence].filter((e, i, a) => a.indexOf(e) === i);
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  /* THE UNIT IS READ FROM THE SNAPSHOT, so one builder serves a night population and a record one and
     neither can borrow the other's words. */
  const W = unitWords(before, after);
  const names = (xs) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} and ${xs.length - 4} more` : xs.join(', '));
  let v;
  if (!before.ok || !after.ok) {
    /* `neither snapshot COULD enumerate` — the negation lives in the verb once. Read back on
       2026-10-25 from a `--from` re-aggregation, the three-way form printed "neither snapshot could
       not enumerate the root", which states the opposite of what happened. */
    const which =
      !before.ok && !after.ok ? 'neither snapshot could enumerate the root' : !before.ok ? 'the opening snapshot could not enumerate the root' : 'the closing snapshot could not enumerate the root';
    v = Verdict.make({
      gate: 'corpus-population',
      status: 'NOT_RUN',
      scope: 'internal',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: W.criterion, threshold: 0, unit: W.unit, direction: 'lte' },
      result: null,
      evidence: ev,
      reason: `${which} (${(before.ok ? after : before).reason}), so this run cannot tell a stable population from a moved one`,
      producedBy: producedByOf(tool, commit, commitReason),
      at: stamp
    });
  } else if (membersOf(before).length === 0 && membersOf(after).length === 0) {
    /* ∅ EXAMINED NOTHING IS NOT A STABLE POPULATION. Both walks succeeded and both offered no
       night, so nothing arrived and nothing left and the movement criterion is met — by a run that
       looked at nothing. `Verdict.make` refuses that `PASS` over `checked: 0` at the type level, so
       before this branch existed the primitive THREW at its own caller, and a tool pointed at an
       empty root died with a stack trace instead of reporting an empty root
       (row 2026-10-22-the-population-primitive-throws-on-an-empty-root).
       🔴 AND AN EMPTY `nights` IS NOT THE SAME FACT UNDER A DECLARED RULE: a narrow rule can refuse
       every night-shaped directory a root does hold, and "offered nothing" would then be false. The
       reason states which of the two happened, because `result` must be null on a NOT_RUN and the
       rule block cannot ride along.
       🔴 AND NEITHER IS AN EMPTY `nights` THE SAME FACT AS A ROOT KEYED ON SOMETHING ELSE. A root
       holding `sub-01`, `sub-02` and `sub-03` read exactly like an empty root here, down to the
       digest, so a record-keyed corpus was published as an emptied one (row
       2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population). The third arm
       names what the walk passed over, so the two roots no longer read alike. */
    const refusedBy = (before.rejectedNightShaped || []).concat(after.rejectedNightShaped || []);
    const refused = [...new Set(refusedBy)].sort();
    const passedBy = (before.passedOver || []).concat(after.passedOver || []);
    const passed = [...new Set(passedBy)].sort();
    const alsoPassed = passed.length ? ` and passed over ${passed.length} further entr${passed.length === 1 ? 'y' : 'ies'} (${names(passed)})` : '';
    const entries = (xs) => `${xs.length} entr${xs.length === 1 ? 'y' : 'ies'}`;
    v = Verdict.make({
      gate: 'corpus-population',
      status: 'NOT_RUN',
      scope: 'internal',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: W.criterion, threshold: 0, unit: W.unit, direction: 'lte' },
      result: null,
      evidence: ev,
      reason: refused.length
        ? `the root ${before.root} offered ${refused.length} night-shaped director${refused.length === 1 ? 'y' : 'ies'} and the caller's own rule ${before.rule} refused every one of them (${names(refused)})${alsoPassed}, so this run measured no population`
        : passed.length
          ? `the root ${before.root} enumerated ${entries(passed)} and the rule ${before.rule} matched none of them (${names(passed)}), so this run measured no population and the root may be keyed on something other than a ${W.one}`
          : `the root ${before.root} enumerated and offered no ${W.thing} at all, so this run measured no population`,
      producedBy: producedByOf(tool, commit, commitReason),
      at: stamp
    });
  } else {
    const d = intersectSnapshots(before, after);
    v = Verdict.make({
      gate: 'corpus-population',
      status: d.stable ? 'PASS' : 'SHORTFALL',
      scope: 'internal',
      /* The triple stays about THIS criterion, which is movement: `excluded` is what arrived or left
         during the run, and nothing else. A caller's own night rule is a different kind of exclusion
         and it rides `result.rule` below — folding the two into one integer would make a narrowed
         root and a moved root read the same, which is the defect one level up. */
      population: { checked: d.n, eligible: d.n + d.added.length + d.removed.length, excluded: d.added.length + d.removed.length },
      criterion: { name: W.criterion, threshold: 0, unit: W.unit, direction: 'lte' },
      result: {
        root: before.root,
        n: d.n,
        unit: W.unit,
        digest: d.digest,
        added: d.added,
        removed: d.removed,
        openedAt: before.at,
        closedAt: after.at,
        maxCtimeMs: after.maxCtimeMs,
        ...ruleBlock(before, after)
      },
      evidence: ev,
      reason: d.stable
        ? null
        : `the ${W.one} population moved during the run: ${d.added.length} arrived (${names(d.added)}), ${d.removed.length} left (${names(d.removed)}) — only the ${d.n}-${W.one} intersection is one population`,
      producedBy: producedByOf(tool, commit, commitReason),
      at: stamp
    });
  }
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`corpus-scope: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

/** What the caller's own night rule did to this population, or nothing at all when it is the
 *  default. A declared rule is a DECISION about the population, so the verdict that publishes the
 *  population publishes the decision beside it — residue
 *  `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`.
 *
 *  🔴 `rejected: []` IS A MEASUREMENT AND `rejected: null` IS NOT. A rule that bites nothing today
 *  still has to say so, because the reader's question is "what did this rule cost me", and an absent
 *  key answers it with silence. The two snapshots are the same root a few seconds apart, so a name
 *  either side rejected counts; the union is what the run actually passed over. */
function ruleBlock(before, after) {
  /* AN ENTRIES WALK HAS NO NIGHT RULE, so the two night questions do not bind and `ruleIsDefault`
     reads `null` there rather than answering a comparison nobody ran. `unit` is the discriminator,
     because `snapshotNights` carries no such key, and it stays the discriminator precisely so this
     branch never has to read a night field to decide. The lister still DECIDED the population, so
     its name goes out ALONE: no night list rides beside it to read as a measurement of something
     nobody ran. */
  const entriesUnit = before.unit ?? after.unit ?? null;
  if (entriesUnit !== null) {
    const name = before.rule === after.rule ? before.rule : `${before.rule} then ${after.rule}`;
    return {
      rule: name,
      ruleUnit: entriesUnit,
      ruleNote:
        name === null
          ? `the lister that chose this ${entriesUnit} population carries no name of its own, so the rule has none to chase; the night questions do not bind`
          : `the caller's lister IS the rule for a ${entriesUnit} population, so the night questions do not bind`
    };
  }
  if (before.ruleIsDefault !== false && after.ruleIsDefault !== false) return {};
  const union = (a, b) => (a === null || b === null ? null : [...new Set([...a, ...b])].sort());
  const rejected = union(before.rejectedNightShaped ?? null, after.rejectedNightShaped ?? null);
  const nonNight = union(before.admittedNonNight ?? null, after.admittedNonNight ?? null);
  return {
    rule: before.rule === after.rule ? before.rule : `${before.rule} then ${after.rule}`,
    ruleRejectedNightShaped: rejected,
    ruleAdmittedNonNight: nonNight,
    ruleNote:
      rejected === null || nonNight === null
        ? 'a snapshot could not enumerate the root, so the rule\u2019s effect on the population was never measured'
        : `the caller's own rule, measured against NIGHT_RE over the same listing: ${rejected.length} night-shaped name(s) refused, ${nonNight.length} non-night name(s) counted as nights`
  };
}

/** The one-line human form of the rule block, for a tool's own console. Empty string when the
 *  caller used the default rule, so a caller prints it unconditionally. */
export function ruleLine(population) {
  const r = population && population.result;
  if (!r || r.rule === undefined) return '';
  /* THE ENTRIES FORM carries no night list, and `say` below would read `undefined.length`. "The two
     night questions do not bind for this unit" is a different statement from NOT MEASURED, so it
     gets its own line rather than borrowing the unreadable-root wording. */
  if (r.ruleUnit !== undefined) return `  rule ${r.rule === null ? 'ANONYMOUS LISTER' : r.rule} — the night questions do not bind for a ${r.ruleUnit} population`;
  const say = (xs, what) => (xs === null ? `${what}: NOT MEASURED` : xs.length === 0 ? `${what}: none` : `${what}: ${xs.join(', ')}`);
  return `  rule ${r.rule} — ${say(r.ruleRejectedNightShaped, 'night-shaped names it refused')} · ${say(r.ruleAdmittedNonNight, 'non-night names it counted as nights')}`;
}

/** THE OTHER HALF OF A RULE WIDER THAN NIGHT-SHAPED, in ONE place. `ruleLine` above is the WALK's
 *  account of its own rule: it can name the non-night directories the rule let through, because the
 *  walk knows them. It cannot say which of them held nothing the READ could score, because only the
 *  read knows that — and a COUNT of removals names nothing to chase, so this names them.
 *
 *  Both device oracles answered that question with their own four-line copy, differing only in the
 *  sentence about what the night lacked, so the next widening of the question moved two files and a
 *  fix to one left the other reading the old way (row
 *  2026-10-22-the-removal-namer-is-duplicated-in-two-oracles). The node-specific half is the
 *  SENTENCE, which stays with the caller; the set arithmetic is the same in both and lives here.
 *
 *  `covered` rows carry a `night`. A row reporting its own read as failed (`ok === false`) scored
 *  nothing and is REMOVED, never counted as covered — membership alone would name it as scored. A
 *  caller whose rows have no `ok` at all, where a row's EXISTENCE is the read, is unaffected, because
 *  `undefined !== false`. There is no guard on the offer: a snapshot or a union that enumerated
 *  nothing already carries an empty `nights`, and a guard here would restate that invariant where no
 *  control can fire it — an unfireable guard reads as covered. */
export function notCovered(offer, covered, { key = 'night' } = {}) {
  const scored = new Set((covered || []).filter((r) => r && r.ok !== false).map((r) => r[key]));
  return membersOf(offer).filter((n) => !scored.has(n));
}

/** The night-unit name, kept because its callers read it and the arithmetic has ONE definition —
 *  which is the whole point of the row above. A record population passes `key: 'record'`. */
export function notANight(offer, covered) {
  return notCovered(offer, covered);
}

/** The tool tree's commit, WITH THE REASON a lookup actually failed. `null` with no reason is the
 *  one shape a consumer cannot act on, so the two facts travel together. */
export function gitCommitOf(cwd = ROOT) {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return { commit: out, reason: null };
    return { commit: null, reason: 'git rev-parse --short HEAD printed nothing for this tool tree' };
  } catch (e) {
    const why = String((e && e.message) || e).split('\n')[0];
    return { commit: null, reason: `git rev-parse --short HEAD failed for this tool tree: ${why}` };
  }
}

/** 🔴 A BORROWED REASON IS A FABRICATED CAUSE. Every verdict this module builds used to stamp
 *  `commitReason: 'not read from a git tree'` whenever the caller named no commit — and no caller
 *  does, because the primitive owns the repo root and the callers do not. So 20 wired tools
 *  published a null code identity under a cause that was FALSE of all of them: they run from inside
 *  the checkout, and `git rev-parse` answers there. The primitive resolves the commit itself now,
 *  and a reason appears only when the lookup genuinely failed, naming what failed.
 *  A caller that must disclaim code identity passes its own `commitReason` with `commit: null`.
 *  EXPORTED because three tools outside this file built the same three-branch choice by hand, and a
 *  fix to one left the others reading the old way (the `notANight` lesson re-applied). */
export function producedByOf(tool, commit, commitReason = null) {
  if (commit) return { tool, commit };
  if (commitReason) return { tool, commit: null, commitReason };
  const g = gitCommitOf();
  return g.commit ? { tool, commit: g.commit } : { tool, commit: null, commitReason: g.reason };
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (n, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`));
  };

  const doc = [
    '| path | files | what |',
    '|---|---|---|',
    '| `/srv/data/tepna-corpus/uploads/` | 900 | the superset |',
    '| `<primary checkout>/uploads` | 777 | fixture inputs |',
    '| `/run/media/…/Ecg nightly` | 1,980 | the PSL corpus |',
    '| `vigil:/srv/tepna/captures` | 6,827 | the box |',
    '| `tools/cpap-corpus.mjs` | — | a TOOL row, not a root |',
    '| **`/run/media/michal/data/Ecg-nightly-archive/CPAP`** | 192 | a mirror |'
  ].join('\n');
  const roots = parseRoots(doc);
  ok('parses every path row and skips the tool row', roots.length === 5, roots.map((r) => r.path).join(' '));
  ok(
    'a bolded path cell still parses',
    roots.some((r) => r.path.endsWith('Ecg-nightly-archive/CPAP'))
  );
  /* PLANT — the three not-countable shapes are named, not dropped. A dropped root is how the scope
     narrowed in the first place (residue 2026-09-05-triage-stamps-searched-the-repo-tree-only). */
  const why = Object.fromEntries(roots.map((r) => [r.path, r.why]));
  ok('an elided path is NOT countable and says why', why['/run/media/…/Ecg nightly'] === 'elided');
  ok('a remote root is NOT countable and says why', why['vigil:/srv/tepna/captures'] === 'remote');
  ok('a <placeholder> root is NOT countable and says why', why['<primary checkout>/uploads'] === 'elided');
  ok('a real absolute path IS countable', roots.find((r) => r.path === '/srv/data/tepna-corpus/uploads/').countable === true);

  /* PLANT — the whole defect in one assertion: a root that is not here returns null, NEVER 0. */
  ok('an absent root counts null, not 0', countUnder('/nonexistent-corpus-root-xyz', '*_ECG.txt') === null);
  ok('a real directory counts a number', typeof countUnder(ROOT, 'package.json') === 'number');

  /* PLANT — two doc rows naming ONE tree must not be summed twice (measured: 554 + 554 = 1761
     against a true 1207). The resolver is injected, so this is a rule about the rule, not the disk. */
  const aliasRows = [
    { root: '/srv/data/tepna-corpus/smoketest-captures', count: 554, why: null },
    { root: '/home/michal/tepna-smoketest/captures', count: 554, why: null },
    { root: '/srv/data/tepna-corpus/smoketest-captures/sub', count: 7, why: null },
    { root: '/elsewhere', count: 10, why: null }
  ];
  const fake = (x) => (x === '/home/michal/tepna-smoketest/captures' ? '/srv/data/tepna-corpus/smoketest-captures' : x);
  const dd = dedupeRoots(aliasRows, fake);
  ok('a symlinked duplicate root is NOT summed', dd[1].counted === false && /alias-of/.test(dd[1].why), JSON.stringify(dd[1]));
  ok('a root NESTED in another is NOT summed', dd[2].counted === false && /nested-in/.test(dd[2].why), JSON.stringify(dd[2]));
  ok('an unrelated root IS summed', dd[3].counted === true);
  ok('the duplicate is still SHOWN, not dropped', dd.length === 4 && dd[1].count === 554);
  ok('the sum counts each tree once', censusVerdict('*', dd).result.files === 564, String(censusVerdict('*', dd).result.files));

  const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const rows = [
    { root: '/a', count: 12, why: null },
    { root: '/b', count: null, why: 'absent' },
    { root: 'vigil:/c', count: null, why: 'remote' }
  ];
  const v = censusVerdict('*_ECG.txt', rows);
  ok('population is an EQUALITY over ROOTS', v.population.checked + v.population.excluded === v.population.eligible && v.population.checked === 1);
  ok('the verdict validates', V.validate(v).ok, V.validate(v).errors.join(' | '));
  ok('the byRoot table travels with the object', v.result.byRoot.length === 3 && v.result.files === 12);
  /* PLANT — every root unreachable is UNDERPOWERED, never a PASS with zero files: that is exactly
     the stamp that shipped, and it must not be emittable as a clean answer. */
  const none = censusVerdict('*_ECG.txt', [
    { root: '/b', count: null, why: 'absent' },
    { root: '/c', count: null, why: 'absent' }
  ]);
  ok('no countable root → UNDERPOWERED, never a zero-file PASS', none.status === 'UNDERPOWERED' && /cannot distinguish absence from unreachability/.test(none.reason), none.status);
  ok('an empty doc → NOT_RUN with result null', censusVerdict('*', []).status === 'NOT_RUN' && censusVerdict('*', []).result === null);

  /* ── POPULATION STABILITY ──────────────────────────────────────────────────────────────────────
     Over REAL directories, because the whole defect lives in what a listing shows and a timestamp
     does not. An old mtime is set on every fixture night and on the root itself: that is the shape
     the preserving resync produces, and a detector that reads a timestamp passes these legs while
     missing the arrival. */
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-pop-'));
  const OLD = new Date('2026-09-23T04:43:00Z');
  const night = (base, n) => {
    const d = join(base, n);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'x_ECG.txt'), 'x');
    utimesSync(join(d, 'x_ECG.txt'), OLD, OLD);
    utimesSync(d, OLD, OLD);
  };
  try {
    const root = join(tmp, 'captures');
    mkdirSync(root, { recursive: true });
    for (const n of ['2026-06-20', '2026-06-21', '2026-06-22']) night(root, n);
    writeFileSync(join(root, 'README.md'), 'not a night');
    utimesSync(root, OLD, OLD);
    const before = snapshotNights(root);
    ok('a night set is enumerated, and a non-dated entry is NOT in the population', before.ok && before.n === 3 && !before.nights.includes('README.md'), JSON.stringify(before.nights));
    const stable = populationVerdict(before, snapshotNights(root));
    ok(
      'an unmoved population → PASS with the equality holding',
      stable.status === 'PASS' && stable.result.n === 3 && stable.population.checked + stable.population.excluded === stable.population.eligible,
      stable.status
    );
    ok('a PASS carries no reason and a stable digest', stable.reason === null && stable.result.digest === before.digest);

    /* PLANT — the arrival, with EVERY timestamp preserved. This is the measured case: a night
       appearing with an mtime weeks old under a root whose own mtime never moves. */
    const rootMtimeBefore = statSync(root).mtimeMs;
    night(root, '2026-06-19');
    utimesSync(root, OLD, OLD);
    const after = snapshotNights(root);
    ok('the root mtime is UNCHANGED across the arrival — a time-keyed detector sees nothing here', statSync(root).mtimeMs === rootMtimeBefore, `${rootMtimeBefore} vs ${statSync(root).mtimeMs}`);
    const moved = populationVerdict(before, after);
    ok('an arrival → SHORTFALL, never a PASS over the bigger set', moved.status === 'SHORTFALL', moved.status);
    ok('the arrival is NAMED in the reason', /2026-06-19/.test(moved.reason) && /1 arrived/.test(moved.reason), moved.reason);
    ok(
      'the figure is scoped to the INTERSECTION, and the union is the eligible',
      moved.population.checked === 3 && moved.population.eligible === 4 && moved.population.excluded === 1,
      JSON.stringify(moved.population)
    );
    ok('the moved verdict validates', V.validate(moved).ok, V.validate(moved).errors.join(' | '));

    /* A departure is the same defect with the sign flipped — a night that leaves also breaks the
       population, and a run that only checked for arrivals would report it as stable. */
    rmSync(join(root, '2026-06-20'), { recursive: true, force: true });
    const gone = populationVerdict(before, snapshotNights(root));
    ok('a departure → SHORTFALL naming it', gone.status === 'SHORTFALL' && /2026-06-20/.test(gone.reason) && /1 left/.test(gone.reason), gone.reason);

    /* An absent root is NOT an empty population (§∅) — a zero here would read as "the corpus
       emptied mid-run", which is the kind of in-band number the rule exists to forbid. */
    const nope = snapshotNights(join(tmp, 'no-such-root'));
    ok('an unreadable root → ok:false with a named reason, never n:0 as a fact', nope.ok === false && nope.n === 0 && /not enumerable/.test(nope.reason));
    const notrun = populationVerdict(nope, nope);
    ok(
      'a verdict over an unreadable root → NOT_RUN with result null',
      notrun.status === 'NOT_RUN' && notrun.result === null && /cannot tell a stable population from a moved one/.test(notrun.reason),
      notrun.status
    );
    ok('the NOT_RUN verdict validates', V.validate(notrun).ok, V.validate(notrun).errors.join(' | '));

    /* PLANT — A READABLE ROOT THAT OFFERED NOTHING. The two walks agree, so the movement criterion
       is met over a run that examined nothing, and `Verdict.make` refuses that `PASS` at the type
       level: the primitive used to THROW here and kill its caller with a stack trace instead of
       reporting an empty root. Three legs, because the repair must not quietly turn a real
       population into NOT_RUN either. */
    const bare = join(tmp, 'offered-nothing');
    mkdirSync(bare, { recursive: true });
    const nothing = populationVerdict(snapshotNights(bare), snapshotNights(bare));
    ok('an empty but READABLE root → NOT_RUN, never PASS over checked 0, and never a throw', nothing.status === 'NOT_RUN' && nothing.population.checked === 0, nothing.status);
    ok(
      'the empty-root NOT_RUN validates and states what was offered, not what failed',
      V.validate(nothing).ok && /offered no night directory at all/.test(nothing.reason),
      V.validate(nothing).errors.join(' | ') || nothing.reason
    );
    ok(
      'and it reads differently from the unreadable root — nobody looked is not nothing was there',
      /not enumerable/.test(notrun.reason) && !/not enumerable/.test(nothing.reason) && nothing.result === null,
      `${nothing.reason} || ${notrun.reason}`
    );
    /* PLANT — THE OTHER WAY TO OFFER NO NIGHT. The root holds two night-shaped directories and the
       caller's rule refuses both, so `nights` is empty for a reason the first reason would misstate. */
    night(bare, '2025-12-31');
    night(bare, '2025-12-30');
    const refusedAll = populationVerdict(snapshotNights(bare, { re: /^2026-/ }), snapshotNights(bare, { re: /^2026-/ }));
    ok(
      'a rule that refused every night-shaped directory says SO, and names them, rather than claiming the root was empty',
      refusedAll.status === 'NOT_RUN' && /refused every one of them/.test(refusedAll.reason) && /2025-12-30/.test(refusedAll.reason),
      refusedAll.reason
    );
    rmSync(join(bare, '2025-12-31'), { recursive: true, force: true });
    rmSync(join(bare, '2025-12-30'), { recursive: true, force: true });
    night(bare, '2026-07-04');
    ok(
      'CONTROL · one night under that same root → PASS over a population of 1, so the branch binds on emptiness alone',
      populationVerdict(snapshotNights(bare), snapshotNights(bare)).status === 'PASS'
    );
    /* PLANT — THE THIRD WAY TO OFFER NO NIGHT, and the one the DEFAULT rule had no words for. This
       root is keyed on records, so the default rule matches nothing: `nights` is empty for a reason
       neither sentence above states, and before the third bin this root and `offered-nothing` above
       published the same digest under the same words (row
       2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population). */
    const recordKeyed = join(tmp, 'record-keyed');
    mkdirSync(recordKeyed, { recursive: true });
    for (const r of ['sub-01', 'sub-02', 'sub-03']) mkdirSync(join(recordKeyed, r), { recursive: true });
    const rk = snapshotNights(recordKeyed);
    ok(
      'a record-keyed root NAMES what the default rule passed over, under the default rule',
      rk.ok === true && rk.n === 0 && rk.ruleIsDefault === true && rk.passedOver.join() === 'sub-01,sub-02,sub-03',
      JSON.stringify(rk.passedOver)
    );
    const vrk = populationVerdict(rk, snapshotNights(recordKeyed), { tool: 'selftest' });
    ok(
      'and its verdict names the three entries instead of publishing an emptied corpus',
      vrk.status === 'NOT_RUN' && /enumerated 3 entries/.test(vrk.reason) && /sub-02/.test(vrk.reason) && V.validate(vrk).ok,
      vrk.reason
    );
    ok(
      'ANTI-FIX CONTROL · the two roots no longer read alike, though the digest alone still cannot tell them apart',
      !/offered no night directory at all/.test(vrk.reason) && /offered no night directory at all/.test(nothing.reason) && rk.digest === digestNights([]),
      `${vrk.reason} || ${nothing.reason}`
    );
    /* The nsrr shape: a record root holds FILES, so a bin built from the directory listing alone
       would have left exactly this root reading as empty. */
    writeFileSync(join(recordKeyed, 'ucddb002.rec'), 'x');
    const rkFile = snapshotNights(recordKeyed);
    ok(
      'a FILE no rule counted is named too, so a record root of files is not an emptied corpus either',
      rkFile.n === 0 && rkFile.passedOver.join() === 'sub-01,sub-02,sub-03,ucddb002.rec',
      JSON.stringify(rkFile.passedOver)
    );
    ok('the digest is order-free', digestNights(['b', 'a']) === digestNights(['a', 'b']) && digestNights(['2026-06-20', '2026-06-21']) !== digestNights(['2026-06-20']));

    /* ── WHAT THE CALLER'S OWN RULE DID ────────────────────────────────────────────────────────
       Residue `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`. A rule is
       applied inside the walk, so before this the snapshot was the narrowed set and the narrowing
       left no trace. The root below holds both hazards at once: a 2027 night a `^2026-` rule
       refuses, and a plain directory a `/./` rule swallows. */
    const ruled = join(tmp, 'ruled');
    mkdirSync(ruled, { recursive: true });
    for (const n of ['2026-06-20', '2026-06-21', '2027-01-04']) night(ruled, n);
    mkdirSync(join(ruled, 'scratch'), { recursive: true });
    writeFileSync(join(ruled, 'NOTES.txt'), 'x');

    const dflt = snapshotNights(ruled);
    ok(
      'the DEFAULT rule says so, and asks neither question',
      dflt.ruleIsDefault === true && dflt.n === 3 && dflt.rejectedNightShaped.length === 0 && dflt.admittedNonNight.length === 0,
      JSON.stringify(dflt.rule)
    );
    ok('a default-rule verdict carries NO rule block — nothing was decided to report', populationVerdict(dflt, snapshotNights(ruled)).result.rule === undefined);

    const narrow = snapshotNights(ruled, { re: /^2026-/ });
    ok('a NARROWER rule still scores its own set', narrow.n === 2 && !narrow.nights.includes('2027-01-04'), JSON.stringify(narrow.nights));
    ok(
      '…and the night it refused is NAMED, not absent',
      narrow.ruleIsDefault === false && narrow.rejectedNightShaped.join() === '2027-01-04' && narrow.admittedNonNight.length === 0,
      JSON.stringify(narrow.rejectedNightShaped)
    );
    const vNarrow = populationVerdict(narrow, snapshotNights(ruled, { re: /^2026-/ }), { tool: 'selftest' });
    ok(
      'the verdict publishes the rule beside the population',
      vNarrow.result.rule === '/^2026-/' && vNarrow.result.ruleRejectedNightShaped.join() === '2027-01-04',
      JSON.stringify(vNarrow.result.rule)
    );
    ok(
      '…and the scored set did NOT move: a declared rule is not a population movement',
      vNarrow.status === 'PASS' && vNarrow.population.checked === 2 && vNarrow.population.excluded === 0,
      `${vNarrow.status} ${JSON.stringify(vNarrow.population)}`
    );
    ok('the narrowed verdict validates', V.validate(vNarrow).ok, V.validate(vNarrow).errors.join(' | '));

    const wide = snapshotNights(ruled, { re: /./ });
    ok(
      'a WIDER rule counts a plain directory as a night, and says which one',
      wide.n === 4 && wide.admittedNonNight.join() === 'scratch' && wide.rejectedNightShaped.length === 0,
      JSON.stringify(wide.admittedNonNight)
    );
    /* THE INVARIANT THE THIRD BIN BUYS: the three name lists PARTITION the listing under every
       rule, so no name can go uncounted the way `scratch` did under the default rule. */
    const partitioned = (snap, all) => {
      const bins = [...snap.nights, ...snap.rejectedNightShaped, ...snap.passedOver].sort();
      return bins.length === all.length && bins.join() === [...all].sort().join();
    };
    const everyDir = ['2026-06-20', '2026-06-21', '2027-01-04', 'scratch', 'NOTES.txt'];
    ok(
      'nights · rejected · passedOver partition the whole listing under the default, a narrower and a wider rule',
      partitioned(dflt, everyDir) && partitioned(narrow, everyDir) && partitioned(wide, everyDir),
      `${JSON.stringify(dflt.passedOver)} ${JSON.stringify(narrow.passedOver)} ${JSON.stringify(wide.passedOver)}`
    );
    const vWide = populationVerdict(wide, snapshotNights(ruled, { re: /./ }), { tool: 'selftest' });
    ok(
      'the verdict names the non-night it swallowed',
      vWide.result.ruleAdmittedNonNight.join() === 'scratch' && /1 non-night name\(s\) counted as nights/.test(vWide.result.ruleNote),
      vWide.result.ruleNote
    );

    /* ∅ — a rule whose effect nobody could measure is `null`, never an empty list. An empty list
       here would read as "the rule rejected nothing", which the failed walk never established. */
    const nopeRuled = snapshotNights(join(tmp, 'no-such-root'), { re: /^2026-/ });
    ok(
      'an unreadable root leaves the rule effect NULL, never [] — and that covers the third bin too',
      nopeRuled.ok === false && nopeRuled.rejectedNightShaped === null && nopeRuled.admittedNonNight === null && nopeRuled.passedOver === null
    );

    /* CONTROL — the real root this residue row was written about. The rule is a no-op here today,
       and that is a MEASUREMENT: the row claimed the corpus already held nights outside 2026. */
    const trio = join(ROOT, 'uploads', 'trio');
    if (existsSync(trio)) {
      const real = snapshotNights(trio, { re: /^2026-/ });
      ok(
        'CONTROL · the ^2026- rule refuses no night under uploads/trio today, over a non-empty root',
        real.ok && real.n > 100 && real.rejectedNightShaped.length === 0 && real.admittedNonNight.length === 0,
        `n=${real.n} rejected=${JSON.stringify(real.rejectedNightShaped)}`
      );
      /* The exact line `tools/tch-reference-validation.mjs` prints. That tool refuses before its
         own walk on any box without the Polar nightly corpus (residue
         `2026-10-21-the-reference-validation-population-path-runs-on-no-box-here`), so this is
         where the rendered string gets pinned. */
      const line = ruleLine(populationVerdict(real, snapshotNights(trio, { re: /^2026-/ }), { tool: 'selftest' }));
      ok(
        'CONTROL · and the printed line says `none` rather than staying silent',
        /^ {2}rule \/\^2026-\/ — night-shaped names it refused: none · non-night names it counted as nights: none$/.test(line),
        JSON.stringify(line)
      );
    }
    /* ── THE REMOVAL NAMER, ONE IMPLEMENTATION FOR BOTH ORACLE SHAPES ──────────────────────────
       Row 2026-10-22-the-removal-namer-is-duplicated-in-two-oracles. The two callers differ in one
       thing only: the ECG pair list has no `ok`, because a pair's existence IS the read, while the
       PPG row list carries the read's own verdict. Both shapes are pinned here, so a widening of the
       question moves one file. */
    const offered = { n: 3, nights: ['2026-07-25', '2026-07-26', 'logs'] };
    ok('the read removed two of three, and the namer NAMES them rather than counting them', notANight(offered, [{ night: '2026-07-25' }]).join(',') === '2026-07-26,logs');
    ok(
      'a row whose own read failed is removed too, never counted as covered',
      notANight(offered, [{ night: '2026-07-25', ok: false }]).length === 3,
      JSON.stringify(notANight(offered, [{ night: '2026-07-25', ok: false }]))
    );
    ok('CONTROL · the same row with ok true is covered, so the two shapes read differently', notANight(offered, [{ night: '2026-07-25', ok: true }]).join(',') === '2026-07-26,logs');
    ok('CONTROL · an offer that enumerated nothing names no removal', notANight({ n: 0, nights: [] }, []).length === 0);
    ok('a covered night the offer never held cannot appear: the difference runs offer minus read', notANight(offered, [{ night: '2099-01-01' }]).length === 3);

    /* ── A POPULATION WHOSE UNIT IS NOT A NIGHT ────────────────────────────────────────────────
       Row 2026-10-21-forty-one-corpus-enumerators-report-no-population. `tools/stage-lab.mjs` walks
       six external PSG archives and none of them holds a night directory, so the night walk over any
       of their roots answers `ok: true, n: 0` — a dataset of records published as empty. The cases
       below pin the three facts a record population needs: the members come from the caller's own
       lister, the criterion and the prose say `records`, and an unreadable root REFUSES rather than
       reporting a population of zero. The night control beside them is what makes the first fact a
       measurement: both calls run over the SAME planted root. */
    const recRoot = join(tmp, 'psg');
    mkdirSync(recRoot, { recursive: true });
    const recFiles = ['ucddb002.rec', 'ucddb003.rec', 'ucddb002_stage.txt'];
    for (const f of recFiles) writeFileSync(join(recRoot, f), 'x');
    const recList = (d) =>
      readdirSync(d)
        .filter((f) => /^ucddb\d+\.rec$/.test(f))
        .map((f) => f.slice(0, -4));
    const recBefore = snapshotEntries(recRoot, { list: recList, unit: 'records' });
    ok('a record snapshot counts what the caller enumerates, sorted', recBefore.ok && recBefore.n === 2 && recBefore.members.join(',') === 'ucddb002,ucddb003', JSON.stringify(recBefore.members));
    ok('and it carries no key named for a unit it does not have', recBefore.nights === undefined && recBefore.unit === 'records', JSON.stringify(Object.keys(recBefore)));
    /* The night walk over a record root still reads `ok` with a population of zero — `nights` must
       not move for a caller who asked for nights — but the zero no longer stands alone: the names it
       passed over ride beside it (row
       2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population). */
    const recAsNights = snapshotNights(recRoot);
    ok(
      'the night walk over a record root reads ok with a population of zero, and NAMES what it passed over',
      recAsNights.ok === true && recAsNights.n === 0 && recAsNights.passedOver.join() === [...recFiles].sort().join(),
      JSON.stringify(recAsNights.passedOver)
    );
    ok('and the RECORD snapshot of that same root asks no night question at all', recBefore.passedOver === null && recBefore.rejectedNightShaped === null, JSON.stringify(recBefore.passedOver));
    const recStable = populationVerdict(recBefore, snapshotEntries(recRoot, { list: recList }), { tool: 'selftest' });
    ok(
      'a stable record population passes under a records criterion',
      recStable.status === 'PASS' && recStable.criterion.name === 'records_added_or_removed' && recStable.criterion.unit === 'records',
      JSON.stringify(recStable.criterion)
    );
    ok('and the result says which unit it counted', recStable.result.unit === 'records' && recStable.result.n === 2, JSON.stringify(recStable.result.unit));
    ok(
      'CONTROL · a night population still publishes the key its readers index on',
      populationVerdict(snapshotNights(join(tmp, 'root')), snapshotNights(join(tmp, 'root'))).criterion.name === 'nights_added_or_removed'
    );
    writeFileSync(join(recRoot, 'ucddb004.rec'), 'x');
    const recMoved = populationVerdict(recBefore, snapshotEntries(recRoot, { list: recList }), { tool: 'selftest' });
    ok(
      'an arriving record is SHORTFALL, and the reason says record where it used to say night',
      recMoved.status === 'SHORTFALL' && recMoved.reason.indexOf('the record population moved during the run') === 0 && recMoved.reason.indexOf('only the 2-record intersection') > 0,
      recMoved.reason
    );
    const recGone = snapshotEntries(join(tmp, 'no-such-psg'), { list: recList });
    ok('an unreadable record root refuses and never reports zero records', recGone.ok === false && recGone.n === 0 && /not enumerable/.test(recGone.reason || ''), JSON.stringify(recGone.reason));
    ok(
      'a record root that enumerated nothing is NOT_RUN, and the reason names the record',
      populationVerdict(snapshotEntries(bare, { list: () => [] }), snapshotEntries(bare, { list: () => [] })).reason.indexOf('offered no record at all') > 0
    );
    ok(
      'the removal namer serves both units from one definition',
      notCovered({ members: ['a', 'b'] }, [{ record: 'a' }], { key: 'record' }).join(',') === 'b' && notANight(offered, [{ night: '2026-07-25' }]).join(',') === '2026-07-26,logs'
    );
    ok(
      'a lister is the enumeration, so its absence throws rather than reporting an empty population',
      (() => {
        try {
          snapshotEntries(recRoot, {});
          return false;
        } catch (e) {
          return /IS the enumeration/.test(e.message);
        }
      })()
    );

    /* THE LISTER IS THE RULE, AND THE SNAPSHOT NOW NAMES IT. Row
       2026-10-26-the-entries-walk-drops-the-lister-that-chose-it: `rule: null` dropped the one
       decision an entries caller makes, and `ruleBlock` could not publish it either, so a reader of
       either live verdict could not tell a wide lister from a narrow one. */
    ok('a named lister reaches the snapshot as the rule', recBefore.rule === 'recList', JSON.stringify(recBefore.rule));
    /* 🔴 A PROPERTY KEY IS NOT A LISTER NAME. `{ list: (d) => ... }` infers `list`, so the naive
       read would publish a rule the caller never wrote. Both arms below must read null. */
    const mkAnon = () => (d) => readdirSync(d);
    ok('an inline lister reads null, because its only name is the parameter it was passed as', snapshotEntries(recRoot, { list: (d) => readdirSync(d) }).rule === null);
    ok('and a genuinely nameless lister reads null too, with no sentinel standing in for a name', snapshotEntries(recRoot, { list: mkAnon() }).rule === null);
    const rSnap = snapshotEntries(recRoot, { list: recList });
    const recRule = populationVerdict(rSnap, snapshotEntries(recRoot, { list: recList }), { tool: 'selftest' }).result;
    ok(
      'and the VERDICT publishes that name, with no night list beside it to read as a measurement',
      recRule.rule === 'recList' && recRule.ruleUnit === 'records' && recRule.ruleRejectedNightShaped === undefined && recRule.ruleAdmittedNonNight === undefined,
      JSON.stringify({ rule: recRule.rule, unit: recRule.ruleUnit })
    );
    ok('the note says the night questions do not bind, never that nobody measured them', /do not bind/.test(recRule.ruleNote) && !/never measured/.test(recRule.ruleNote), recRule.ruleNote);
    ok(
      'the one-line form reads the entries shape instead of subscripting a list it never had',
      ruleLine({ result: recRule }) === '  rule recList — the night questions do not bind for a records population',
      ruleLine({ result: recRule })
    );
    ok(
      'a nameless lister says so on that line rather than printing a bare null',
      (() => {
        const a = snapshotEntries(recRoot, { list: mkAnon() });
        const line = ruleLine({ result: populationVerdict(a, snapshotEntries(recRoot, { list: mkAnon() }), { tool: 'selftest' }).result });
        return /ANONYMOUS LISTER/.test(line) && !/null/.test(line);
      })()
    );
    ok(
      'CONTROL · a NIGHT verdict under a narrowed rule keeps both night lists and carries no unit',
      (() => {
        /* TWO WAYS THIS CONTROL READ AS COVERED BEFORE IT COULD FIRE. A root with no night-shaped
           directory makes the verdict NOT_RUN with `result: null`, and the shared root above gains
           directories from earlier legs, so an exact list could never be pinned to it. So plant one. */
        const nr = join(tmp, 'rule-control');
        mkdirSync(join(nr, '2026-07-25'), { recursive: true });
        mkdirSync(join(nr, '2026-07-26'), { recursive: true });
        const narrow = { re: /^2026-07-25$/ };
        const w = populationVerdict(snapshotNights(nr, narrow), snapshotNights(nr, narrow), { tool: 'selftest' }).result;
        return w !== null && w.ruleUnit === undefined && Array.isArray(w.ruleAdmittedNonNight) && Array.isArray(w.ruleRejectedNightShaped) && w.ruleRejectedNightShaped.join() === '2026-07-26';
      })()
    );

    /* A NIGHT-RULE ANSWER OVER A POPULATION THAT HAS NO NIGHT RULE. Row
       2026-10-26-the-entries-walk-asserts-a-night-rule-answer-it-never-computed: both entries arms
       wrote `ruleIsDefault: true`, which claims a comparison against `NIGHT_RE` that nobody ran for
       a listing not keyed on dates. §∅ reaches the verdict layer, so the field reads `null` and the
       reader can tell a night answer from no night answer at all. */
    ok('an entries snapshot gives no night-rule answer rather than asserting the default one', rSnap.ruleIsDefault === null && rSnap.ruleIsDefault !== true, JSON.stringify(rSnap.ruleIsDefault));
    ok(
      'and its refusal arm says the same, because a walk that never ran compared nothing either',
      recGone.ok === false && recGone.ruleIsDefault === null,
      JSON.stringify({ ok: recGone.ok, ruleIsDefault: recGone.ruleIsDefault })
    );
    /* THE TWO ∅ FIELDS IN ONE LITERAL HAVE TO AGREE. `passedOver` already read null for exactly this
       reason two lines below, and the disagreement is what made `true` legible as a measurement. */
    ok(
      'the two absent-by-construction fields of an entries snapshot agree with each other',
      rSnap.ruleIsDefault === null && rSnap.passedOver === null && rSnap.rejectedNightShaped === null && rSnap.admittedNonNight === null
    );
    /* THE DISCRIMINATOR IS STILL `unit`, so dropping the night answer costs the verdict nothing. A
       branch that had read the night field would have gone silent on this very change. */
    ok(
      'the verdict still publishes the lister, so the entries branch never read the night field',
      recRule.rule === 'recList' && recRule.ruleUnit === 'records',
      JSON.stringify({ rule: recRule.rule, unit: recRule.ruleUnit })
    );
    ok(
      'CONTROL · a NIGHT snapshot still ANSWERS the question, both ways, so null is not a blanket',
      (() => {
        const nr2 = join(tmp, 'rule-default-control');
        mkdirSync(join(nr2, '2026-07-25'), { recursive: true });
        const d = snapshotNights(nr2);
        const n = snapshotNights(nr2, { re: /^2026-07-25$/ });
        return d.ruleIsDefault === true && n.ruleIsDefault === false;
      })()
    );

    /* THE CODE IDENTITY, AND THE REASON FOR ITS ABSENCE. A reason that names a cause the run cannot
       have had is worse than no reason, so the CONTROL below must be able to fire: a directory that
       is genuinely outside a git tree has to produce a null commit WITH a reason that names the
       failure. Without that leg the honest-reason guard is unfireable and reads as covered. */
    const snap = snapshotNights(join(tmp, 'root'));
    const live = populationVerdict(snap, snap, { tool: 'tools/corpus-scope.mjs' });
    ok(
      'a caller that names no commit gets the tool tree own commit, and NO reason is invented for it',
      /^[0-9a-f]{7,40}$/.test(String(live.producedBy.commit)) && live.producedBy.commitReason === undefined,
      JSON.stringify(live.producedBy)
    );
    const stated = populationVerdict(snap, snap, { tool: 'tools/corpus-scope.mjs', commit: 'deadbee' });
    ok('an explicitly stated commit wins over the lookup', stated.producedBy.commit === 'deadbee' && stated.producedBy.commitReason === undefined);
    const disclaimed = populationVerdict(snap, snap, { tool: 'tools/corpus-scope.mjs', commitReason: 'a fabricated sample claims no code identity' });
    ok(
      'a caller that disclaims code identity keeps its OWN reason verbatim',
      disclaimed.producedBy.commit === null && disclaimed.producedBy.commitReason === 'a fabricated sample claims no code identity'
    );
    const outside = gitCommitOf('/');
    ok(
      'CONTROL · outside a git tree the commit is null AND the reason names the failure, never a borrowed sentence',
      outside.commit === null && typeof outside.reason === 'string' && /rev-parse/.test(outside.reason),
      JSON.stringify(outside)
    );
    ok('CONTROL · inside the tool tree the same reader answers a commit and no reason', /^[0-9a-f]{7,40}$/.test(String(gitCommitOf().commit)) && gitCommitOf().reason === null);
    const refused = populationVerdict(snapshotNights(join(tmp, 'absent-root')), snapshotNights(join(tmp, 'absent-root')), { tool: 'tools/corpus-scope.mjs' });
    ok(
      'the NOT_RUN leg carries the same resolved identity, so a refusal is still attributable',
      refused.status === 'NOT_RUN' && /^[0-9a-f]{7,40}$/.test(String(refused.producedBy.commit)),
      JSON.stringify(refused.producedBy)
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(fail ? `\n${fail} FAILURE(S)` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json'], positional: true }, { tool: 'corpus-scope' });
  if (argv.includes('--selftest')) process.exit(selftest());
  /* The corpus-free sample the adoption gate runs: the measured 2026-09-22 shape — one countable
     tree, one alias of it, one remote root — which is the case the residue is about. */
  if (argv.includes('--verdict-sample')) {
    const rows = dedupeRoots(
      [
        { root: '/srv/data/tepna-corpus/smoketest-captures', count: 554, why: null },
        { root: '/home/michal/tepna-smoketest/captures', count: 554, why: null },
        { root: 'vigil:/srv/tepna/captures', count: null, why: 'remote' }
      ],
      (x) => (x === '/home/michal/tepna-smoketest/captures' ? '/srv/data/tepna-corpus/smoketest-captures' : x)
    );
    console.log(JSON.stringify(censusVerdict('*_ECG.txt', rows), null, 2));
    return;
  }
  const pattern = argv.find((a) => !a.startsWith('--'));
  if (!pattern) {
    console.error("usage: node tools/corpus-scope.mjs '<find -name pattern>' [--json]");
    process.exit(2);
  }
  const docPath = join(ROOT, DOC);
  const roots = existsSync(docPath) ? parseRoots(readFileSync(docPath, 'utf8')) : [];
  const rows = roots.map((r) => {
    const count = r.countable ? countUnder(resolve(r.path), pattern) : null;
    return { root: r.path, count, why: r.countable ? (count === null ? 'absent' : null) : r.why };
  });
  const deduped = dedupeRoots(rows, (x) => realpathSync(resolve(x)));
  const v = censusVerdict(pattern, deduped);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  console.log(`corpus census · pattern ${pattern} · roots from ${DOC}\n`);
  for (const r of deduped) console.log(`  ${r.count === null ? 'NOT COUNTABLE HERE'.padEnd(12) : String(r.count).padStart(12)}  ${r.root}${r.why ? `   (${r.why})` : ''}`);
  console.log(
    `\n  ${v.result.files} file(s) across ${v.result.summedRoots} DISTINCT tree(s), from ${v.population.eligible} documented root(s): ` +
      `${v.population.excluded} not countable here, ${v.population.checked - v.result.summedRoots} an alias or subtree of another.`
  );
  console.log('  A count that does not name its roots is not a count — quote this scope with the number.');
}

if (isCliEntry(import.meta.url)) main();
