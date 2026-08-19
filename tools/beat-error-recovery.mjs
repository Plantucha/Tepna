// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * beat-error-recovery — target 6 of KNOWN-CLOCK-ADVERSARIAL-CAPTURE: inject beat-detection errors of
 * KNOWN type and rate into a real beat train, run the shipped HRV path, and measure the damage.
 *
 * WHY A SEPARATE TOOL. `known-clock-recovery.mjs` perturbs the TIME AXIS and asks what the clock
 * estimator recovers. That substrate cannot express the error that actually reaches a user: a missed
 * or invented heartbeat. The arrival sidecar has no beats in it. So target 6 needs a different input
 * (the RR train) and a different readout (the HRV metric), and the brief said so before this existed.
 *
 * WHY IT MATTERS MORE THAN THE PPM WORK. A clock error of 30 ppm moves a 7 h night by 0.75 s and
 * moves rMSSD by nothing at all — rMSSD is a difference of ADJACENT intervals, so a smooth rate error
 * cancels almost exactly. A single missed beat merges two intervals into one that is ~2x normal, and
 * rMSSD is quadratic in that. The two failure families are not comparable in size, and only one of
 * them had ever been measured here.
 *
 * MALIK CORRECTION IS THE THING UNDER TEST, not a preprocessing step. `PPGDSP.correctRR` exists to
 * remove exactly these artefacts; the question this tool answers is how much of the injected damage
 * actually survives it.
 *
 * DETERMINISM. Seeded LCG only — no Math.random, no Date.now. Every figure re-runs to the bit.
 *
 * Usage:
 *   node tools/beat-error-recovery.mjs --self-test
 *   node tools/beat-error-recovery.mjs --root <captures-dir> [--out results.json]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DexBuild = require(join(ROOT, 'tools/build-core.js'));

/* The DSPs are browser modules: they attach to `window` and some carry ESM syntax the shared realm
   cannot eval. This mirrors tests/run-tests.mjs — same sandbox shape, same classicify() — so the tool
   exercises the SHIPPED code rather than a reimplementation of it. */
function realm() {
  const noop = () => {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.addEventListener = noop;
  sandbox.removeEventListener = noop;
  sandbox.document = {
    createElement: () => ({ style: {}, getContext: () => null, appendChild: noop }),
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: noop }
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['clock.js', 'ppgdex-dsp.js', 'ecgdex-dsp.js']) {
    vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: join(ROOT, f) });
  }
  return ctx;
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}

// ── HRV metrics, defined here so the readout is unambiguous ───────────────────────────────────────
export function hrv(rr) {
  const a = rr.filter(Number.isFinite);
  if (a.length < 3) return null;
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const sdnn = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1));
  let sq = 0;
  for (let i = 1; i < a.length; i++) sq += (a[i] - a[i - 1]) ** 2;
  const rmssd = Math.sqrt(sq / (a.length - 1));
  let nn50 = 0;
  for (let i = 1; i < a.length; i++) if (Math.abs(a[i] - a[i - 1]) > 50) nn50++;
  return { n: a.length, meanRR: mean, hr: 60000 / mean, sdnn, rmssd, pnn50: (nn50 / (a.length - 1)) * 100 };
}

// ── beat-error injections. Each returns a NEW train. ──────────────────────────────────────────────
export const BEAT = {
  /* A MISSED beat: the detector fails to fire, so two adjacent intervals MERGE into one. This is the
     physically correct model — a dropped beat does not shorten the record, it fuses two RRs. */
  miss: (rr, frac, seed) => {
    const r = lcg(seed),
      out = [];
    for (let i = 0; i < rr.length; i++) {
      if (i < rr.length - 1 && r() < frac) {
        out.push(rr[i] + rr[i + 1]);
        i++;
      } else out.push(rr[i]);
    }
    return out;
  },
  /* A FALSE POSITIVE: a spurious detection SPLITS one interval into two. Split point is drawn but
     bounded away from the ends, because a detector firing 1 ms after a real beat is a different
     artefact (and is what refractory logic removes). */
  falsePositive: (rr, frac, seed) => {
    const r = lcg(seed ^ 0x5f),
      out = [];
    for (const x of rr) {
      if (r() < frac) {
        const f = 0.3 + r() * 0.4;
        out.push(x * f, x * (1 - f));
      } else out.push(x);
    }
    return out;
  },
  /* JITTER: the beat is found, but ±ms off. This is detector imprecision rather than a miscount, and
     it is the one that should hurt rMSSD most per unit of error, since rMSSD differentiates. */
  jitter: (rr, ms, seed) => {
    const r = lcg(seed ^ 0xa3);
    return rr.map((x) => x + (r() - 0.5) * 2 * ms);
  }
};

