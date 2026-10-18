/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * seqnet-eval.mjs — run the JS port over REAL cached nights exactly as seqnet.py does (same fold hash, same
 * column drop, same presence flags, same tensorise, same Viterbi) and score it: pooled/per-cohort κ, and —
 * when the Python run's saved probabilities are given — the per-night max |Δ| between the two implementations.
 *
 *   node seqnet-eval.mjs --weights fold0.json --cache <lab-cache> --cohorts a,b,.. --fold 0 [--proba <dir>] [--limit N] [--verdict out.json]
 *   node seqnet-eval.mjs --selftest | --verdict-sample
 *
 * THE CRITERION IS STATED BEFORE THE RUN (STAGE-LAB brief §24, 2026-10-12), not read off it: the port is
 * at parity when EVERY compared night's max |Δ proba| against the Python run is ≤ 2e-3 (Python saves
 * float16, whose resolution near 1.0 is ~5e-4), and κ_JS − κ_Python on the same nights is within
 * ±0.002 (Viterbi ties can flip single epochs). One night outside the band is a FAIL; a run with no
 * Python probabilities to compare against is NOT_RUN — never a pass by absence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { foldOf, loadWeights, seqnetForward, viterbi } from './seqnet-infer.mjs';
import { makeVerdict } from './verdict-emit.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] !== undefined && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null))
    .filter(Boolean)
);
const FEAT = args.features || 'oxy1';
const model = args.weights ? loadWeights(JSON.parse(fs.readFileSync(args.weights, 'utf8'))) : null;
const meta = model ? model.meta : {};
const K = model ? model.arch.K : 4;

function listNights(cache, cohorts) {
  const nights = [];
  for (const c of cohorts) {
    const d = path.join(cache, c);
    for (const f of fs.readdirSync(d).sort()) {
      if (!f.endsWith(`.${FEAT}.json`)) continue;
      const m = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      if (m.skipped) continue;
      nights.push({ cohort: c, id: m.id, bin: path.join(d, f.slice(0, -5) + '.f32'), k: m.k, n: m.n, y: Int32Array.from(m.labels), names: m.names });
    }
  }
  return nights;
}

/** tensorise(): keep columns, per-row missing fraction, per-block presence over the whole night, nan→0, clip ±8. */
function tensorise(t, keep, blockCols) {
  const raw = new Float32Array(fs.readFileSync(t.bin).buffer.slice(0), 0, t.n * t.k);
  const kk = keep.length,
    nb = blockCols.length,
    kin = kk + 1 + nb;
  const pres = blockCols.map((cols) => {
    for (let r = 0; r < t.n; r++) for (const c of cols) if (!Number.isNaN(raw[r * t.k + keep[c]])) return 1;
    return 0;
  });
  const X = new Float32Array(t.n * kin);
  for (let r = 0; r < t.n; r++) {
    let miss = 0;
    for (let j = 0; j < kk; j++) {
      let v = raw[r * t.k + keep[j]];
      if (Number.isNaN(v)) {
        miss++;
        v = 0;
      } else if (!Number.isFinite(v)) v = 0;
      X[r * kin + j] = v > 8 ? 8 : v < -8 ? -8 : v;
    }
    X[r * kin + kk] = miss / kk;
    for (let b = 0; b < nb; b++) X[r * kin + kk + 1 + b] = pres[b];
  }
  return { X, kin };
}

