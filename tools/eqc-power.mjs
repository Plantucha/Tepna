#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * eqc-power.mjs — how many simultaneous epochs does Extended Quadruple
 * Collocation need before it can say WHICH pair of sources shares error?
 *
 * PRE-REGISTERED, AND THAT IS THE POINT. CROSS-DOMAIN-METHODS-FOLLOWUPS §7
 * adopts blind analysis as a discipline; this is the first use of it. The
 * required N is determined HERE, by simulation against a planted answer,
 * BEFORE the real corpus is touched — so the corpus cannot be run, found
 * underpowered, and then re-read with a friendlier threshold. If the corpus
 * has fewer epochs than this tool says are needed, the answer is "we cannot
 * tell", and that is a result rather than a failure.
 *
 * WHY IT MATTERS HERE. §1 of that brief proves the TCH correlation rho is NOT
 * identifiable from three sources — 3 pairwise variances, 4 unknowns — so it
 * must come from outside the triplet. A FOURTH source is the cheapest outside
 * information available, and Pierdicca et al. (2017) show quadruple collocation
 * can additionally identify WHICH pair carries the shared error rather than
 * assuming it.
 *
 * THE MODEL. Four systems observe one truth: x_i = t + e_i. Pairwise difference
 * variances are V_ij = s_i^2 + s_j^2 - 2*c_ij. If exactly ONE pair (a,b) shares
 * error, c_ab = rho*s_a*s_b and every other c_ij = 0. That gives 6 equations for
 * 5 unknowns (four variances + rho) — overdetermined by one, which is exactly
 * the slack that lets a WRONG hypothesis about which pair is correlated be
 * detected: it forces the shared variance into an equation that cannot absorb
 * it, and the least-squares residual rises.
 *
 * ⚠️ THE HONEST FAILURE MODE THIS MEASURES. With too few epochs the sampling
 * noise in V_ij swamps that residual gap and the procedure picks a pair at
 * random while still returning a confident-looking number. Chance is 1/6 = 17 %.
 * The output below is identification ACCURACY against the planted pair, so a row
 * near 17 % means the method is guessing.
 *
 * USAGE
 *   node tools/eqc-power.mjs [--trials 400] [--rho 0.5]
 * ════════════════════════════════════════════════════════════════════════ */

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const TRIALS = arg('--trials', 400);
const RHO = arg('--rho', 0.5);

/* Seeded — an unreproducible power analysis is worth nothing, and this one is
   pre-registering a threshold that later work will be held to. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => {
  let u = 0;
  let v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const PAIRS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3]
];

function variance(a) {
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
}

/* Least-squares solve for the four error variances GIVEN a hypothesis about
   which pair is correlated: use only the 5 pair equations that the hypothesis
   says are clean. Returns the residual of the fit over those 5. */
function fitGivenPair(V, hyp) {
  const rows = [];
  const rhs = [];
  PAIRS.forEach((p, k) => {
    if (p[0] === hyp[0] && p[1] === hyp[1]) return; // the contaminated equation
    const r = [0, 0, 0, 0];
    r[p[0]] = 1;
    r[p[1]] = 1;
    rows.push(r);
    rhs.push(V[k]);
  });
  // normal equations A'A x = A'b, 4x4 — solved by Gaussian elimination
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const b = [0, 0, 0, 0];
  for (let i = 0; i < rows.length; i++) {
    for (let r = 0; r < 4; r++) {
      b[r] += rows[i][r] * rhs[i];
      for (let c = 0; c < 4; c++) A[r][c] += rows[i][r] * rows[i][c];
    }
  }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const s2 = [0, 1, 2, 3].map((i) => M[i][4] / M[i][i]);
  if (s2.some((v) => !Number.isFinite(v) || v <= 0)) return null; // non-physical ⇒ hypothesis rejected
  let resid = 0;
  for (let i = 0; i < rows.length; i++) {
    const pred = rows[i].reduce((s, w, j) => s + w * s2[j], 0);
    resid += (pred - rhs[i]) ** 2;
  }
  return { s2, resid };
}

function identifyPair(V) {
  let best = null;
  for (const hyp of PAIRS) {
    const f = fitGivenPair(V, hyp);
    if (!f) continue;
    if (!best || f.resid < best.resid) best = { hyp, ...f };
  }
  return best;
}

function trial(n, sigmas, planted, rho, rnd) {
  const [pa, pb] = planted;
  const x = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    const shared = gauss(rnd);
    for (let k = 0; k < 4; k++) {
      let e = gauss(rnd);
      if (k === pa || k === pb) e = rho * shared + Math.sqrt(1 - rho * rho) * e;
      x[k].push(sigmas[k] * e);
    }
  }
  const V = PAIRS.map(([a, b]) => variance(x[a].map((v, i) => v - x[b][i])));
  const got = identifyPair(V);
  if (!got) return { exact: false, cls: false };
  const exact = got.hyp[0] === pa && got.hyp[1] === pb;
  // the COMPLEMENTARY edge: the two indices not in the planted pair
  const comp = [0, 1, 2, 3].filter((i) => i !== pa && i !== pb);
  const cls = exact || (got.hyp[0] === comp[0] && got.hyp[1] === comp[1]);
  return { exact, cls };
}

/* Real measured sigmas where we have them: ECGDex 0.30, PpgDex 0.33,
   OxyDex 1.10 bpm (TCH medians). CPAPDex has no published sigma, so it is given
   the middle of that range — flagged, not hidden. */
const SIGMAS = [0.3, 0.33, 1.1, 0.6];
const LABELS = ['ECGDex', 'PpgDex', 'OxyDex', 'CPAPDex(assumed)'];

console.log('Extended Quadruple Collocation — can it identify the correlated pair?');
console.log(`  sigmas: ${LABELS.map((l, i) => `${l}=${SIGMAS[i]}`).join(' · ')}`);
console.log(`  planted rho = ${RHO} on ONE pair · ${TRIALS} trials per N · chance = 16.7 %\n`);
console.log('       N     EXACT pair   pair-or-COMPLEMENT   verdict');
for (const n of [50, 100, 174, 250, 500, 1000, 2000, 5000]) {
  let hit = 0;
  let hitCls = 0;
  for (let t = 0; t < TRIALS; t++) {
    const rnd = mulberry32(7000 + t * 131 + n);
    const planted = PAIRS[t % 6];
    const r = trial(n, SIGMAS, planted, RHO, rnd);
    if (r.exact) hit++;
    if (r.cls) hitCls++;
  }
  const acc = (hit / TRIALS) * 100;
  const accCls = (hitCls / TRIALS) * 100;
  const verdict = acc < 30 ? 'GUESSING' : acc < 70 ? 'weak' : acc < 90 ? 'usable' : 'reliable';
  const mark = n === 174 ? '   ← what the 2 available nights give' : '';
  console.log(`  ${String(n).padStart(6)}   ${acc.toFixed(1).padStart(7)} %   ${accCls.toFixed(1).padStart(9)} %   ${verdict}${mark}`);
}
