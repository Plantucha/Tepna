/**
 * tools/refpick-figure-census.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * EVERY PUBLISHED FIGURE A PAT LEG PRODUCED STATES THE PICK RULE BEHIND IT — counted by FIGURE, never
 * by surface (brief CONSENSUS-REFPICK-FOLLOWUPS-2026-11-06 §3, the fourth acceptance box).
 *
 * Three live rules choose the channel every consensus foot rests on, so two published tables that read
 * the same quantity can disagree for no reason a reader can see. The brief's remedy is option B's stamp:
 * each figure names the rule that produced it. A HAND COUNT of those stamps went stale the day it
 * landed — the 2026-11-23 correction in that brief found a SECOND leg inside one already-ticked surface,
 * because the count had keyed on surfaces. So the census keys on the FIGURE, and it declares each one.
 *
 * WHAT THIS DECIDES
 *   1 · every declared figure still carries its anchor, and a rule statement sits within a declared
 *       number of lines of that anchor;
 *   2 · no surface in the population cites a PAT figure while no row declares it.
 * Either defect reds. The second arm is the one a hand count cannot keep: a new paper that quotes
 * `47.7 ppm` reds here until somebody states which rule produced the number it quotes.
 *
 * WHAT IT DOES NOT DECIDE
 *   Whether a given number is a figure at all. That judgment is a reading, so it lives in the declared
 *   row as `prose` or `unattributed` with its reason, in the open, and the verdict publishes both counts
 *   beside the PASS. A row is never silently dropped: an undeclared citation is a defect.
 *
 * POPULATION — `papers/*.html`, `papers/*.md` and `briefs/*.md`, which is the brief's own population.
 * `docs/papers/` is the SERVED COPY that `tools/build-docs.mjs` writes from `papers/`, so judging the
 * source judges both; a census over both would double every count and red on a stale served copy that
 * the walker regenerates anyway. Leg filenames are scanned in `papers/` only, because a brief names a
 * leg to discuss it; a brief enters the population when it pins one of the leg's FIGURES.
 *
 * CLI: --census (default) · --json · --selftest · --verdict-sample
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/refpick-figure-census.mjs';
const GATE = 'refpick-figure-rule';

/* The legs. A name here is a PAT instrument whose output rests on one reference-channel pick. */
const LEG_RE =
  /pat-feasibility-worker\.js|pat-feasibility\.js|pat-align\.js|pat-gate\.js|pat-host-offset\.mjs|pat-matchrate-strict\.mjs|beat-correspondence\.mjs|ppg-foot-consensus-e1\.mjs|ppg-fusion-e3\.mjs/g;

/* The figures. Each is a number only a PAT leg produced, so a surface quoting one is citing the leg
   whether or not it names the file. The lookarounds are load-bearing: a bare `11 ?/ ?21` matched
   `211 / 210` inside an unrelated band-power triple and put a paper in the population that pins
   nothing. */
const FIG_RE = /(?<![\d.])47\.7\s*ppm|(?<![\d.])11\s*\/\s*21(?![\d.])|11 of 21|145,586|(?<![\d.])1,156\s*ms/g;

/* A rule statement, in the words the surfaces actually use. */
const RULE_RE = /peak-count argmax|peak-argmax|snr-pick-guarded|snr-pick|pick rule|reference pick/i;

/* ── THE DECLARATION ──────────────────────────────────────────────────────────────────────────────
   One row per surface that cites a PAT figure. `figures` carries the stamped figures; `prose` and
   `unattributed` carry the readings, each with the reason that justifies it. */
