#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * cvhr-gap-edge.mjs — what a TIME HOLE does to the two CVHR detectors, measured on planted beats
 * ------------------------------------------------------------------------------------------------
 * PPGDEX-ALGORITHM-DEEP-DIVE §4 item 2, treatment (3): "`cvhrFromNN` needs the gap, not the mask.
 * It band-passes toward ~0.022-0.05 Hz, so it is sensitive to the time axis rather than to
 * individual values; a removed interval must leave a HOLE in time, not close up. It is a faithful
 * port of ECGDex's `detectCVHR`, so whatever is done here must be done there too."
 *
 * WHAT WAS ALREADY TRUE WHEN THIS WAS WRITTEN. ECGDex carries the treatment — `detectCVHR(nn, tt,
 * activeSec, spansGap)` builds a per-second `covered` mask, skips an event on an uncovered second
 * and returns `coveredSec`. PpgDex's port predates it and has no `spansGap` parameter at all. Both
 * files reason, in a comment, that the mask cannot matter: "Events can only arise in covered
 * seconds: the 1 Hz resample holds the last beat's HR flat across a hole, so `res` decays to 0
 * there and the ENV_ON gate stays shut" (ppgdex-dsp.js, and its twin in ecgdex-dsp.js). Residue row
 * `2026-09-24-cvhr-held-grid-is-sound-the-plot-and-mae-are-not` read that reasoning as a complete
 * answer and closed the CVHR index as sound.
 *
 * WHAT THIS MEASURES, AND WHY A PLANTED RECORD. The question is what a hole DOES, so the record
 * either side of it has to be known and identical across the cases compared. A planted record gives
 * exactly that: one apnea-band oscillation, a hole of a chosen length inserted at a fixed beat, and
 * the same oscillation afterwards. The control is the SAME leg built with no hole inserted at all —
 * not the same leg with a zero-length hole, which inserts a 0 ms interval, an infinite instantaneous
 * rate, and suppresses three events on its own. (That control artefact is why an earlier reading of
 * this battery reported three fabricated events where there are at most two.)
 *
 * THE CRITERION IS PRE-STATED AND IT IS PARITY, not correctness: over the battery below, PpgDex and
 * ECGDex must return the SAME event count for the same beats and the same gap mask. Parity is what
 * treatment (3) asks for and what the Integrator depends on — it corroborates the two nodes'
 * `apnea.cvhrIndex` against each other, so a mask on one side only makes that comparison measure
 * the dropouts. Correctness is reported beside it and is NOT the criterion, because no repair for
 * it ships here (see "what this does not claim").
 *
 * WHAT THIS DOES NOT CLAIM. (1) Nothing here is corpus evidence: the beats are planted, so the
 * figures bound the mechanism and do not estimate how often it fires on a real night. (2) The
 * EDGE term is unrepaired in BOTH nodes and this tool only measures it: a hole's boundary adds up
 * to two events on COVERED seconds, because the band-pass support (a 47 s and a 9 s moving average)
 * and the dip-to-rebound search (up to 48 s) reach across the boundary while the per-second mask
 * only covers seconds the hole itself spans. The ±2 s limit both files state is about the exported
 * HR series, not about the event detector. (3) A PASS here says the two nodes agree, never that
 * either is right.
 *
 *   node tools/cvhr-gap-edge.mjs              # the table on stderr, one tepna.verdict/1 on stdout
 *   node tools/cvhr-gap-edge.mjs --json       # the object alone
 *   node tools/cvhr-gap-edge.mjs --selftest   # the planter's own properties
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const JSON_OUT = has('--json');

