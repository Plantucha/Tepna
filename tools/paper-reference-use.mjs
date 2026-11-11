#!/usr/bin/env node
/*
 * paper-reference-use.mjs — a paper's reference list read against its own body.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * A LISTED REFERENCE THAT THE BODY NEVER INVOKES CLAIMS A PROVENANCE THE PAPER NEVER USED.
 * Residue row `2026-11-08-treatment-response-lists-references-its-body-never-invokes`:
 * `papers/treatment-response.html` listed Killick, Truong, Giles and Kasai, and each name appeared
 * exactly once — inside `<ol class="refs">`. #4600 placed those four at the statements they support.
 * The census behind that row (board #4531) then read the same screen over all 24 papers and found the
 * defect in ten of them, so the fix for one paper left the class open and no gate watched it.
 *
 * CLAUDE.md §📚 holds the three literature lines, and `citation-ledger` enforces the DOI half of them:
 * a DOI on a reader-facing surface must name the ledger's first author. It says nothing about a
 * reference nobody cites, because an uninvoked entry carries no DOI claim to check. This gate is the
 * other half, and it reads the two channels the census read, nothing more.
 *
 *   node tools/paper-reference-use.mjs                     # check
 *   node tools/paper-reference-use.mjs --base origin/main   # …and refuse baseline GROWTH
 *   node tools/paper-reference-use.mjs --json               # one tepna.verdict/1
 *   node tools/paper-reference-use.mjs --verdict-sample     # the verdict shape, examining nothing
 *   node tools/paper-reference-use.mjs --write-baseline     # freeze today's uninvoked set
 *   node tools/paper-reference-use.mjs --selftest
 *
 * THE POPULATION, AND WHY EVERY EXCLUSION SHRINKS THE FINDING SET. Eligible is each `<li>` of a
 * reference list that carries a four-digit year and no `<code>` element — the `<code>` entries point
 * at this repository, so they are not external references. Two classes leave the checked set with a
 * named reason, and both withhold judgement rather than assert one:
 *
 *   | class                | why the surname screen cannot decide it |
 *   |----------------------|------------------------------------------|
 *   | `bracket-channel`    | the body carries a numbered citation, so position invokes an entry and the name need not appear (the census's AMBIGUOUS paper) |
 *   | `surname-unreadable` | no leading surname token reads out of the entry text |
 *
 * ⚠️ WHY A RATCHET. 40 entries in 8 papers read uninvoked today, and each one needs a reader to place
 * the source honestly in a body it did not write — eight units of judgement, not one sweep. So today's
 * set is FROZEN into a baseline and the gate reds only on an entry the baseline does not hold. The
 * baseline may only SHRINK, which `--base` enforces against the ref.
 *
 * ⚠️ WHAT A BASELINED ENTRY IS NOT. It is not approved. It is GRANDFATHERED, and the only legal way to
 * retire a row is to invoke the source in the body or to drop the entry from the list.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
export const BASELINE_PATH = 'tools/paper-reference-baseline.json';
export const EXCLUSION_REASONS = ['bracket-channel', 'surname-unreadable'];

const REFS_RE = /<ol class="refs">([\s\S]*?)<\/ol>/;
const LI_RE = /<li>([\s\S]*?)<\/li>/g;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;
/* An index citation, `[4]` or `[1,9]` or `[2–4]`. Validity is decided against the list LENGTH below:
   `[0,1]` is a probability interval in two of these papers, and a list has no entry 0. */
const BRACKET_RE = /\[\d{1,2}(?:\s*[,;–—-]\s*\d{1,2})*\]/g;
const INITIAL_RE = /^[A-Z]{1,3}\.?$/;
const PARTICLE_RE = /^(?:and|et|al|van|von|de|del|der|den|da|di|du|la|le|ten|ter)$/i;

