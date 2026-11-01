#!/usr/bin/env node
/*
 * tools/tch-pooled-hat.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ══════════════════════════════════════════════════════════════════════════
 * THE POOLED-SECONDS HAT, and why it differs from a median over nights.
 *
 * `tch-fused-corpus` prints the caveat itself: "A median over nights is NOT the pooled-seconds
 * hat the papers quote; it is the across-night distribution." This tool computes both and the
 * exact algebraic term that separates them, so the difference is attributed rather than guessed.
 *
 * DERIVATION (SENSOR-TRIO-NIGHTS-PAPER §10). The three-cornered hat is LINEAR in the pairwise
 * variances, σ²_A = ½(V_AB + V_AC − V_BC). A variance pooled over nights decomposes as
 *
 *     V_pool = Σ w_n·Var_n  +  [ Σ w_n·μ_n² − (Σ w_n·μ_n)² ]      w_n = SECONDS fraction
 *            = within-night (seconds-weighted)  +  BETWEEN-night bias variance  ≡ B
 *
 * Because the solve is linear it COMMUTES with any linear pooling, so
 *
 *     σ²_pooled,A − σ²_secondsWeighted,A  =  ½(B_AB + B_AC − B_BC)      ← exact, not approximate
 *
 * A MEDIAN is not linear, so a median over nights neither commutes NOR carries B: it differs for
 * two independent reasons. That is the whole content of the caveat, made computable.
 *
 * ⚠️ This tool does not mint a "better" σ. It explains why three published σ_Verity figures
 * (1.42 / 3.51 / 0.94–1.03) can all be arithmetically correct over the same nights while
 * disagreeing — they are different estimators, and the gap between them is B, which is measurable.
 *
 * Usage:
 *   node tools/tch-pooled-hat.mjs --dir uploads/trio
 *   node tools/tch-pooled-hat.mjs --dir uploads/trio --json
 *   node tools/tch-pooled-hat.mjs --selftest      # planted truth: identity + recovery
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveNight } from './tch-fused-corpus.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { STAMP_OUTPUT_OWED, corpusBlock, corpusIdentity, repoRelative, stampFields } from './fold-generation.mjs';
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries, snapshotNights } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['h10', 'verity', 'o2'];

/* TCH solve from the three pairwise variances. Linear by construction — that linearity is what
   makes the pooled/weighted identity exact, so it is written once and shared by both paths. */
export function tchFromPairs(vHV, vHO, vVO) {
  return {
    h10: 0.5 * (vHV + vHO - vVO),
    verity: 0.5 * (vHV + vVO - vHO),
    o2: 0.5 * (vHO + vVO - vHV)
  };
}

/* Given per-night pairwise moments, return the pooled-seconds variances, the seconds-weighted
   within-night variances, and the between-night bias variances B. */
export function poolPairs(nights) {
  const N = nights.reduce((a, r) => a + r.pairs.hv.n, 0);
  const out = {};
  for (const pk of ['hv', 'ho', 'vo']) {
    let within = 0,
      mu1 = 0,
      mu2 = 0;
    for (const r of nights) {
      const w = r.pairs[pk].n / N;
      within += w * r.pairs[pk].var;
      mu1 += w * r.pairs[pk].mu;
      mu2 += w * r.pairs[pk].mu * r.pairs[pk].mu;
    }
    const B = Math.max(0, mu2 - mu1 * mu1);
    out[pk] = { within, B, pooled: within + B, meanMu: mu1 };
  }
  return { N, ...out };
}

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sq = (x) => (x == null || x < 0 ? null : Math.sqrt(x));

export function estimators(nights) {
  const P = poolPairs(nights);
  const pooled = tchFromPairs(P.hv.pooled, P.ho.pooled, P.vo.pooled);
  const weighted = tchFromPairs(P.hv.within, P.ho.within, P.vo.within);
  const gap = tchFromPairs(P.hv.B, P.ho.B, P.vo.B); // ½(B_AB + B_AC − B_BC) per corner, by linearity
  const perNight = nights.map((r) => tchFromPairs(r.pairs.hv.var, r.pairs.ho.var, r.pairs.vo.var));
  const med = {};
  for (const k of KEYS) med[k] = median(perNight.map((p) => sq(p[k])).filter((x) => x != null));
  return { P, pooled, weighted, gap, med, perNight, nights: nights.length };
}

