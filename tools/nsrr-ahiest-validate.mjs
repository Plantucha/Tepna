#!/usr/bin/env node
/*
 * tools/nsrr-ahiest-validate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DOES THE ELABORATE AHI ESTIMATE BEAT THE TRIVIAL ONE? — a POOL SCORER, not a tool.
 *
 * `computeAHIestimates` (oxydex-dsp.js) produces TWO estimates of the same quantity:
 *
 *   ahiODI4    = ODI-4 × 1.1                                    — one measured term, one constant
 *   ahiKulkas  = 0.8×ODI3 + 0.6×DesSev + 0.15×T95 − 1.2         — three measured terms, four constants
 *
 * The first has been measured against real PSG (`papers/odi4-ahi-bias.html` §3.2, SHHS1 n = 5136:
 * slope 0.134, R² 0.27 against scored AHI). **The second never has, by anything** — `nsrr-adapter.js`
 * surfaced only `ahiOxyEst` (= ahiODI4), and every NSRR measurement in this repo reads the adapter,
 * so what the adapter dropped was invisible to all of them. Exposing `ahiKulkas` is what makes this
 * scorer possible and is the smaller half of the change.
 *
 * Its four coefficients are hand-set. The call site records a real guardrail — *"do not tune the
 * surrogate to chase the simulator"* — which is good discipline about the SYNTHETIC cohort and says
 * nothing about whether the numbers work on real PSG.
 *
 * ── THE COMPARISON IS PAIRED, AND THAT IS THE DESIGN ──────────────────────────────────────────
 * Any desaturation-derived index under-reads SHHS's scored AHI on DEFINITION: SHHS scored hypopneas
 * without requiring a desaturation, so a large part of the gap is not detector behaviour at all
 * (§3.2 of the paper establishes this). That confound would wreck an absolute verdict on either
 * estimate — but it applies to BOTH, on the SAME records, so the paired question survives it intact:
 *
 *     does ahiKulkas track scored AHI BETTER than ahiODI4 does?
 *
 * Both are scored from one `analyzeRecord` call per record, so they see identical rows, identical
 * detector state and identical reference. A record contributes to the verdict only if BOTH produced
 * a value — comparing a 300-record ahiKulkas against a 280-record ahiODI4 would be two populations
 * wearing one name.
 *
 * ⚠️ `ahiKulkas` refuses (null) when ANY of ODI-3, DesSev or T95 is absent, while `ahiODI4` refuses
 * only on ODI-4. So the two are NOT null on the same records by construction, and `bothPresent` is
 * reported rather than assumed — a differential refusal rate is itself a finding about which
 * estimate is available when you need it.
 *
 * ── THIS IS A SCORER MODULE ───────────────────────────────────────────────────────────────────
 *     node tools/nsrr-score-pool.mjs --scorer ./nsrr-ahiest-validate.mjs --limit 300
 *
 * inheriting the pool's parallelism, checkpoint/`--resume`, SIGKILL-survivability and heartbeat
 * (§2.9 of `briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md`).
 *
 * §2.6 — one `analyzeRecord` per record, which internally runs `processNight` ONCE. Scoring the two
 * estimates separately would double a 4 s/record cost to measure quantities that are computed
 * together anyway.
 * §2.11 — nothing GPU-accelerated; per-record arrays are far too small for dispatch to pay.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ODI = await import('./nsrr-oxydex-odi.mjs');

export function makeRealm() {
  return ODI.makeRealm();
}

export function median(v) {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(4);
}

/* Pearson over paired finite values. Returns null below n=3 rather than a number computed from
   two points, which is defined and carries no information. */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx,
      b = ys[i] - my;
    sxy += a * b;
    sx += a * a;
    sy += b * b;
  }
  if (!(sx > 0) || !(sy > 0)) return null;
  return +(sxy / Math.sqrt(sx * sy)).toFixed(4);
}

export function poolScoreRecord(ctx, rec) {
  const xmlText = readFileSync(rec.xml, 'utf8');
  /* ⚠️ the key is `edfBuffer`, not `edfBuf`. A wrong name is not a type error here — `analyzeRecord`
     reads `.byteLength` off undefined and returns `{err}`, so all 300 records "complete" and the
     verdict reports n=0, which reads as a finished run rather than a broken one. Copied from
     `ODI.scoreRecord` rather than guessed a second time. */
  const out = ctx.NSRR.analyzeRecord({
    id: rec.id,
    edfBuffer: ODI.toArrayBuffer(readFileSync(rec.edf)),
    xmlText
  });
  if (out.err) return { id: rec.id, err: out.err };
  const ref = out.scoredAHI != null ? +out.scoredAHI : null;
  const a4 = out.ahiOxyEst != null ? +out.ahiOxyEst : null;
  const ak = out.ahiKulkas != null ? +out.ahiKulkas : null;
  return {
    id: rec.id,
    scoredAHI: ref,
    ahiODI4: a4,
    ahiKulkas: ak,
    bothPresent: a4 != null && ak != null && ref != null,
    errODI4: a4 != null && ref != null ? +(a4 - ref).toFixed(3) : null,
    errKulkas: ak != null && ref != null ? +(ak - ref).toFixed(3) : null
  };
}

