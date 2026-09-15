#!/usr/bin/env node
/*
 * tools/nsrr-aai-validate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DOES OXYDEX'S AUTONOMIC AROUSAL INDEX TRACK EXPERT-SCORED AROUSALS? — a POOL SCORER, not a tool.
 *
 * `aai` is user-visible and graded `heuristic`, and its own registry citation says why: "internal.
 * HEURISTIC per the OxyDex Reference guide's pre-existing grade" — graded heuristic because nothing
 * external has ever checked it. SHHS1 carries the reference it lacks: expert-scored arousals, the
 * most frequent annotation in the corpus, on 5136 records.
 *
 * ── THIS IS A SCORER MODULE, AND THAT IS THE WHOLE DESIGN DECISION ────────────────────────────
 * It exports `makeRealm` / `poolScoreRecord` / `liveStat` and is driven by `tools/nsrr-score-pool.mjs`:
 *
 *     node tools/nsrr-score-pool.mjs --scorer ./nsrr-aai-validate.mjs --limit 200
 *
 * So it inherits the pool's worker parallelism, checkpoint/`--resume`, SIGKILL-survivability and
 * heartbeat rather than reimplementing any of them. That is §2.9 of the tool-build standard
 * (`briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md`) applied to its own author: a first attempt at
 * this measurement WAS a standalone single-threaded script with no progress output, and it cost half
 * an hour of looking hung — the pool existed the whole time and was made scorer-generic precisely so
 * this would not happen.
 *
 * §2.6 — parallelism measured, not assumed: profiled per record, `processNight` is 4040 ms of a
 * 4112 ms total (98 %), with the EDF read 42 ms and row-building 22 ms. Serial scalar work over
 * 32 520 rows, so the parallelism that pays is ACROSS records, which is exactly what the pool does.
 * §2.11 — nothing here is GPU-accelerated and nothing should be; the per-record arrays are far too
 * small for dispatch to pay, the same finding as the SpO₂ scorer.
 *
 * ── THE MEASUREMENT ──────────────────────────────────────────────────────────────────────────
 * AAI is defined at `oxydex-dsp.js:4400` as `(spikes.length + odi4.count) / durationHr`. It is
 * reached through the SHIPPED path — `NSRR.edfToOxyRows` then `OxyDex._bare.processNight` — never a
 * reimplementation, because a hand-rolled row builder would measure this file's idea of the adapter
 * rather than the adapter.
 *
 * ⚠️ `edfToOxyRows` returns `{ rows, t0Ms, durSec, … }`, NOT an array. Reading `.length` on it is
 * `undefined`, and a guard written as `if (!conv.length) continue` therefore skips EVERY record while
 * looking like a validity check — which is how the first attempt ran the entire 5136-record corpus,
 * discarding all of it, and reported a fabricated "146 s/record". The real cost is 4.1 s.
 *
 * ⚠️ The reference is arousals per hour of SCORED SLEEP, not per hour of recording. Using wall time
 * inflates the denominator by whatever the subject spent awake, which on this cohort is substantial.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ODI = await import('./nsrr-oxydex-odi.mjs');

/* the pool builds one realm per worker and reuses it; the ODI module already co-loads exactly the
   modules this needs (clock, kernel constants, the EDF reader, OxyDex, the NSRR adapter) */
export function makeRealm() {
  return ODI.makeRealm();
}

export function oxyEntry(ctx) {
  const ns = (ctx.OxyDex && (ctx.OxyDex._bare || ctx.OxyDex)) || null;
  if (!ns || typeof ns.processNight !== 'function') throw new Error('OxyDex.processNight not reachable — a silent empty result is the failure this guard prevents');
  return ns;
}

/* Arousals per hour of scored sleep, from the expert annotation. */
export function expertArousalIndex(xmlText, ann) {
  const n = (String(xmlText || '').match(/<EventConcept>Arousal/g) || []).length;
  const sleepHr = ann && ann.nSleepEpochs ? (ann.nSleepEpochs * 30) / 3600 : null;
  /* §∅ — no scored sleep means no denominator, so no index. Never 0, which would read as a night
     with no arousals rather than a night that was never staged. */
  if (!(sleepHr > 0)) return null;
  return +(n / sleepHr).toFixed(3);
}