function selftest() {
  /* Planted: three corners with known σ, plus a known per-night pairwise BIAS. The identity
     σ²_pooled − σ²_weighted = ½(B_AB + B_AC − B_BC) must hold exactly, and the pooled hat must
     recover the planted σ when the bias is zero. */
  const mk = (n, vHV, vHO, vVO, mHV, mHO, mVO) => ({
    pairs: { hv: { n, var: vHV, mu: mHV }, ho: { n, var: vHO, mu: mHO }, vo: { n, var: vVO, mu: mVO } }
  });
  let pass = 0,
    fail = 0;
  const chk = (name, got, want, tol) => {
    const ok = Math.abs(got - want) <= tol;
    console.log(`  ${ok ? '✓' : '✗'} ${name}  got ${got.toFixed(6)}  want ${want.toFixed(6)}`);
    if (ok) pass++;
    else fail++;
  };
  // 1 · zero bias ⇒ pooled == weighted, and both recover the planted σ
  const sA = 2,
    sB = 1,
    sC = 3;
  const z = [mk(1000, sA * sA + sB * sB, sA * sA + sC * sC, sB * sB + sC * sC, 0, 0, 0), mk(3000, sA * sA + sB * sB, sA * sA + sC * sC, sB * sB + sC * sC, 0, 0, 0)];
  const ez = estimators(z);
  chk('zero-bias: pooled σ_h10 recovers planted', Math.sqrt(ez.pooled.h10), sA, 1e-9);
  chk('zero-bias: gap is zero', ez.gap.h10, 0, 1e-9);
  // 2 · planted between-night bias ⇒ identity holds exactly
  const b = [mk(1000, 5, 13, 10, 0.0, 0.0, 0.0), mk(3000, 5, 13, 10, 2.0, -1.0, 0.5)];
  const eb = estimators(b);
  for (const k of KEYS) chk(`identity ${k}: pooled − weighted == ½(ΣB)`, eb.pooled[k] - eb.weighted[k], eb.gap[k], 1e-9);
  // 3 · a median over nights is NOT the weighted mean when nights differ in length
  const u = [mk(100, 5, 13, 10, 0, 0, 0), mk(9900, 9, 13, 10, 0, 0, 0)];
  const eu = estimators(u);
  const differs = Math.abs(eu.med.h10 - Math.sqrt(eu.weighted.h10)) > 1e-6;
  console.log(`  ${differs ? '✓' : '✗'} median ≠ seconds-weighted when night lengths differ  (${eu.med.h10.toFixed(4)} vs ${Math.sqrt(eu.weighted.h10).toFixed(4)})`);
  if (differs) pass++;
  else fail++;
  console.log(`\n${fail === 0 ? '✓' : '✗'} selftest — ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  const i = argv.indexOf('--dir');
  const dir = i >= 0 && argv[i + 1] ? argv[i + 1] : join(ROOT, 'uploads', 'trio');
  const asJson = argv.includes('--json');
  /* ── THE POPULATION THESE THREE ESTIMATORS ARE COMPUTED OVER ──────────────────────────────
     Row 2026-10-21-forty-one-corpus-enumerators-report-no-population. The headline printed
     `N nights … (M skipped)`, so the skipped count was there and the OFFERED count never was: a
     root holding nothing night-shaped, and a root whose every night solves, both printed a bare
     pair of numbers. `snapshotNights`' default rule is this walk's own rule written twice over —
     `\d{2}` where this file wrote `\d\d` — so the offered set does not move, and the night
     questions bind because the rule is the default one. */
  const snapBefore = snapshotNights(dir);
  const commitOf = gitCommitOf();
  const POP_EV = ['tools/tch-pooled-hat.mjs', 'tools/corpus-scope-core.mjs'];
  const solved = [];
  const publishPopulation = () => {
    const population = populationVerdict(snapBefore, snapshotNights(dir), {
      commit: commitOf.commit,
      commitReason: commitOf.reason,
      tool: 'tools/tch-pooled-hat.mjs',
      evidence: POP_EV
    });
    const rule = ruleLine(population);
    /* 🔴 PUBLISHED BEFORE EVERY EXIT, the refusal included. `need >=2 solved nights` is the one
       case where the population IS the whole finding, and it was the one case that reported none. */
    console.log(`\npopulation: ${snapBefore.n} night(s) offered under ${dir} · ${solved.length} solved · movement ${population.status}` + (population.reason ? ` — ${population.reason}` : ''));
    if (rule) console.log(rule);
    /* The solved ROWS, not their names: `notCovered` reads `row[key]`, so a list of strings would
       cover nothing and report every offered night as unsolved. */
    const unsolved = notCovered(snapBefore, solved, { key: 'night' });
    if (snapBefore.ok && unsolved.length !== snapBefore.n - solved.length) throw new Error(`population arithmetic: ${snapBefore.n} offered − ${solved.length} solved ≠ ${unsolved.length} unsolved`);
    if (unsolved.length) console.log(`  ${unsolved.length} offered night(s) went unsolved, by name: ${unsolved.slice(0, 8).join(' · ')}${unsolved.length > 8 ? ` · … (+${unsolved.length - 8})` : ''}`);
    console.log('POPULATION ' + JSON.stringify(population));
    return population;
  };
  if (!snapBefore.ok) {
    console.error(`refused: ${snapBefore.reason} — ${dir}`);
    publishPopulation();
    process.exit(2);
  }
  const names = snapBefore.nights;
  const skipped = [];
  for (const n of names) {
    const r = solveNight(dir, n);
    if (r.skip || !r.pairs) skipped.push(`${n}: ${r.skip || 'no pairs'}`);
    else solved.push(r);
  }
  if (solved.length < 2) {
    console.error(`need ≥2 solved nights, got ${solved.length}`);
    publishPopulation();
    process.exit(2);
  }
  const e = estimators(solved);
  /* The corpus identity of THIS cut, scoped to the nights the estimators actually read. A published
     number that records only which files it hashed cannot say which pipeline folded them, and the
     2026-09-22 whole-corpus re-fold moved 288 of 288 comparable exports without touching one input
     path. `fold-generation.mjs` re-resolves this block later; an unstamped night it names is a hole
     in this number's provenance, not a zero. */
  const root = repoRelative(dir);
  const corpus = root
    ? corpusBlock(corpusIdentity(root, { nights: solved.map((r) => r.night) }))
    : { root: dir, resolvable: false, reason: 'the corpus is outside this checkout, so git cannot identify it', dataDigest: null, foldGeneration: null };
  if (asJson) {
    /* THE JSON READER GETS THE OBJECT TOO, inside the document rather than printed beside it: a
       consumer parsing stdout as one JSON value would otherwise have to choose between the figures
       and their population, and the whole point is that neither stands alone. */
    const population = populationVerdict(snapBefore, snapshotNights(dir), {
      commit: commitOf.commit,
      commitReason: commitOf.reason,
      tool: 'tools/tch-pooled-hat.mjs',
      evidence: POP_EV
    });
    console.log(
      JSON.stringify(
        { dir, corpus, population, offered: snapBefore.n, nights: e.nights, skipped: skipped.length, pairs: e.P, pooled: e.pooled, weighted: e.weighted, gap: e.gap, medianSigma: e.med },
        null,
        2
      )
    );
    return;
  }
  console.log(`\n  POOLED-SECONDS HAT vs MEDIAN OVER NIGHTS — ${e.nights} nights, ${e.P.N.toLocaleString()} pooled seconds (${skipped.length} skipped)\n`);
  console.log('  pairwise variance decomposition (bpm²)');
  console.log('  pair        within(sec-wtd)      B(between)        pooled     B share');
  for (const pk of ['hv', 'ho', 'vo']) {
    const p = e.P[pk];
    console.log(`  ${pk.padEnd(6)} ${p.within.toFixed(3).padStart(16)} ${p.B.toFixed(3).padStart(15)} ${p.pooled.toFixed(3).padStart(13)} ${((100 * p.B) / p.pooled).toFixed(1).padStart(9)}%`);
  }
  console.log('\n  per-device σ (bpm) under three estimators');
  console.log('  device      pooled-seconds   seconds-weighted   median-over-nights      gap(pooled−wtd, σ²)');
  for (const k of KEYS) {
    const a = sq(e.pooled[k]),
      b = sq(e.weighted[k]);
    console.log(
      `  ${k.padEnd(10)} ${(a == null ? 'neg' : a.toFixed(3)).padStart(14)} ${(b == null ? 'neg' : b.toFixed(3)).padStart(18)} ${(e.med[k] == null ? '—' : e.med[k].toFixed(3)).padStart(20)} ${e.gap[k].toFixed(4).padStart(24)}`
    );
  }
  console.log('\n  identity check  σ²_pooled − σ²_weighted == ½(B_AB + B_AC − B_BC):');
  for (const k of KEYS) {
    const lhs = e.pooled[k] - e.weighted[k];
    console.log(`    ${k.padEnd(8)} lhs ${lhs.toFixed(9)}   rhs ${e.gap[k].toFixed(9)}   |Δ| ${Math.abs(lhs - e.gap[k]).toExponential(2)}`);
  }
  console.log(`\n  corpus identity (the ${e.nights} nights read)`);
  if (corpus.resolvable) {
    console.log(`    dataDigest ${corpus.dataDigest} over ${corpus.dataFiles} export file(s) · foldGeneration ${corpus.foldGeneration}`);
    console.log(`    ${corpus.stamped} of ${corpus.nights} night(s) carry a fold stamp under ${corpus.codeDigests.length} code digest(s); ${corpus.unstamped} carry none and cannot be attributed.`);
    /* ── THE STAMP FIELDS, so a published table carries the generation by COPY. The attributes are
       built by `stampFields` in `fold-generation.mjs`, beside the block they describe, so the printer
       here cannot drift from the gate that reads the pasted marker. */
    const stamp = stampFields(corpus, { producer: 'tools/tch-pooled-hat.mjs', invocation: process.argv.slice(2).join(' '), day: new Date().toISOString().slice(0, 10) });
    console.log('\n  TABLE-PROVENANCE fields for a table cut from this run');
    if (stamp.attrs) console.log(`    ${stamp.attrs}`);
    if (stamp.reason) console.log(`    no foldGeneration: ${stamp.reason}`);
    console.log(`    ${STAMP_OUTPUT_OWED}`);
  } else {
    console.log(`    unresolvable — ${corpus.reason}`);
  }
  console.log('\n  ⚠ These are the SAME nights under three estimators. A difference between them is not');
  console.log('    disagreement about the devices — it is the estimators answering different questions.\n');
  publishPopulation();
}

/* A NAMED lister: `snapshotEntries` publishes `rule: list.name`, and an inline arrow would publish
   `rule: null` — the caller's one decision, unrecorded. */
function sampleNights() {
  return ['2026-06-10', '2026-06-11', '2026-06-12'];
}
/* The adoption sample reads no corpus, so the object's shape is checkable where no uploads tree
   exists. It prints the object ALONE, because `verify:verdict-adoption` parses stdout as JSON. */
/* THE SAMPLE LIVES IN A NAMED HELPER, because `corpus-reads.mjs` blanks a `verdictSample` body
   before it decides whether this tool reports a population: a fabricated call left at top level
   would clear the tool over a walk no run makes (the lesson its own CONTROL leg records). */
function verdictSample() {
  const at = '2026-10-28T00:00:00Z';
  const snap = snapshotEntries('<uploads>/trio', { list: sampleNights, unit: 'nights', at });
  return populationVerdict(snap, snap, { tool: 'tools/tch-pooled-hat.mjs', at, evidence: ['tools/tch-pooled-hat.mjs', 'tools/corpus-scope-core.mjs'] });
}
if (process.argv.slice(2).includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

if (isCliEntry(import.meta.url)) main();
