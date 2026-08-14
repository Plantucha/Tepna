// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * known-clock-recovery — inject a KNOWN clock defect, run the production estimator, measure what
 * comes back. (KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md)
 *
 * WHY THIS EXISTS. Every timing number the suite publishes is self-consistent but UNANCHORED:
 * `hostAxis` measures device against host, Allan measures host against itself, closure measures three
 * sources against each other. Nothing was ever compared to a truth known in advance, so all of it
 * could be wrong in the same direction and every gate would still read green. This tool supplies the
 * missing truth: it perturbs a real recording by an exact amount and asks the shipped estimator to
 * recover it.
 *
 * SUBSTRATE. Any `*_PMDARRIVAL.csv` written by capture-host — one row per BLE packet, carrying the
 * capture host's stamp and the device's own sensor counter. That pair IS the two clocks.
 *
 * DETERMINISM IS A CONTRACT HERE, NOT A CONVENIENCE. Nothing in this file calls Math.random() or
 * Date.now(). The one place noise is needed (target 3, wander) uses a seeded LCG, so a reported
 * figure re-runs to the bit. A recovery experiment whose numbers move between runs cannot separate
 * "the estimator is biased" from "the draw was unlucky".
 *
 * Usage:
 *   node tools/known-clock-recovery.mjs --root <captures-dir> [--out results.json] [--min-packets N]
 *   node tools/known-clock-recovery.mjs --self-test
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DexClock = require(join(ROOT, 'clock.js'));

/* ── the Clock Contract's own parser rules apply to the sidecar too ──────────────────────────────
   Explicit regex, never `new Date(str)` (§2.4), and components validated by Date.UTC round-trip so
   an out-of-range field yields null rather than a silently rolled instant (§2.7). */
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
export function parseHostStamp(s) {
  const m = ISO.exec(String(s).trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
  const ms = m[7] ? +m[7].padEnd(3, '0') : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, se, ms);
  const b = new Date(t);
  if (b.getUTCFullYear() !== y || b.getUTCMonth() !== mo - 1 || b.getUTCDate() !== d) return null;
  return t;
}

export function parseSidecar(text) {
  const lines = String(text).split('\n');
  const byMeas = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length < 4) continue;
    const hostMs = parseHostStamp(c[0]);
    const devNs = Number(c[3]);
    if (hostMs === null || !Number.isFinite(devNs)) continue;
    const k = c[2];
    if (!byMeas.has(k)) byMeas.set(k, []);
    byMeas.get(k).push({ hostMs, devMs: devNs / 1e6 });
  }
  return byMeas;
}

/* A capture can carry a counter RESET mid-session (measured: one O2Ring night steps −27,463 s). A
   reset is not a clock error, it is a different clock — splitting is honest, "correcting" is not. */
export function longestMonotonicRun(a) {
  let best = [],
    cur = a.length ? [a[0]] : [];
  for (let i = 1; i < a.length; i++) {
    if (a[i].devMs >= a[i - 1].devMs) cur.push(a[i]);
    else {
      if (cur.length > best.length) best = cur;
      cur = [a[i]];
    }
  }
  return cur.length > best.length ? cur : best;
}

// seeded LCG — reproducible "noise" (numerical recipes constants)
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}

// ── perturbations. Each returns a NEW anchor array; none mutates its input. ────────────────────
export const PERTURB = {
  offset: (a, ms) => a.map((x) => ({ devMs: x.devMs, hostMs: x.hostMs + ms })),
  frequency: (a, ppm) => {
    const d0 = a[0].devMs;
    return a.map((x) => ({ hostMs: x.hostMs, devMs: d0 + (x.devMs - d0) * (1 + ppm / 1e6) }));
  },
  /* A random WALK in frequency — the τ^+1/2 mechanism. Injected on the host leg so the device axis
     keeps its real quantisation (which target 7 depends on). */
  wander: (a, ppmStep, seed) => {
    const r = lcg(seed);
    let f = 0,
      acc = 0;
    const out = [];
    for (let i = 0; i < a.length; i++) {
      f += (r() - 0.5) * 2 * ppmStep;
      const dt = i > 0 ? a[i].devMs - a[i - 1].devMs : 0;
      acc += (f / 1e6) * dt;
      out.push({ devMs: a[i].devMs, hostMs: a[i].hostMs + acc });
    }
    return out;
  },
  jump: (a, ms, atFrac) => {
    const k = Math.floor(a.length * atFrac);
    return a.map((x, i) => ({ devMs: x.devMs, hostMs: x.hostMs + (i >= k ? ms : 0) }));
  },
  lossContiguous: (a, frac) => {
    const n = a.length,
      cut = Math.floor(n * frac),
      s = Math.floor((n - cut) / 2);
    return a.filter((_, i) => i < s || i >= s + cut);
  },
  lossInterleaved: (a, frac) => {
    const keep = Math.max(1, Math.round((1 - frac) * 10));
    return a.filter((_, i) => i % 10 < keep);
  }
};

