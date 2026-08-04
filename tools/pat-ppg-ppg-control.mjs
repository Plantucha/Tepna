#!/usr/bin/env node
/*
 * tools/pat-ppg-ppg-control.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE POSITIVE CONTROL THE PAT WORK NEVER HAD — O2Ring FINGER pulse vs Verity pulse.
 *
 * ⚠️ SENSOR PLACEMENT IS PART OF THE RESULT AND MUST BE STATED. On this corpus the ring is on the
 * RIGHT INDEX FINGER and the Verity on the LEFT ANKLE (confirmed by the wearer 2026-08-04). That is
 * not a short wrist->finger hop: it is UPPER LIMB vs LOWER LIMB, ~60-80 cm of arterial path versus
 * ~100-120 cm. The pulse reaches the finger FIRST and the ankle tens of ms later, so the expected lag
 * is POSITIVE and of order 20-90 ms — which is what six nights measure (+23 +35 +43 +53 +72 +81 ms).
 * A NEGATIVE lag is anatomically impossible here and condemns the pair on sign alone, independently
 * of its coupling ratio (2026-07-18: -121 ms, ratio 0.11).
 *
 * This geometry is the basis of brachial-ankle pulse wave velocity (baPWV): with the path-length
 * difference measured, transit difference gives a velocity, an established arterial-stiffness marker.
 * Re-deriving that is out of scope here — but do not re-label these sites without re-reading the sign.
 *
 * Every PAT verdict in this repo has been ECG->pulse, and every one has been retracted or declared
 * unquotable (PAT-UNDER-PERBLOCK-ALIGNMENT §3c.5, PAT-NO-VALID-ANCHOR's ⚠). A negative there has two
 * incompatible readings and no way to choose between them: the physiology is unrecoverable, or the
 * cross-device machinery does not work. Nothing in that design can tell them apart.
 *
 * Two PPG streams can. Both sites see the SAME cardiac cycle, separated only by a peripheral transit
 * difference, so coupling must be strong and obvious. Same host, same daemon, same beat detector on both
 * sides, no ECG detector involved (which fails plausibility on half the ring corpus).
 *
 *   COUPLED   -> the machinery works; an ECG->pulse null is about the ECG leg or the physiology.
 *   NOT       -> the machinery is broken, and NO PAT verdict from this repo means anything, negative
 *                or positive. That is the more valuable outcome, and the one §3d.1 predicts when it
 *                finds ACC alignment HURTS by +23 to +53 points.
 *
 * THE WINDOW IS THE ONE THING THAT MUST CHANGE. `rawLags` accepts only [PHYS_LO=200, PHYS_HI=650] ms,
 * tuned for ECG->pulse. Wrist->finger is tens of ms, so reusing that window returns a null BY
 * CONSTRUCTION. This uses a symmetric window and lets the strict statistic's leave-one-block-out
 * centre locate the true offset — which is what it exists to do, and it absorbs the unknown constant
 * delta exactly as in the sibling tools.
 *
 * PAIR SELECTION IS STILL UNPRINCIPLED (§3c.4: longest is arbitrary, highest-scoring is circular, and
 * §3d showed there is no quality feature to select on). So this tool scores EVERY candidate pair and
 * reports the RANGE, never a single number. A control does not need an unbiased point estimate — it
 * needs to know whether coupling is detectable AT ALL, and the maximum over pairs answers that.
 *
 *   node tools/pat-ppg-ppg-control.mjs --dir <captures root> [--night 2026-08-03] [--surrogates 100]
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDsps, getDsps, median, quantile, BIN_MIN } from './pat-matchrate-strict.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DIR = arg('--dir', null);
const ONLY = arg('--night', null);
const N_SURR = +arg('--surrogates', 100);
const WIN_MS = +arg('--window', 400); // symmetric search: wrist->finger is tens of ms, not 200-650
const STRICT_W_MS = 40;
const RATE_LO = 30,
  RATE_HI = 120;
/* AXIS — host | grid. The whole point of the A/B (this brief's Done-when 1): coupling grouped perfectly
   by the ring's axis provenance, drawn grids coupling and host-measured axes failing, which is backwards
   for a physiological result. `host` uses parsePPG's relSec (device ns, host-disciplined via hostAxis).
   `grid` forces index/fs — the drawn axis, a uniform `index x constant`. Coupling ONLY on grid means the
   agreement is an artifact of regularity; coupling on BOTH with more scatter on host means the per-frame
   re-anchor jitter is the term, and that is a capture-path finding rather than an analysis one. */