export function measure(rrTrue, ctx, opts = {}) {
  const seed = opts.seed ?? 4242;
  const PPGDSP = ctx.PPGDSP || ctx.window.PPGDSP;
  const ECGDSP = ctx.ECGDSP || ctx.window.ECGDSP;
  const hasMalik = PPGDSP && typeof PPGDSP.correctRR === 'function';
  /* TWO correctors, and using the wrong one is itself a measurable error. The RR train here is
     ECG-derived, and the suite applies a STRICTER Malik bound to ECG/Pulse than to optical PPG —
     300/2200/0.20 vs 300/2000/0.30, intentionally per oxydex-dsp.js:92. `PPGDSP.correctRR` is the
     optical one; `ECGDSP.validateRR` reaches the ECG one (`_malikCorrect`, closure-local, ±0.20 from
     a W=5 local median). Both are reported so the attribution is explicit rather than assumed. */
  const hasEcgMalik = ECGDSP && typeof ECGDSP.validateRR === 'function';
  const truth = hrv(rrTrue);
  const tt = rrTrue.map((_, i) => i); // correctRR takes (rr, t); index time is sufficient for gating
  const out = { truth, malikAvailable: hasMalik, targets: {} };

  const run = (label, rr) => {
    const raw = hrv(rr);
    let corrected = null,
      nCorr = null;
    if (hasMalik) {
      try {
        /* The shipped return is `{ nn, tt, nCorr, flags }`. An earlier version of this tool looked for
           `rr | corrected | out`, matched none of them, and recorded null for every stream — so the
           whole corpus reported "after Malik: n/a" while the corrector was running fine. Silence read
           as a result, again. `nn` is the repaired interval series; `nCorr` is how many it repaired,
           and is worth reporting because a corrector that fixes the metric by rewriting a third of the
           beats is not the same finding as one that repairs a handful. */
        const c = PPGDSP.correctRR(
          rr,
          rr.map((_, i) => i)
        );
        const arr = c && Array.isArray(c.nn) ? c.nn : null;
        if (arr && arr.length >= 3) {
          corrected = hrv(arr.filter(Number.isFinite));
          nCorr = c.nCorr ?? null;
        }
      } catch {
        /* correctRR refused — recorded as null, never silently treated as a pass */
      }
    }
    // the ECG-tuned corrector, reached through its public surface
    let ecgCorrRmssdErr = null,
      ecgNCorr = null;
    if (hasEcgMalik && truth) {
      try {
        const v = ECGDSP.validateRR(
          rrTrue,
          rr.map((x) => ({ rr: x }))
        );
        if (v && Number.isFinite(v.devRMSSD)) {
          ecgCorrRmssdErr = ((v.devRMSSD - truth.rmssd) / truth.rmssd) * 100;
          ecgNCorr = v.devEctopyCorrected ?? null;
        }
      } catch {
        /* refused — null, never a silent pass */
      }
    }
    const err = (m, k) => (m && truth ? ((m[k] - truth[k]) / truth[k]) * 100 : null);
    return {
      label,
      nRaw: raw ? raw.n : null,
      nCorr,
      correctedFrac: nCorr != null && raw ? nCorr / raw.n : null,
      ecgCorrRmssdErr,
      ecgNCorr,
      rawErrPct: raw ? { rmssd: err(raw, 'rmssd'), sdnn: err(raw, 'sdnn'), meanRR: err(raw, 'meanRR'), pnn50: raw.pnn50 - truth.pnn50 } : null,
      correctedErrPct: corrected ? { rmssd: err(corrected, 'rmssd'), sdnn: err(corrected, 'sdnn'), meanRR: err(corrected, 'meanRR'), pnn50: corrected.pnn50 - truth.pnn50 } : null
    };
  };

  out.targets.miss = [0.001, 0.005, 0.02, 0.05].map((f) => ({ frac: f, ...run(`miss ${f}`, BEAT.miss(rrTrue, f, seed)) }));
  out.targets.falsePositive = [0.001, 0.005, 0.02, 0.05].map((f) => ({ frac: f, ...run(`fp ${f}`, BEAT.falsePositive(rrTrue, f, seed)) }));
  out.targets.jitter = [2, 10, 30].map((m) => ({ ms: m, ...run(`jitter ${m}`, BEAT.jitter(rrTrue, m, seed)) }));
  /* CONTROL: no injection. Must reproduce truth exactly, and must not be quietly "corrected" into
     something else — if Malik moves an unperturbed train, that is a finding about Malik. */
  out.targets.null = run('null', rrTrue.slice());
  return out;
}

