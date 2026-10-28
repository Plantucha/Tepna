// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// corpus-scope-core.mjs — the population half of corpus-scope: snapshots, verdicts, rule lines and
// the code identity they stamp. Split out of `corpus-scope.mjs` so that importing it costs a tool
// nothing.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS: THE REMEDY FOR ONE DEFECT WAS REMOVING THE CHECK FOR ANOTHER. Residue
// `2026-10-26-wiring-a-population-verdict-costs-the-probe-safety-that-made-it-cheap`. A tool that
// reports its population imports `populationVerdict`, and `closureHazards` in tools/argv-survey.mjs
// tests its hazard patterns against the WHOLE FILE TEXT of every module in an import closure. The
// old single module shelled out to `find` and to `git`, so every importer read `exec,fs-write` and
// left `inertPopulation` — the corpus-free probe population. Wiring a tool to report its population
// therefore took it out of the set a probe could verify, which is the free half the backlog was
// sized by.
//
// 🔴 AND THE SPLIT THE ROW NAMED DOES NOT EXIST. The row said to cut the pure verdict half from the
// git half. The verdict half CALLS the git half: `populationVerdict` and `censusVerdict` route
// through `producedByOf`, which falls back to the commit reader. That fallback is deliberate and
// load-bearing (see `producedByOf`). So the cut only works if the commit read is itself pure, which
// is what `gitCommitOf` below does.
//
// THE BAR FOR THIS FILE, and the suite asserts it: nothing in this text may write, exec or fetch.
// `tools/corpus-scope.mjs` keeps `countUnder` (which runs `find`), the CLI and the selftest, and
// re-exports everything here, so no caller of the old module changed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/* ⚠️ THE DOC LISTS THE SAME TREE TWICE, AND SUMMING ROOTS DOUBLE-COUNTS IT. Measured on this tool's
   first real run: a smoketest capture tree under a home directory and `/srv/data/tepna-corpus/smoketest-captures/`
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
/** Night-shaped directories under a root AT ANY DEPTH — a DIFFERENT walk from `snapshotNights`,
 *  and deliberately not a replacement for it. That primitive reads ONE level, because a scorer's
 *  population is the night directories its own `--dir` offers directly, and widening it would change
 *  what eleven shipped tools score. A CENSUS asks a different question — how big is the corpus — and
 *  the corpus NESTS: `uploads/` holds 180 night-shaped directories and a `readdirSync` of it names
 *  none of them, so a one-level census publishes an understatement as a measurement. Row
 *  2026-10-26-the-327-night-shaped-figure-counts-directories-over-two-scopes is that failure one
 *  level up. This walk is recursive and its verdict STATES its depth beside the number.
 *
 *  ∅ A root this machine cannot walk yields `null`, never `0`. "Nobody looked" and "the corpus holds
 *  none" are different statements, and the second is the one a later reader reuses as a size.
 *
 *  PURE given `lister`, which is REQUIRED and injected. This module must not shell out: the header
 *  above records that `closureHazards` reads the whole text of every module in an importer's
 *  closure, so a `find` here would mark all eleven scorers `exec`. The shipped lister that does walk
 *  a filesystem lives in `tools/corpus-scope.mjs`. */
export function nightDirsUnder(root, { re = NIGHT_RE, lister } = {}) {
  if (typeof lister !== 'function') {
    throw new TypeError('nightDirsUnder: a lister is required — this module never walks a filesystem itself');
  }
  const found = lister(root);
  if (found === null || found === undefined) {
    return { ok: false, root, reason: 'root not walkable from this machine', directories: null, names: null, rule: String(re) };
  }
  const dirs = found.filter((n) => re.test(n));
  return { ok: true, root, reason: null, directories: dirs.length, names: [...new Set(dirs)].sort(), rule: String(re) };
}

/** The corpus size as ONE `tepna.verdict/1` object, in the TWO UNITS the 327 figure conflated.
 *  `directories` counts night-shaped directories and `distinctNames` counts the names they carry;
 *  the published figure summed the first and was read as the second. Neither is called a night
 *  count, because a name says a directory exists and eligibility needs the streams inside it. */
