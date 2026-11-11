#!/usr/bin/env node
/*
 * paper-claim-markers.mjs — which published papers bind a number to a committed artifact.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * A PUBLISHED NUMBER THAT NO MARKER BINDS IS PROSE, AND NO GATE READS PROSE.
 * Residue row `2026-11-08-twenty-papers-carry-no-claim-marker-and-the-resolver-skips-papers` has two
 * halves. The READER half landed as #4815: `tools/table-provenance-core.mjs` now lists `papers` in
 * `STAMP_ROOTS`, so a stamp inside a paper is read. The WRITER half is this one: 20 of the 23 papers
 * carry no `CLAIM` marker and no `TABLE-PROVENANCE` stamp, so the suite's resolver has nothing to
 * resolve there, and the row recorded that debt as unmeasured rather than wrong.
 *
 * THIS GATE MEASURES THE DEBT AND STOPS IT GROWING. It writes no marker, because each marker needs a
 * reader to bind one number to one committed artifact, and a wrong binding publishes a wrong
 * provenance. So today's unmarked set is FROZEN, and the gate reds on a paper the baseline does not
 * hold. The baseline may only SHRINK, which `--base` enforces against the ref.
 *
 *   node tools/paper-claim-markers.mjs                      # check
 *   node tools/paper-claim-markers.mjs --base origin/main    # …and refuse baseline GROWTH
 *   node tools/paper-claim-markers.mjs --json                # one tepna.verdict/1
 *   node tools/paper-claim-markers.mjs --verdict-sample      # the verdict shape, examining nothing
 *   node tools/paper-claim-markers.mjs --work-list           # the unmarked papers, and the artifact each could bind to
 *   node tools/paper-claim-markers.mjs --write-baseline      # freeze today's unmarked set
 *   node tools/paper-claim-markers.mjs --selftest
 *
 * THE POPULATION, AND WHY EVERY EXCLUSION SHRINKS THE FINDING SET. Eligible is each `papers/*.html`
 * file. Two classes leave the checked set with a named reason, and both withhold judgement:
 *
 *   | class                 | why this screen cannot decide it |
 *   |-----------------------|----------------------------------|
 *   | `index-page`          | `papers/papers.html` lists the papers; it publishes no result of its own |
 *   | `no-published-number` | the body states no number, so there is nothing for a marker to bind |
 *
 * THE NUMBER SCREEN IS DELIBERATELY NARROW. A four-digit year, an ISO date and an in-repo `<code>`
 * pointer are not published results, and the reference list is the other papers' numbers, not this
 * paper's. All four are removed before the screen reads a digit. A version string (`v1.2.3`) would
 * read as a number, which widens the CHECKED set and can only cost the gate a finding it must then
 * justify — it cannot hide one.
 *
 * A MALFORMED STAMP IS NOT A MARKER. `parseStamps` reports a stamp with no `producer=`, no `output=`
 * or no table above it as malformed, and this gate counts it as absent, because a marker that the
 * resolver refuses binds nothing. The paper's finding line names it, so the two cases never read alike.
 *
 * ⚠️ WHAT A BASELINED PAPER IS NOT. It is not approved. It is GRANDFATHERED, and the only legal way to
 * retire a key is to bind one of its numbers with a marker the suite resolves, or to drop the paper.
 * A key that names no file reds: a baseline that describes a tree which no longer exists has stopped
 * measuring anything.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { stripElement, stripTags } from './strip-markup.mjs';
import { parseStamps } from './table-provenance-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
export const BASELINE_PATH = 'tools/paper-claim-marker-baseline.json';
export const EXCLUSION_REASONS = ['index-page', 'no-published-number'];
export const INDEX_PAGE = 'papers/papers.html';
export const ARTIFACT_DIR = 'analysis/published-numbers';
export const BASELINE_REASON = 'residue 2026-11-08-twenty-papers-carry-no-claim-marker-and-the-resolver-skips-papers · board #4527 CitB-1';

const REFS_RE = /<ol class="refs">[\s\S]*?<\/ol>/g;
/* The suite's own CLAIM grammar (`tests/run-tests.mjs`), matching the bare and the sourced form alike:
   either one gives the number a name a resolver can read, which is what the row counts. */
const CLAIM_RE = /CLAIM\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const NUMBER_RE = /\d+(?:\.\d+)?/;

/**
 * The paper's own prose: no script, no style, no reference list, no in-repo `<code>` pointer, no markup.
 *
 * @param {string} html the page
 * @returns {string} the visible text, one line
 */