const AXIS = arg('--axis', 'host');
const BLOCK_MS = BIN_MIN * 60000;

function fiducialTimes(text) {
  const { PPGDSP } = getDsps();
  const rec = PPGDSP.parsePPG(text);
  if (rec.t0Ms == null) return null;
  const per = rec.ch.map((c) => PPGDSP.detectChannel(c, rec.fs));
  let refIdx = 0,
    best = -1;
  per.forEach((p, i) => {
    if (p.peaks.length > best) {
      best = p.peaks.length;
      refIdx = i;
    }
  });
  const cons = PPGDSP.consensusBeats(per, refIdx, rec.fs);
  const rel = rec.relSec;
  const at =
    AXIS === 'grid'
      ? (idx) => rec.t0Ms + (idx / rec.fs) * 1000 // the DRAWN axis: index x constant
      : (idx) => {
          // feet are FRACTIONAL (refineFeet interpolates sub-sample)
          const lo = Math.floor(idx),
            hi = Math.min(lo + 1, rel.length - 1),
            f = idx - lo;
          return rec.t0Ms + (rel[lo] + (rel[hi] - rel[lo]) * f) * 1000;
        };
  const t = Array.from(cons.feet, at)
    .filter(isFinite)
    .sort((a, b) => a - b);
  return { t0Ms: rec.t0Ms, durSec: rec.durSec, times: t, site: rec.site };
}

/* Nearest counterpart within +-WIN_MS, signed. Symmetric because neither device is known to lead. */
function signedLags(A, B) {
  const out = [];
  let j = 0;
  for (const a of A) {
    while (j < B.length && B[j] < a - WIN_MS) j++;
    let bestIdx = -1,
      bestAbs = Infinity;
    for (let k = j; k < B.length && B[k] <= a + WIN_MS; k++) {
      const d = Math.abs(B[k] - a);
      if (d < bestAbs) {
        bestAbs = d;
        bestIdx = k;
      }
    }
    if (bestIdx >= 0) out.push({ t: a, lag: B[bestIdx] - a });
  }
  return out;
}

/* Leave-one-block-out acceptance, identical in spirit to strictMatchRate: a block's centre is the
   median lag of every OTHER block, so a stream pair with no real relationship has no centre that
   generalises and cannot self-confirm. */
function strictRate(lags, nA) {
  if (!lags.length) return { rate: NaN, resid: NaN, blocks: 0 };
  const t0 = lags[0].t;
  const by = new Map();
  for (const e of lags) {
    const b = Math.floor((e.t - t0) / BLOCK_MS);
    if (!by.has(b)) by.set(b, []);
    by.get(b).push(e.lag);
  }
  const keys = [...by.keys()];
  if (keys.length < 2) return { rate: NaN, resid: NaN, blocks: keys.length };
  let kept = 0;
  const resid = [];
  for (const e of lags) {
    const b = Math.floor((e.t - t0) / BLOCK_MS);
    const others = [];
    for (const k of keys) if (k !== b) others.push(...by.get(k));
    const c = median(others);
    const d = e.lag - c;
    if (Math.abs(d) <= STRICT_W_MS) {
      kept++;
      resid.push(d);
    }
  }
  return {
    rate: nA ? kept / nA : NaN,
    resid: resid.length ? quantile(resid, 0.75) - quantile(resid, 0.25) : NaN,
    blocks: keys.length
  };
}

function circShift(t, span, frac) {
  const d = span * frac;
  const lo = t[0];
  return t.map((x) => lo + ((x - lo + d) % span)).sort((a, b) => a - b);
}