const ppmOf = (r) => (r && r.ok ? r.ppm : null);

/** Run every target against one anchor set. Returns a plain object — no printing. */
export function recover(anchors, opts = {}) {
  const seed = opts.seed ?? 12345;
  const base = DexClock.hostAxis(anchors);
  const out = { n: anchors.length, baseline: null, targets: {} };
  if (!base.ok) {
    out.baseline = { ok: false, reason: base.reason };
    return out;
  }
  const spanS = (anchors[anchors.length - 1].devMs - anchors[0].devMs) / 1000;
  out.baseline = {
    ok: true,
    ppm: base.ppm,
    spanS,
    maxStepMs: base.maxStepMs,
    spreadMs: base.spreadMs,
    independent: base.independent,
    deviceDrawn: base.deviceDrawn ?? null,
    drawnShare: base.drawnShare ?? null,
    /* `stability` has NO `ok` field — it is either the object or null. Guarding on `.ok` silently
       recorded null for every stream and would have been reported as "no noise type recovered",
       which is a check reporting about something it never examined. Present/absent is the contract. */
    stabilitySlope: base.stability ? base.stability.slope : null,
    stabilityNoise: base.stability ? base.stability.noise : null,
    stabilityTaus: base.stability ? base.stability.taus : null,
    ppmUncertainty: base.stability ? base.stability.ppmUncertainty : null
  };

  // T0 · NULL CONTROL — the same input, untouched. Must reproduce the baseline exactly.
  out.targets.null = { injected: 0, recovered: ppmOf(DexClock.hostAxis(anchors.map((x) => ({ ...x })))) };
  out.targets.null.errPpm = out.targets.null.recovered === null ? null : out.targets.null.recovered - base.ppm;

  // T1 · CONSTANT OFFSET — expected UNRECOVERABLE (hostAxis subtracts r0). Recovering ~0 is the pass.
  out.targets.offset = [1000, 5000, 60000].map((ms) => {
    const r = ppmOf(DexClock.hostAxis(PERTURB.offset(anchors, ms)));
    return { injectedMs: ms, dPpm: r === null ? null : r - base.ppm };
  });

  /* T2 · CONSTANT FREQUENCY — the calibration curve.
     SIGN, stated in the DATA rather than a comment, because getting it wrong is the classic way to
     report a confident wrong answer: the injection makes the DEVICE run fast by +ppm, and hostAxis
     reports `r = host − dev`, so the correct recovery is **−ppm**. `expectedPpm` carries that, and
     `relErr` is measured against it. (My own first self-test asserted against +ppm and failed at
     −198.7 %, which is exactly this sign, doubled.) */
  out.targets.frequency = [-500, -100, -10, -1, 1, 10, 100, 500].map((ppm) => {
    const r = ppmOf(DexClock.hostAxis(PERTURB.frequency(anchors, ppm)));
    const rec = r === null ? null : r - base.ppm;
    const expected = -ppm;
    return { injectedPpm: ppm, expectedPpm: expected, recoveredPpm: rec, relErr: rec === null ? null : (rec - expected) / Math.abs(expected) };
  });

  // T3 · FREQUENCY WANDER — recover the NOISE TYPE, not a magnitude (allan.py's classify()).
  out.targets.wander = [0.5, 5].map((step) => {
    const r = DexClock.hostAxis(PERTURB.wander(anchors, step, seed));
    return {
      injectedPpmStep: step,
      slope: r.ok && r.stability ? r.stability.slope : null,
      noise: r.ok && r.stability ? r.stability.noise : null
    };
  });

  // T4 · PACKET LOSS — contiguous (what a real dropout is) vs interleaved (what it is not).
  out.targets.loss = [0.1, 0.3, 0.5].flatMap((f) =>
    [
      ['contiguous', PERTURB.lossContiguous],
      ['interleaved', PERTURB.lossInterleaved]
    ].map(([kind, fn]) => {
      const set = fn(anchors, f);
      const r = set.length >= 3 ? ppmOf(DexClock.hostAxis(set)) : null;
      return { kind, frac: f, n: set.length, dPpm: r === null ? null : r - base.ppm };
    })
  );

  // T5 · TIMESTAMP JUMP — must localise to maxStepMs, not smear into the rate.
  out.targets.jump = [200, 2000].map((ms) => {
    const r = DexClock.hostAxis(PERTURB.jump(anchors, ms, 0.5));
    return {
      injectedMs: ms,
      maxStepMs: r.ok ? r.maxStepMs : null,
      stepRatio: r.ok && base.maxStepMs > 0 ? r.maxStepMs / base.maxStepMs : null
    };
  });

  return out;
}