/* ═══════════════════════════ THE PRE-STATED BATTERY, IN ONE PLACE ══════════════════════════════ */
export const GAP_S = 10; // the nodes' own gap cut (ECGDex `GAP_S`, PpgDex `PPG_CVHR_GAP_S`)
export const PERIOD_S = 30; // planted cycle length — mid apnea band, inside the detector's 14-46 s
export const AMP_BPM = 8; // planted amplitude — above the ENV_ON 2.6 bpm envelope gate
export const BASE_BPM = 60;
export const PRE_SEC = 900; // beats before the hole
export const POST_SEC = 900; // beats after it
export const STEPS_BPM = [0, 15, -20]; // rate step applied to the post-hole segment
export const HOLES_S = [11, 13, 15, 17, 20, 22, 25, 30, 45, 47, 60, 75, 90, 105, 120, 300, 900];
export const PARITY_CEIL = 0; // events — the criterion: |PPG - ECG| over the battery

/* ═════════════════════════════════ THE PLANTED RECORD ══════════════════════════════════════════
   `insert: false` is the CONTROL: the same beats with no hole at all. With `insert: true` one
   interval of `holeSec` is spliced in at the same beat — real time passes and no beat is emitted,
   which is what a dropout leaves in a beat series. Every other interval is identical between the
   two, so the difference in event count is the hole's, and nothing else's. */
export function plant({ holeSec, stepBpm = 0, insert = true, preSec = PRE_SEC, postSec = POST_SEC, period = PERIOD_S, ampBpm = AMP_BPM, base = BASE_BPM }) {
  const nn = [],
    tt = [];
  let t = 0;
  const push = (hrBpm) => {
    const ms = 60000 / hrBpm;
    t += ms / 1000;
    nn.push(ms); // nn[k] is the interval ENDING at tt[k] — buildPPI's convention, and buildNN's
    tt.push(t);
  };
  const osc = (sec, b) => b + ampBpm * Math.sin((2 * Math.PI * sec) / period);
  while (t < preSec) push(osc(t, base));
  if (insert) {
    t += holeSec;
    nn.push(holeSec * 1000);
    tt.push(t);
  }
  const until = t + postSec;
  while (t < until) push(osc(t, base + stepBpm));
  return { nn: Float64Array.from(nn), tt: Float64Array.from(tt) };
}

/* The two series the CALLERS measure and hand down, by the callers' own rules:
   `activeSec` — inter-beat deltas at or under the gap cut (ppgdex-dsp.js `_cvhrActiveSec`).
   `spansGap`  — nn-aligned, marking the interval that ENDS at beat k (ecgdex-dsp.js buildNN). */
export function activeSecOf(tt) {
  let a = 0;
  for (let i = 1; i < tt.length; i++) {
    const d = tt[i] - tt[i - 1];
    if (d > 0 && d <= GAP_S) a += d;
  }
  return a;
}
export function spansGapOf(tt) {
  const sg = new Uint8Array(tt.length);
  for (let i = 1; i < tt.length; i++) if (tt[i] - tt[i - 1] > GAP_S) sg[i] = 1;
  return sg;
}

/* ═════════════════════════════════ REALMS — the real modules ═══════════════════════════════════ */
export async function realms() {
  const B = await import(join(ROOT, 'tools/build-core.js'));
  const classicify = B.classicify || B.default?.classicify;
  const { PPG_REALM, ECG_REALM } = await import(join(ROOT, 'tools/realm-manifest.js'));
  const load = (files) => {
    const noop = () => {};
    const el = () => ({
      style: {},
      dataset: {},
      textContent: '',
      innerHTML: '',
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      setAttribute: noop,
      removeAttribute: noop,
      getAttribute: () => null,
      appendChild: noop,
      addEventListener: noop,
      removeEventListener: noop
    });
    const sb = {
      console: { log() {}, warn() {}, error() {} },
      setTimeout,
      clearTimeout,
      addEventListener: noop,
      removeEventListener: noop,
      navigator: { userAgent: 'node' },
      localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      document: {
        getElementById: () => null,
        createElement: el,
        createTextNode: () => ({}),
        querySelector: () => null,
        querySelectorAll: () => [],
        head: el(),
        body: el(),
        documentElement: el(),
        addEventListener: noop,
        readyState: 'complete'
      }
    };
    sb.window = sb;
    sb.self = sb;
    sb.globalThis = sb;
    const ctx = vm.createContext(sb);
    ctx.__DEX_NAMESPACED__ = true;
    for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
    return sb;
  };
  return { P: load(PPG_REALM).PPGDSP, E: load(ECG_REALM).ECGDSP };
}