const SURFACES = [
  {
    surface: 'papers/wearable-clock-drift.html',
    figures: [
      {
        name: 'the 5-minute-block refit table',
        leg: 'pat-feasibility-worker.js',
        rule: 'peak-count argmax',
        anchor: 'R² of linear fit',
        ruleAnchor: 'channel by a peak-count argmax',
        within: 120
      },
      {
        name: 'Table 1 · the 11 gated co-recording nights',
        leg: 'pat-feasibility-worker.js',
        rule: 'peak-count argmax',
        anchor: 'Table 1 · The 11 gated co-recording nights',
        ruleAnchor: 'picked the consensus reference PPG channel by a peak-count argmax',
        within: 1
      },
      {
        name: 'the §3.6 corpus-scale closure table',
        leg: 'pat-feasibility-worker.js',
        rule: 'peak-count argmax',
        anchor: 'closure verdict on the H10↔Verity pairwise fit',
        ruleAnchor: 'Pick rule for the σ above',
        within: 30
      }
    ],
    prose: 'This paper is the producer, and its correction record quotes 47.7 ppm, 1,156 ms and 11 of 21 throughout as the claims it refutes. Each table it keeps carries its own stamp above.'
  },
  {
    surface: 'papers/RERUN-RESULTS.md',
    figures: [
      {
        name: 'the 52-night corpus-scale closure entry',
        leg: 'pat-feasibility-worker.js',
        rule: 'peak-count argmax',
        anchor: 'corpus-scale clock closure, 52 nights',
        ruleAnchor: 'peak-count argmax',
        within: 12
      }
    ],
    prose: 'The 47.7 ppm and 1,156 ms lines further down are the v1 claims this file records as refuted, and each sits beside its refutation.'
  },
  {
    surface: 'papers/null-calibration.html',
    figures: [
      {
        name: 'Table 3 · the four discriminating tests',
        leg: 'pat-feasibility-worker.js',
        rule: 'peak-count argmax',
        anchor: 'Table 3 · Four discriminating tests',
        ruleAnchor: 'peak-count argmax',
        within: 2
      }
    ],
    prose: 'The §4.4 line quotes the refuted 47.7 ppm premise, and the §5 arithmetic restates Table 3. `pat-align.js` appears in the §7 instrument list, which pins no figure of its own.'
  },
  {
    surface: 'papers/dead-ends.html',
    figures: [],
    prose:
      'Wall 2.7 narrates the refutation itself: the 1.1 s drift was one cardiac cycle, and the 0.008 ppm residual is a chrony figure from the capture host. The paper pins no table of its own, and it points at wearable-clock-drift.html §3.2 for the numbers.'
  },
  {
    surface: 'papers/papers.html',
    figures: [],
    prose: 'The index card restates the drift paper abstract, including the refuted 47.7 ppm, with the refutation in the same sentence. It carries no table.'
  },
  {
    surface: 'briefs/CONSENSUS-REFPICK-FOLLOWUPS-2026-11-06-BRIEF.md',
    figures: [],
    prose: 'This brief is the ledger this census serves. It names 11 of 21 while reporting the pass rate of the leg it holds open, and it pins no figure of its own.'
  },
  {
    surface: 'briefs/PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md',
    figures: [
      {
        name: 'the §3a re-run sweep table',
        leg: 'tools/pat-matchrate-strict.mjs',
        rule: 'peak-count argmax',
        anchor: 'strict ratio | p (strict)',
        ruleAnchor: 'The pick rule behind every number above.',
        within: 24
      }
    ],
    prose: 'The rest of the brief argues about definitions, and it pins no further PAT figure.'
  },
  {
    surface: 'briefs/RADIO-DELAY-FLOOR-2026-11-03-BRIEF.md',
    figures: [
      {
        name: 'the per-night beat offset table',
        leg: 'tools/pat-host-offset.mjs',
        rule: 'peak-count argmax',
        anchor: 'night | median beat offset | median RR',
        ruleAnchor: 'The pick rule behind both rows is the peak-count argmax.',
        within: 10
      }
    ],
    prose: 'The floor map itself rests on radio timing, not on a PPG channel pick.'
  },
  {
    surface: 'briefs/PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md',
    figures: [
      {
        name: 'every §8 number of the clock-offset leg',
        leg: 'tools/pat-host-offset.mjs',
        rule: 'peak-count argmax',
        anchor: '### 8.2 · Result',
        ruleAnchor: 'The reference pick rule behind every §8 number is the peak-count argmax.',
        within: 12
      }
    ],
    prose: 'The §8.6 correction and the §8.7 settlement withdraw the verdict those numbers carried, and they pin no further figure.'
  },
  {
    surface: 'briefs/PAT-COMPENDIUM-2026-08-10-BRIEF.md',
    figures: [
      {
        name: 'the six-night within-5-min-bin σ column',
        leg: 'pat-feasibility-worker.js',
        rule: 'peak-count argmax',
        anchor: '| night | Rayleigh R | lag median |',
        ruleAnchor: 'Pick rule behind the σ column',
        within: 13
      }
    ],
    unattributed: [
      {
        name: 'the per-night Rayleigh R column of the same table',
        why: 'No artifact in the tree computes a per-night Rayleigh R of the PAT lag. A tracked-source search on 2026-11-23 read every *.js, *.mjs and *.py for rayleigh, resultant, concentration, lag phase and phase lock, and the three hits measure another quantity. The brief states that beside the table, and a §7 decision keeps the column labelled rather than deleting a one-session measurement.'
      }
    ]
  },
  {
    surface: 'briefs/INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md',
    figures: [],
    prose: 'Three lines quote the 47.7 ppm premise this brief excludes on 51 of 54 pairings, each beside the measurement that excludes it.',
    unattributed: [
      {
        name: 'the §2-RESULT-VII identifiability table, row "unimodal nights identifiable"',
        why: 'The 11 of 21 count here comes from the buggy-versus-corrected identifiability split, not from the feasibility pass rate that shares the number. The brief does not name the leg that produced the split, so this census declines to attribute it from the text.'
      }
    ]
  },
  {
    surface: 'briefs/PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md',
    figures: [],
    prose: 'The §2 blocker table quotes the 47.7 ppm claim as the figure `halfDrift` excludes, and its source cell points at INTEGRATOR-PAT-VASCULAR §2-RESULT-II.3 for the measurement.'
  }
];

