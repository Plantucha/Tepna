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

const deviceOf = (f) => (/O2Ring/i.test(f) ? 'O2Ring' : /VeritySense|Polar_Sense/i.test(f) ? 'Verity' : /H10/i.test(f) ? 'H10' : 'other');

/* ── BLINDING ────────────────────────────────────────────────────────────────────────────────────
   WHY THIS IS IN THE TOOL RATHER THAN A PROCEDURE NOTE. This work preregistered its criteria and still
   had to withdraw two claims, both caught by the same operator running one more check — the mechanism
   that cannot be relied on. "Hand the analysis to another session" is the fix, and it is also the kind
   of instruction nobody follows unless it is cheaper than not following it. These two modes make it two
   commands.

     prepare : node tools/known-clock-recovery.mjs --blind-prepare --root <corpus> --out <dir>
               writes <dir>/blinded.json  (anchors only, perturbed, opaque stream ids)
                  and <dir>/TRUTH.json    (what was done — DO NOT open before scoring)
     analyse : the second operator reads blinded.json, reports {id -> recoveredPpm} as their own JSON
     score   : node tools/known-clock-recovery.mjs --blind-score --truth <dir>/TRUTH.json --claims <f>

   WHAT IS ACTUALLY HIDDEN, stated plainly because a blinding claim is worth nothing vague: the analyst
   receives anchor pairs and an opaque id. They do not receive the device name, the night, whether a
   perturbation was applied, which family it came from, or its magnitude — including whether it is a
   NULL. The menu below is fixed and published; concealing the menu would be security theatre, since an
   analyst can read this file. What they cannot know is the DRAW.

   THE KEY IS THE ONLY SECRET, and it is not generated here — the caller passes `--key`, so the tool has
   no hidden state and a run is reproducible by whoever holds the key. Reusing a key reproduces a draw
   exactly, which is the point: a disputed result can be re-derived rather than re-argued. */
const BLIND_MENU = [
  { id: 'null', apply: (a) => a.map((x) => ({ ...x })), truth: 0 },
  { id: 'freq-neg-small', apply: (a) => PERTURB.frequency(a, -10), truth: 10 },
  { id: 'freq-pos-small', apply: (a) => PERTURB.frequency(a, 10), truth: -10 },
  { id: 'freq-neg-mid', apply: (a) => PERTURB.frequency(a, -100), truth: 100 },
  { id: 'freq-pos-mid', apply: (a) => PERTURB.frequency(a, 100), truth: -100 },
  { id: 'offset-only', apply: (a) => PERTURB.offset(a, 5000), truth: 0 },
  { id: 'loss-contiguous', apply: (a) => PERTURB.lossContiguous(a, 0.3), truth: 0 }
];

/* A 32-bit FNV-1a of `key + streamIndex`. Deterministic, no crypto claim intended — this hides a draw
   from a colleague, not from an adversary, and saying so is better than implying more. */
function drawFor(key, i) {
  let h = 0x811c9dc5;
  for (const ch of String(key) + ':' + i) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return BLIND_MENU[h % BLIND_MENU.length];
}

