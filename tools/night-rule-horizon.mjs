#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * THE YEAR A DECLARED NIGHT RULE STOPS SCORING — measured, never read off the digits.
 *
 * Row `2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year`: eleven analysis tools used
 * to pass `/^2026-/` to `snapshotNights` as their own declared night rule, so each one refused a
 * night from any other year. The refusal was honest — `populationVerdict` names the caller's rule
 * and every night-shaped directory it turned away, and a probe over a planted 2027 root read
 * `NOT_RUN … the caller's own rule /^2026-/ refused every one of them (2027-01-04, 2027-02-11)`.
 * What the row asked for and the repository lacked is a GATE that fires BEFORE the boundary.
 *
 * 🔴 THE OWNER RULED ON 2026-10-28, AND THE OTHER HALF IS NOW BUILT. A night name is any
 * `YYYY-MM-DD`, whatever the year, and the rule lives in ONE shared constant — `NIGHT_RE` in
 * `corpus-scope-core.mjs`, which every one of the eleven now passes. So this tool no longer guards
 * a boundary the fleet decided to keep: it guards against a NEW pin, and reds the day a tool
 * re-declares a rule that stops scoring on a calendar date.
 *
 * 🔴 THIS TOOL STILL WIDENS NO POPULATION ITSELF. It measures what each site declares; moving a
 * site onto the shared constant is that tool's own diff, and the owner owns the ruling behind it.
 *
 * 🔴 THE INSTRUMENT IS BEHAVIOURAL. A census that grepped for the digits `2026` would be a
 * text-keyed instrument measuring a text-keyed property, and it would agree with itself. Each
 * declared literal is COMPILED and probed over synthetic night names, so the horizon is the first
 * year the rule actually refuses while it still admits the corpus's own years.
 *
 * It fails closed: an `re:` this reader cannot compile is reported, and the verdict is FAIL rather
 * than a PASS over a population it could not read.
 *
 *   node tools/night-rule-horizon.mjs                 # walk the documented roots, emit the verdict
 *   node tools/night-rule-horizon.mjs --verdict-sample # the shape, with no corpus
 *   node tools/night-rule-horizon.mjs --selftest       # plants
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { DOC, dedupeRoots, gitCommitOf, nightDirsUnder, NIGHT_RE, parseRoots, populationVerdict, producedByOf, ruleLine, snapshotNights } from './corpus-scope-core.mjs';
import { findDirNames } from './corpus-scope.mjs';
import { escapeRe } from './regex-escape-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SELF = 'tools/night-rule-horizon.mjs';
const Verdict = createRequire(import.meta.url)(join(REPO, 'verdict.js'));

/* The probe window. It opens at the earliest year the corpus could hold and runs far enough past
   today that a rule pinned to any plausible year is caught, and `15` is a day every month has. */
export const PROBE_FIRST_YEAR = 2026;
export const PROBE_LAST_YEAR = 2040;
const probeName = (y) => `${y}-06-15`;

/* A `snapshotNights` call that carries its own `re:`. The first expression finds every SITE and the
   second reads the rule at it, as a literal or as the bare name of a module-level one. The two
   counts are compared — a site this reader cannot resolve is named rather than dropped, which is
   the whole difference between a census and a claim.

   A call can also hand the rule over inside a named options object, which `OBJ_AT_SITE_RE` and
   `objectRule` read as a second family with its own arithmetic. One counter over both families
   would let an unread inline site hide behind a resolved object.

   🔴 THE UNIT IS THE SITE, NOT THE TOOL. This reader does not tell a production site from a plant
   inside a tool's own selftest, so each row carries its line and a reader follows it. Over-naming
   a site costs one lookup; a classifier guessing wrong in the other direction would make the gate
   fail open, which is the trade this comment records rather than hides. */
/* 🔴 ONE SPELLING OF THE LITERAL SHAPE, AND IT IS UNAMBIGUOUS BY CONSTRUCTION. The first draft
   spelled the literal four times as `(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+`, whose catch-all branch
   also admitted `[`. So a bracket could open a character class OR be eaten as an ordinary character,
   the engine held two parses of every bracket, and CodeQL named it three times over as exponential
   backtracking on repeated brackets. Each branch below starts on a character the other two refuse,
   which makes the match deterministic: a catch-all that excludes `[`, an escape pair, or a class.
   One constant also ends the four-way drift, which was how three of the four copies read alike. */
const LIT_BODY = String.raw`(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+`;
const LIT_SRC = String.raw`\/` + LIT_BODY + String.raw`\/[a-z]*`;
const LIT_ANCHORED = new RegExp(String.raw`^\/(` + LIT_BODY + String.raw`)\/([a-z]*)$`);
/* A NAME REACHES A PATTERN, so it is escaped completely rather than for the one character it is
   known to carry. The first draft escaped `$` alone, which CodeQL read as incomplete escaping: a
   backslash in the input would have reached the pattern unescaped. The identifier grammar this tool
   matches cannot produce one today, and an escaper that is right only while its caller stays narrow
   is the defect, not the caller. */
const escRe = escapeRe;

