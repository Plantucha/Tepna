/*
 * tools/capture-recapture.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * HOW MANY BEATS DID *EVERY* DETECTOR MISS — epidemiology's capture–recapture, imported.
 *
 * THE FINDING THIS ANSWERS. `KNOWN-CLOCK-ADVERSARIAL-CAPTURE` measured that one missed beat in a
 * thousand inflates rMSSD by 20.8 %, against ~0.003 % for the whole clock-error family. Four orders of
 * magnitude apart, and only the smaller one had instruments. The larger one needs a number for the beats
 * nobody saw — which is by construction the one quantity no detector can report.
 *
 * WHY CURRENT PRACTICE CANNOT ANSWER IT. The field (PPG-beats, Charlton et al.) establishes reference
 * beats by running two detectors and keeping those BOTH found. That is an INTERSECTION, and it discards
 * exactly the population being counted. This repo already contains one: `PPGDSP.detectorAgreementTriplet`
 * states it plainly — "A beat missing from either other channel is DROPPED". Sound as a quality filter,
 * silently biased as truth, and the bias is invisible because the discarded beats are the unseen ones.
 *
 * ── THE THREE ESTIMATORS, AND WHY ALL THREE ARE REPORTED ─────────────────────────────────────────────
 *
 * Every one of them is a projection from the observed capture histories onto the unobserved 000 cell, and
 * they fail in DIFFERENT directions. Reporting one number would hide which failure we are living with.
 *
 *   1. LOG-LINEAR, no three-way term      n̂₀ = (n₁₁₁·n₁₀₀·n₀₁₀·n₀₀₁) / (n₁₁₀·n₁₀₁·n₀₁₁)
 *      The standard remedy for dependent sources, and the reason ≥3 are needed: with two lists the model
 *      is SATURATED and the dependence cannot be estimated from the data at all. Fits all three pairwise
 *      interactions and predicts the missing cell. Assumes no three-way interaction — not identifiable
 *      here, so it is an assumption, not a finding.
 *
 *   2. CHAO's lower bound                 n̂₀ = f₁² / (2·f₂)
 *      Nonparametric, no model selection, robust to heterogeneity — and LESS biased than Chapman unless
 *      the sources are independent (Brittain & Böhning 2009), which is precisely our case. Its value is
 *      that it needs no interaction model to be right about a FLOOR.
 *
 *   3. MODIFIED CHAO, one-inflation robust  n̂₀ = 2·f₂³ / (9·f₃²)
 *      ⚠️ THE ONE THAT MATTERS HERE, and it is missing from the proposal this implements. Chao SEVERELY
 *      overestimates under one-inflation — an excess of items seen by exactly ONE source (Böhning et al.
 *      2018, Metrika). Our f₁ bucket is precisely where false positives live: a motion spike that one
 *      detector alone calls a beat enters as a singleton and is indistinguishable from a real beat two
 *      detectors missed. Naive Chao therefore inflates the missed-beat count in the flattering direction.
 *      This variant estimates f₁ from f₂ and f₃ instead of trusting it (f̂₁ = 2f₂²/3f₃), which is why it
 *      needs three sources — the same requirement the interaction model has, arrived at independently.
 *
 * A LARGE GAP BETWEEN 2 AND 3 IS ITSELF THE RESULT: it measures how much of the singleton bucket is not
 * beats. That is a diagnostic no single estimator can produce, and it is the reason this module refuses
 * to return a scalar.
 *
 * ⚠️ WHAT THIS CANNOT DO. Positive dependence between sources biases every capture–recapture estimate
 * DOWNWARD (Brenner 1995) — detectors fail together, because motion, poor perfusion and apnea degrade
 * optical and electrical channels at once. So the honest reading of every number here is A LOWER BOUND
 * on the beats missed, never an estimate of them. Stated as "at least N", it is usable; stated as "N", it
 * is wrong in the direction that makes the corpus look better than it is.
 *
 * REFERENCES
 *   Brittain & Böhning (2009), AStA Adv Stat Anal — Chao vs Chapman under dependence. doi:10.1007/s10182-008-0085-y
 *   Böhning, Rocchetti, Maruotti & Holling (2018), Metrika 81:361–375 — modified Chao under one-inflation.
 *   Brenner (1995), Epidemiology 6:42–48 — direction of the dependence bias with two dependent sources.
 *
 * PURE. No I/O, no clock, no corpus. The driver that feeds it real beat trains is
 * `tools/beat-capture-recapture.mjs`; this file is gate-backed by the `capture-recapture` group.
 */

/** The seven observable capture histories, in a fixed order. `000` is the cell being estimated. */
export const CELLS = ['100', '010', '001', '110', '101', '011', '111'];