/** Minimal .npy reader for float16/float32 C-order arrays (what seqnet.py --save-proba writes). */
function readNpy(file) {
  const buf = fs.readFileSync(file);
  const hlen = buf.readUInt16LE(8),
    header = buf.toString('latin1', 10, 10 + hlen);
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1],
    shape = /'shape':\s*\(([^)]*)\)/
      .exec(header)[1]
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((x) => !Number.isNaN(x));
  const off = 10 + hlen,
    n = shape.reduce((a, b) => a * b, 1),
    out = new Float32Array(n);
  if (descr === '<f2') for (let i = 0; i < n; i++) out[i] = half(buf.readUInt16LE(off + 2 * i));
  else if (descr === '<f4') for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(off + 4 * i);
  else throw new Error('npy dtype ' + descr);
  return { data: out, shape };
}
function half(h) {
  const s = h & 0x8000 ? -1 : 1,
    e = (h >> 10) & 0x1f,
    f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

export const PARITY = { probaTol: 2e-3, kappaTol: 0.002 };

/**
 * The parity verdict from per-night results: [{ cohort, id, n, maxDelta|null }], κ of the JS port and, when
 * known, of the Python run on the same nights. Pure, so the selftest can plant every outcome.
 */
export function parityVerdict(nightResults, { kappaJs, kappaPy = null, evidence = [], commit, commitReason, at } = {}) {
  const criterion = {
    name: `every compared night has max |Δ proba(JS − Python)| ≤ ${PARITY.probaTol} and |κ_JS − κ_Python| ≤ ${PARITY.kappaTol} (pre-stated, brief §24)`,
    threshold: 0,
    unit: 'nights outside the band',
    direction: 'eq'
  };
  const base = { gate: 'seqnet-port-parity', criterion, evidence: evidence.slice(), tool: 'tools/seqnet-eval.mjs', commit, commitReason, at };
  const compared = nightResults.filter((r) => r.maxDelta != null);
  const bad = compared.filter((r) => r.maxDelta > PARITY.probaTol);
  const population = { checked: compared.length, eligible: nightResults.length, excluded: nightResults.length - compared.length };
  const worst = compared.reduce((m, r) => Math.max(m, r.maxDelta), 0);
  const kappaGap = kappaPy == null ? null : Math.abs(kappaJs - kappaPy);
  const result = { nights: nightResults.length, compared: compared.length, outsideBand: bad.length, worstDelta: worst, kappaJs, kappaPy, kappaGap };
  if (!compared.length) {
    return makeVerdict({ ...base, status: 'NOT_RUN', population, result: null, reason: 'no night had a Python probability file to compare against — parity was not measured' });
  }
  if (bad.length) {
    return makeVerdict({
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `${bad.length} of ${compared.length} night(s) outside the band, worst max |Δ proba| ${worst.toExponential(2)} > ${PARITY.probaTol}`
    });
  }
  if (kappaGap != null && kappaGap > PARITY.kappaTol) {
    return makeVerdict({
      ...base,
      status: 'FAIL',
      population,
      result,
      reason: `every night within ${PARITY.probaTol} but κ differs by ${kappaGap.toFixed(4)} > ${PARITY.kappaTol} (κ_JS ${kappaJs.toFixed(4)}, κ_Python ${kappaPy.toFixed(4)})`
    });
  }
  return makeVerdict({ ...base, status: 'PASS', population, result, reason: null });
}

export function kappaOf(C, K) {
  let n = 0,
    tr = 0;
  const rs = new Float64Array(K),
    cs = new Float64Array(K);
  for (let i = 0; i < K; i++)
    for (let j = 0; j < K; j++) {
      n += C[i][j];
      rs[i] += C[i][j];
      cs[j] += C[i][j];
      if (i === j) tr += C[i][j];
    }
  let pe = 0;
  for (let i = 0; i < K; i++) pe += rs[i] * cs[i];
  pe /= n * n;
  return (tr / n - pe) / (1 - pe);
}

/** Pooled κ of the Python run from its fold JSON (seqnet.py writes one confusion per night). */
function pythonKappa(foldJson, K) {
  const C = Array.from({ length: K }, () => new Float64Array(K));
  for (const e of JSON.parse(fs.readFileSync(foldJson, 'utf8')).out) for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) C[i][j] += e.conf[i][j];
  return kappaOf(C, K);
}