const SITE_RE = /snapshotNights\s*\([^;]{0,240}?\bre:/g;
const RULE_AT_SITE_RE = new RegExp(String.raw`snapshotNights\s*\([^;]{0,240}?\bre:\s*(` + LIT_SRC + String.raw`|[A-Za-z_$][\w$]*)`, 'g');
/* 🔴 A GUARD BUILT FROM TWO REGEXES THAT SHARE A BLIND SPOT CANNOT SEE WHAT BOTH MISS. The pair
   above counts sites by the same `re:`-inside-the-call text they resolve by, so `snapshotNights(nr,
   narrow)` — the rule built into an object one line earlier — was neither counted nor read, and the
   fail-closed arm had nothing to compare. This family finds the call whose options are a name, and
   the name resolves through its own binding or the site reads as unparsed. */
const OBJ_AT_SITE_RE = /snapshotNights\s*\(\s*[^;()]{0,160}?,\s*([A-Za-z_$][\w$]*)\s*\)/g;
const OBJ_RULE_RE = new RegExp(String.raw`\bre:\s*(` + LIT_SRC + String.raw`|[A-Za-z_$][\w$]*)`);

const count = (text, re) => (String(text).match(re) || []).length;

/** Compile one literal as written. Sources in this repository are the only input. */
export function compileLiteral(lit) {
  const m = LIT_ANCHORED.exec(String(lit));
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

/** The literal a module-level `const` binds, or null when the name is bound once more than once
 *  with differing text — two bindings are exactly the case a single-entry reader gets wrong. */
export function constLiteral(text, name) {
  const re = new RegExp(String.raw`\bconst\s+` + escRe(name) + String.raw`\s*=\s*(` + LIT_SRC + String.raw`)`, 'g');
  const hits = [...new Set([...String(text).matchAll(re)].map((m) => m[1]))];
  return hits.length === 1 ? hits[0] : null;
}

/** The rule at one site, resolved. `NIGHT_RE` is the primitive's own yardstick spelled by name. */
export function resolveRule(text, token) {
  if (token.startsWith('/')) return { rule: token, re: compileLiteral(token) };
  if (token === 'NIGHT_RE') return { rule: String(NIGHT_RE), re: NIGHT_RE };
  const lit = constLiteral(text, token);
  return lit ? { rule: lit, re: compileLiteral(lit), via: token } : { rule: null, re: null, via: token };
}

/** The rule inside an options object bound to `name`, or null when this reader cannot see one.
 *
 * A binding that holds no `re:` is not a night rule at all, so it answers `{ rule: null, none: true }`
 * and the caller skips the site rather than failing on it. A binding this reader cannot find answers
 * `{ rule: null }`, which fails the gate closed.
 */
export function objectRule(text, name) {
  const re = new RegExp(`\\bconst\\s+${name}\\s*=\\s*\\{([^{}]*)\\}`, 'g');
  const bodies = [...text.matchAll(re)].map((m) => m[1]);
  if (!bodies.length) return { rule: null, re: null, via: name };
  const uniq = [...new Set(bodies)];
  if (uniq.length > 1) return { rule: null, re: null, via: name };
  const hit = OBJ_RULE_RE.exec(uniq[0]);
  if (!hit) return { rule: null, re: null, via: name, none: true };
  const r = resolveRule(text, hit[1]);
  return r.re ? { rule: r.rule, re: r.re, via: name } : { rule: null, re: null, via: name };
}

/** The first probed year this rule refuses while it still admits `PROBE_FIRST_YEAR`. PURE.
 *
 * `null` means the rule admits every probed year, so it carries no horizon. A rule that refuses the
 * FIRST year is not pinned to a later one — it scores nothing today, which is a different defect,
 * and `admitsFirst` carries it so the two never read alike.
 */
export function horizonOf(re) {
  const admitsFirst = re.test(probeName(PROBE_FIRST_YEAR));
  let horizon = null;
  for (let y = PROBE_FIRST_YEAR; y <= PROBE_LAST_YEAR; y++) {
    if (!re.test(probeName(y))) {
      horizon = y;
      break;
    }
  }
  return { admitsFirst, horizon, probedThrough: PROBE_LAST_YEAR };
}

/** Every declared night rule in `tools/`, with its measured horizon. */
export function declaredRules(toolsDir = HERE) {
  const rows = [];
  const unparsed = [];
  for (const f of readdirSync(toolsDir)
    .filter((n) => n.endsWith('.mjs'))
    .sort()) {
    const rel = `tools/${f}`;
    if (rel === SELF) continue;
    const text = readFileSync(join(toolsDir, f), 'utf8');
    if (!text.includes('snapshotNights')) continue;
    const sites = count(text, SITE_RE);
    if (!sites) continue;
    /* 🔴 A PLANT IS NOT A SCORER. A rule written below a file's own `function selftest(` line is a
       fixture: it exists to prove the primitive refuses, so it must never ride in the judged set, or
       the gate would report a deliberate refusal as a defect. Three sites qualify in this checkout,
       and the verdict names every one of them rather than dropping them (∅). */
    const sfAt = text.search(/^(?:export\s+)?(?:async\s+)?function selftest\s*\(/m);
    /* 🔴 AFTER THE DECLARATION IS NOT INSIDE THE BODY. Six shipped `pat-*` sites sit BELOW their
       file's `function selftest(` line, because the harness is declared above the command path, so a
       line-order test called them fixtures and dropped two thirds of the judged set. The body ends at
       the next closing brace in column one, which Biome guarantees for a top-level function. */
    const sfEnd =
      sfAt < 0
        ? -1
        : (() => {
            const i = text.indexOf('\n}', sfAt);
            return i < 0 ? text.length : i;
          })();
    let inlineResolved = 0;
    const seen = new Map();
    for (const m of text.matchAll(RULE_AT_SITE_RE)) {
      const line = text.slice(0, m.index).split('\n').length;
      const r = resolveRule(text, m[1]);
      if (!r.re) {
        unparsed.push(`${rel}:${line} ${m[1]}`);
        continue;
      }
      inlineResolved++;
      const inSelftest = sfAt >= 0 && m.index > sfAt && m.index < sfEnd;
      /* \U0001f534 ONE ROW PER DISTINCT RULE, AND THE OCCURRENCE COUNT TRAVELS WITH IT. A second session
         counted six fixture sites in this file where this reader reports one row, because six legs
         pass the same literal. Both numbers are right about different units, so the row carries its
         own, and a census that printed only the row count would read as a site count. */
      const key = `${r.rule}\u0000${inSelftest}`;
      const prior = seen.get(key);
      if (prior) {
        prior.occurrences++;
        prior.lines.push(line);
        continue;
      }
      const row = { tool: rel, line, rule: r.rule, via: r.via || null, inSelftest, occurrences: 1, lines: [line], ...horizonOf(r.re), re: r.re };
      seen.set(key, row);
      rows.push(row);
    }
    /* FAIL CLOSED. A site whose rule this reader never saw is the one case where a green verdict
       would be a claim about text it could not read. */
    /* The second family: `snapshotNights(root, opts)` where the rule was built into `opts`. */
    let objSites = 0;
    let objResolved = 0;
    let objRuleless = 0;
    for (const m of text.matchAll(OBJ_AT_SITE_RE)) {
      objSites++;
      const line = text.slice(0, m.index).split('\n').length;
      const r = objectRule(text, m[1]);
      if (r.none) {
        objRuleless++;
        continue;
      }
      if (!r.re) {
        unparsed.push(`${rel}:${line} options object ${m[1]}`);
        continue;
      }
      objResolved++;
      const inSelftest = sfAt >= 0 && m.index > sfAt && m.index < sfEnd;
      const key = `${r.rule}\u0000${inSelftest}`;
      const prior = seen.get(key);
      if (prior) {
        prior.occurrences++;
        prior.lines.push(line);
        continue;
      }
      const row = { tool: rel, line, rule: r.rule, via: r.via, inSelftest, occurrences: 1, lines: [line], ...horizonOf(r.re), re: r.re };
      seen.set(key, row);
      rows.push(row);
    }
    /* 🔴 ONE COUNTER FOR TWO FAMILIES CANCELS A MISS AGAINST A HIT. Each family owes its own
       arithmetic, or an unread inline site hides behind a resolved options object. */
    if (inlineResolved < sites) unparsed.push(`${rel} ${sites} inline site(s), ${inlineResolved} resolved`);
    if (objResolved + objRuleless < objSites) unparsed.push(`${rel} ${objSites} options-object site(s), ${objResolved} resolved, ${objRuleless} holding no rule`);
  }
  return { rules: rows, unparsed: unparsed.sort() };
}

/** The night names the documented roots offer, under the primitive's own shape yardstick.
 *
 * 🔴 A ROOT THIS MACHINE CANNOT WALK IS NOT A ZERO (§∅). `classifyRoot` already separates the three
 * reasons — a placeholder row, a remote host, a path absent here — and each is counted and named, so
 * a narrowed scope is visible. The primary checkout's `uploads/` tree is written as a placeholder in
 * the doc, which is why `extra` exists: the eleven year-ruled tools are pointed at it by `--dir`, so
 * a gate that never walked it would miss the first night that crosses the boundary.
 *
 * 🔴 THE WALK IS RECURSIVE AND THE VERDICT STATES ITS DEPTH. Row
 * 2026-10-28-the-horizon-tripwire-judges-a-one-level-night-population: this collector read ONE level
 * and published the union as `nightsOffered` with no depth beside it, so a night nested under a
 * documented root never reached the rules it judges. The corpus nests. Measured here on 2026-10-28,
 * three of the five readable roots offer ZERO names to a one-level read while holding 109, 147 and 2
 * one level down, and a 2027 directory under any of them would escape the probe built to catch
 * exactly that directory.
 *
 * 🔴 THIS IS NOT `snapshotNights` WIDENED. That primitive keeps its one-level contract, because a
 * scorer's population is what its own `--dir` offers directly and eleven shipped tools take theirs
 * from it. The question HERE scores nothing — it asks which names the corpus holds at all, which is
 * the CENSUS question — so it takes the census walk and states its depth the way
 * `corpus-scope.mjs --nights` does.
 *
 * No root-count is summed. The documented roots nest and alias, so one total over them would name no
 * set; each row carries its own `directories` beside the union of names.
 *
 * PURE given `lister`, which is REQUIRED and injected — the contract `nightDirsUnder` sets, because
 * the shipped walker shells out and a collector nobody can plant is how the one-level read shipped.
 */
export function corpusNights(docText, { resolver = (p) => realpathSync(p), extra = [], lister } = {}) {
  if (typeof lister !== 'function') {
    throw new TypeError('corpusNights: a lister is required — an absent walker throws rather than publishing an empty corpus');
  }
  const parsed = parseRoots(docText);
  const rows = dedupeRoots(
    parsed.map((r) => ({ root: r.path, count: r.countable ? 0 : null, why: r.why })),
    resolver
  );
  const excluded = { elided: 0, remote: 0, absent: 0, 'not-absolute': 0, alias: 0 };
  const roots = [];
  const names = new Set();
  /* ∅: an unwalkable root carries `directories: null`, never 0 — "nobody looked" is not "none". */
  const walk = (root, extraFields = {}) => {
    const w = nightDirsUnder(resolve(root), { lister });
    if (!w.ok) excluded.absent++;
    roots.push({ root, ok: w.ok, n: w.ok ? w.names.length : 0, directories: w.ok ? w.directories : null, reason: w.ok ? null : w.reason, ...extraFields });
    for (const n of w.names || []) names.add(n);
  };
  for (const r of rows) {
    if (r.count === null) {
      excluded[r.why] = (excluded[r.why] || 0) + 1;
      roots.push({ root: r.root, ok: false, n: 0, directories: null, reason: r.why });
      continue;
    }
    if (r.counted === false) {
      excluded.alias++;
      roots.push({ root: r.root, ok: false, n: 0, directories: null, reason: r.why });
      continue;
    }
    walk(r.root);
  }
  for (const root of extra) walk(root, { caller: true });
  return { roots, excluded, nights: [...names].sort(), readable: roots.filter((r) => r.ok).length, depth: 'recursive' };
}

/** One verdict over the pair. PURE in its inputs, so the selftest plants both halves. */
export function horizonVerdict({ rules, unparsed, nights, roots, excluded = null, depth = null, commit = null, commitReason = null, at = null }) {
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const base = {
    gate: 'night-rule-horizon',
    scope: 'internal',
    criterion: { name: 'nights_refused_by_a_declared_rule', threshold: 0, unit: 'nights', direction: 'lte' },
    evidence: [SELF, 'tools/corpus-scope.mjs', DOC],
    producedBy: producedByOf(SELF, commit, commitReason),
    at: stamp
  };
  /* 🔴 A COUNT BESIDE ONE LINE NUMBER READS AS THAT LINE REPEATING. A rule passed from several
     places folds into one row, so the row names its first site and then every other line it was
     read at. A reader follows all of them, never the first alone. One line can hold two calls, and
     `corpus-scope.mjs:260` does, so a repeated number in that list is a measurement rather than a
     duplicate. */
  const site = (r) => {
    const n = r.occurrences || 1;
    const at = r.lines || [];
    return `${r.tool}:${r.line} ${r.rule}${n > 1 ? ` \u00d7${n}` : ''}${at.length > 1 ? ` (at ${at.join(', ')})` : ''}`;
  };
  const occ = (rs) => rs.reduce((a, r) => a + (r.occurrences || 1), 0);
  const plants = rules.filter((r) => r.inSelftest);
  const shipped = rules.filter((r) => !r.inSelftest);
  /* A shipped rule that admits no night of the corpus year is already past its horizon, which is the
     defect this gate exists for in its arrived form. It leaves the refusal population and reds on its
     own reason, so one dead tool cannot read as hundreds of refused nights. */
  const expired = shipped.filter((r) => !r.admitsFirst);
  const judged = shipped.filter((r) => r.admitsFirst);
  const pinned = judged.filter((r) => r.horizon != null);
  const horizons = pinned.map((r) => r.horizon);
  const earliest = horizons.length ? Math.min(...horizons) : null;
  const atEarliest = [...new Set(pinned.filter((r) => r.horizon === earliest).map((r) => r.tool))].sort();
  const refused = [];
  for (const r of judged) for (const n of nights) if (!r.re.test(n)) refused.push({ tool: r.tool, rule: r.rule, night: n });
  const result = {
    rulesDeclared: rules.length,
    sitesDeclared: occ(rules),
    rulesJudged: judged.length,
    sitesJudged: occ(judged),
    rulesPinned: pinned.length,
    toolsPinned: [...new Set(pinned.map((r) => r.tool))].length,
    rulesInSelftest: plants.length,
    sitesInSelftest: occ(plants),
    selftestSites: plants.map(site).sort(),
    rulesExpired: expired.length,
    expiredSites: expired.map(site).sort(),
    earliestHorizonYear: earliest,
    toolsAtEarliestHorizon: atEarliest,
    nightsOffered: nights.length,
    /* The figure means nothing without the walk that produced it, and a guessed word would be worse
       than none: an unstated depth reads null (row
       2026-10-28-the-horizon-tripwire-judges-a-one-level-night-population). */
    nightsDepth: depth,
    rootsReadable: roots.filter((x) => x.ok).length,
    rootsOffered: roots.length,
    rootsExcluded: excluded,
    refused: refused.length
  };
  if (unparsed.length)
    return Verdict.make({
      ...base,
      status: 'FAIL',
      population: { checked: 0, eligible: nights.length, excluded: nights.length },
      result: { ...result, unparsed },
      reason: `${unparsed.length} declared night rule site(s) could not be read, so this run cannot state a horizon: ${unparsed.join('; ')}`
    });
  if (!judged.length)
    return Verdict.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result,
      reason: `no shipped tool declares a night rule that admits ${PROBE_FIRST_YEAR}, so there is no horizon to measure: ${rules.length} declared, ${plants.length} inside a selftest, ${expired.length} admitting no night of ${PROBE_FIRST_YEAR}`
    });
  if (!nights.length)
    return Verdict.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result,
      reason: `${roots.filter((x) => x.ok).length} of ${roots.length} documented root(s) enumerated and offered no night-shaped directory, so no night was tested against the ${rules.length} declared rule(s)`
    });
  if (expired.length)
    return Verdict.make({
      ...base,
      status: 'FAIL',
      population: { checked: nights.length, eligible: nights.length, excluded: 0 },
      result,
      reason: `${expired.length} shipped night rule site(s) admit no night of ${PROBE_FIRST_YEAR}, so each scores nothing today: ${result.expiredSites.join('; ')}`
    });
  if (refused.length) {
    const first = refused.slice(0, 4).map((x) => `${x.tool} refuses ${x.night} under ${x.rule}`);
    return Verdict.make({
      ...base,
      status: 'FAIL',
      population: { checked: nights.length, eligible: nights.length, excluded: 0 },
      result,
      reason: `${refused.length} night-and-rule pair(s) refuse a night the corpus holds today: ${first.join('; ')}${refused.length > 4 ? ` and ${refused.length - 4} more` : ''}`
    });
  }
  return Verdict.make({
    ...base,
    status: 'PASS',
    population: { checked: nights.length, eligible: nights.length, excluded: 0 },
    result,
    reason: null
  });
}