/**
 * Roll a list of per-beat capture histories into the 7-cell table.
 * Each history is a 3-bit string / array of booleans over sources [A,B,C]. `000` is IGNORED rather than
 * accepted: a beat no source captured cannot have been observed, so its presence in the input means the
 * caller built the histories wrong, and silently counting it would corrupt every estimate downstream.
 */
export function tabulate(histories) {
  const counts = Object.fromEntries(CELLS.map((c) => [c, 0]));
  let dropped = 0;
  for (const h of histories || []) {
    const key = Array.isArray(h) ? h.map((b) => (b ? 1 : 0)).join('') : String(h);
    if (key === '000') {
      dropped += 1;
      continue;
    }
    if (!(key in counts)) throw new Error(`not a 3-source capture history: ${JSON.stringify(h)}`);
    counts[key] += 1;
  }
  return { counts, observed: CELLS.reduce((s, c) => s + counts[c], 0), impossibleHistories: dropped };
}

/** f₁/f₂/f₃ — captured by exactly one, two, three sources. The frequency view the Chao family needs. */
export function frequencies(counts) {
  return {
    f1: counts['100'] + counts['010'] + counts['001'],
    f2: counts['110'] + counts['101'] + counts['011'],
    f3: counts['111']
  };
}

// A refusal, never a silent zero — the house rule from DexClock.hostAxis. A caller must not be able to
// mistake "this could not be computed" for "nothing was missed", which is the one error that would make
// the corpus look clean precisely when the data is worst.
const refuse = (reason) => ({ ok: false, reason, n0: null });

/**
 * Log-linear with all three pairwise interactions and no three-way term.
 * Also returns the interaction terms themselves, because a fit that found NO dependence on this data
 * would be the surprising result and must not pass silently (λ > 0 ⇒ that pair captures together more
 * often than independence predicts ⇒ the estimate below is a floor).
 */
export function logLinear(counts) {
  const need = ['110', '101', '011', '111', '100', '010', '001'];
  const zero = need.filter((c) => !counts[c]);
  if (zero.length) return refuse(`empty cell(s) ${zero.join(',')} — the closed form divides by zero`);
  const n0 = (counts['111'] * counts['100'] * counts['010'] * counts['001']) / (counts['110'] * counts['101'] * counts['011']);
  // λ_XY = log(n_XY · n̂₀ / (n_X · n_Y)) — zero under independence, positive when the pair fails together.
  const lam = (pair, x, y) => Math.log((counts[pair] * n0) / (counts[x] * counts[y]));
  return {
    ok: true,
    n0,
    interactions: { AB: lam('110', '100', '010'), AC: lam('101', '100', '001'), BC: lam('011', '010', '001') }
  };
}

/** Chao's lower bound. Undefined without doubletons — with f₂ = 0 there is nothing to project from. */
export function chao(counts) {
  const { f1, f2 } = frequencies(counts);
  if (!f2) return refuse('f2 = 0 — no beat was seen by exactly two sources');
  return { ok: true, n0: (f1 * f1) / (2 * f2) };
}

/**
 * Chao modified to survive one-inflation: estimates f₁ from f₂ and f₃ rather than trusting the singleton
 * bucket, because that bucket is where a single detector's false positives land.
 */
export function modifiedChao(counts) {
  const { f2, f3 } = frequencies(counts);
  if (!f3) return refuse('f3 = 0 — no beat was seen by all three sources');
  return { ok: true, n0: (2 * f2 ** 3) / (9 * f3 ** 2) };
}

/**
 * All three, plus the comparison that is the actual product.
 * `oneInflation` is Chao ÷ modified-Chao: > 1 means the singleton bucket is larger than the doubleton and
 * tripleton counts can explain, i.e. it holds things that are not beats.
 */
export function estimate(histories) {
  const { counts, observed, impossibleHistories } = tabulate(histories);
  const ll = logLinear(counts);
  const ch = chao(counts);
  const mc = modifiedChao(counts);
  const ratio = ch.ok && mc.ok && mc.n0 > 0 ? ch.n0 / mc.n0 : null;
  return {
    counts,
    observed,
    impossibleHistories,
    frequencies: frequencies(counts),
    estimators: { logLinear: ll, chao: ch, modifiedChao: mc },
    oneInflation: ratio,
    // Every number here is a LOWER bound on what was missed — positive dependence biases capture–recapture
    // downward, and our detectors fail together by construction. Named so a consumer cannot read it as a
    // point estimate without reading the word.
    missedAtLeast: mc.ok ? mc.n0 : ch.ok ? ch.n0 : null
  };
}