function run() {
  const cohorts = args.cohorts.split(',');
  const nights = listNights(args.cache, cohorts);
  const fold = parseInt(args.fold, 10),
    group = !!meta.group_subjects;
  let test = nights.filter((t) => foldOf(t.cohort, t.id, group) === fold);
  if (args.limit) test = test.slice(0, parseInt(args.limit, 10));
  const namesAll = nights.find((t) => t.names).names;
  const rx = meta.drop ? new RegExp(meta.drop) : null;
  const keep = namesAll.map((nm, j) => (rx && rx.test(nm) ? -1 : j)).filter((j) => j >= 0);
  const keepNames = keep.map((j) => namesAll[j]);
  if (meta.names && (meta.names.length !== keepNames.length || meta.names.some((n, i) => n !== keepNames[i])))
    throw new Error("feature names differ from the model's — refusing (a column shift would read as a result)");
  const blockCols = (meta.block_prefixes || ['spo2.', 'pulse.', 'motion.']).map((pre) => keepNames.map((nm, j) => (nm.startsWith(pre) ? j : -1)).filter((j) => j >= 0));
  const logT = Float64Array.from(meta.logT.flat()),
    logPrior = Float64Array.from(meta.logPrior);
  const M = Array.from({ length: K }, () => new Float64Array(K));
  const perCohort = {};
  const results = [];
  let msTotal = 0,
    epochs = 0;
  for (const t of test) {
    const { X } = tensorise(t, keep, blockCols);
    const t0 = performance.now();
    const r = seqnetForward(model, X, t.n);
    const p = viterbi(r.proba, t.n, K, logT, logPrior);
    msTotal += performance.now() - t0;
    epochs += t.n;
    if (!perCohort[t.cohort]) perCohort[t.cohort] = Array.from({ length: K }, () => new Float64Array(K));
    const Mc = perCohort[t.cohort];
    for (let i = 0; i < t.n; i++)
      if (t.y[i] >= 0) {
        M[t.y[i]][p[i]]++;
        Mc[t.y[i]][p[i]]++;
      }
    let maxDelta = null;
    if (args.proba) {
      const f = path.join(args.proba, `${t.cohort}~${t.id}.npy`);
      if (fs.existsSync(f)) {
        const py = readNpy(f).data;
        maxDelta = 0;
        for (let i = 0; i < py.length; i++) maxDelta = Math.max(maxDelta, Math.abs(py[i] - r.proba[i]));
      }
    }
    results.push({ cohort: t.cohort, id: t.id, n: t.n, maxDelta });
  }
  const kappaJs = kappaOf(M, K);
  const perClass = [];
  for (let c = 0; c < K; c++) {
    let tp = M[c][c],
      col = 0,
      row = 0;
    for (let i = 0; i < K; i++) {
      col += M[i][c];
      row += M[c][i];
    }
    const P = tp / Math.max(col, 1),
      R = tp / Math.max(row, 1);
    perClass.push(`P${P.toFixed(3)}/R${R.toFixed(3)}/F${((2 * P * R) / Math.max(P + R, 1e-9)).toFixed(3)}`);
  }
  console.log(
    `JS port · fold ${fold} · ${test.length} test nights · ${epochs} epochs · ${(msTotal / 1000).toFixed(1)} s (${(msTotal / Math.max(test.length, 1)).toFixed(0)} ms/night) · kin ${keep.length + 1 + blockCols.length}`
  );
  console.log(`pooled kappa ${kappaJs.toFixed(4)} | ${['W', 'light', 'deep', 'REM'].map((n, i) => n + ' ' + perClass[i]).join(' | ')}`);
  for (const [c, Mc] of Object.entries(perCohort)) console.log(`  ${c.padEnd(12)} kappa ${kappaOf(Mc, K).toFixed(3)}`);
  const compared = results.filter((r) => r.maxDelta != null);
  if (compared.length) console.log(`proba vs Python (float16-saved): ${compared.length} nights, max |Δ| ${Math.max(...compared.map((r) => r.maxDelta)).toExponential(2)}`);
  const kappaPy = args['python-fold'] ? pythonKappa(args['python-fold'], K) : null;
  if (kappaPy != null) console.log(`kappa: JS ${kappaJs.toFixed(4)} vs Python ${kappaPy.toFixed(4)} (gap ${Math.abs(kappaJs - kappaPy).toFixed(4)})`);
  const v = parityVerdict(results, { kappaJs, kappaPy, evidence: [args.weights, args.proba, args['python-fold']].filter(Boolean) });
  console.log(`verdict: ${v.status}${v.reason ? ' — ' + v.reason : ''}`);
  if (args.verdict) {
    fs.writeFileSync(args.verdict, JSON.stringify(v, null, 2) + '\n');
    console.log(`→ ${args.verdict}`);
  }
  process.exit(v.status === 'PASS' ? 0 : 1);
}

