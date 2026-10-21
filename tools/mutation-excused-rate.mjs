#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * mutation-excused-rate — COUNT the exclusion the diff-scoped mutation gate makes, over the verdicts
 * CI has already uploaded. It runs mutmut zero times.
 *
 * THE ROW IT ANSWERS (`2026-10-19-string-mutants-that-reach-an-interface-are-unmeasured`):
 * `mutate_diff` excuses every string-literal mutant as not required, because mutmut wraps EVERY
 * literal in `XX` sentinels. The exclusion therefore covers a log message, a dict key, a `join`
 * separator and a subprocess argument alike. The row names candidate rules that would separate a
 * literal a consumer READS from prose, and states the cost of moving the bar: a not-required mutant
 * turned BLOCKING lands on every open PR. So the bar waits for a rate, and this tool measures it.
 *
 * WHAT IT READS. Every `mutation-diff` artifact the CI job uploads carries a `mutation-diff.json`
 * whose `not_required[]` entries name the mutant, its module, the exclusion reason and the `key` —
 * the whitespace-normalised `- old | + new` diff of the changed line. The key is the only decidable
 * evidence in the record: `file_line` is an integer against a tree at an unknown commit, so no rule
 * may read it. Every rule below is a predicate over the key's OLD side.
 *
 * TWO DENOMINATORS, BOTH QUOTED (Osprey, board #704). The population is the set of diffs whose
 * `mutation (diff-scoped)` job RAN, so a rate over it reads "among diffs the gate examined". A
 * relevance filter can skip that job on a change that would have reded it. The count of merged PRs in
 * the same window rides in the record beside it, so a reader cannot mistake the one for the other.
 *
 * THE CRITERION IS THE ROW'S OWN CLAIM, pre-stated: zero interface-reaching mutants are excused. A
 * measurement that finds any reads FAIL, which is the defect being quantified rather than a gate
 * failing. `--verdict` prints the object and exits 0 for that reason; `--strict` exits 1 on non-PASS.
 *
 * Usage:
 *   node tools/mutation-excused-rate.mjs                 # the committed record -> one verdict (offline)
 *   node tools/mutation-excused-rate.mjs --verdict        # the same, for the adoption gate's `emits.cmd`
 *   node tools/mutation-excused-rate.mjs --collect [--limit N] [--out <path>]   # network: re-measure
 *   node tools/mutation-excused-rate.mjs --selftest       # the pure rules, pinned
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = 'analysis/mutation-excused-rate.json';
/* The slug is DERIVED from the origin remote. A written-down `<owner>/<repo>` would be a second
   source of truth, and it reads as a hardcoded checkout root to the suite's own detector. An
   unreadable remote REFUSES — ∅ absence is null, so nothing here guesses a repository. */
function repoSlug() {
  const r = spawnSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const m = r.status === 0 ? /[:/]([^/:]+\/[^/]+?)(?:\.git)?\s*$/.exec(r.stdout) : null;
  if (!m) {
    console.error('the origin remote is unreadable, so the artifact repository is unknown — nothing was read');
    process.exit(2);
  }
  return m[1];
}
const ARTIFACT_NAME = 'mutation-diff';
const DEFAULT_LIMIT = 250;
const EXAMPLE_CAP = 12;
const SAMPLE_CAP = 6;
const SAMPLE_PER_MODULE = 2;
/* The row's bar, pre-stated: the exclusion is claimed unmeasured, so the claim under test is zero. */
const THRESHOLD = 0;

/* ── the rules: predicates over the key's OLD side ──────────────────────────────────────────────── */

/* A key is `" | ".join` of the whitespace-normalised `-`/`+` lines of the mutant's diff, so a literal
   `|` inside a changed line is indistinguishable from the separator. Such a key is UNPARSEABLE here,
   never guessed: it joins `excludedKeys` and is counted, not classified. */
export function sidesOfKey(key) {
  if (typeof key !== 'string' || key === '') return null;
  const parts = key.split(' | ');
  const minus = [];
  const plus = [];
  for (const p of parts) {
    if (p.startsWith('- ')) minus.push(p.slice(2));
    else if (p.startsWith('+ ')) plus.push(p.slice(2));
    else return null; // a fragment that is neither side: the separator was ambiguous
  }
  if (minus.length === 0 || plus.length === 0) return null;
  return { old: minus.join('\n'), new: plus.join('\n') };
}

/* WOULD-REQUIRE rules — the ones the row names, plus `vector-element`, which #3810 produced: four
   subprocess argv strings (`"journalctl"`, `"-u"`, `"tepna-capture"`, `"--grep"`) excused as prose
   while the tests assert each of them. Each rule is named so a reader can accept one and refuse another. */
export const REQUIRE_RULES = [
  {
    name: 'dict-key',
    why: 'a literal that keys a dict a function returns, writes or reads is behaviour the consumer sees',
    test: (s) => /(["'])[^"']*\1\s*:/.test(s) || /\[\s*(["'])[^"']*\1\s*\]/.test(s) || /\.(get|setdefault|pop)\(\s*(["'])/.test(s)
  },
  {
    name: 'join-or-split-separator',
    why: 'a separator decides the shape of a string a consumer parses',
    test: (s) => /\.(join|split|rsplit|partition|rpartition|strip|lstrip|rstrip|startswith|endswith)\(/.test(s)
  },
  {
    name: 'strftime-format',
    why: 'a stamp format is an interface: the Clock Contract parses it by regex',
    test: (s) => /(strftime|strptime|isoformat|fromisoformat)\s*\(/.test(s)
  },
  {
    /* A SPACE IS THE DISCRIMINATOR, and it was measured, not guessed: the unrefined rule — any bare
       literal on its own line — took `"the header word has no reading from this run"` out of a
       multi-line `SystemExit` call for an argv word. A word a process reads carries no space, and a
       flag starts with `-`; the one space-carrying interface string in hand, a `strftime` pattern,
       has its own rule. A space-carrying literal on its own line is prose, and stays excused. */
    name: 'vector-element',
    why: 'a bare space-less literal element of a sequence is an argv word, a unit name or a flag — read by a process, not by a human',
    test: (s) => {
      const m = /^\s*(["'])((?:(?!\1).)*)\1\s*,?\s*$/.exec(s);
      return !!m && (!/\s/.test(m[2]) || m[2].startsWith('-'));
    }
  }
];

/* PROSE rules — the case FOR keeping the exclusion. A key that hits one of these is not counted as
   interface-reaching even when a would-require rule also fires, because the row's own "against" list
   governs the overlap: a logged or returned string stays prose. */
export const PROSE_RULES = [
  { name: 'print-or-log', why: 'the literal reaches a human through stdout or a logger', test: (s) => /\b(print|logg?er?|_LOG|log|warn|warning|info|debug|error)\s*\(|\bprint\(/.test(s) },
  { name: 'returned-reason', why: 'a reason or detail string is the gate explaining itself', test: (s) => /\b(reason|detail|message|msg|advice|hint)\b/.test(s) }
];

export function classifyKey(key) {
  const sides = sidesOfKey(key);
  if (!sides) return null;
  const req = REQUIRE_RULES.filter((r) => r.test(sides.old)).map((r) => r.name);
  const prose = PROSE_RULES.filter((r) => r.test(sides.old)).map((r) => r.name);
  return { old: sides.old, new: sides.new, require: req, prose, interfaceReaching: req.length > 0 && prose.length === 0 };
}

/* ── aggregation: scalars and small maps only (the 8 GB rule — one artifact is held at a time) ──── */

export function newTally() {
  return {
    diffsExamined: 0,
    diffsWithCounter: 0,
    counterSum: 0,
    noCounter: Object.create(null),
    diffsWithMutants: 0,
    diffsWithExcused: 0,
    diffsWithInterfaceReaching: 0,
    excusedOccurrences: 0,
    byReason: Object.create(null),
    ruleOccurrences: Object.create(null),
    proseOccurrences: Object.create(null),
    interfaceOccurrences: 0,
    undecidableOccurrences: 0,
    unparseableKeys: 0,
    keys: new Map(), // key -> { n, module, reason, require, prose, interfaceReaching }
    shas: new Set(),
    examples: [],
    samplesByRule: new Map() // rule -> [{ key, module, reason }] — distinct keys, capped per module
  };
}

function bump(obj, k) {
  obj[k] = (obj[k] || 0) + 1;
}

/* A sample a reader can audit: at most SAMPLE_CAP distinct keys per rule, and at most SAMPLE_PER_MODULE
   of them from one module — one PR's own mutants would otherwise fill every slot (measured: the first
   400 artifacts are recent, so all 12 unfiltered examples came from one module of mine). */
function sample(store, rule, entry) {
  let arr = store.get(rule);
  if (!arr) {
    arr = [];
    store.set(rule, arr);
  }
  if (arr.length >= SAMPLE_CAP) return;
  if (arr.filter((e) => e.module === entry.module).length >= SAMPLE_PER_MODULE) return;
  arr.push(entry);
}

/* One artifact's parsed `mutation-diff.json` folded into the tally. Returns nothing: the record is
   dropped by the caller as soon as this returns, so nothing accumulates but counters. */
export function foldDiff(t, doc, sha) {
  t.diffsExamined += 1;
  if (sha) t.shas.add(sha);
  const pop = (doc.verdict && doc.verdict.population) || null;
  /* 🔴 THE DENOMINATOR IS NOT "EVERY ARTIFACT". The not-required counter shipped in #3669, and the
     retention window reaches back past it: an older artifact reports zero exclusions because nothing
     counted them, not because none were made. A diff that changed no Python module (NOT_APPLICABLE,
     result null) generated no mutant at all, so it could not have excused one either. Both are
     EXCLUDED by name — counting them as examined is the examined-nothing shape this repo refuses. */
  const res = (doc.verdict && doc.verdict.result) || null;
  const counter = res && Object.hasOwn(res, 'notRequired') ? res.notRequired : null;
  if (!Number.isInteger(counter)) {
    const st = (doc.verdict && doc.verdict.status) || 'no verdict';
    bump(
      t.noCounter,
      st === 'NOT_APPLICABLE' ? 'no Python module changed, so no mutant was generated' : `no notRequired counter in the verdict result (status ${st}) — the artifact predates the counter`
    );
    return;
  }
  t.diffsWithCounter += 1;
  t.counterSum += counter;
  if (pop && pop.eligible > 0) t.diffsWithMutants += 1;
  const nr = Array.isArray(doc.not_required) ? doc.not_required : [];
  if (nr.length > 0) t.diffsWithExcused += 1;
  let anyInterface = false;
  for (const e of nr) {
    t.excusedOccurrences += 1;
    bump(t.byReason, typeof e.reason === 'string' ? e.reason : 'no reason recorded');
    const c = classifyKey(e.key);
    if (!c) {
      t.unparseableKeys += 1;
      continue;
    }
    for (const r of c.require) bump(t.ruleOccurrences, r);
    for (const r of c.prose) bump(t.proseOccurrences, r);
    if (c.interfaceReaching) {
      t.interfaceOccurrences += 1;
      anyInterface = true;
    } else if (c.require.length === 0 && c.prose.length === 0) t.undecidableOccurrences += 1;
    const prev = t.keys.get(e.key);
    if (prev) prev.n += 1;
    else {
      t.keys.set(e.key, { n: 1, module: e.module || null, reason: e.reason || null, require: c.require, prose: c.prose, interfaceReaching: c.interfaceReaching });
      const ent = { key: e.key, module: e.module || null, reason: e.reason || null };
      for (const r of c.require) sample(t.samplesByRule, r, ent);
      for (const r of c.prose) sample(t.samplesByRule, r, ent);
      if (c.require.length === 0 && c.prose.length === 0) sample(t.samplesByRule, 'no-rule', ent);
      if (c.interfaceReaching && t.examples.length < EXAMPLE_CAP && t.examples.filter((x) => x.module === ent.module).length < SAMPLE_PER_MODULE) t.examples.push({ ...ent, rules: c.require });
    }
  }
  if (anyInterface) t.diffsWithInterfaceReaching += 1;
}

export function summarise(t, meta) {
  const distinct = { total: t.keys.size, interfaceReaching: 0, undecidable: 0, byRule: Object.create(null), byProse: Object.create(null) };
  for (const v of t.keys.values()) {
    if (v.interfaceReaching) distinct.interfaceReaching += 1;
    if (v.require.length === 0 && v.prose.length === 0) distinct.undecidable += 1;
    for (const r of v.require) bump(distinct.byRule, r);
    for (const r of v.prose) bump(distinct.byProse, r);
  }
  const d = t.diffsWithCounter || 0;
  return {
    schema: 'tepna.mutation-excused-rate/1',
    ...meta,
    diffs: {
      artifactsParsed: t.diffsExamined,
      examined: d,
      noCounter: { ...t.noCounter },
      withMutants: t.diffsWithMutants,
      withExcused: t.diffsWithExcused,
      withInterfaceReaching: t.diffsWithInterfaceReaching,
      distinctHeadShas: t.shas.size
    },
    mutants: {
      excusedOccurrences: t.excusedOccurrences,
      /* The gate's OWN counter, summed independently of the entries. A disagreement means an entry
         was dropped between the count and the list, so the figure is not quoted as if it agreed. */
      counterSum: t.counterSum,
      counterAgrees: t.counterSum === t.excusedOccurrences,
      distinctKeys: t.keys.size,
      unparseableKeys: t.unparseableKeys,
      byReason: { ...t.byReason }
    },
    rules: {
      requireOccurrences: { ...t.ruleOccurrences },
      proseOccurrences: { ...t.proseOccurrences },
      distinctKeysByRule: { ...distinct.byRule },
      distinctKeysByProse: { ...distinct.byProse },
      definitions: [...REQUIRE_RULES.map((r) => ({ name: r.name, kind: 'would-require', why: r.why })), ...PROSE_RULES.map((r) => ({ name: r.name, kind: 'prose', why: r.why }))]
    },
    interfaceReaching: {
      occurrences: t.interfaceOccurrences,
      distinctKeys: distinct.interfaceReaching,
      perDiffWithCounter: d ? Number((t.interfaceOccurrences / d).toFixed(4)) : null,
      perDiffWithExcused: t.diffsWithExcused ? Number((t.interfaceOccurrences / t.diffsWithExcused).toFixed(4)) : null,
      shareOfExcused: t.excusedOccurrences ? Number((t.interfaceOccurrences / t.excusedOccurrences).toFixed(4)) : null
    },
    undecidable: { occurrences: t.undecidableOccurrences, distinctKeys: distinct.undecidable },
    /* OCCURRENCES ARE NOT KEYS. The same mutant recurs on every diff that touches its function, and a
       re-run of one head uploads a second artifact, so the occurrence count carries the gate's LOAD
       and the distinct-key count carries the rule's REACH. Both are reported; neither substitutes. */
    mostRepeatedKeys: [...t.keys.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 5)
      .map(([key, v]) => ({ key, n: v.n, module: v.module, rules: v.require, interfaceReaching: v.interfaceReaching })),
    examples: t.examples,
    samplesByRule: Object.fromEntries([...t.samplesByRule.entries()].map(([k, v]) => [k, v])),
    caveats: [
      'the denominator is diffs whose `mutation (diff-scoped)` job RAN; a relevance filter can skip that job on a change that would have reded it (residue 2026-10-20-capture-host-relevance-filter-skips-the-tools-change-that-reds-it), so `mergedPrsInWindow` rides beside it and is the denominator for "lands on every open PR"',
      "a rule fires on the mutant key's OLD LINE, so a line holding two literals can match a role the MUTATED literal does not occupy — the rules are named and counted separately for that reason, and a reader may accept one and refuse another",
      'a key whose changed line carries a literal `|` is unparseable, because `diff_key` joins the sides with the same character: counted as `mutants.unparseableKeys`, never classified',
      'occurrences repeat across diffs and re-runs; `distinctKeys` is the figure to quote for how many distinct mutants a moved bar would require',
      'the count errs in BOTH directions, and neither direction is a bound. It over-counts a separator mutated inside a message string, which joins prose (`coverage_scope.py`, a `", ".join` inside an f-string the gate prints). It under-counts every interface string no rule names: the `no-rule` samples hold `encoding="utf-8"`, `decode("ascii", "replace")` and a tool path passed as a keyword argument, each read by a consumer and each excused as prose. A rule set is a proposal, so the record carries the samples that argue against it'
    ]
  };
}

/* ── the verdict ────────────────────────────────────────────────────────────────────────────────── */

export function verdictFor(rec, commit) {
  const V = require(path.join(ROOT, 'verdict.js'));
  const criterion = {
    name: 'interface-reaching excused mutants — a string mutant whose line matches a would-require rule and no prose rule, over the diffs whose mutation job ran',
    direction: 'lte',
    threshold: THRESHOLD,
    unit: 'mutants'
  };
  const base = {
    gate: 'mutation-excused-rate',
    scope: 'internal',
    criterion,
    producedBy: { tool: 'tools/mutation-excused-rate.mjs', commit: commit || null, ...(commit ? {} : { commitReason: 'HEAD unreadable in this checkout' }) }
  };
  if (!rec) {
    return V.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: `${RECORD} is absent — run \`node tools/mutation-excused-rate.mjs --collect\` on the primary checkout`,
      evidence: ['tools/mutation-excused-rate.mjs']
    });
  }
  const n = rec.interfaceReaching ? rec.interfaceReaching.occurrences : null;
  const pop = rec.population || { checked: 0, eligible: 0, excluded: 0 };
  if (!Number.isInteger(n) || !Number.isInteger(pop.checked)) {
    return V.make({
      ...base,
      status: 'UNKNOWN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: `${RECORD} carries no integer interfaceReaching.occurrences — the record is unreadable, not a pass`,
      evidence: [RECORD]
    });
  }
  const status = pop.checked === 0 ? 'NOT_RUN' : n <= THRESHOLD ? 'PASS' : 'FAIL';
  const ir = rec.interfaceReaching;
  const reason =
    status === 'PASS'
      ? null
      : status === 'NOT_RUN'
        ? 'the record examined no artifact'
        : `${n} excused mutant(s) over ${rec.diffs.examined} measurable diff(s) match a would-require rule and no prose rule — ${ir.perDiffWithCounter} per measurable diff, ${ir.distinctKeys} distinct key(s), on ${rec.diffs.withInterfaceReaching} diff(s). The denominator is diffs whose mutation job RAN, not every merged PR (${rec.mergedPrsInWindow == null ? 'merged count not read' : `${rec.mergedPrsInWindow} merged in the window`})`;
  return V.make({
    ...base,
    status,
    population: pop,
    /* NOT_RUN carries result: null — nothing was examined, so nothing was measured (verdict.js). */
    result:
      status === 'NOT_RUN'
        ? null
        : {
            interfaceReaching: ir,
            diffs: rec.diffs,
            excusedOccurrences: rec.mutants.excusedOccurrences,
            distinctKeys: rec.mutants.distinctKeys,
            unparseableKeys: rec.mutants.unparseableKeys,
            distinctKeysByRule: rec.rules.distinctKeysByRule,
            undecidable: rec.undecidable,
            window: rec.window || null,
            mergedPrsInWindow: rec.mergedPrsInWindow == null ? null : rec.mergedPrsInWindow
          },
    reason,
    evidence: [RECORD, 'tools/mutation-excused-rate.mjs', 'briefs/RESIDUE.md 2026-10-19-string-mutants-that-reach-an-interface-are-unmeasured']
  });
}

/* ── collection (the only path that touches the network) ────────────────────────────────────────── */

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
}

function listArtifacts(limit, slug) {
  const out = [];
  let total = null;
  for (let page = 1; out.length < limit && page <= 40; page += 1) {
    const j = JSON.parse(gh(['api', `repos/${slug}/actions/artifacts?per_page=100&name=${ARTIFACT_NAME}&page=${page}`]));
    if (total === null && Number.isInteger(j.total_count)) total = j.total_count;
    const arts = j.artifacts || [];
    if (arts.length === 0) break;
    for (const a of arts) {
      if (out.length >= limit) break;
      out.push({ id: a.id, expired: !!a.expired, created_at: a.created_at, sha: (a.workflow_run && a.workflow_run.head_sha) || null });
    }
  }
  return { arts: out, total: total === null ? out.length : total };
}

function mergedPrsSince(oldestIso, slug) {
  try {
    const day = String(oldestIso).slice(0, 10);
    const j = JSON.parse(gh(['api', `search/issues?q=${encodeURIComponent(`repo:${slug} is:pr is:merged merged:>=${day}`)}&per_page=1`]));
    return Number.isInteger(j.total_count) ? j.total_count : null;
  } catch {
    return null;
  }
}

function collect(opts) {
  const { limit, outPath, cacheDir, fromCache } = opts;
  const slug = fromCache ? null : repoSlug();
  const t = newTally();
  const excludedReasons = Object.create(null);
  let listedByGitHub = null;
  let cachedMergedPrs = null;
  let arts = [];
  if (fromCache) {
    /* OFFLINE RE-MEASUREMENT. The rules are the moving part of this tool, so a rule change must not
       cost 1380 downloads: `--collect --cache <dir>` saves what it read, `--from-cache <dir>` folds it. */
    const meta = JSON.parse(fs.readFileSync(path.join(fromCache, 'index.json'), 'utf8'));
    arts = meta.arts;
    listedByGitHub = meta.listedByGitHub;
    /* The merged-PR denominator is a property of the WINDOW, so it is cached with the artifact list
       rather than re-queried: an offline re-fold that dropped it would publish a rate with one
       denominator missing, which is the reading Osprey's caveat exists to prevent. */
    cachedMergedPrs = meta.mergedPrsInWindow ?? null;
    for (const a of arts) {
      if (a.expired) {
        bump(excludedReasons, 'artifact expired');
        continue;
      }
      const f = path.join(fromCache, `${a.id}.json`);
      if (!fs.existsSync(f)) {
        bump(excludedReasons, 'absent from the cache');
        continue;
      }
      foldDiff(t, JSON.parse(fs.readFileSync(f, 'utf8')), a.sha);
    }
  } else {
    if (spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status !== 0) {
      console.error('unzip is absent — an absent tool, not a measurement. Install it and re-run.');
      process.exit(2);
    }
    const listed = listArtifacts(limit, slug);
    arts = listed.arts;
    listedByGitHub = listed.total;
    if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'excused-'));
    const zip = path.join(tmp, 'a.zip');
    for (const a of arts) {
      if (a.expired) {
        bump(excludedReasons, 'artifact expired');
        continue;
      }
      try {
        fs.writeFileSync(zip, execFileSync('gh', ['api', `repos/${slug}/actions/artifacts/${a.id}/zip`], { maxBuffer: 64 << 20 }));
        const text = execFileSync('unzip', ['-p', zip, 'mutation-diff.json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
        if (cacheDir) fs.writeFileSync(path.join(cacheDir, `${a.id}.json`), text);
        foldDiff(t, JSON.parse(text), a.sha);
      } catch (e) {
        bump(excludedReasons, `unreadable: ${String((e && e.message) || e).slice(0, 48)}`);
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    const isoNow = arts
      .filter((a) => !a.expired)
      .map((a) => a.created_at)
      .sort();
    cachedMergedPrs = isoNow.length ? mergedPrsSince(isoNow[0], slug) : null;
    if (cacheDir) fs.writeFileSync(path.join(cacheDir, 'index.json'), `${JSON.stringify({ arts, listedByGitHub, mergedPrsInWindow: cachedMergedPrs }, null, 1)}\n`);
  }
  /* population: checked = the diffs that COULD have reported an exclusion (the counter was in the
     verdict), and every other listed artifact is excluded under its own named reason. The equality
     `checked + excluded = eligible` is what makes the rate readable. */
  for (const [k, v] of Object.entries(t.noCounter)) excludedReasons[k] = (excludedReasons[k] || 0) + v;
  const checkedIso = arts
    .filter((a) => !a.expired)
    .map((a) => a.created_at)
    .sort();
  const rec = summarise(t, {
    collectedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    listedByGitHub,
    window: { oldest: checkedIso[0] || null, newest: checkedIso[checkedIso.length - 1] || null, limit: fromCache ? 'from cache' : limit },
    population: { checked: t.diffsWithCounter, eligible: arts.length, excluded: arts.length - t.diffsWithCounter },
    excludedReasons: { ...excludedReasons },
    mergedPrsInWindow: cachedMergedPrs,
    producedBy: { tool: 'tools/mutation-excused-rate.mjs', commit: headSha() }
  });
  const dest = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(rec, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(ROOT, dest)} — ${rec.population.checked} measurable diff(s) of ${arts.length} listed (${listedByGitHub} exist), ${rec.mutants.excusedOccurrences} excused mutant(s) [counter ${rec.mutants.counterSum}, agrees ${rec.mutants.counterAgrees}], ${rec.interfaceReaching.occurrences} interface-reaching over ${rec.interfaceReaching.distinctKeys} distinct key(s)`
  );
  return rec;
}

function headSha() {
  const r = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 && /^[0-9a-f]{7,40}\s*$/.test(r.stdout) ? r.stdout.trim() : null;
}

function readRecord() {
  const p = path.join(ROOT, RECORD);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { population: null };
  }
}

/* ── selftest: the rules and the fold, pinned without a network, a clock or a repo ──────────────── */
if (process.argv.includes('--selftest')) {
  let ran = 0;
  const ok = (c, m) => {
    ran += 1;
    if (!c) {
      console.error(`FAIL: ${m}`);
      process.exit(1);
    }
  };
  // the key's two sides
  ok(sidesOfKey('- "journalctl", | + "XXjournalctlXX",').old === '"journalctl",', 'the old side is the `-` line');
  ok(sidesOfKey('- a | + b | - c | + d').old === 'a\nc', 'a multi-line hunk keeps both old lines');
  ok(sidesOfKey('- x = "a | b" | + x = "XXa | bXX"') === null, 'a literal pipe makes the key UNPARSEABLE, never guessed');
  ok(sidesOfKey('') === null && sidesOfKey(null) === null && sidesOfKey('- only a minus') === null, 'a one-sided or empty key is null');
  // the four argv strings #3810 excused, each a vector element and interface-reaching
  for (const lit of ['"journalctl",', '"-u",', '"tepna-capture",', '"--grep"']) {
    const c = classifyKey(`- ${lit} | + "XXsentinelXX",`);
    ok(c.require.includes('vector-element') && c.interfaceReaching, `${lit} is a vector element and reaches the interface`);
  }
  ok(
    !classifyKey('- "the header word has no reading from this run" | + "XXthe header word has no reading from this runXX"').interfaceReaching,
    'a space-carrying literal alone on its line is PROSE, not an argv word'
  );
  ok(classifyKey('- "--grep=since last line", | + "XX--grep=since last lineXX",').require.includes('vector-element'), 'a flag keeps the rule even with a space, because it starts with a dash');
  // the row's own three candidates
  ok(classifyKey('- "dropped_before": n, | + "XXdropped_beforeXX": n,').require.includes('dict-key'), 'a dict key hits dict-key');
  ok(classifyKey('- return ", ".join(parts) | + return "XX, XX".join(parts)').require.includes('join-or-split-separator'), 'a join separator hits its rule');
  ok(classifyKey('- stamp = t.strftime("%Y-%m-%d") | + stamp = t.strftime("XX%Y-%m-%dXX")').require.includes('strftime-format'), 'a stamp format hits strftime-format');
  // prose keeps the exclusion even when a would-require rule also fires
  const pr = classifyKey('- print("dropped: {}".format(n)) | + print("XXdropped: {}XX".format(n))');
  ok(pr.prose.includes('print-or-log') && !pr.interfaceReaching, 'a printed literal stays prose');
  const rs = classifyKey('- return False, "reason: {}".format(x) | + return False, "XXreason: {}XX".format(x)');
  ok(rs.prose.includes('returned-reason') && !rs.interfaceReaching, 'a returned reason string stays prose');
  const nd = classifyKey('- CONST = "abc" + tail | + CONST = "XXabcXX" + tail');
  ok(nd.require.length === 0 && nd.prose.length === 0 && !nd.interfaceReaching, 'a literal no rule reaches is UNDECIDABLE, not required');
  // the fold: counters only, the counter-present denominator, and the population equality
  const t = newTally();
  const D = (nr, extra) => ({ verdict: { status: 'PASS', population: { checked: 1, eligible: 2, excluded: 1 }, result: { notRequired: nr.length } }, not_required: nr, ...extra });
  const ARGV = '- "journalctl", | + "XXjournalctlXX",';
  foldDiff(
    t,
    D([
      { mutant: 'm1', module: 'a.py', reason: 'mutmut XX sentinel', key: ARGV },
      { mutant: 'm2', module: 'a.py', reason: 'every changed token lies inside a string literal', key: '- print("x") | + print("XXxXX")' }
    ]),
    'deadbeef'
  );
  foldDiff(t, { verdict: { status: 'NOT_APPLICABLE', population: { checked: 0, eligible: 0, excluded: 0 }, result: null } }, 'cafe1234');
  foldDiff(t, D([{ mutant: 'm3', module: 'b.py', reason: 'mutmut XX sentinel', key: ARGV }]), 'deadbeef');
  // a PASS artifact from before the counter shipped: zero exclusions BECAUSE nothing counted them
  foldDiff(t, { verdict: { status: 'PASS', population: { checked: 4, eligible: 4, excluded: 0 }, result: { killed: 4, survived: 0 } } }, 'old0000');
  ok(t.diffsExamined === 4 && t.diffsWithCounter === 2, 'four artifacts parsed, two of them measurable');
  ok(Object.keys(t.noCounter).length === 2, 'the two unmeasurable artifacts are excluded under DIFFERENT named reasons');
  ok(
    /predates the counter/.test(Object.keys(t.noCounter).join(' ')) && /no Python module changed/.test(Object.keys(t.noCounter).join(' ')),
    'the reasons name the pre-counter artifact and the no-mutant diff apart'
  );
  ok(t.diffsWithMutants === 2 && t.diffsWithExcused === 2, 'the with-mutants and with-excused counters are read from the artifacts that carried the counter');
  ok(t.counterSum === 3 && t.excusedOccurrences === 3, "the gate's own counter is summed beside the entries");
  ok(t.diffsWithInterfaceReaching === 2 && t.interfaceOccurrences === 2, 'both diffs carrying the argv mutant are counted once each');
  ok(t.keys.size === 2 && t.keys.get(ARGV).n === 2, 'a key seen twice is ONE distinct key with n = 2');
  ok(t.shas.size === 3, 'a re-run of the same sha is one sha');
  // the sample caps: one module may not fill a rule's slots, and the repeat structure is ordered
  const t2 = newTally();
  for (let i = 0; i < 5; i += 1) foldDiff(t2, D([{ mutant: `m${i}`, module: 'a.py', reason: 'mutmut XX sentinel', key: `- "w${i}", | + "XXw${i}XX",` }]), `sha${i}`);
  foldDiff(t2, D([{ mutant: 'z', module: 'b.py', reason: 'mutmut XX sentinel', key: '- "zz", | + "XXzzXX",' }]), 'shaz');
  ok(t2.samplesByRule.get('vector-element').length === 3, 'one module fills at most two slots, so a second module still gets in');
  ok(t2.samplesByRule.get('vector-element').filter((e) => e.module === 'b.py').length === 1, 'the other module is the third sample');
  ok(t2.examples.length === 3 && t2.examples.filter((e) => e.module === 'a.py').length === 2, 'the examples carry the same per-module cap');
  const s = summarise(t, { population: { checked: 2, eligible: 4, excluded: 2 } });
  ok(s.mostRepeatedKeys[0].n === 2 && s.mostRepeatedKeys.length === 2, 'the repeat structure is ordered by occurrence count');
  ok(s.caveats.length === 5 && s.caveats.every((c) => typeof c === 'string' && c.length > 40), 'the record states what the rate does NOT measure');
  ok(s.interfaceReaching.distinctKeys === 1 && s.interfaceReaching.occurrences === 2, 'the summary separates occurrences from distinct keys');
  ok(s.interfaceReaching.perDiffWithCounter === 1 && s.interfaceReaching.shareOfExcused === 0.6667, 'both rates are per their own denominator, and the diff rate counts only measurable diffs');
  ok(s.diffs.artifactsParsed === 4 && s.diffs.examined === 2 && Object.keys(s.diffs.noCounter).length === 2, 'the summary keeps the artifact count and the measurable count apart');
  ok(s.mutants.counterAgrees === true && s.mutants.counterSum === 3, "a disagreement with the gate's own counter would be visible in the record");
  ok(s.undecidable.occurrences === 0 && s.mutants.unparseableKeys === 0, 'nothing was undecidable or unparseable in this fold');
  // the verdict: the shape every status owes
  const V = require(path.join(ROOT, 'verdict.js'));
  const fail = verdictFor({ ...s, diffs: s.diffs, mutants: s.mutants, rules: s.rules, mergedPrsInWindow: 40 }, 'abc1234');
  ok(fail.status === 'FAIL' && V.validate(fail).ok && /per measurable diff/.test(fail.reason), 'a measured exclusion reads FAIL with a reason naming the rate');
  const none = verdictFor(null, 'abc1234');
  ok(none.status === 'NOT_RUN' && V.validate(none).ok, 'an absent record is NOT_RUN, never a pass');
  const unk = verdictFor({ population: null }, 'abc1234');
  ok(unk.status === 'UNKNOWN' && V.validate(unk).ok, 'an unreadable record is UNKNOWN, never a pass');
  const zero = verdictFor({ ...summarise(newTally(), { population: { checked: 0, eligible: 0, excluded: 0 } }), mergedPrsInWindow: null }, 'abc1234');
  ok(zero.status === 'NOT_RUN' && V.validate(zero).ok, 'checked = 0 is NOT_RUN, because PASS over nothing examined is the examined-nothing shape');
  const clean = verdictFor({ ...s, interfaceReaching: { ...s.interfaceReaching, occurrences: 0 }, mergedPrsInWindow: 40 }, 'abc1234');
  ok(clean.status === 'PASS' && clean.reason === null && V.validate(clean).ok, 'zero interface-reaching mutants is the PASS the row would need');
  console.log(`all ${ran} selftests passed`);
  process.exit(0);
}

/* One place in the tree decides CLI-vs-import, because every hand-rolled spelling goes silent through
   a symlink to the tool (`tools/argv-guard.mjs`, #3811). */
if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(
    argv,
    { valued: ['--limit', '--out', '--cache', '--from-cache'], boolean: ['--collect', '--verdict', '--strict', '--selftest'] },
    { tool: 'tools/mutation-excused-rate.mjs' }
  );
  if (argv.includes('--collect')) {
    const val = (flag) => {
      const i = argv.indexOf(flag);
      return i >= 0 ? argv[i + 1] : null;
    };
    collect({
      limit: val('--limit') ? Math.max(1, Number(val('--limit')) || DEFAULT_LIMIT) : DEFAULT_LIMIT,
      outPath: val('--out') || RECORD,
      cacheDir: val('--cache'),
      fromCache: val('--from-cache')
    });
    process.exit(0);
  }
  const v = verdictFor(readRecord(), headSha());
  console.log(JSON.stringify(v, null, 2));
  process.exit(argv.includes('--strict') && v.status !== 'PASS' ? 1 : 0);
}