/* ═══════════════════════════════════════ ONE CASE ══════════════════════════════════════════════ */
export function score(P, E, opts) {
  const { nn, tt } = plant(opts);
  const activeSec = activeSecOf(tt);
  const sg = spansGapOf(tt);
  const p = P.cvhrFromNN(nn, tt, activeSec, sg); // the 4th argument is IGNORED before the port
  const e = E.detectCVHR(nn, tt, activeSec, sg);
  const eNoMask = E.detectCVHR(nn, tt, activeSec);
  return {
    beats: nn.length,
    ppg: p.events.length,
    ecg: e.events.length,
    ecgNoMask: eNoMask.events.length,
    maskExcluded: eNoMask.events.length - e.events.length,
    idxPpg: p.index,
    idxEcg: e.index
  };
}

/* ═══════════════════════════════════════ SELFTEST ══════════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  const ok = (c, m) => {
    if (!c) fail++;
    console.log(`${c ? 'ok  ' : 'FAIL'}  ${m}`);
  };
  const ctl = plant({ holeSec: 0, insert: false });
  const hol = plant({ holeSec: 300 });
  ok(hol.nn.length === ctl.nn.length + 1, 'a hole adds exactly ONE interval to the control, so every other interval is shared');
  ok(ctl.tt[ctl.tt.length - 1] < PRE_SEC + POST_SEC + 2, 'the control spans the two segments and nothing else');
  const sg = spansGapOf(hol.tt);
  let marked = 0;
  for (let i = 0; i < sg.length; i++) marked += sg[i];
  ok(marked === 1, 'the planted hole is the only interval over the gap cut');
  const at = Array.from(sg).indexOf(1);
  ok(Math.abs(hol.nn[at] - 300000) < 1, 'the marked interval IS the hole, and the mask marks the interval that ENDS at that beat');
  ok(Math.abs(activeSecOf(hol.tt) - activeSecOf(ctl.tt)) < 2, 'the hole is dead time: it does not enter activeSec, so the index denominator is unmoved');
  /* The control must not be the degenerate one. A zero-length hole is a 0 ms interval and an
     infinite rate, and it SUPPRESSES events — the artefact that made an earlier reading of this
     battery report three fabricated events. The planter is asked for it here so the difference is
     on the record rather than in a comment. */
  const deg = plant({ holeSec: 0, insert: true });
  ok(deg.nn[Array.from(deg.nn).indexOf(0)] === 0, 'a zero-length hole inserts a 0 ms interval, which is why it is not the control');
  const shortHole = plant({ holeSec: GAP_S - 1 });
  let markedShort = 0;
  const sgs = spansGapOf(shortHole.tt);
  for (let i = 0; i < sgs.length; i++) markedShort += sgs[i];
  ok(markedShort === 0, 'an interval at or under the gap cut is a long interval, not a hole, and is not masked');
  console.log(fail ? `\nselftest: ${fail} FAILURE(S)` : '\nselftest: all green');
  return fail;
}

/* ═══════════════════════════════════ THE ENTRY POINT ═══════════════════════════════════════════
   Everything below runs only when this file is the program. The planter, the two series the callers
   derive and the realm loader are exports, and `tools/cvhr-edge-widen.mjs` imports them; without
   this guard an import ran the whole battery and consumed the importer's own argv. */