export function liveStat(rows) {
  const all = (rows || []).filter((r) => r && !r.err);
  const p = all.filter((r) => r.bothPresent);
  const ref = p.map((r) => r.scoredAHI);
  const rOdi = pearson(
    p.map((r) => r.ahiODI4),
    ref
  );
  const rKul = pearson(
    p.map((r) => r.ahiKulkas),
    ref
  );
  /* the verdict statistic is the PAIRED per-record improvement in absolute error, so the
     definitional under-read that both estimates inherit cancels */
  const gain = p.map((r) => Math.abs(r.errODI4) - Math.abs(r.errKulkas));
  let hw = null;
  if (gain.length >= 5) {
    const mu = gain.reduce((a, b) => a + b, 0) / gain.length;
    const sd = Math.sqrt(gain.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (gain.length - 1));
    hw = +((1.96 * sd) / Math.sqrt(gain.length)).toFixed(4);
  }
  const det = [];
  if (p.length) {
    det.push('r vs scored AHI — ahiODI4 ' + rOdi + '   ahiKulkas ' + rKul);
    det.push('median |err| — ahiODI4 ' + median(p.map((r) => Math.abs(r.errODI4))) + '   ahiKulkas ' + median(p.map((r) => Math.abs(r.errKulkas))));
    det.push('scored AHI median ' + median(ref));
  }
  const kNull = all.filter((r) => r.ahiKulkas == null).length;
  const oNull = all.filter((r) => r.ahiODI4 == null).length;
  det.push('refused — ahiKulkas ' + kNull + '/' + all.length + '  ahiODI4 ' + oNull + '/' + all.length + ' (they refuse on DIFFERENT inputs)');
  return { label: 'median paired gain |err(ODI4)| − |err(Kulkas)|, events/h  (>0 ⇒ Kulkas better)', value: median(gain), halfWidth: hw, n: gain.length, detail: det };
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  A('pearson: recovers a perfect positive relation', pearson([1, 2, 3, 4], [2, 4, 6, 8]) === 1);
  A('pearson: recovers a perfect negative relation', pearson([1, 2, 3, 4], [-2, -4, -6, -8]) === -1);
  A('pearson: n<3 is null, not a number from two points', pearson([1, 2], [1, 2]) === null);
  A('pearson: a constant column is null, not 0/0', pearson([1, 1, 1, 1], [1, 2, 3, 4]) === null);

  const mk = (ref, a4, ak) => ({
    scoredAHI: ref,
    ahiODI4: a4,
    ahiKulkas: ak,
    bothPresent: a4 != null && ak != null && ref != null,
    errODI4: a4 != null ? +(a4 - ref).toFixed(3) : null,
    errKulkas: ak != null ? +(ak - ref).toFixed(3) : null
  });

  /* Kulkas nearer the reference on every record ⇒ positive gain */
  const better = [mk(20, 10, 18), mk(30, 15, 27), mk(40, 20, 36), mk(25, 12, 23), mk(35, 17, 33)];
  const st = liveStat(better);
  A('liveStat: positive gain when Kulkas is nearer on every record', st.value > 0);
  A('liveStat: publishes a paired half-width once n>=5', st.halfWidth != null);

  /* and the mirror — a gate that only ever reports "better" is not measuring anything */
  const worse = better.map((r) => mk(r.scoredAHI, r.ahiKulkas, r.ahiODI4));
  A('liveStat: NEGATIVE gain when the two are swapped (the statistic has a sign)', liveStat(worse).value < 0);
  A('liveStat: exactly zero gain when both estimates are identical', liveStat(better.map((r) => mk(r.scoredAHI, r.ahiODI4, r.ahiODI4))).value === 0);

  /* differential refusal is REPORTED, not silently dropped — the two refuse on different inputs */
  const mixed = better.concat([mk(20, 10, null), mk(22, null, 19)]);
  const sm = liveStat(mixed);
  A('liveStat: a record missing either estimate is excluded from the paired verdict', sm.n === 5);
  A(
    'liveStat: reports each estimate’s refusal count separately',
    sm.detail.some((d) => /refused .*ahiKulkas 1\/7.*ahiODI4 1\/7/.test(d))
  );
  A('liveStat: refuses a half-width below the floor', liveStat(better.slice(0, 2)).halfWidth === null);

  console.log('\n' + (bad ? '✗ ' + bad + ' failed' : '✓ all ' + good + ' assertions passed'));
  return bad ? 1 : 0;
}

const IS_CLI = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_CLI) process.exit(selftest());