export function nightCensusVerdict(rows, { commit = null, commitReason = null, rule = String(NIGHT_RE), depth = 'recursive', tool = 'tools/corpus-scope.mjs' } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const counted = rows.filter((r) => r.directories !== null && r.directories !== undefined);
  /* A root that aliases or nests inside another is COUNTED and NOT SUMMED, the rule `dedupeRoots`
     states — hiding it would make the scope smaller than the doc says it is. */
  const summed = counted.filter((r) => r.counted !== false);
  const directories = summed.reduce((a, r) => a + r.directories, 0);
  const names = new Set();
  for (const r of summed) for (const n of r.names || []) names.add(n);
  const sorted = [...names].sort();
  const excluded = rows.length - counted.length;
  let status;
  let reason;
  if (rows.length === 0) {
    status = 'NOT_RUN';
    reason = `${DOC} listed no corpus roots — the doc could not be parsed`;
  } else if (counted.length === 0) {
    status = 'UNDERPOWERED';
    reason = `none of the ${rows.length} documented root(s) is walkable from this machine, so this run cannot distinguish an empty corpus from an unreachable one`;
  } else {
    status = 'PASS';
    reason = null;
  }
  const v = Verdict.make({
    gate: 'corpus-night-census',
    status,
    scope: 'internal',
    population: { checked: counted.length, eligible: rows.length, excluded },
    criterion: { name: 'documented_roots_walked', threshold: rows.length, unit: '', direction: 'eq' },
    result:
      status === 'NOT_RUN'
        ? null
        : { directories, distinctNames: sorted.length, summedRoots: summed.length, depth, rule, earliest: sorted[0] ?? null, latest: sorted[sorted.length - 1] ?? null, byRoot: rows },
    evidence: [tool, DOC],
    reason,
    producedBy: producedByOf(tool, commit, commitReason)
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`corpus-scope: night census verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

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
 *  one shape a consumer cannot act on, so the two facts travel together.
 *
 *  🔴 READ FROM `.git`, NEVER SHELLED OUT FOR, AND THAT IS THIS FILE'S WHOLE REASON TO EXIST. One
 *  `execFileSync` anywhere in this text would put `exec` back in every importer's closure and undo
 *  the split. `tools/corpus-scope.mjs` keeps the `git rev-parse` reader as `gitCommitOfExec`, and
 *  the selftest there asserts THIS function agrees with it — in the primary checkout and in a
 *  worktree, whose `.git` is a file rather than a directory.
 *
 *  ⚠️ IT PUBLISHES THE FULL 40-HEX SHA, where the exec reader published `--short`. Git picks that
 *  width from the repository's object count, so no reader that does not run git can reproduce it,
 *  and a fixed cut would hide the same change while giving nothing back (Kestrel, board #1642).
 *  Every consumer in this repo already accepts `[0-9a-f]{7,40}`, and `pr-compliance`'s freshness
 *  check resolves the value through git, which takes either form.
 *
 *  🔴 AN UNKNOWN LAYOUT REFUSES BY NAME (§∅). A reftable store, a `.git` that is neither file nor
 *  directory, an unborn branch and a ref that resolves nowhere each return `commit: null` with the
 *  rail that failed. A guessed commit is worse than an absent one. */
export function gitCommitOf(cwd = ROOT) {
  const g = _gitDirOf(cwd);
  if (!g.dir) return { commit: null, reason: g.reason };
  let head;
  try {
    head = readFileSync(join(g.dir, 'HEAD'), 'utf8').trim();
  } catch (e) {
    const why = String((e && e.message) || e).split('\n')[0];
    if (existsSync(join(g.dir, 'reftable'))) return { commit: null, reason: `this tool tree uses a reftable ref store, which this reader does not read: ${why}` };
    return { commit: null, reason: `HEAD is unreadable in this tool tree: ${why}` };
  }
  if (_SHA40.test(head)) return { commit: head, reason: null };
  const m = /^ref:\s*(\S+)$/.exec(head);
  if (!m) return { commit: null, reason: `HEAD in this tool tree holds neither a 40-hex sha nor a 'ref:' line` };
  const sha = _resolveRef(g.dir, m[1], 0);
  if (sha) return { commit: sha, reason: null };
  return { commit: null, reason: `${m[1]} resolves to no sha in the loose refs or packed-refs of this tool tree` };
}

const _SHA40 = /^[0-9a-f]{40}$/;

/** The git directory for `start`, walking up like git does. A WORKTREE'S `.git` IS A FILE holding
 *  `gitdir: <path>`, and every bird works in a worktree, so that is the common case here, not the
 *  exotic one. */
function _gitDirOf(start) {
  let d = resolve(start);
  for (;;) {
    const g = join(d, '.git');
    let st = null;
    try {
      st = statSync(g);
    } catch {
      st = null;
    }
    if (st && st.isDirectory()) return { dir: g, reason: null };
    if (st && st.isFile()) {
      let txt = '';
      try {
        txt = readFileSync(g, 'utf8');
      } catch (e) {
        return { dir: null, reason: `${g} is a file this reader cannot read: ${String((e && e.message) || e).split('\n')[0]}` };
      }
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(txt);
      if (!m) return { dir: null, reason: `${g} is a file with no 'gitdir:' line` };
      return { dir: resolve(d, m[1]), reason: null };
    }
    if (st) return { dir: null, reason: `${g} is neither a directory nor a file` };
    const up = dirname(d);
    if (up === d) return { dir: null, reason: `no .git exists at or above ${resolve(start)}` };
    d = up;
  }
}

/** A ref to a sha over the three rails git uses, in git's own order: the worktree's own gitdir, the
 *  common dir it names, then `packed-refs`. A symref chain is followed, with a depth cap so a cycle
 *  refuses rather than hangs. */
function _resolveRef(gitDir, ref, depth) {
  if (depth > 8) return null;
  const roots = [gitDir];
  try {
    const cd = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
    if (cd) roots.push(resolve(gitDir, cd));
  } catch {
    /* no commondir: this gitdir is its own common dir */
  }
  for (const r of roots) {
    let v = null;
    try {
      v = readFileSync(join(r, ref), 'utf8').trim();
    } catch {
      v = null;
    }
    if (v && _SHA40.test(v)) return v;
    const sym = v && /^ref:\s*(\S+)$/.exec(v);
    if (sym) return _resolveRef(gitDir, sym[1], depth + 1);
  }
  for (const r of roots) {
    let txt = null;
    try {
      txt = readFileSync(join(r, 'packed-refs'), 'utf8');
    } catch {
      txt = null;
    }
    if (!txt) continue;
    for (const line of txt.split('\n')) {
      if (!line || line[0] === '#' || line[0] === '^') continue;
      const sp = line.indexOf(' ');
      if (sp <= 0 || line.slice(sp + 1).trim() !== ref) continue;
      const sha = line.slice(0, sp).trim();
      if (_SHA40.test(sha)) return sha;
    }
  }
  return null;
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