/* The one sentence a reader needs: the program ages out on a date, and these tools carry it. */
export function horizonLine(v) {
  const r = v.result || {};
  if (r.earliestHorizonYear == null) return '  no declared night rule carries a horizon inside the probe window';
  return `  the earliest horizon is ${r.earliestHorizonYear}-01-01, carried by ${r.toolsAtEarliestHorizon.length} tool(s): ${r.toolsAtEarliestHorizon.join(', ')}`;
}

function sampleRules() {
  const pinned = compileLiteral('/^2026-/');
  const shape = compileLiteral('/^\\d{4}-\\d{2}-\\d{2}$/');
  return [
    { tool: 'tools/pat-mode-posture.mjs', line: 476, rule: '/^2026-/', inSelftest: false, re: pinned, ...horizonOf(pinned) },
    { tool: 'tools/tch-multinight.mjs', line: 849, rule: '/^\\d{4}-\\d{2}-\\d{2}$/', inSelftest: false, re: shape, ...horizonOf(shape) }
  ];
}

/* One synthetic pair, so the shape `verify:verdict-adoption` parses needs no corpus. */
function verdictSample() {
  return horizonVerdict({
    rules: sampleRules(),
    unparsed: [],
    nights: ['2026-06-10', '2026-06-11'],
    roots: [{ root: 'uploads/trio', ok: true, n: 2, directories: 2, reason: null }],
    depth: 'recursive',
    at: '2026-10-26T00:00:00Z'
  });
}