export function blindPrepare(streams, key) {
  const blinded = [];
  const truth = [];
  streams.forEach((s, i) => {
    const pick = drawFor(key, i);
    const anchors = pick.apply(s.anchors);
    const id = 'S' + String(i).padStart(4, '0');
    /* THE TRUTH MUST BE ABSOLUTE, NOT A DELTA. The analyst holds only the perturbed anchors, so the
       only quantity they can report is the stream's ABSOLUTE rate — they cannot subtract a baseline
       they were never given. A first version stored the delta and scored an absolute claim against it,
       which turned every stream that merely HAS a real rate into a "false positive": 21 of 61 on the
       first real run, all of them the estimator working correctly. The baseline is computed here,
       where the unperturbed anchors are still in hand, and added to the draw. */
    const base = DexClock.hostAxis(s.anchors);
    const baselinePpm = base.ok ? base.ppm : null;
    /* IS THE DRAW EVEN APPLICABLE? A frequency error cannot be injected into a stream with no device
       span — scaling `(x.devMs - d0)` by `(1 + f)` leaves a zero-length axis untouched — so expecting
       a recovery there demands the impossible. Measured on the first real blind run: `freq-pos-mid`
       scored a median error of EXACTLY 100.000 ppm, i.e. the injected magnitude, because 10 of its
       draws landed on the corpus's zero-span drawn streams and the estimator correctly returned the
       baseline. Marking them inapplicable is honest; leaving them in would have scored the analyst
       down for the harness's error, which is the failure this whole apparatus exists to prevent. */
    const devSpan = s.anchors.length > 1 ? s.anchors[s.anchors.length - 1].devMs - s.anchors[0].devMs : 0;
    const applicable = baselinePpm !== null && (pick.truth === 0 || devSpan > 0);
    const expectedPpm = !applicable ? null : baselinePpm + pick.truth;
    blinded.push({ id, anchors: anchors.map((a) => ({ devMs: a.devMs, hostMs: a.hostMs })) });
    truth.push({ id, perturbation: pick.id, deltaPpm: pick.truth, baselinePpm: baselinePpm, expectedPpm: expectedPpm, applicable: applicable, devSpanMs: devSpan, source: s.label });
  });
  return {
    blinded: { note: 'anchors only — device, night and the draw itself are withheld', streams: blinded },
    truth: { key, note: 'DO NOT open before the analyst has committed their claims', streams: truth }
  };
}

/* Scoring is deliberately DUMB: it compares the analyst's numbers to the draw and reports, with no
   tolerance tuning and no re-run. A score computed after seeing the answer is not a score. */