export function bodyText(html) {
  let s = stripElement(String(html || ''), 'script');
  s = stripElement(s, 'style');
  s = s.replace(REFS_RE, ' ');
  s = stripElement(s, 'code');
  return stripTags(s).replace(/\s+/g, ' ').trim();
}

/**
 * Does the body state a number a marker could bind? Years and ISO dates are stamps, not results.
 *
 * @param {string} body the paper's visible text
 * @returns {boolean}
 */
export function publishesNumber(body) {
  const s = String(body || '')
    .replace(ISO_DATE_RE, ' ')
    .replace(YEAR_RE, ' ');
  return NUMBER_RE.test(s);
}

/**
 * One paper read for markers. Pure: the caller reads the file.
 *
 * @param {{file: string, text: string}} paper
 * @returns {{file: string, excluded: string|null, claims: string[], stamps: number, malformedStamps: string[], marked: boolean}}
 */
export function scanPaper({ file, text }) {
  const src = String(text || '');
  const out = { file, excluded: null, claims: [], stamps: 0, malformedStamps: [], marked: false };
  if (file === INDEX_PAGE) {
    out.excluded = 'index-page';
    return out;
  }
  if (!publishesNumber(bodyText(src))) {
    out.excluded = 'no-published-number';
    return out;
  }
  for (const m of src.matchAll(new RegExp(CLAIM_RE.source, 'g'))) out.claims.push(m[1]);
  const st = parseStamps(src, file);
  out.stamps = st.stamps.length;
  out.malformedStamps = st.malformed.slice();
  out.marked = out.claims.length > 0 || out.stamps > 0;
  return out;
}

/**
 * The artifacts an unmarked paper could bind to, by shared slug token. A HINT for the reader who
 * writes the marker, never a criterion: a shared token means the names agree, not that the numbers do.
 *
 * @param {string} file a paper path
 * @param {string[]} artifacts the file names under `analysis/published-numbers`
 * @returns {string[]} the candidate artifact names
 */