function selftest() {
  let fail = 0;
  const PASSED = [];
  const ok = (name, cond, detail) => {
    if (cond) {
      PASSED.push(name);
      console.log(`  ok   ${name}`);
    } else {
      console.log(`  FAIL ${name} — ${detail}`);
      fail++;
    }
  };
  console.log('### THE HORIZON IS MEASURED, NOT READ OFF THE DIGITS');
  const yr = horizonOf(compileLiteral('/^2026-/'));
  ok('a year-pinned rule admits the corpus year and carries a horizon', yr.admitsFirst && yr.horizon === 2027, JSON.stringify(yr));
  const shape = horizonOf(compileLiteral('/^\\d{4}-\\d{2}-\\d{2}$/'));
  ok('the shape rule admits every probed year, so it has no horizon', shape.admitsFirst && shape.horizon === null, JSON.stringify(shape));
  /* A rule that refuses the FIRST year scores nothing today. It must not read as a pin on a later
     year, or a dead tool would publish a future horizon. */
  const dead = horizonOf(compileLiteral('/^2019-/'));
  ok('a rule that refuses the corpus year reads as admitting nothing, not as a later pin', !dead.admitsFirst, JSON.stringify(dead));

  /* ── THE OWNER'S 2027 DIRECTORY, READ OFF A REAL DISK ──────────────────────────────────────
     Owner ruling 2026-10-28 on row `2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year`:
     a night is any `YYYY-MM-DD` name whatever the year, held in ONE shared constant. Every leg
     above probes a SYNTHETIC name against a compiled pattern, so none of them would catch a rule
     that admits the string while the walk still drops the directory. These two plant a 2027 night
     under a real root and read it back through the production primitive, once under the shared
     constant and once under every rule the eleven actually declare. A rule re-pinned to a year
     reds HERE, against a directory on disk, rather than against a regular expression. */
  console.log('\n### THE SHARED RULE, AGAINST A 2027 DIRECTORY ON DISK');
  const planted = mkdtempSync(join(tmpdir(), 'night-horizon-'));
  for (const n of ['2026-06-10', '2027-01-04']) mkdirSync(join(planted, n), { recursive: true });
  const shared = snapshotNights(planted);
  ok(
    'the shared constant admits a 2027 night directory and refuses none of the two',
    shared.ok === true && shared.n === 2 && shared.nights.includes('2027-01-04') && shared.rejectedNightShaped.length === 0,
    JSON.stringify(shared.nights)
  );
  /* THE SCORERS, NOT THE PLANTS. A rule below a file's own `function selftest(` line exists to
     prove the primitive refuses, so it must stay refusing; only a declared SCORING rule owes the
     2027 directory. */
  const refusing = declaredRules()
    .rules.filter((r) => !r.inSelftest && !snapshotNights(planted, { re: r.re }).nights.includes('2027-01-04'))
    .map((r) => `${r.tool}:${r.line} ${r.rule}`);
  ok('every declared SCORING rule reads the planted 2027 night back off the disk', refusing.length === 0, refusing.join(', '));

  console.log('\n### PLANT · A NIGHT OUTSIDE THE RULE REDS, AND THE REASON NAMES THE PAIR');
  const rules = sampleRules();
  const roots = [{ root: 'planted', ok: true, n: 2, reason: null }];
  const clean = horizonVerdict({ rules, unparsed: [], nights: ['2026-06-10'], roots, at: '2026-10-26T00:00:00Z' });
  ok('the 2026-only corpus passes', clean.status === 'PASS' && clean.result.refused === 0, clean.status);
  const crossed = horizonVerdict({ rules, unparsed: [], nights: ['2026-06-10', '2027-01-04'], roots, at: '2026-10-26T00:00:00Z' });
  ok('one 2027 night reds the gate', crossed.status === 'FAIL', crossed.status);
  ok('…and the reason names the tool, the night and the rule', /pat-mode-posture\.mjs refuses 2027-01-04 under \/\^2026-\//.test(String(crossed.reason)), String(crossed.reason));
  /* THE NEGATIVE CONTROL for the plant above: the shape rule in the same run refuses nothing, so a
     FAIL cannot be an artefact of the walk. */
  ok('…while the shape rule in the same run refuses neither night', crossed.result.refused === 1, JSON.stringify(crossed.result));

  console.log('\n### A FIXTURE RULE LEAVES THE JUDGED SET BY NAME, AND THE SAME RULE SHIPPED REDS');
  /* The live read found three `re:` sites inside a selftest, one of them `/^2026-07-25$/`, which
     refuses every other night the corpus holds. Judged, it reported 174 refused pairs over one
     deliberate fixture, which is a count of the gate's own blind spot rather than of a defect. */
  const plantRe = compileLiteral('/^2026-07-25$/');
  const plant = { tool: 'tools/corpus-scope.mjs', line: 1086, rule: '/^2026-07-25$/', inSelftest: true, re: plantRe, ...horizonOf(plantRe) };
  const withPlant = horizonVerdict({ rules: [...rules, plant], unparsed: [], nights: ['2026-06-10'], roots, at: '2026-10-26T00:00:00Z' });
  ok(
    'a rule written inside a selftest refuses a corpus night and does not red the gate',
    withPlant.status === 'PASS' && withPlant.result.refused === 0,
    `${withPlant.status} ${withPlant.result.refused}`
  );
  ok(
    '…and the verdict names the excluded site rather than dropping it',
    withPlant.result.rulesInSelftest === 1 && /corpus-scope\.mjs:1086/.test(withPlant.result.selftestSites.join(' ')),
    JSON.stringify(withPlant.result.selftestSites)
  );
  /* TWO UNITS, STATED SEPARATELY. Six legs in one file can pass one literal, so the row count and the
     site count differ, and a reader given one number takes it for the other. */
  const repeated = horizonVerdict({ rules: [...rules, { ...plant, occurrences: 6 }], unparsed: [], nights: ['2026-06-10'], roots, at: '2026-10-26T00:00:00Z' });
  ok(
    'a rule passed by six legs is one row and six sites, and the verdict states both',
    repeated.result.rulesInSelftest === 1 && repeated.result.sitesInSelftest === 6,
    `${repeated.result.rulesInSelftest} row(s), ${repeated.result.sitesInSelftest} site(s)`
  );
  ok(
    '…and the named site carries its own occurrence count',
    /corpus-scope\.mjs:1086 \/\^2026-07-25\$\/ \u00d76/.test(repeated.result.selftestSites.join(' ')),
    JSON.stringify(repeated.result.selftestSites)
  );
  /* THE CONTROL. One field differs, and the same rule now reds on its own reason. */
  const expired = horizonVerdict({ rules: [...rules, { ...plant, inSelftest: false }], unparsed: [], nights: ['2026-06-10'], roots, at: '2026-10-26T00:00:00Z' });
  ok(
    '…while the same rule outside a selftest reds as a site already past its horizon',
    expired.status === 'FAIL' && /admit no night of 2026/.test(String(expired.reason)),
    `${expired.status} ${expired.reason}`
  );
  ok('…and that reason counts the site once, never once per night', expired.result.rulesExpired === 1 && expired.result.refused === 0, JSON.stringify(expired.result.rulesExpired));

  console.log('\n### A RULE BUILT INTO A NAMED OPTIONS OBJECT IS A SECOND SITE FAMILY');
  /* 🔴 TWO REGEXES THAT SHARE A BLIND SPOT CANNOT SEE WHAT BOTH MISS. The inline reader counted a
     site by the same `re:`-inside-the-call text it resolved by. So `snapshotNights(nr, narrow)` was
     neither counted nor read, and the fail-closed arm had nothing to compare. */
  const objText = 'const narrow = { re: /^2026-07-25$/ };\nsnapshotNights(nr, narrow);\n';
  ok('a rule built into a named object resolves through the binding', objectRule(objText, 'narrow').rule === '/^2026-07-25$/', JSON.stringify(objectRule(objText, 'narrow')));
  const twoBindings = `${objText}const narrow = { re: /^2027-/ };\n`;
  ok('…and two bindings of one name resolve to nothing, so the census fails closed', objectRule(twoBindings, 'narrow').re === null, JSON.stringify(objectRule(twoBindings, 'narrow')));
  const ruleless = 'const opts = { limit: 3 };\nsnapshotNights(nr, opts);\n';
  ok('…while a binding holding no rule is skipped rather than read as unread', objectRule(ruleless, 'opts').none === true, JSON.stringify(objectRule(ruleless, 'opts')));

  console.log('\n### IT FAILS CLOSED');
  const blind = horizonVerdict({ rules, unparsed: ['tools/x.mjs 2 site(s), 1 read'], nights: ['2026-06-10'], roots, at: '2026-10-26T00:00:00Z' });
  ok('an unreadable rule site fails rather than passing over what it could not read', blind.status === 'FAIL' && blind.population.checked === 0, blind.status);
  const empty = horizonVerdict({ rules, unparsed: [], nights: [], roots: [{ root: 'planted', ok: false, n: 0, reason: 'ENOENT' }], at: '2026-10-26T00:00:00Z' });
  ok('no night offered is NOT_RUN, never a PASS over nothing', empty.status === 'NOT_RUN' && empty.population.checked === 0, empty.status);

  console.log('\n### THE LIVE READ FINDS THE DECLARED RULES IN THIS CHECKOUT');
  const live = declaredRules();
  ok('ANTI-VACUITY · the reader finds the declared rules', live.rules.length >= 2, `${live.rules.length} rule(s)`);
  ok('every site is readable, so the live read states a horizon', live.unparsed.length === 0, live.unparsed.join('; '));
  /* 🔴 THIS ASSERTION REVERSED ON 2026-10-28, AND ITS ANTI-VACUITY MOVED WITH IT. It used to read
     `>= 1`, which pinned the eleven year-ruled scorers in place by testing for them. The owner
     ruled that a night is any `YYYY-MM-DD`, so no SCORING rule may carry a horizon now. A bare
     `=== 0` would pass over an empty read, so the probe's own liveness is carried by the fixture
     rules on the next line, which stay pinned deliberately. */
  const livePinned = live.rules.filter((r) => r.horizon != null && r.admitsFirst && !r.inSelftest);
  ok('NO live scoring rule carries a horizon — every one of them is the shared constant', livePinned.length === 0, livePinned.map((r) => `${r.tool}:${r.line} ${r.rule}`).join(', '));
  const plantPinned = live.rules.filter((r) => r.horizon != null && r.admitsFirst && r.inSelftest);
  ok('ANTI-VACUITY · the probe still finds a pinned rule in this checkout, among the fixtures', plantPinned.length >= 1, `${plantPinned.length} pinned fixture rule(s)`);
  /* ANTI-VACUITY for the exclusion above: if this checkout held no fixture site, the plant legs
     would be testing a path the live read never walks. */
  const liveplants = live.rules.filter((r) => r.inSelftest);
  ok('…and the live read finds the fixture sites it must exclude', liveplants.length >= 1, liveplants.map((r) => `${r.tool}:${r.line}`).join(', '));
  /* ANTI-VACUITY for the family above. This checkout passes one fixture rule inline once and through
     a named object twice, so the row's occurrence count proves both readers ran. */
  const objFixture = live.rules.find((r) => r.rule === '/^2026-07-25$/');
  ok(
    '…and the live read counts the options-object sites beside the inline one',
    (objFixture?.occurrences ?? 0) >= 3,
    JSON.stringify(objFixture && { line: objFixture.line, occurrences: objFixture.occurrences })
  );
  /* The row carries every line it was read at, because a bare `×3` beside one line number would
     read as that one line repeating. */
  ok('…and the folded row names the other lines rather than only its first', (objFixture?.lines ?? []).length >= 3 && new Set(objFixture.lines).size >= 2, JSON.stringify(objFixture?.lines));
  ok('…and the sample validates against the contract', Verdict.validate(verdictSample()).ok !== false, JSON.stringify(Verdict.validate(verdictSample())));

  console.log('\n### THE COLLECTOR WALKS AT DEPTH, AND THE VERDICT SAYS WHICH DEPTH');
  /* Row 2026-10-28-the-horizon-tripwire-judges-a-one-level-night-population. The collector had no
     plant at all before this section — the live walk was its only caller — which is how a one-level
     read shipped inside a gate built to catch a directory that nests. `extra` plants a root without
     a doc to parse, and `lister` is the injected walker the shipped tool passes `findDirNames` as. */
  const hzLister = () => ['corpus', 'trio', '2026-06-10', '2027-01-04', 'notes'];
  const hzDeep = corpusNights('', { extra: ['/planted/corpus'], lister: hzLister });
  ok('a name the walker reports from below the root reaches the judged set', hzDeep.nights.join(',') === '2026-06-10,2027-01-04', JSON.stringify(hzDeep.nights));
  ok('…and the collector states the depth it walked', hzDeep.depth === 'recursive', JSON.stringify(hzDeep.depth));
  ok('…and the row carries its directory count beside the names', hzDeep.roots[0].directories === 2 && hzDeep.roots[0].n === 2, JSON.stringify(hzDeep.roots[0]));
  /* THE PAIR THAT MATTERS FOR §∅: a walked-and-hzEmpty root and an hzAbsent one must not read the
     same. The first is a measurement of zero, the second is the absence of a measurement. */
  const hzEmpty = corpusNights('', { extra: ['/planted/empty'], lister: () => [] });
  ok(
    'a root walked and holding nothing reads ok with a zero count',
    hzEmpty.roots[0].ok === true && hzEmpty.roots[0].directories === 0 && hzEmpty.excluded.absent === 0,
    JSON.stringify(hzEmpty.roots[0])
  );
  const hzAbsent = corpusNights('', { extra: ['/planted/absent'], lister: () => null });
  ok(
    '…while a root this machine cannot walk reads null directories, never zero',
    hzAbsent.roots[0].ok === false && hzAbsent.roots[0].directories === null && hzAbsent.excluded.absent === 1,
    JSON.stringify(hzAbsent.roots[0])
  );
  /* The lister is the enumeration, so its absence throws rather than publishing an hzEmpty corpus —
     the contract `nightDirsUnder` sets, and the reason a gate cannot silently stop walking. */
  let hzThrew = null;
  try {
    corpusNights('', { extra: ['/planted/corpus'] });
  } catch (e) {
    hzThrew = e;
  }
  ok('an absent lister throws rather than reporting a corpus of none', hzThrew instanceof TypeError && /lister is required/.test(hzThrew.message), String(hzThrew));
  /* ANTI-VACUITY for the depth field: it is the walk's own report, not a constant in the builder. A
     verdict built without one says null rather than borrowing the word the live run happens to use. */
  const hzNoDepth = horizonVerdict({ rules, unparsed: [], nights: ['2026-06-10'], roots, at: '2026-10-26T00:00:00Z' });
  ok('a verdict built with no stated depth publishes null, never a guessed word', hzNoDepth.result.nightsDepth === null, JSON.stringify(hzNoDepth.result.nightsDepth));
  const hzWithDepth = horizonVerdict({ rules, unparsed: [], nights: ['2026-06-10'], roots, depth: 'recursive', at: '2026-10-26T00:00:00Z' });
  ok(
    '…and the stated depth reaches the result beside the figure',
    hzWithDepth.result.nightsDepth === 'recursive' && hzWithDepth.result.nightsOffered === 1,
    JSON.stringify(hzWithDepth.result.nightsDepth)
  );

  const ran = PASSED.length + fail;
  console.log(`\n${fail ? `\u2717 ${fail} of ${ran} FAILED` : `\u2713 all ${ran} selftests passed \u00b7 the horizon is measured and the boundary reds`}`);
  return fail ? 1 : 0;
}

const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample'], valued: ['--doc', '--dir'] }, { tool: 'night-rule-horizon' });
  if (argv.includes('--selftest')) process.exit(selftest());
  /* The sample sits ABOVE the walk: `verify:verdict-adoption` reads it where the corpus is absent. */
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 2));
    process.exit(0);
  }
  const docPath = argv.indexOf('--doc') >= 0 ? argv[argv.indexOf('--doc') + 1] : join(REPO, DOC);
  const { rules, unparsed } = declaredRules();
  const uploads = process.env.DEX_UPLOADS || join(REPO, 'uploads');
  /* ONE root, where two used to sit: `uploads/trio` was listed beside `uploads` because the walk
     read one level, and the recursive walk reaches it from the parent alone. */
  const extra = argv.indexOf('--dir') >= 0 ? [argv[argv.indexOf('--dir') + 1]] : [uploads];
  const { roots, nights, excluded, depth } = corpusNights(readFileSync(docPath, 'utf8'), { extra, lister: findDirNames });
  /* The primitive owns the repo root and resolves its own commit; this tool stamps the same pair
     into its own verdict rather than borrowing a reason (`corpus-scope.mjs` records why). */
  const { commit, reason: commitReason } = gitCommitOf(REPO);
  const v = horizonVerdict({ rules, unparsed, nights, roots, excluded, depth, commit, commitReason });
  /* The walk's own account of its yardstick, beside the horizon the rules carry. */
  const pop = populationVerdict(
    {
      ok: true,
      root: docPath,
      reason: null,
      n: nights.length,
      nights,
      digest: null,
      maxCtimeMs: null,
      at: v.at,
      rule: String(NIGHT_RE),
      ruleIsDefault: true,
      rejectedNightShaped: [],
      admittedNonNight: []
    },
    {
      ok: true,
      root: docPath,
      reason: null,
      n: nights.length,
      nights,
      digest: null,
      maxCtimeMs: null,
      at: v.at,
      rule: String(NIGHT_RE),
      ruleIsDefault: true,
      rejectedNightShaped: [],
      admittedNonNight: []
    },
    { tool: SELF, at: v.at }
  );
  console.log(`POPULATION ${nights.length} night name(s) over ${roots.filter((r) => r.ok).length} readable root(s) of ${roots.length} documented, ${depth} walk`);
  const rl = ruleLine(pop);
  if (rl) console.log(rl);
  console.log(horizonLine(v));
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.status === 'FAIL' ? 1 : 0);
}