export function blindScore(truth, claims) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const rows = truth.streams.map((t) => {
    const c = byId.get(t.id);
    const got = c && Number.isFinite(c.recoveredPpm) ? c.recoveredPpm : null;
    const exp = t.expectedPpm == null ? null : t.expectedPpm;
    const err = got === null || exp === null ? null : got - exp;
    return { id: t.id, perturbation: t.perturbation, expected: exp, delta: t.deltaPpm, claimed: got, errPpm: err, missing: got === null || exp === null, inapplicable: t.applicable === false };
  });
  const scored = rows.filter((r) => !r.missing);
  const abs = scored.map((r) => Math.abs(r.errPpm)).sort((a, b) => a - b);
  return {
    n: rows.length,
    answered: scored.length,
    unanswered: rows.filter((r) => r.missing && !r.inapplicable).length,
    /* Reported, never silently dropped: a draw the harness could not actually apply. */
    inapplicable: rows.filter((r) => r.inapplicable).length,
    medAbsErrPpm: abs.length ? abs[abs.length >> 1] : null,
    worstAbsErrPpm: abs.length ? abs[abs.length - 1] : null,
    /* A null draw the analyst reported a rate for is the failure this whole design exists to catch. */
    /* A false positive is a rate claimed where the DRAW added none — judged on the delta, not on the
       absolute expectation, because a stream with a genuine baseline rate is not a false positive. */
    falsePositives: scored.filter((r) => r.delta === 0 && Math.abs(r.errPpm) > 1).length,
    rows: rows
  };
}

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
  /* BLINDING. The assertion that matters is not that scoring works — it is that the file handed to the
     analyst carries no device, no night, no perturbation name and no magnitude. A blinding harness that
     leaks the draw is worse than none, because it produces a confident "independent" result. */
  const bstreams = [
    { label: 'Polar_H10_02849638_x_PMDARRIVAL.csv#ecg', anchors: a.map((x) => ({ ...x })) },
    { label: 'Wellue_O2Ring_y_PMDARRIVAL.csv#ppg', anchors: a.map((x) => ({ ...x })) }
  ];
  const bp = blindPrepare(bstreams, 'test-key');
  const blob = JSON.stringify(bp.blinded);
  ok('the blinded file names no device', !/H10|O2Ring|Verity|Wellue|Polar/i.test(blob));
  /* Strict on purpose, and it earned that: the first version failed on the word "perturbation" in the
     file's own explanatory note — no draw leaked, but a test that tolerates near-misses in a blinding
     check is not worth having, so the note was reworded rather than the assertion loosened. */
  ok('…no draw name and no expected magnitude', !/freq-|offset-only|loss-|expectedPpm|baselinePpm|perturbation/.test(blob));
  ok(
    '…and only opaque ids',
    bp.blinded.streams.every((x) => /^S\d{4}$/.test(x.id))
  );
  ok(
    'the TRUTH file does carry the draw',
    bp.truth.streams.every((x) => typeof x.perturbation === 'string')
  );
  ok('the same key reproduces the same draw', JSON.stringify(blindPrepare(bstreams, 'test-key').truth) === JSON.stringify(bp.truth));
  ok('a different key does not', JSON.stringify(blindPrepare(bstreams, 'other-key').truth) !== JSON.stringify(bp.truth));
  /* the failure this exists to catch: a rate claimed on a draw that had none */
  const nullId = bp.truth.streams.find((x) => x.deltaPpm === 0);
  if (nullId) {
    const sc = blindScore(bp.truth, [{ id: nullId.id, recoveredPpm: (nullId.expectedPpm || 0) + 42 }]);
    ok('scoring flags a rate claimed on a NULL draw as a false positive', sc.falsePositives === 1, 'fp=' + sc.falsePositives);
  }
  const empty = blindScore(bp.truth, []);
  ok('an unanswered stream is counted, not silently dropped', empty.unanswered + empty.inapplicable === bp.truth.streams.length);
  ok('…and an INAPPLICABLE draw is reported separately, not scored as a miss', typeof empty.inapplicable === 'number');
  ok('monotonic split finds the longer run', longestMonotonicRun([{ devMs: 0 }, { devMs: 1 }, { devMs: 2 }, { devMs: 0 }]).length === 3);
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--selftest') || argv.includes('--self-test')) return selfTest();
  if (argv.includes('--blind-prepare')) {
    const root = arg('--root') || process.env.DEX_CAPTURES;
    const out = arg('--out');
    const key = arg('--key');
    if (!root || !out || !key) {
      console.error('usage: --blind-prepare --root <captures> --out <dir> --key <secret>');
      console.error('  the KEY is yours to keep; the tool stores no hidden state and reusing it reproduces the draw');
      return 2;
    }
    const streams = [];
    for (const f of sidecars(root)) {
      let byMeas;
      try {
        byMeas = parseSidecar(readFileSync(f, 'utf8'));
      } catch {
        continue;
      }
      for (const [meas, rows] of byMeas) {
        const seg = longestMonotonicRun(rows);
        if (seg.length < Number(arg('--min-packets') || 500)) continue;
        streams.push({ label: basename(f) + '#' + meas, anchors: seg });
      }
    }
    const { blinded, truth } = blindPrepare(streams, key);
    writeFileSync(join(out, 'blinded.json'), JSON.stringify(blinded));
    writeFileSync(join(out, 'TRUTH.json'), JSON.stringify(truth, null, 1));
    console.log(`prepared ${streams.length} stream(s)\n  give the analyst : ${join(out, 'blinded.json')}\n  DO NOT OPEN yet  : ${join(out, 'TRUTH.json')}`);
    return 0;
  }
  if (argv.includes('--blind-score')) {
    const t = arg('--truth'),
      c = arg('--claims');
    if (!t || !c) {
      console.error('usage: --blind-score --truth <TRUTH.json> --claims <analyst.json>');
      return 2;
    }
    const truth = JSON.parse(readFileSync(t, 'utf8'));
    const raw = JSON.parse(readFileSync(c, 'utf8'));
    const claims = Array.isArray(raw) ? raw : raw.streams || raw.claims || [];
    const sc = blindScore(truth, claims);
    console.log(
      `answered ${sc.answered}/${sc.n}  inapplicable ${sc.inapplicable}  med|err| ${sc.medAbsErrPpm === null ? 'n/a' : sc.medAbsErrPpm.toFixed(3)} ppm  worst ${sc.worstAbsErrPpm === null ? 'n/a' : sc.worstAbsErrPpm.toFixed(3)}  FALSE POSITIVES on null draws: ${sc.falsePositives}`
    );
    for (const r of sc.rows) console.log(`  ${r.id}  ${String(r.perturbation).padEnd(16)} expected ${String(r.expected).padStart(5)}  claimed ${r.claimed === null ? '(none)' : r.claimed.toFixed(2)}`);
    return sc.falsePositives > 0 ? 1 : 0;
  }
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