export function artifactCandidates(file, artifacts) {
  const toks = String(file || '')
    .replace(/^papers\//, '')
    .replace(/\.html$/, '')
    .split('-')
    .filter((t) => t.length >= 4);
  return (artifacts || []).filter((a) => toks.some((t) => a.includes(t))).sort();
}

/**
 * The census over every paper, plus the ratchet's state.
 *
 * @param {{file: string, text: string}[]} papers
 * @param {Record<string, string>} baseline the grandfathered unmarked set
 * @param {string[]} [artifacts] the file names under `analysis/published-numbers`
 */
export function census(papers, baseline, artifacts = []) {
  const base = baseline && typeof baseline === 'object' ? baseline : {};
  const list = papers || [];
  const c = {
    papers: list.length,
    eligible: list.length,
    checked: 0,
    excluded: 0,
    byReason: {},
    marked: 0,
    claims: 0,
    stamps: 0,
    malformedStamps: [],
    unmarked: [],
    unbaselined: [],
    discharged: [],
    unresolvedBaseline: [],
    workList: {}
  };
  for (const r of EXCLUSION_REASONS) c.byReason[r] = 0;
  const seen = new Set();
  for (const p of list) {
    seen.add(p.file);
    const s = scanPaper(p);
    if (s.excluded) {
      c.excluded++;
      c.byReason[s.excluded] = (c.byReason[s.excluded] || 0) + 1;
      continue;
    }
    c.checked++;
    c.claims += s.claims.length;
    c.stamps += s.stamps;
    for (const m of s.malformedStamps) c.malformedStamps.push(m);
    if (s.marked) {
      c.marked++;
      continue;
    }
    c.unmarked.push(s.file);
    c.workList[s.file] = artifactCandidates(s.file, artifacts);
    if (!(s.file in base)) c.unbaselined.push(s.file);
  }
  const live = new Set(c.unmarked);
  for (const k of Object.keys(base)) {
    if (!seen.has(k)) c.unresolvedBaseline.push(k);
    else if (!live.has(k)) c.discharged.push(k);
  }
  return c;
}

/** @param {Record<string, string>} prior @param {Record<string, string>} now */
export function baselineGrowth(prior, now) {
  const was = new Set(Object.keys(prior || {}));
  return Object.keys(now || {}).filter((k) => !was.has(k));
}

/**
 * A census that examined no paper decides nothing — CLAUDE.md §4b. An absent `papers/` directory reads
 * exactly like a clean tree, so it refuses; a corpus whose every paper is excluded examined each one
 * and found the rule does not bind.
 *
 * @param {ReturnType<typeof census>} c
 */
export function censusStatus(c) {
  if (!c.eligible) return 'NOT_RUN';
  if (!c.checked) return 'NOT_APPLICABLE';
  return c.unbaselined.length || c.unresolvedBaseline.length ? 'FAIL' : 'PASS';
}

function headSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export function verdictOf({ c, growth = [], status, reason = null, growthExamined = null }) {
  const st = status || censusStatus(c);
  const v = Verdict.make({
    gate: 'paper-claim-markers',
    status: st,
    population: { checked: c.checked, eligible: c.eligible, excluded: c.excluded },
    criterion: {
      name: 'no_unmarked_paper_outside_the_baseline',
      threshold: 0,
      unit: 'papers',
      direction: 'eq'
    },
    result:
      st === 'NOT_RUN'
        ? null
        : {
            papersScanned: c.papers,
            marked: c.marked,
            claimMarkers: c.claims,
            provenanceStamps: c.stamps,
            malformedStamps: c.malformedStamps.slice(),
            unmarked: c.unmarked.length,
            grandfathered: c.unmarked.length - c.unbaselined.length,
            unbaselined: c.unbaselined.slice(),
            unresolvedBaseline: c.unresolvedBaseline.slice(),
            discharged: c.discharged.length,
            excludedByReason: c.byReason,
            baselineGrowth: (growth || []).slice(),
            baselineGrowthExamined: growthExamined
          },
    evidence: ['tools/paper-claim-markers.mjs', BASELINE_PATH, 'briefs/RESIDUE.md'],
    reason:
      st === 'PASS'
        ? null
        : reason || (st === 'NOT_RUN' ? 'no paper was read' : st === 'NOT_APPLICABLE' ? 'every paper left the checked set with a named reason' : 'a paper states a number that no marker binds'),
    producedBy: { tool: 'tools/paper-claim-markers.mjs', commit: headSha() },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`paper-claim-markers produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

export function readPapers(root = ROOT) {
  const dir = join(root, 'papers');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => ({ file: `papers/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
}

export function readArtifacts(root = ROOT) {
  const dir = join(root, ARTIFACT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function readBaseline(root = ROOT) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return {};
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return j.unmarked && typeof j.unmarked === 'object' ? j.unmarked : {};
}

export function selftest() {
  let ran = 0;
  const fail = [];
  const ok = (cond, what) => {
    ran++;
    if (!cond) fail.push(what);
  };
  const page = (body) => `<html><body>${body}</body></html>`;
  const paper = (file, body) => ({ file, text: page(body) });
  const stamp = (producer, output) => `<table><tr><td>7</td></tr></table>\n<!-- TABLE-PROVENANCE producer="${producer}" output="${output}" -->`;

  // THE TWO OUTCOMES, each against the other as its control.
  const bare = scanPaper(paper('papers/a.html', '<p>The median was 4.2 ms. CLAIM aMedian = 4.2</p>'));
  ok(bare.marked && bare.claims.length === 1 && bare.excluded === null, 'a CLAIM marker marks the paper');
  const none = scanPaper(paper('papers/a.html', '<p>The median was 4.2 ms.</p>'));
  ok(!none.marked && none.claims.length === 0 && none.excluded === null, 'the same prose with no marker reads unmarked');

  const sourced = scanPaper(paper('papers/a.html', '<p>CLAIM aNights = 49 FROM analysis/published-numbers/x.json#claims/nights</p>'));
  ok(sourced.marked && sourced.claims[0] === 'aNights', 'the sourced form marks the paper too');

  const stamped = scanPaper({ file: 'papers/a.html', text: page(`<p>49 nights.</p>${stamp('tools/x.mjs', 'abc123def456')}`) });
  ok(stamped.marked && stamped.stamps === 1 && stamped.malformedStamps.length === 0, 'a TABLE-PROVENANCE stamp marks the paper');
  const malformed = scanPaper({ file: 'papers/a.html', text: page('<p>49 nights.</p><!-- TABLE-PROVENANCE producer="tools/x.mjs" -->') });
  ok(!malformed.marked && malformed.stamps === 0 && malformed.malformedStamps.length === 1, 'a malformed stamp binds nothing, and is reported');

  // THE EXCLUSIONS, each against a checked control.
  const index = scanPaper(paper(INDEX_PAGE, '<p>The 23 papers.</p>'));
  ok(index.excluded === 'index-page' && !index.marked, 'the index page leaves the checked set');
  const prose = scanPaper(paper('papers/b.html', '<p>We found no effect at all.</p>'));
  ok(prose.excluded === 'no-published-number', 'a body with no number leaves the checked set');
  ok(scanPaper(paper('papers/b.html', '<p>We found 0.3 of an effect.</p>')).excluded === null, 'a body with a number stays in it');

  // THE NUMBER SCREEN's own controls.
  ok(!publishesNumber('Published in 2026. Revised 2026-11-08.'), 'a year and an ISO date are not published numbers');
  ok(publishesNumber('The ICC was 0.91.'), 'a decimal is');
  ok(bodyText('<p>5 ms</p><ol class="refs"><li>Bland JM 1986;1:307.</li></ol>') === '5 ms', 'the reference list is not the paper body');
  ok(bodyText('<script>var n = 7;</script><p>no result</p>') === 'no result', 'a script body is not the paper body');
  ok(!publishesNumber(bodyText('<p>see <code>tools/x.mjs:68</code></p>')), 'an in-repo pointer is not a published number');

  // THE RATCHET, both directions.
  const papers = [paper('papers/a.html', '<p>4.2 ms. CLAIM aMedian = 4.2</p>'), paper('papers/b.html', '<p>0.91 ICC.</p>'), paper(INDEX_PAGE, '<p>2 papers.</p>')];
  const open = census(papers, {});
  ok(open.checked === 2 && open.excluded === 1 && open.eligible === 3, 'the population arithmetic holds: checked + excluded = eligible');
  ok(open.unmarked.length === 1 && open.unbaselined.length === 1 && censusStatus(open) === 'FAIL', 'an unmarked paper outside the baseline reds');
  const held = census(papers, { 'papers/b.html': BASELINE_REASON });
  ok(held.unmarked.length === 1 && held.unbaselined.length === 0 && censusStatus(held) === 'PASS', 'the same paper inside the baseline passes');
  const fixed = census([paper('papers/b.html', '<p>0.91 ICC. CLAIM bIcc = 0.91</p>')], { 'papers/b.html': BASELINE_REASON });
  ok(fixed.discharged.length === 1 && fixed.unmarked.length === 0, 'a paper that gained a marker reads discharged');
  const gone = census([paper('papers/a.html', '<p>4.2 ms. CLAIM aMedian = 4.2</p>')], { 'papers/zz.html': BASELINE_REASON });
  ok(gone.unresolvedBaseline.length === 1 && censusStatus(gone) === 'FAIL', 'a baseline key that names no paper reds');
  ok(baselineGrowth({ 'papers/b.html': 'x' }, { 'papers/b.html': 'x', 'papers/c.html': 'x' }).length === 1, 'an appended key reads as growth');
  ok(baselineGrowth({ 'papers/b.html': 'x', 'papers/c.html': 'x' }, { 'papers/b.html': 'x' }).length === 0, 'a dropped key does not');

  // THE WORK LIST is a hint, and the gate's state never moves with it.
  ok(
    artifactCandidates('papers/sigma-no-reference.html', ['sigma-corpus-2026-10-21.json', 'ahi-refit-2026-10-13.json'])[0] === 'sigma-corpus-2026-10-21.json',
    'a shared slug token names the candidate artifact'
  );
  ok(artifactCandidates('papers/b.html', ['sigma-corpus-2026-10-21.json']).length === 0, 'a paper sharing no token names none');
  ok(census(papers, {}, []).unbaselined.length === census(papers, {}, ['sigma-corpus-2026-10-21.json']).unbaselined.length, 'the artifact list cannot change the finding set');

  // THE REFUSALS.
  ok(censusStatus(census([], {})) === 'NOT_RUN', 'an empty corpus examines nothing and refuses');
  ok(censusStatus(census([paper(INDEX_PAGE, '<p>2 papers.</p>')], {})) === 'NOT_APPLICABLE', 'a corpus of nothing but excluded papers is not applicable');

  // THE VERDICT.
  const v = verdictOf({ c: held });
  ok(v.status === 'PASS' && v.population.checked === 2 && v.result.grandfathered === 1, 'the verdict validates and carries the population it judged');
  ok(verdictOf({ c: census([], {}) }).result === null, 'a NOT_RUN verdict carries no result');
  ok(
    v.result.baselineGrowthExamined === null && verdictOf({ c: held, growthExamined: false }).result.baselineGrowthExamined === false,
    'the verdict states whether baseline growth was examined, so an unresolved --base is not a silent green'
  );

  const line = fail.length ? `paper-claim-markers selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--verdict-sample')) {
    process.stdout.write(`${JSON.stringify(verdictOf({ c: census([], {}), status: 'NOT_RUN', reason: 'sample only; this invocation read no paper' }), null, 1)}\n`);
    process.exit(0);
  }

  if (argv.includes('--selftest')) {
    const r = selftest();
    for (const f of r.fail) process.stderr.write(`✕ ${f}\n`);
    process.stdout.write(`${r.line}\n`);
    process.exit(r.ok ? 0 : 1);
  }

  const papers = readPapers();
  const artifacts = readArtifacts();
  const c = census(papers, readBaseline(), artifacts);

  if (argv.includes('--work-list')) {
    for (const f of c.unmarked) {
      const cand = c.workList[f] || [];
      process.stdout.write(`${f} — ${cand.length ? `could bind to ${ARTIFACT_DIR}/{${cand.join(', ')}}` : 'no artifact under ' + ARTIFACT_DIR + ' shares a slug token'}\n`);
    }
    process.stdout.write(`· ${c.unmarked.length} unmarked paper(s), ${c.unmarked.filter((f) => (c.workList[f] || []).length).length} with a candidate artifact\n`);
    process.exit(0);
  }

  if (argv.includes('--write-baseline')) {
    const unmarked = {};
    for (const k of c.unmarked) unmarked[k] = BASELINE_REASON;
    writeFileSync(
      join(ROOT, BASELINE_PATH),
      `${JSON.stringify(
        {
          note: 'The papers that state a number no CLAIM marker and no TABLE-PROVENANCE stamp binds. GRANDFATHERED, never approved: each one needs a reader to bind one number to one committed artifact. The set may only SHRINK.',
          generated: new Date().toISOString().slice(0, 10),
          unmarked
        },
        null,
        1
      )}\n`
    );
    process.stdout.write(`paper-claim-markers: wrote ${Object.keys(unmarked).length} baselined paper(s) to ${BASELINE_PATH}\n`);
    process.exit(0);
  }

  /* THE RATCHET'S OTHER HALF: without it, appending to the baseline is the escape hatch. */
  let growth = [];
  let growthExamined = null;
  const bi = argv.indexOf('--base');
  if (bi !== -1 && argv[bi + 1]) {
    const ref = argv[bi + 1];
    let resolved = true;
    try {
      execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      resolved = false;
    }
    /* AN ABSENT REF AND AN ABSENT FILE READ THE SAME THROUGH `git show`, and only the second is a legal
       green — CLAUDE.md §4b's family, success reported about something never examined. */
    growthExamined = resolved;
    if (!resolved) process.stderr.write(`· paper-claim-markers: --base ${ref} does not resolve here, so baseline growth was NOT examined\n`);
    else {
      try {
        const prior = JSON.parse(execFileSync('git', ['show', `${ref}:${BASELINE_PATH}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        growth = baselineGrowth(prior.unmarked || {}, readBaseline());
      } catch {
        /* ABSENT AT THE BASE IS NOT GROWTH — that is how this gate's own first commit passes. */
      }
    }
  }

  const reasons = [];
  if (c.unbaselined.length) reasons.push(`${c.unbaselined.length} paper(s) state a number outside the baseline`);
  if (c.unresolvedBaseline.length) reasons.push(`${c.unresolvedBaseline.length} baseline key(s) name no paper`);
  if (growth.length) reasons.push(`${growth.length} key(s) APPENDED to the baseline — a ratchet may only shrink`);
  const base = censusStatus(c);
  const status = base === 'PASS' && reasons.length ? 'FAIL' : base;

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(verdictOf({ c, growth, status, reason: reasons.join('; ') || null, growthExamined }), null, 1)}\n`);
  } else {
    for (const f of c.unbaselined) process.stderr.write(`✕ ${f} — a published number binds to nothing: add a CLAIM marker or a TABLE-PROVENANCE stamp\n`);
    for (const k of c.unresolvedBaseline) process.stderr.write(`✕ ${BASELINE_PATH} holds "${k}", which names no paper — drop the key\n`);
    for (const g of growth) process.stderr.write(`✕ ${BASELINE_PATH} gained "${g}" — the baseline may only shrink\n`);
    for (const m of c.malformedStamps) process.stdout.write(`· ${m} — the stamp binds nothing until it resolves\n`);
    if (c.discharged.length) process.stdout.write(`· ${c.discharged.length} baselined paper(s) now carry a marker — drop them with --write-baseline\n`);
    if (status === 'PASS')
      process.stdout.write(
        `paper-claim-markers: ✓ PASS — ${c.checked} of ${c.eligible} papers checked, ${c.marked} marked by ${c.claims} CLAIM marker(s) and ${c.stamps} stamp(s), ${c.unmarked.length} grandfathered\n`
      );
    else process.stderr.write(`\npaper-claim-markers: ${status} — ${reasons.join('; ') || 'the census examined nothing'}\n`);
  }
  process.exit(status === 'PASS' ? 0 : status === 'NOT_RUN' ? 2 : 1);
}

if (isCliEntry(import.meta.url)) main();