// ── corpus ────────────────────────────────────────────────────────────────────────────────────────
function* rrFiles(root) {
  for (const d of readdirSync(root).sort()) {
    const p = join(root, d);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) for (const f of readdirSync(p).sort()) if (/_RR\.txt$/.test(f)) yield join(p, f);
  }
}

export function parseRR(text) {
  const out = [];
  for (const ln of String(text).split('\n')) {
    const parts = ln.trim().split(/[;,\s]+/);
    for (const p of parts) {
      const v = Number(p);
      /* A plausible RR only. 300–2000 ms is 30–200 bpm; anything outside is a header, a timestamp
         column, or an artefact, and admitting it would silently invent HRV. */
      if (Number.isFinite(v) && v >= 300 && v <= 2000) {
        out.push(v);
        break;
      }
    }
  }
  return out;
}

function selfTest() {
  let fail = 0;
  const ok = (n, c, d = '') => {
    if (!c) fail++;
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  };
  const ctx = realm();
  ok('shipped PPGDSP loaded into the realm', !!(ctx.PPGDSP || ctx.window.PPGDSP));
  // a synthetic but realistic train: 60 bpm with physiological variability
  const r = lcg(1),
    rr = [];
  for (let i = 0; i < 3000; i++) rr.push(1000 + Math.sin(i / 40) * 25 + (r() - 0.5) * 24);
  const t = hrv(rr);
  ok('baseline HRV is physiological', t.rmssd > 3 && t.rmssd < 60 && t.hr > 50 && t.hr < 70, `rmssd=${t.rmssd.toFixed(1)} hr=${t.hr.toFixed(1)}`);
  const m = measure(rr, ctx);
  ok('NULL control reproduces truth exactly', Math.abs(m.targets.null.rawErrPct.rmssd) < 1e-9, `err=${m.targets.null.rawErrPct.rmssd}`);
  const miss5 = m.targets.miss.find((x) => x.frac === 0.05);
  ok('a 5 % miss rate INFLATES rMSSD substantially', miss5.rawErrPct.rmssd > 50, `${miss5.rawErrPct.rmssd.toFixed(1)} %`);
  ok(
    '…far more than it moves meanRR',
    Math.abs(miss5.rawErrPct.rmssd) > 5 * Math.abs(miss5.rawErrPct.meanRR),
    `rmssd ${miss5.rawErrPct.rmssd.toFixed(1)} vs meanRR ${miss5.rawErrPct.meanRR.toFixed(2)}`
  );
  const j = m.targets.jitter.find((x) => x.ms === 30);
  ok('detector jitter inflates rMSSD too', j.rawErrPct.rmssd > 10, `${j.rawErrPct.rmssd.toFixed(1)} %`);
  /* REGRESSION: the Malik leg silently recorded null for an entire corpus because this tool read the
     wrong key off the shipped return. Assert it is POPULATED, not merely absent. */
  ok('the ECG-tuned corrector leg is populated too', miss5.ecgCorrRmssdErr !== null, `err=${miss5.ecgCorrRmssdErr}`);
  ok(
    'the Malik corrector leg is actually READ, not silently null',
    miss5.correctedErrPct !== null && miss5.nCorr !== null,
    `corrected=${JSON.stringify(miss5.correctedErrPct && miss5.correctedErrPct.rmssd)} nCorr=${miss5.nCorr}`
  );
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--selftest') || argv.includes('--self-test')) return selfTest();
  const root = arg('--root') || process.env.DEX_CAPTURES;
  if (!root) {
    console.error('usage: node tools/beat-error-recovery.mjs --root <captures-dir> [--out f.json]\n   or: --self-test');
    return 2;
  }
  const ctx = realm();
  const results = [];
  for (const f of rrFiles(root)) {
    let rr;
    try {
      rr = parseRR(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    if (rr.length < 500) continue;
    const dev = /VeritySense|Polar_Sense/i.test(f) ? 'Verity' : /H10/i.test(f) ? 'H10' : 'other';
    results.push({ file: basename(f), night: basename(dirname(f)), device: dev, beats: rr.length, ...measure(rr, ctx) });
  }
  const doc = { tool: 'beat-error-recovery', substrate: root, streams: results.length, results };
  const out = arg('--out');
  if (out) {
    writeFileSync(out, JSON.stringify(doc, null, 1));
    console.log(`wrote ${out} — ${results.length} stream(s)`);
  } else console.log(JSON.stringify(doc, null, 1));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('beat-error-recovery.mjs')) process.exit(main(process.argv.slice(2)));