export function poolScoreRecord(ctx, rec) {
  const ns = oxyEntry(ctx);
  const xmlText = readFileSync(rec.xml, 'utf8');
  const edf = ctx.CpapEdf.readEDF(ODI.toArrayBuffer(readFileSync(rec.edf)));
  const conv = ctx.NSRR.edfToOxyRows(edf);
  /* ⚠️ `.rows`, not the object itself — see the header. */
  const rows = conv && conv.rows;
  if (!rows || !rows.length) return { id: rec.id, err: 'no SpO2 rows' };
  const night = ns.processNight(rows, 'nsrr');
  if (!night || !night.spikes || !night.odi4) return { id: rec.id, err: 'processNight produced no spikes/odi4' };
  const hrs = conv.durSec ? conv.durSec / 3600 : null;
  if (!(hrs > 0)) return { id: rec.id, err: 'no duration' };
  const ann = ctx.NSRR.parseNsrrXml(xmlText, conv.t0Ms || 0);
  const expAI = expertArousalIndex(xmlText, ann);
  return {
    id: rec.id,
    aai: +((night.spikes.length + night.odi4.count) / hrs).toFixed(3),
    expAI,
    spikes: night.spikes.length,
    odi4Count: night.odi4.count,
    hours: +hrs.toFixed(3),
    coveragePct: conv.spo2CoveragePct != null ? conv.spo2CoveragePct : null
  };
}

export function median(v) {
  const a = v.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
}

/* The pool's live statistic: the running AAI/expert ratio, so a partial run carries a real answer.
   Half-width is the between-record spread of the ratio — records are the unit of independence. */
export function liveStat(rows) {
  const p = (rows || []).filter((r) => r && !r.err && r.aai != null && r.expAI > 0);
  const ratio = p.map((r) => r.aai / r.expAI);
  let hw = null;
  if (ratio.length >= 5) {
    const mu = ratio.reduce((a, b) => a + b, 0) / ratio.length;
    const sd = Math.sqrt(ratio.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (ratio.length - 1));
    hw = +((1.96 * sd) / Math.sqrt(ratio.length)).toFixed(4);
  }
  const det = [];
  if (p.length) det.push('expert median ' + median(p.map((r) => r.expAI)) + '/h  ·  AAI median ' + median(p.map((r) => r.aai)) + '/h');
  return { label: 'median AAI / expert arousal index', value: median(ratio), halfWidth: hw, n: ratio.length, detail: det };
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
      console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
    }
  };
  console.log('▸ nsrr-aai-validate --selftest\n');

  const xml = '<EventConcept>Arousal|Arousal ()</EventConcept><EventConcept>Arousal|Arousal ()</EventConcept><EventConcept>Hypopnea|Hypopnea</EventConcept>';
  A('expert index: counts arousals per hour of SCORED SLEEP', expertArousalIndex(xml, { nSleepEpochs: 240 }) === 1, String(expertArousalIndex(xml, { nSleepEpochs: 240 })));
  A('expert index: ignores non-arousal events', expertArousalIndex(xml, { nSleepEpochs: 120 }) === 2);
  A('§∅: no scored sleep → null, never 0', expertArousalIndex(xml, { nSleepEpochs: 0 }) === null && expertArousalIndex(xml, null) === null);
  A('§∅: a night with sleep but no arousals is 0, which IS a measurement', expertArousalIndex('', { nSleepEpochs: 120 }) === 0);

  const rows = [
    { aai: 5, expAI: 20 },
    { aai: 6, expAI: 20 },
    { aai: 4, expAI: 20 },
    { aai: 5, expAI: 20 },
    { aai: 5, expAI: 20 },
    { aai: 5, expAI: 20 }
  ];
  const st = liveStat(rows);
  A('liveStat: reports the median ratio', Math.abs(st.value - 0.25) < 0.01, String(st.value));
  A('liveStat: publishes a between-record half-width once n>=5', st.halfWidth != null);
  A('liveStat: refuses a half-width below the floor', liveStat(rows.slice(0, 3)).halfWidth === null);
  A('liveStat: excludes errored rows rather than scoring them 0', liveStat([{ err: 'x' }, ...rows]).n === rows.length);
  A('liveStat: excludes a zero expert index (undefined ratio), never divides by it', liveStat([{ aai: 5, expAI: 0 }, ...rows]).n === rows.length);
  A('liveStat: an empty set yields a null value, not 0', liveStat([]).value === null);
  A('liveStat: carries the label the pool prints', /AAI/.test(liveStat([]).label));

  let ctx = null;
  try {
    ctx = makeRealm();
  } catch (e) {
    console.log('    (realm: ' + String(e.message).slice(0, 60) + ')');
  }
  A('realm: loads and exposes the shipped path', !!(ctx && ctx.NSRR && typeof ctx.NSRR.edfToOxyRows === 'function'));
  if (ctx)
    A(
      'realm: OxyDex.processNight reachable from the namespace',
      (() => {
        try {
          oxyEntry(ctx);
          return true;
        } catch {
          return false;
        }
      })()
    );

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

/* §2.9/entry-point guard: importing this module must NOT run anything — the pool imports it in every
   worker, and a module with side effects on import would run its selftest N times. */
if (process.argv.includes('--selftest') && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(selftest());