const isMain = isCliEntry(import.meta.url);
async function main() {
  if (has('--selftest')) return selftest() ? 1 : 0;

  /* ═════════════════════════════════════ THE BATTERY ═════════════════════════════════════════════ */
  const { P, E } = await realms();
  const rows = [];
  let parityMaxAbs = 0,
    parityDisagreements = 0,
    maskExcludedTotal = 0,
    edgeAddedMaxPpg = 0,
    edgeAddedMaxEcg = 0;
  for (const stepBpm of STEPS_BPM) {
    const ref = score(P, E, { holeSec: 0, stepBpm, insert: false });
    for (const holeSec of HOLES_S) {
      const r = score(P, E, { holeSec, stepBpm });
      const parity = r.ppg - r.ecg;
      const addedPpg = r.ppg - ref.ppg,
        addedEcg = r.ecg - ref.ecg;
      parityMaxAbs = Math.max(parityMaxAbs, Math.abs(parity));
      if (parity !== 0) parityDisagreements++;
      maskExcludedTotal += r.maskExcluded;
      edgeAddedMaxPpg = Math.max(edgeAddedMaxPpg, addedPpg);
      edgeAddedMaxEcg = Math.max(edgeAddedMaxEcg, addedEcg);
      rows.push({ stepBpm, holeSec, refPpg: ref.ppg, refEcg: ref.ecg, ...r, parity, addedPpg, addedEcg });
    }
  }
  const checked = rows.length;

  if (!JSON_OUT) {
    /* The table goes to STDERR: stdout is the object, and the adoption gate parses stdout from its
     first brace, so prose there would have to stay brace-free forever. */
    console.error('step  hole      ref  ppg  ecg  ecgNoMask  masked  parity  addedPPG  addedECG');
    for (const r of rows) {
      console.error(
        `${String(r.stepBpm).padStart(4)}  ${String(r.holeSec).padStart(4)}s  ${String(r.refPpg).padStart(7)}  ${String(r.ppg).padStart(3)}  ${String(r.ecg).padStart(3)}  ${String(r.ecgNoMask).padStart(9)}  ${String(r.maskExcluded).padStart(6)}  ${String(r.parity).padStart(6)}  ${String(r.addedPpg).padStart(8)}  ${String(r.addedEcg).padStart(8)}`
      );
    }
    console.error(
      `\nparity max |PPG-ECG| = ${parityMaxAbs} over ${checked} planted case(s); the ECGDex mask excluded ${maskExcludedTotal} event(s); a hole ADDED at most ${Math.max(edgeAddedMaxPpg, edgeAddedMaxEcg)} event(s) at its edges, which neither node removes.`
    );
  }

  const commit = (() => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
    } catch {
      return null;
    }
  })();
  const status = parityMaxAbs <= PARITY_CEIL ? 'PASS' : 'FAIL';
  const v = Verdict.make({
    gate: 'cvhr-gap-mask-parity',
    status,
    population: { checked, eligible: checked, excluded: 0 },
    criterion: { name: 'ppg_minus_ecg_event_count_max_abs', threshold: PARITY_CEIL, unit: 'events', direction: 'lte' },
    result: {
      parityMaxAbs,
      parityDisagreements,
      maskExcludedTotal,
      edgeEventsAddedMaxPpg: edgeAddedMaxPpg,
      edgeEventsAddedMaxEcg: edgeAddedMaxEcg,
      rows
    },
    evidence: ['tools/cvhr-gap-edge.mjs', 'briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md'],
    reason: status === 'PASS' ? null : `${parityDisagreements} of ${checked} planted case(s) disagree between the two nodes by up to ${parityMaxAbs} event(s)`,
    producedBy: { tool: 'tools/cvhr-gap-edge.mjs', commit }
  });
  const bad = Verdict.validate(v);
  if (bad && bad.length) {
    console.error('verdict does not validate: ' + bad.join('; '));
    process.exit(2);
  }
  console.log(JSON.stringify(v));
  return 0;
}

if (isMain) process.exit(await main());