export function verdictSample() {
  const nights = [
    { cohort: 'a', id: '1', n: 900, maxDelta: 4e-4 },
    { cohort: 'a', id: '2', n: 850, maxDelta: 9e-4 }
  ];
  return parityVerdict(nights, {
    kappaJs: 0.5,
    kappaPy: 0.501,
    evidence: ['--verdict-sample: planted per-night deltas, no model read'],
    commit: null,
    commitReason: '--verdict-sample: planted nights, no model read, no code identity claimed'
  });
}

function selftest() {
  let pass = 0;
  const fails = [];
  const ok = (c, w) => {
    if (c) pass++;
    else fails.push(w);
  };
  const AT = { commit: null, commitReason: 'selftest', evidence: ['selftest: planted per-night deltas, no model read'] };
  const good = [
    { cohort: 'a', id: '1', n: 10, maxDelta: 1e-3 },
    { cohort: 'b', id: '2', n: 10, maxDelta: 1.9e-3 }
  ];
  ok(parityVerdict(good, { kappaJs: 0.5, kappaPy: 0.501, ...AT }).status === 'PASS', 'PASS: every night within 2e-3 and κ within 0.002');
  ok(parityVerdict(good, { kappaJs: 0.5, kappaPy: 0.51, ...AT }).status === 'FAIL', 'FAIL: nights fine but κ gap 0.01');
  const bad = [...good, { cohort: 'c', id: '3', n: 10, maxDelta: 2.1e-3 }];
  const vb = parityVerdict(bad, { kappaJs: 0.5, kappaPy: 0.5, ...AT });
  ok(vb.status === 'FAIL' && /1 of 3/.test(vb.reason), `FAIL: one night at 2.1e-3 is named: ${vb.reason}`);
  const none = [{ cohort: 'a', id: '1', n: 10, maxDelta: null }];
  const vn = parityVerdict(none, { kappaJs: 0.5, ...AT });
  ok(vn.status === 'NOT_RUN' && vn.population.checked === 0 && vn.population.excluded === 1, 'NOT_RUN: nothing compared is never a pass');
  ok(parityVerdict(good, { kappaJs: 0.5, ...AT }).status === 'PASS', 'PASS without a Python κ: the per-night band alone decides, κ gap is null');
  const v = verdictSample();
  ok(v.schema === 'tepna.verdict/1' && v.status === 'PASS' && v.criterion.direction === 'eq' && v.population.eligible === 2, 'the sample is a valid PASS object');
  ok(
    Math.abs(
      kappaOf(
        [
          [5, 0],
          [0, 5]
        ],
        2
      ) - 1
    ) < 1e-12 &&
      Math.abs(
        kappaOf(
          [
            [5, 5],
            [5, 5]
          ],
          2
        )
      ) < 1e-12,
    'κ: perfect = 1, chance = 0'
  );
  if (fails.length) {
    console.error(`seqnet-eval selftest: ${fails.length} failed, ${pass} passed`);
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`seqnet-eval: all ${pass} selftests passed`);
}

// Dispatch only when run as the entry point, so tests can import parityVerdict without starting a run.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes('--selftest')) selftest();
  else if (process.argv.includes('--verdict-sample')) console.log(JSON.stringify(verdictSample(), null, 2));
  else run();
}