// ── corpus walk ────────────────────────────────────────────────────────────────────────────────
function* sidecars(root) {
  for (const d of readdirSync(root).sort()) {
    const p = join(root, d);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith('_PMDARRIVAL.csv')) yield join(p, f);
    } else if (d.endsWith('_PMDARRIVAL.csv')) yield p;
  }
}

const deviceOf = (f) => (/O2Ring/i.test(f) ? 'O2Ring' : /VeritySense/i.test(f) ? 'Verity' : /H10/i.test(f) ? 'H10' : 'other');

function selfTest() {
  let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (!cond) fail++;
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  ok('parseHostStamp reads an explicit stamp', parseHostStamp('2026-08-13T23:18:13.840') === Date.UTC(2026, 7, 13, 23, 18, 13, 840));
  ok('…and REFUSES an out-of-range one rather than rolling it', parseHostStamp('2026-13-45T25:99:99') === null);
  ok('…and refuses a non-stamp', parseHostStamp('Phone timestamp') === null);
  // a synthetic pair with a KNOWN planted rate
  const a = [];
  let acc = 0;
  for (let i = 0; i < 400; i++) {
    acc += 1000 + ((i * 37) % 97);
    a.push({ devMs: acc, hostMs: acc + acc * 50e-6 });
  }
  const r = recover(a);
  ok('a planted +50 ppm baseline is seen', Math.abs(r.baseline.ppm - 50) < 5, `ppm=${r.baseline.ppm.toFixed(2)}`);
  ok('NULL control reproduces the baseline exactly', r.targets.null.errPpm === 0, `err=${r.targets.null.errPpm}`);
  const f100 = r.targets.frequency.find((x) => x.injectedPpm === 100);
  ok('a +100 ppm device injection is recovered as -100 ppm within 2 %', Math.abs(f100.relErr) < 0.02, `rel=${(f100.relErr * 100).toFixed(3)} %`);
  ok(
    'constant offset is NOT recoverable — by construction',
    r.targets.offset.every((o) => Math.abs(o.dPpm) < 1e-6)
  );
  ok(
    'a contiguous dropout does not move the rate',
    r.targets.loss.filter((l) => l.kind === 'contiguous').every((l) => Math.abs(l.dPpm) < 1)
  );
  /* REGRESSION: this tool once guarded on `stability.ok`, a field that does not exist, so every
     stream recorded a null noise type and the wander target reported "(none)" across the whole
     corpus — silence read as a result. Assert the field is actually POPULATED, not merely absent. */
  ok(
    'the stability curve is actually READ, not silently null',
    r.baseline.stabilityNoise !== null && r.baseline.stabilityTaus > 0,
    `noise=${r.baseline.stabilityNoise} taus=${r.baseline.stabilityTaus}`
  );
  /* NOT "always names a type": `classify()` returns `noise: null` (with candidates) when the slope
     SE cannot discriminate, which is its honest refusal and must not be asserted away. What must hold
     is that a SLOPE was computed for every injection — the curve ran. Measured: the classifier names
     a type at 0.5 and 20 ppm/step and declines in between, so class recovery succeeds at the extremes
     only. That is a property of the estimator worth reporting, not a bug to assert around. */
  ok(
    'every wander injection yields a computed slope (named or not)',
    r.targets.wander.every((w) => typeof w.slope === 'number' && isFinite(w.slope)),
    JSON.stringify(r.targets.wander.map((w) => [w.slope, w.noise]))
  );
  ok('monotonic split finds the longer run', longestMonotonicRun([{ devMs: 0 }, { devMs: 1 }, { devMs: 2 }, { devMs: 0 }]).length === 3);
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--self-test')) return selfTest();
  const root = arg('--root') || process.env.DEX_CAPTURES;
  if (!root) {
    console.error('usage: node tools/known-clock-recovery.mjs --root <captures-dir> [--out f.json] [--min-packets N]');
    console.error('   or: node tools/known-clock-recovery.mjs --self-test');
    return 2;
  }
  const minPk = Number(arg('--min-packets') || 500);
  const results = [];
  for (const f of sidecars(root)) {
    let byMeas;
    try {
      byMeas = parseSidecar(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    for (const [meas, rows] of byMeas) {
      if (rows.length < minPk) continue;
      const seg = longestMonotonicRun(rows);
      const split = seg.length < rows.length;
      if (seg.length < minPk) continue;
      const rec = recover(seg);
      results.push({ file: basename(f), night: basename(dirname(f)), device: deviceOf(f), meas, packets: rows.length, usedPackets: seg.length, counterReset: split, ...rec });
    }
  }
  const out = arg('--out');
  const doc = { tool: 'known-clock-recovery', substrate: root, files: results.length, results };
  if (out) {
    writeFileSync(out, JSON.stringify(doc, null, 1));
    console.log(`wrote ${out} — ${results.length} stream(s)`);
  } else console.log(JSON.stringify(doc, null, 1));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('known-clock-recovery.mjs')) process.exit(main(process.argv.slice(2)));