export function citationsIn(rel, text) {
  const out = [];
  const res = rel.startsWith('papers/') ? [LEG_RE, FIG_RE] : [FIG_RE];
  for (const re of res) {
    for (const m of text.matchAll(re)) out.push({ hit: m[0], line: lineOf(text, m.index) });
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

function lineOfSubstring(text, needle) {
  const at = text.indexOf(needle);
  return at === -1 ? null : lineOf(text, at);
}

/**
 * The whole judgment over a map of `relative path → text`. Pure, so the selftest asks it about trees
 * that are not this checkout, including the tree where the stamp was deleted.
 */
export function audit(files, declared = SURFACES) {
  const bySurface = new Map(declared.map((r) => [r.surface, r]));
  const figures = [];
  const defects = [];
  const undeclared = [];
  const cited = [];

  for (const [rel, text] of Object.entries(files)) {
    if (citationsIn(rel, text).length === 0) continue;
    cited.push(rel);
    if (!bySurface.has(rel)) {
      undeclared.push(rel);
      defects.push(`${rel} cites a PAT figure and no row declares it`);
    }
  }

  for (const row of declared) {
    const text = files[row.surface];
    if (text === undefined) {
      defects.push(`${row.surface} is declared and absent from the population`);
      continue;
    }
    for (const fig of row.figures || []) {
      const at = lineOfSubstring(text, fig.anchor);
      const ruleAt = lineOfSubstring(text, fig.ruleAnchor);
      const near = at !== null && ruleAt !== null && Math.abs(ruleAt - at) < fig.within + 1;
      const rec = { surface: row.surface, name: fig.name, leg: fig.leg, rule: fig.rule, anchorLine: at, ruleLine: ruleAt, ok: near };
      if (at === null) rec.why = 'the figure anchor is absent, so this row judges a figure that moved or went away';
      else if (ruleAt === null) rec.why = 'no rule statement matches the declared anchor, so the figure states no rule';
      else if (!near) rec.why = `the rule statement sits ${Math.abs(ruleAt - at)} line(s) from the figure, past the declared ${fig.within}`;
      figures.push(rec);
      if (!near) defects.push(`${row.surface} · ${fig.name}: ${rec.why}`);
      if (!RULE_RE.test(fig.ruleAnchor)) defects.push(`${row.surface} · ${fig.name}: the declared rule anchor names no rule this census can read`);
    }
    for (const u of row.unattributed || []) if (!u.why) defects.push(`${row.surface} · ${u.name}: an unattributed figure carries no reason`);
    if ((row.figures || []).length === 0 && !row.prose && !(row.unattributed || []).length) defects.push(`${row.surface} declares neither a figure nor a reason`);
  }

  const unattributed = declared.reduce((n, r) => n + (r.unattributed || []).length, 0);
  return { figures, defects, undeclared, cited, declared: declared.length, unattributed };
}

/**
 * The population, read from THIS checkout. The two directory names are static on purpose: a root
 * this function took as an argument would read as an enumeration over a path a run supplies, which is
 * the shape `tools/corpus-reads.mjs` holds to a population verdict. This walks repo prose, never a
 * capture night, and the selftest injects its own `{path: text}` map rather than re-pointing a root.
 */
export function population() {
  const files = {};
  for (const dir of ['papers', 'briefs']) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!/\.(html|md)$/.test(name)) continue;
      const rel = `${dir}/${name}`;
      files[rel] = readFileSync(join(ROOT, rel), 'utf8');
    }
  }
  return files;
}