function biggest(dir, re, n) {
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

function scorePair(A, B) {
  const t0 = Math.max(A.times[0], B.times[0]);
  const t1 = Math.min(A.times[A.times.length - 1], B.times[B.times.length - 1]);
  const ovl = (t1 - t0) / 60000;
  if (ovl < 10) return null;
  const a = A.times.filter((x) => x >= t0 && x <= t1);
  const b = B.times.filter((x) => x >= t0 && x <= t1);
  const rA = a.length / ovl,
    rB = b.length / ovl;
  if (rA < RATE_LO || rA > RATE_HI || rB < RATE_LO || rB > RATE_HI) return { ovl, skip: `rate ${rA.toFixed(0)}/${rB.toFixed(0)}` };
  const obs = signedLags(a, b);
  const o = strictRate(obs, a.length);
  const span = t1 - t0;
  const ch = [];
  for (let i = 0; i < N_SURR; i++) ch.push(strictRate(signedLags(a, circShift(b, span, (i + 1) / (N_SURR + 1))), a.length).rate);
  const clean = ch.filter(isFinite);
  const m = clean.length ? median(clean) : NaN;
  const p = (clean.filter((x) => x >= o.rate).length + 1) / (clean.length + 1);
  return {
    ovl,
    beatsA: a.length,
    beatsB: b.length,
    medLag: obs.length ? median(obs.map((e) => e.lag)) : null,
    rate: o.rate,
    resid: o.resid,
    blocks: o.blocks,
    chance: m,
    ratio: m > 0 ? o.rate / m : NaN,
    p
  };
}

function main() {
  if (!DIR || !existsSync(DIR)) {
    console.error('--dir <captures root> required');
    process.exit(2);
  }
  loadDsps();
  const nights = readdirSync(DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && statSync(join(DIR, d)).isDirectory())
    .filter((d) => !ONLY || d === ONLY)
    .sort();
  console.log(`FINGER (O2Ring, right index) <-> ANKLE (Verity, left) — axis=${AXIS}`);
  console.log(`symmetric window +-${WIN_MS} ms - strict +-${STRICT_W_MS} ms - ${N_SURR} surrogates - EVERY pair scored\n`);
  console.log('night        pairs  best: ovl  beatsF  beatsA  medLag  strict chance ratio     p   residIQR');
  console.log('  (medLag = ankle minus finger; POSITIVE is the only anatomically possible sign)');
  console.log('-'.repeat(100));
  const bests = [];
  const OUT = arg('--json-out', '/tmp/ppg-ppg-control.json');
  for (const n of nights) {
    const dir = join(DIR, n);
    const fs_ = biggest(dir, /o2ring.*_PPG\.txt$/i, 3);
    const ws = biggest(dir, /verity.*_PPG\.txt$/i, 3);
    if (!fs_.length || !ws.length) continue;
    const F = fs_
      .map((c) => {
        try {
          return fiducialTimes(readFileSync(c.f, 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const W = ws
      .map((c) => {
        try {
          return fiducialTimes(readFileSync(c.f, 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    let best = null,
      nPairs = 0;
    for (const a of F)
      for (const b of W) {
        const r = scorePair(a, b);
        if (!r || r.skip) continue;
        nPairs++;
        if (!best || (isFinite(r.ratio) && r.ratio > best.ratio)) best = r;
      }
    if (!best) {
      console.log(`${n}  no scorable pair`);
      continue;
    }
    bests.push({ ...best, night: n });
    writeFileSync(OUT, JSON.stringify(bests, null, 1));
    console.log(
      `${n}  ${String(nPairs).padStart(5)}  ${best.ovl.toFixed(0).padStart(9)} ${String(best.beatsA).padStart(7)} ` +
        `${String(best.beatsB).padStart(7)} ${(best.medLag ?? NaN).toFixed(0).padStart(7)} ` +
        `${(best.rate * 100).toFixed(0).padStart(5)}% ${(best.chance * 100).toFixed(0).padStart(5)}% ` +
        `${best.ratio.toFixed(2).padStart(5)} ${best.p.toFixed(3)} ${(best.resid ?? NaN).toFixed(0).padStart(8)}`
    );
  }
  if (bests.length) {
    console.log('-'.repeat(100));
    const sig = bests.filter((b) => b.p < 0.05 && b.ratio > 1);
    console.log(`${bests.length} night(s) - best-pair ratio median ${median(bests.map((b) => b.ratio)).toFixed(2)} - ` + `${sig.length}/${bests.length} with p<0.05 and ratio>1`);
    console.log(
      sig.length >= bests.length * 0.5
        ? 'CONTROL PASSES: two PPG streams on one host DO couple -> the machinery works.'
        : 'CONTROL FAILS: even two PPG streams on one host do not couple -> the machinery, not the physiology, is the term. NO PAT verdict from this repo is meaningful.'
    );
    console.log('NOTE: best-of-pairs is an UPPER bound (§3c.4) — valid for "is it detectable at all", not for a level.');
  }
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) main();
export { signedLags, strictRate, scorePair };