/** @param {string} html a page or a fragment @returns {string} the visible text, one line */
export function visibleText(html) {
  return String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The leading surname of a reference entry. Initials, particles and a leading glyph are stepped over;
 * a corporate author reads as its first word (`Task Force of the ESC` → `Task`), which the census
 * stated as a limit and hand-checked.
 *
 * @param {string} text the entry's visible text
 * @returns {string|null} the surname, or null when none reads out
 */
export function surnameOf(text) {
  const s = String(text || '').replace(/^[^A-Za-z]+/, '');
  for (const tok of s.split(/\s+/)) {
    const w = tok.replace(/[,.;:]+$/, '');
    if (!w || INITIAL_RE.test(tok) || PARTICLE_RE.test(w)) continue;
    return /^[A-Z][A-Za-z'’À-ɏ-]+$/.test(w) ? w : null;
  }
  return null;
}

/**
 * The numbered citations a body carries, kept only where every index names a real list position.
 *
 * ⚠️ THE DENOMINATOR IS THE RENDERED LIST, NOT THE SCREENED SUBSET. An `<ol>` numbers every `<li>`,
 * including the companion-paper and project-documentation entries that eligibility drops, so passing
 * the eligible count would read a real `[7]` in a 10-entry list as out of range and put the paper
 * back under a screen that cannot judge it.
 *
 * @param {string} body the paper's visible text, reference list removed
 * @param {number} listLength the number of `<li>` the list renders
 * @returns {string[]} the surviving citation groups
 */
export function citationGroups(body, listLength) {
  const n = Number(listLength) || 0;
  return (String(body || '').match(BRACKET_RE) || []).filter((g) =>
    g
      .slice(1, -1)
      .split(/[,;–—-]/)
      .every((d) => {
        const v = Number(d.trim());
        return Number.isFinite(v) && v >= 1 && v <= n;
      })
  );
}

/**
 * One paper's reference list against its own body. Pure: the caller reads the file.
 *
 * @param {{file: string, text: string}} paper
 * @returns {{file: string, hasList: boolean, eligible: number, checked: number, excluded: {key: string, reason: string}[], uninvoked: string[], invoked: number}}
 */
export function scanPaper({ file, text }) {
  const out = { file, hasList: false, eligible: 0, checked: 0, excluded: [], uninvoked: [], invoked: 0 };
  const m = REFS_RE.exec(String(text || ''));
  if (!m) return out;
  out.hasList = true;
  const body = visibleText(String(text).slice(0, m.index) + String(text).slice(m.index + m[0].length));
  const rendered = [...m[1].matchAll(LI_RE)].map((x) => x[1]);
  const entries = rendered.filter((li) => YEAR_RE.test(li) && !/<code/.test(li));
  out.eligible = entries.length;
  const seen = new Map();
  const keyFor = (sur, year) => {
    const base = `${file}#${sur} ${year}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  };
  if (citationGroups(body, rendered.length).length) {
    for (const li of entries) {
      const t = visibleText(li);
      out.excluded.push({ key: keyFor(surnameOf(t) || '?', YEAR_RE.exec(t)?.[1] || '?'), reason: 'bracket-channel' });
    }
    return out;
  }
  for (const li of entries) {
    const t = visibleText(li);
    const sur = surnameOf(t);
    const year = YEAR_RE.exec(t)?.[1] || '?';
    if (!sur) {
      out.excluded.push({ key: keyFor('?', year), reason: 'surname-unreadable' });
      continue;
    }
    out.checked++;
    const key = keyFor(sur, year);
    /* The name, not the entry: a body invokes `Bland` as `Bland and Altman (1986)`, as `Bland–Altman`
       or inside a method name, and all three are an invocation. */
    if (new RegExp(`(^|[^A-Za-z])${sur}([^A-Za-z]|$)`).test(body)) out.invoked++;
    else out.uninvoked.push(key);
  }
  return out;
}

/**
 * The census over every paper, plus the ratchet's verdict on it.
 *
 * @param {{file: string, text: string}[]} papers
 * @param {Record<string, string>} baseline the grandfathered uninvoked set
 */
export function census(papers, baseline) {
  const base = baseline && typeof baseline === 'object' ? baseline : {};
  const c = {
    papers: papers.length,
    withList: 0,
    eligible: 0,
    checked: 0,
    excluded: 0,
    byReason: {},
    invoked: 0,
    uninvoked: [],
    unbaselined: [],
    discharged: [],
    perPaper: {}
  };
  for (const r of EXCLUSION_REASONS) c.byReason[r] = 0;
  for (const p of papers) {
    const s = scanPaper(p);
    if (!s.hasList) continue;
    c.withList++;
    c.eligible += s.eligible;
    c.checked += s.checked;
    c.excluded += s.excluded.length;
    c.invoked += s.invoked;
    for (const e of s.excluded) c.byReason[e.reason] = (c.byReason[e.reason] || 0) + 1;
    if (s.uninvoked.length) c.perPaper[p.file] = s.uninvoked.slice();
    for (const k of s.uninvoked) {
      c.uninvoked.push(k);
      if (!(k in base)) c.unbaselined.push(k);
    }
  }
  const live = new Set(c.uninvoked);
  for (const k of Object.keys(base)) if (!live.has(k)) c.discharged.push(k);
  return c;
}

/** @param {Record<string, string>} prior @param {Record<string, string>} now */
export function baselineGrowth(prior, now) {
  const was = new Set(Object.keys(prior || {}));
  return Object.keys(now || {}).filter((k) => !was.has(k));
}

/**
 * A census that examined no entry decides nothing — CLAUDE.md §4b. An absent `papers/` directory and a
 * corpus whose lists hold no external entry both read exactly like a clean tree, so both refuse.
 *
 * @param {ReturnType<typeof census>} c
 */
export function censusStatus(c) {
  if (!c.withList || !c.eligible) return 'NOT_RUN';
  if (!c.checked) return 'NOT_APPLICABLE';
  return c.unbaselined.length ? 'FAIL' : 'PASS';
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
    gate: 'paper-reference-invocation',
    status: st,
    population: { checked: c.checked, eligible: c.eligible, excluded: c.excluded },
    criterion: {
      name: 'no_unbaselined_uninvoked_reference_in_a_paper',
      threshold: 0,
      unit: 'references',
      direction: 'eq'
    },
    result:
      st === 'NOT_RUN'
        ? null
        : {
            papersScanned: c.papers,
            papersWithAList: c.withList,
            invoked: c.invoked,
            uninvoked: c.uninvoked.length,
            grandfathered: c.uninvoked.length - c.unbaselined.length,
            papersCarryingOne: Object.keys(c.perPaper).length,
            excludedByReason: c.byReason,
            discharged: c.discharged.length,
            unbaselined: c.unbaselined.slice(),
            baselineGrowth: (growth || []).slice(),
            baselineGrowthExamined: growthExamined
          },
    evidence: ['tools/paper-reference-use.mjs', BASELINE_PATH, 'briefs/RESIDUE.md'],
    reason: st === 'PASS' ? null : reason || (st === 'NOT_RUN' ? 'no paper carries a reference list with an external entry' : 'an uninvoked reference sits outside the baseline'),
    producedBy: { tool: 'tools/paper-reference-use.mjs', commit: headSha() },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`paper-reference-use produced an invalid verdict: ${chk.errors.join('; ')}`);
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

export function readBaseline(root = ROOT) {
  const p = join(root, BASELINE_PATH);
  if (!existsSync(p)) return {};
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return j.uninvoked && typeof j.uninvoked === 'object' ? j.uninvoked : {};
}

export function selftest() {
  let ran = 0;
  const fail = [];
  const ok = (cond, what) => {
    ran++;
    if (!cond) fail.push(what);
  };
  const page = (refs, body = '') => `<html><body><p>${body}</p><ol class="refs">${refs}</ol></body></html>`;
  const li = (t) => `<li>${t}</li>`;

  // THE TWO OUTCOMES, each against the other as its control.
  const invoked = scanPaper({ file: 'p.html', text: page(li('Shrout PE, Fleiss JL. Intraclass correlations. 1979;86:420.'), 'We score ICC after Shrout and Fleiss (1979).') });
  ok(invoked.uninvoked.length === 0 && invoked.invoked === 1, 'a body that names the surname invokes the entry');
  const listed = scanPaper({ file: 'p.html', text: page(li('Shrout PE, Fleiss JL. Intraclass correlations. 1979;86:420.'), 'We score the ICC with no citation.') });
  ok(listed.uninvoked.length === 1 && listed.uninvoked[0] === 'p.html#Shrout 1979', 'CONTROL · the same entry in a body that never names it reads uninvoked');

  // ELIGIBILITY. A repo pointer is not an external reference, and an entry with no year is not one.
  const codeEntry = scanPaper({ file: 'p.html', text: page(li('Project documentation: <code>CLAUDE.md</code>, 2026 suite.'), 'x') });
  ok(codeEntry.eligible === 0, 'a `<code>` entry points at this repo and leaves the population');
  const noYear = scanPaper({ file: 'p.html', text: page(li('Quan SF. Sleep Heart Health Study design.'), 'x') });
  ok(noYear.eligible === 0, 'an entry with no four-digit year leaves the population');
  ok(scanPaper({ file: 'p.html', text: '<html><body><p>no list</p></body></html>' }).hasList === false, 'a paper with no reference list is not scanned');

  // SURNAMES: initials first, a glyph first, a particle, a corporate author, and the refusal.
  ok(surnameOf('D. W. Allan, “Statistics of atomic frequency standards,” 1966.') === 'Allan', 'an initials-first entry reads its surname');
  ok(surnameOf('✓ Schipper F, van Sloun RJG. Sleep staging, 2024.') === 'Schipper', 'a leading glyph does not hide the surname');
  ok(surnameOf('van Sloun RJG, Schipper F. 2021.') === 'Sloun', 'a particle is stepped over');
  ok(surnameOf('Task Force of the ESC. Heart rate variability. 1996.') === 'Task', 'a corporate author reads as its first word');
  ok(surnameOf('“anonymous note,” 1999.') === null, 'CONTROL · an entry with no capitalised leading word reads no surname');
  const unread = scanPaper({ file: 'p.html', text: page(li('“anonymous note,” 1999.'), 'x') });
  ok(unread.excluded.length === 1 && unread.excluded[0].reason === 'surname-unreadable' && unread.uninvoked.length === 0, 'an unreadable surname is EXCLUDED, never a finding');

  // THE BRACKET CHANNEL, and the interval that is not one.
  const three = [li('Allan DW. Statistics. 1966.'), li('Gray JE. A method. 1974.'), li('Riley WJ. Handbook. 2008.')].join('');
  const bracket = scanPaper({ file: 'p.html', text: page(three, 'The estimator follows [2] and [1,3].') });
  ok(bracket.checked === 0 && bracket.excluded.length === 3 && bracket.excluded.every((e) => e.reason === 'bracket-channel'), 'a numbered citation withdraws that paper from the surname screen');
  const interval = scanPaper({ file: 'p.html', text: page(three, 'Coverage lies in [0,1] and names nobody.') });
  ok(interval.checked === 3 && interval.uninvoked.length === 3, 'CONTROL · `[0,1]` names no list position, so the screen still runs');
  ok(citationGroups('see [4]', 3).length === 0, 'an index past the list length is not a citation');
  const dropped = scanPaper({
    file: 'p.html',
    text: page(li('Companion paper <code>papers/x.html</code>.') + li('Allan DW. Statistics. 1966.') + li('Gray JE. A method. 1974.'), 'The estimator follows [3].')
  });
  ok(dropped.eligible === 2 && dropped.checked === 0 && dropped.excluded.every((e) => e.reason === 'bracket-channel'), 'a citation is counted against the RENDERED list, not the screened subset');

  // TWO ENTRIES, ONE SURNAME AND YEAR: the second key carries its occurrence.
  const twice = scanPaper({ file: 'p.html', text: page(li('Bland JM. Agreement. 1986.') + li('Bland JM. Reply. 1986.'), 'nothing') });
  ok(twice.uninvoked.join('|') === 'p.html#Bland 1986|p.html#Bland 1986 (2)', 'a repeated surname and year keys by occurrence');

  // THE ARITHMETIC, THE RATCHET AND THE DISCHARGE.
  const papers = [
    { file: 'a.html', text: page(li('Shrout PE. ICC. 1979.'), 'nothing') },
    { file: 'b.html', text: page(li('Quan SF. SHHS. 1997.'), 'Quan 1997 states the design.') }
  ];
  const c0 = census(papers, {});
  ok(c0.checked + c0.excluded === c0.eligible, 'checked + excluded === eligible');
  ok(c0.uninvoked.length === 1 && c0.unbaselined.length === 1 && censusStatus(c0) === 'FAIL', 'an uninvoked entry the baseline does not hold is a FAIL');
  const c1 = census(papers, { 'a.html#Shrout 1979': 'board #4531' });
  ok(censusStatus(c1) === 'PASS' && c1.unbaselined.length === 0, 'CONTROL · the same entry inside the baseline passes');
  const c2 = census([papers[1]], { 'a.html#Shrout 1979': 'board #4531' });
  ok(c2.discharged.length === 1 && censusStatus(c2) === 'PASS', 'a baselined entry that no longer reads uninvoked is DISCHARGED, not a failure');
  ok(baselineGrowth({ x: 1 }, { x: 1, y: 1 }).length === 1 && baselineGrowth({ x: 1, y: 1 }, { x: 1 }).length === 0, 'growth counts an APPENDED key and a shrink counts none');

  // A CENSUS THAT EXAMINED NOTHING DECIDES NOTHING.
  ok(censusStatus(census([], {})) === 'NOT_RUN', 'no paper with a list is NOT_RUN, never a PASS over checked: 0');
  ok(censusStatus(census([{ file: 'a.html', text: page(li('Project doc <code>x</code> 2026.'), 'x') }], {})) === 'NOT_RUN', 'a corpus with no external entry is NOT_RUN');
  ok(censusStatus(census([{ file: 'a.html', text: page(three, 'see [1]') }], {})) === 'NOT_APPLICABLE', 'a corpus whose every entry is excluded examined nothing to judge');
  const v = verdictOf({ c: c1 });
  ok(v.status === 'PASS' && v.population.checked === 2 && v.result.grandfathered === 1, 'the verdict validates and carries the population it judged');
  ok(verdictOf({ c: census([], {}) }).result === null, 'a NOT_RUN verdict carries no result');
  ok(
    v.result.baselineGrowthExamined === null && verdictOf({ c: c1, growthExamined: false }).result.baselineGrowthExamined === false,
    'the verdict states whether baseline growth was examined, so an unresolved --base is not a silent green'
  );

  const line = fail.length ? `paper-reference-use selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

function isCliEntry(url) {
  return process.argv[1] && url === new URL(`file://${process.argv[1]}`).href;
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
  const c = census(papers, readBaseline());

  if (argv.includes('--write-baseline')) {
    const uninvoked = {};
    for (const k of c.uninvoked) uninvoked[k] = 'board #4531 · residue 2026-11-08-treatment-response-lists-references-its-body-never-invokes';
    writeFileSync(
      join(ROOT, BASELINE_PATH),
      `${JSON.stringify(
        {
          note: 'The references that sit uninvoked in a paper body. GRANDFATHERED, never approved: each one needs a reader to place the source in the body, or to drop the entry. The set may only SHRINK.',
          generated: new Date().toISOString().slice(0, 10),
          uninvoked
        },
        null,
        1
      )}\n`
    );
    process.stdout.write(`paper-reference-use: wrote ${Object.keys(uninvoked).length} baselined entr(ies) to ${BASELINE_PATH}\n`);
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
    /* AN ABSENT REF AND AN ABSENT FILE READ THE SAME THROUGH `git show`, and only the second is a
       legal green — CLAUDE.md §4b's family, success reported about something never examined. So the
       two are separated, and a ref that does not resolve is REPORTED rather than counted as "no
       growth". It does not red the gate: the census half still examined every paper. */
    growthExamined = resolved;
    if (!resolved) process.stderr.write(`· paper-reference-use: --base ${ref} does not resolve here, so baseline growth was NOT examined\n`);
    else {
      try {
        const prior = JSON.parse(execFileSync('git', ['show', `${ref}:${BASELINE_PATH}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        growth = baselineGrowth(prior.uninvoked || {}, readBaseline());
      } catch {
        /* ABSENT AT THE BASE IS NOT GROWTH — that is how this gate's own first commit passes. */
      }
    }
  }

  const reasons = [];
  if (c.unbaselined.length) reasons.push(`${c.unbaselined.length} uninvoked reference(s) outside the baseline`);
  if (growth.length) reasons.push(`${growth.length} entr(ies) APPENDED to the baseline — a ratchet may only shrink`);
  const base = censusStatus(c);
  const status = base === 'PASS' && reasons.length ? 'FAIL' : base;

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(verdictOf({ c, growth, status, reason: reasons.join('; ') || null, growthExamined }), null, 1)}\n`);
  } else {
    for (const k of c.unbaselined) process.stderr.write(`✕ ${k} — the body never invokes this reference: cite it where it is used, or drop the entry\n`);
    for (const g of growth) process.stderr.write(`✕ ${BASELINE_PATH} gained "${g}" — the baseline may only shrink\n`);
    if (c.discharged.length) process.stdout.write(`· ${c.discharged.length} baselined entr(ies) no longer read uninvoked — drop them from the baseline with --write-baseline\n`);
    if (status === 'PASS')
      process.stdout.write(
        `paper-reference-use: ✓ PASS — ${c.withList} of ${c.papers} papers carry a list, ${c.checked} of ${c.eligible} entries checked, ${c.invoked} invoked, ${c.uninvoked.length} grandfathered in ${Object.keys(c.perPaper).length} paper(s)\n`
      );
    else process.stderr.write(`\npaper-reference-use: ${status} — ${reasons.join('; ') || 'the census examined nothing'}\n`);
  }
  process.exit(status === 'PASS' ? 0 : status === 'NOT_RUN' ? 2 : 1);
}

if (isCliEntry(import.meta.url)) main();