export function verdictOf(res, opts = {}) {
  const without = res.figures.filter((f) => !f.ok).length;
  const defects = res.defects.length;
  const examined = res.figures.length > 0;
  return makeVerdict({
    gate: GATE,
    status: !examined ? 'NOT_RUN' : defects ? 'FAIL' : 'PASS',
    population: { checked: res.figures.length, eligible: res.figures.length, excluded: 0 },
    criterion: { name: 'figures_without_their_rule_or_undeclared_surfaces', threshold: 0, unit: 'defects', direction: 'lte' },
    result: examined
      ? {
          figures: res.figures.length,
          figuresWithoutRule: without,
          undeclaredSurfaces: res.undeclared.length,
          citedSurfaces: res.cited.length,
          declaredSurfaces: res.declared,
          unattributedFigures: res.unattributed
        }
      : null,
    evidence: [TOOL, 'briefs/CONSENSUS-REFPICK-FOLLOWUPS-2026-11-06-BRIEF.md'],
    reason: res.figures.length === 0 ? 'the population held no declared figure, so nothing was examined' : defects ? res.defects.slice(0, 4).join(' · ') : null,
    tool: TOOL,
    ...opts
  });
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */

let ASSERTED = 0;
function ok(cond, what) {
  ASSERTED++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${what}`);
  return cond ? 0 : 1;
}

const FIG_ROW = (over = {}) => ({
  name: 'Table 9',
  leg: 'pat-feasibility-worker.js',
  rule: 'peak-count argmax',
  anchor: 'Table 9 · the nights',
  ruleAnchor: 'by a peak-count argmax',
  within: 2,
  ...over
});

function selftest() {
  let fail = 0;
  const STAMPED = 'intro\nTable 9 · the nights\nthe leg picked the channel by a peak-count argmax\n';
  const BARE = 'intro\nTable 9 · the nights\nnothing about the pick here\n';
  const FAR = `intro\nTable 9 · the nights\n${'filler\n'.repeat(9)}by a peak-count argmax\n`;
  const DECL = [{ surface: 'papers/x.html', figures: [FIG_ROW()], prose: 'none' }];

  const good = audit({ 'papers/x.html': STAMPED }, DECL);
  fail += ok(good.defects.length === 0, 'a figure whose rule sits beside it passes');
  fail += ok(good.figures.length === 1 && good.figures[0].ok, 'the passing figure is reported, not merely counted');

  const bare = audit({ 'papers/x.html': BARE }, DECL);
  fail += ok(bare.defects.length === 1, 'a figure with no rule statement reds');
  fail += ok(/states no rule/.test(bare.figures[0].why || ''), 'the red names the absent rule statement');

  const far = audit({ 'papers/x.html': FAR }, DECL);
  fail += ok(far.defects.length === 1, 'a rule statement past the declared distance reds');
  fail += ok(/past the declared 2/.test(far.figures[0].why || ''), 'the distance red quotes the declared window');

  const moved = audit({ 'papers/x.html': 'nothing here at all\n' }, DECL);
  fail += ok(/anchor is absent/.test(moved.figures[0].why || ''), 'a figure whose anchor went away reds rather than passing');

  const gone = audit({}, DECL);
  fail += ok(gone.defects.length === 1 && /absent from the population/.test(gone.defects[0]), 'a declared surface absent from the tree reds');

  const un = audit({ 'papers/x.html': STAMPED, 'papers/new.html': 'the median was 47.7 ppm\n' }, DECL);
  fail += ok(un.undeclared.length === 1 && un.undeclared[0] === 'papers/new.html', 'a new surface citing a PAT figure reds as undeclared');

  const legOnly = audit({ 'papers/x.html': STAMPED, 'papers/leg.html': 'we ran pat-gate.js\n' }, DECL);
  fail += ok(legOnly.undeclared.length === 1, 'a paper naming a leg enters the population');
  const briefLeg = audit({ 'papers/x.html': STAMPED, 'briefs/B.md': 'we ran pat-gate.js\n' }, DECL);
  fail += ok(briefLeg.undeclared.length === 0, 'a brief naming a leg and pinning no figure stays out of the population');
  const briefFig = audit({ 'papers/x.html': STAMPED, 'briefs/B.md': 'the 47.7 ppm premise\n' }, DECL);
  fail += ok(briefFig.undeclared.length === 1, 'a brief pinning a figure enters the population');

  fail += ok(citationsIn('papers/z.html', 'band-power 211 / 210 / 213').length === 0, 'CONTROL · a digit run around 11 / 21 is not a citation');
  fail += ok(citationsIn('papers/z.html', 'identifiable on 11 / 21 nights').length === 1, 'the real 11 / 21 figure is a citation');

  const noReason = audit({ 'papers/x.html': STAMPED }, [{ surface: 'papers/x.html', figures: [], unattributed: [{ name: 'T' }] }]);
  fail += ok(
    noReason.defects.some((d) => /carries no reason/.test(d)),
    'an unattributed figure with no reason reds'
  );
  const silent = audit({ 'papers/x.html': STAMPED }, [{ surface: 'papers/x.html', figures: [] }]);
  fail += ok(
    silent.defects.some((d) => /neither a figure nor a reason/.test(d)),
    'a surface declared with nothing at all reds'
  );

  const badRule = audit({ 'papers/x.html': 'Table 9 · the nights\nchosen somehow\n' }, [{ surface: 'papers/x.html', figures: [FIG_ROW({ ruleAnchor: 'chosen somehow' })], prose: 'none' }]);
  fail += ok(
    badRule.defects.some((d) => /names no rule this census can read/.test(d)),
    'a declared anchor that states no rule reds'
  );

  const vGood = verdictOf(good);
  fail += ok(vGood.status === 'PASS' && vGood.reason === null, 'a clean tree answers PASS with no reason');
  fail += ok(vGood.population.checked === 1 && vGood.population.checked + vGood.population.excluded === vGood.population.eligible, 'the population arithmetic closes');
  const vBad = verdictOf(bare);
  fail += ok(vBad.status === 'FAIL' && /states no rule/.test(vBad.reason), 'a defect answers FAIL and the reason names it');
  const vNone = verdictOf(audit({}, []));
  fail += ok(vNone.status === 'NOT_RUN' && /nothing was examined/.test(vNone.reason), 'CONTROL · an empty declaration answers NOT_RUN, never PASS over zero');

  const live = audit(population());
  fail += ok(live.figures.length >= 9, `the live tree declares ${live.figures.length} figure(s)`);
  fail += ok(live.defects.length === 0, live.defects.length ? `the live tree reds: ${live.defects[0]}` : 'the live tree carries no defect');

  console.log(fail ? `\nselftest: ${fail} FAILURE(S) of ${ASSERTED}` : `\nselftest: all ${ASSERTED} assertions passed`);
  return fail;
}

export function verdictSample() {
  return verdictOf(audit({ 'papers/x.html': 'Table 9 · the nights\nby a peak-count argmax\n' }, [{ surface: 'papers/x.html', figures: [FIG_ROW()], prose: 'sample' }]), {
    commit: null,
    commitReason: 'a --verdict-sample judges a synthetic tree and names no commit'
  });
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { valued: [], boolean: ['--census', '--json', '--selftest', '--verdict-sample'] }, { tool: TOOL });
  const has = (f) => argv.includes(f);
  if (has('--selftest')) process.exit(selftest() ? 1 : 0);
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample()));
    process.exit(0);
  }
  const res = audit(population());
  const v = verdictOf(res);
  if (has('--json')) console.log(JSON.stringify({ figures: res.figures, defects: res.defects, undeclared: res.undeclared, verdict: v }, null, 2));
  else {
    for (const f of res.figures) console.log(`${f.ok ? '✓' : '✗'} ${f.surface} · ${f.name} — ${f.rule}${f.ok ? '' : ` — ${f.why}`}`);
    for (const d of res.defects) console.log(`✗ ${d}`);
    printVerdict(v);
  }
  process.exit(res.defects.length ? 1 : 0);
}
