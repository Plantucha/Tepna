#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * cvhr-edge-widen.mjs — what widening the CVHR dropout exclusion by the detector's own support costs
 * ------------------------------------------------------------------------------------------------
 * Residue `2026-10-19-a-cvhr-hole-edge-adds-events-on-covered-seconds`, whose remedy clause reads:
 * "widen the exclusion by the detector's own support rather than by the hole, and measure what it
 * costs on a real night." This tool is that measurement. It decides nothing about correctness — it
 * decides whether the remedy pays for itself.
 *
 * THE DEFECT, RESTATED. `cvhrFromNN` (PpgDex) and `detectCVHR` (ECGDex) skip an event stamped on a
 * second a dropout spans, and only on such a second. The decision at second `s` nonetheless reads
 * far outside it. `sm` averages `hr[s-2 … s+2]`; `lo = ma(sm, 23)` takes that to `hr[s-25 … s+25]`;
 * `res = hiCut - lo` inherits the same reach; `env` averages `|res[s-12 … s+12]|`, so the gate at
 * `s` rests on `hr[s-37 … s+37]`; the dip-to-rebound search reads `res[s+8 … s+47]`, whose own
 * support reaches `s+72`. So the decision at `s` rests on `hr[s-37 … s+72]`, and an event on a
 * COVERED second can be manufactured by a hole up to 72 s AFTER it or 37 s BEFORE it. The planted
 * battery in #3711 measured that term at up to two events per hole.
 *
 * ⚠️ THE EXCLUSION WINDOW IS THE MIRROR OF THE SUPPORT WINDOW, and getting that backwards is the easy
 * mistake. The decision at `s` looks FORWARD 72 s and BACKWARD 37 s, so a hole at `[h0, h1]`
 * contaminates every `s` with `s >= h0 - 72` and `s <= h1 + 37`. The widen therefore reaches 72 s
 * BEFORE the hole and 37 s after it, not the other way round.
 *
 * THE CANDIDATE WIDTHS ARE THE CODE'S, NOT A GUESS. Each one is a span read off the chain above, and
 * `full` is the whole support window the row's remedy clause names.
 *
 * THE CRITERION IS PRE-STATED AND IT IS COMMENSURABILITY. The artefact removed is bounded at two
 * events per hole. A widen that removes MORE than two real events per hole therefore costs more
 * detection than the fabrication it prevents, and cannot pay for itself. That bound comes from the
 * detector's structure and from a planted battery, never from the nights judged here.
 *
 * PHASE 1 IS THE PLANTED CHECK, because the cost is only worth knowing if the widen WORKS. The
 * battery's planter supplies a record with a hole and the same record without one, so the hole's own
 * contribution is a difference of two counts. Under a widen both legs lose the same neighbourhood of
 * the join, so the difference should fall to zero. Both nodes run it.
 *
 * PHASE 2 IS THE COST, on the node's own real inputs. A night is parsed and analysed by the real
 * `PPGDSP.analyze`, and the CVHR leg is then recomputed from the `nn`/`tt` that run produced. The
 * recomputation is CONTROLLED: its event count must equal the count `analyze` published, or the
 * night refuses by name rather than contributing a number.
 *
 * WHAT THE HOLE POPULATION IS, AND WHY IT IS NOT THE BEAT SERIES. `_spansGap` comes from
 * `intervalsSpanningTimeGap`, which marks an interval spanning a `relSec` discontinuity — a jump
 * beyond `TIME_GAP_STEPS / fs`, two sample periods. The holes here are read from that same axis, so
 * they are the node's own, not a `> GAP_S` rule applied to beat times.
 *
 * WHAT THIS DOES NOT CLAIM. (1) Nothing here says either node's CVHR index is right; the parity
 * contract and the index's own grade are elsewhere. (2) A night that refuses is reported, never
 * dropped, but a refusal is not evidence about the widen. (3) `relSec` can step BACKWARD on a real
 * O2Ring night (the 2026-08-14 note in `ppgdex-dsp.js`), and `intervalsSpanningTimeGap` tests
 * strictly greater, so a backward step is no more a hole here than it is to the node.
 *
 *   node tools/cvhr-edge-widen.mjs                 # tables on stderr, one tepna.verdict/1 on stdout
 *   node tools/cvhr-edge-widen.mjs --json          # the object alone
 *   node tools/cvhr-edge-widen.mjs --planted-only  # phase 1 alone: seconds, no corpus
 *   node tools/cvhr-edge-widen.mjs --rebuilt-mask   # CONTROL: rebuild the mask out here instead of reading the node's
 *   node tools/cvhr-edge-widen.mjs --selftest      # the widen filter's own properties
 *   node tools/cvhr-edge-widen.mjs --tree <dir> --limit N --out <json>
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GAP_S, HOLES_S, PERIOD_S, STEPS_BPM, activeSecOf, plant, realms, spansGapOf } from './cvhr-gap-edge.mjs';
import { corpusSearch } from './regen-goldens-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const JSON_OUT = has('--json');
const REBUILT_MASK = has('--rebuilt-mask');
const say = (s) => {
  if (!JSON_OUT) console.error(s);
};

/* ═══════════════════════ THE WIDTHS, READ OFF THE DETECTOR, AND THE BOUND ══════════════════════ */
/* `res[s]` support: `sm` averages hr ±2 and `lo = ma(sm, 23)` averages that ±23. */
export const SUP_RES = 25;
/* `env[s]` support: the envelope averages |res| ±12 over a series already reaching ±25. */
export const SUP_ENV = 37;
/* The dip-to-rebound search reads `res[s+8 … s+47]`, and `res[s+47]` itself reaches `s+72`. */
export const SUP_REBOUND = 72;
/* `intervalsSpanningTimeGap`: a `relSec` step beyond two sample periods is a discontinuity. */
export const TIME_GAP_STEPS = 2;
/* `cvhrFromNN`'s own floors — a night under either refuses inside the detector, not here. */
export const MIN_BEATS = 60;
export const MIN_SPAN_S = 120;
/* THE PRE-STATED BOUND: the edge term is at most two events per hole (#3711's planted battery). */
export const COST_CEIL = 2;
export const CANDIDATES = Object.freeze([
  { key: 'current', pre: 0, post: 0, what: 'the shipped rule — the hole’s own seconds and nothing else' },
  { key: 'res', pre: SUP_RES, post: SUP_RES, what: 'the residual’s support' },
  { key: 'env', pre: SUP_ENV, post: SUP_ENV, what: 'the envelope gate’s support' },
  { key: 'full', pre: SUP_REBOUND, post: SUP_ENV, what: 'the whole decision window, rebound search included' }
]);
export const PRIMARY = 'full';

/* ═════════════════════════════════════ THE WIDEN FILTER ════════════════════════════════════════
   One rule, used by both phases: an event at second `s` is excluded by candidate `c` when some hole
   `[h0, h1]` satisfies `s >= h0 - c.pre && s <= h1 + c.post`. A hole is a CLOSED second interval, so
   a point join (the planted control, which has no hole) is `[c, c]`. */
export function excludedBy(sec, holes, cand) {
  for (const h of holes) if (sec >= h[0] - cand.pre && sec <= h[1] + cand.post) return true;
  return false;
}
export function survivors(events, holes, cand, region) {
  let n = 0;
  for (const e of events) {
    if (region && (e.sec < region[0] || e.sec > region[1])) continue;
    if (!excludedBy(e.sec, holes, cand)) n++;
  }
  return n;
}
/* How far from a hole an event can still be influenced by it, plus the same again as margin. Used to
   split a count difference into the part that CAN be the edge term and the part that cannot. */
export const NEAR_S = SUP_REBOUND + SUP_ENV;

/* Every verdict names the code that produced it; a tree that is not a checkout says so in
   `commitReason` rather than leaving the field absent. */
export const COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
})();
export const PRODUCED_BY = COMMIT ? { tool: 'tools/cvhr-edge-widen.mjs', commit: COMMIT } : { tool: 'tools/cvhr-edge-widen.mjs', commit: null, commitReason: 'the tree is not a git checkout' };

/* ══════════════════════════ PHASE 1 · DOES THE WIDEN NEUTRALISE THE TERM? ══════════════════════
   The hole leg and the control leg share every interval but one, so the hole's contribution is the
   difference of two counts. The control has no hole; the comparable exclusion there is the same
   window around the JOIN second, which is where the hole was spliced in. */
export function plantedCase(det, { holeSec, stepBpm, period = PERIOD_S }) {
  const H = plant({ holeSec, stepBpm, period });
  const C = plant({ holeSec, stepBpm, period, insert: false });
  /* The spliced interval is the one longer than the gap cut; the hole spans `(tt[k] - holeSec, tt[k]]`
     and the join sits at its start, which is the last shared beat time. */
  let k = -1;
  for (let i = 0; i < H.nn.length; i++)
    if (H.nn[i] > GAP_S * 1000) {
      k = i;
      break;
    }
  if (k < 1) return { holeSec, stepBpm, reason: 'the planter spliced no hole longer than the gap cut' };
  const joinSec = H.tt[k] - holeSec;
  const holes = [[Math.floor(joinSec), Math.ceil(H.tt[k])]];
  const joins = [[Math.floor(joinSec), Math.floor(joinSec)]];
  const h = det(H.nn, H.tt, activeSecOf(H.tt), spansGapOf(H.tt));
  const c = det(C.nn, C.tt, activeSecOf(C.tt), spansGapOf(C.tt));
  /* ⚠️ THE WHOLE-RECORD DIFFERENCE IS NOT THE EDGE TERM, and this is the planter's doing. `plant`
     oscillates on ABSOLUTE time, so splicing a hole of `holeSec` shifts the phase of all 900 s of
     post-hole beats against the control's. A count difference far from the hole is that phase shift
     and nothing else, while the edge term can only live inside the support window. So the difference
     is split: `deltaNear` is the part that CAN be the edge term, `deltaFar` the part that cannot. */
  const near = [holes[0][0] - NEAR_S, holes[0][1] + NEAR_S];
  const nearC = [joins[0][0] - NEAR_S, joins[0][1] + NEAR_S];
  const out = { holeSec, stepBpm, hole: h.events.length, control: c.events.length, delta: {}, deltaNear: {}, deltaFar: {} };
  for (const cand of CANDIDATES) {
    const dAll = survivors(h.events, holes, cand) - survivors(c.events, joins, cand);
    const dNear = survivors(h.events, holes, cand, near) - survivors(c.events, joins, cand, nearC);
    out.delta[cand.key] = dAll;
    out.deltaNear[cand.key] = dNear;
    out.deltaFar[cand.key] = dAll - dNear;
  }
  /* The ABSOLUTE planted cost, which the signed differences above cannot show: both legs lose the
     same neighbourhood, so a candidate that removes three real events from each reads as zero. */
  out.removedFromControl = {};
  for (const cand of CANDIDATES) out.removedFromControl[cand.key] = c.events.length - survivors(c.events, joins, cand);
  return out;
}

export function plantedPhase(P, E) {
  const rows = [];
  for (const holeSec of HOLES_S)
    for (const stepBpm of STEPS_BPM) {
      const p = plantedCase((...a) => P.cvhrFromNN(...a), { holeSec, stepBpm });
      const e = plantedCase((...a) => E.detectCVHR(...a), { holeSec, stepBpm });
      rows.push({ ...p, ecgDelta: e.delta, ecgNear: e.deltaNear, ecgFar: e.deltaFar, ecgReason: e.reason || null });
    }
  /* THE TWO SIGNS ARE DIFFERENT FACTS AND ARE KEPT APART. A POSITIVE delta is the hole still adding
     an event the control does not have — the artefact, unrepaired. A NEGATIVE delta is the widen
     taking an event the control keeps — over-exclusion, which is a cost rather than a failure. An
     absolute worst conflates a remedy that does not work with one that works and costs. */
  const added = {},
    asym = {},
    far = {},
    cost = {};
  for (const cand of CANDIDATES) {
    let a = 0,
      d = 0,
      f = 0,
      c = 0;
    for (const r of rows) {
      if (!r.delta) continue;
      for (const v of [r.deltaNear[cand.key], r.ecgNear ? r.ecgNear[cand.key] : 0]) {
        a = Math.max(a, v);
        d = Math.min(d, v);
      }
      for (const v of [r.deltaFar[cand.key], r.ecgFar ? r.ecgFar[cand.key] : 0]) f = Math.max(f, Math.abs(v));
      c = Math.max(c, r.removedFromControl[cand.key]);
    }
    added[cand.key] = a;
    asym[cand.key] = -d;
    far[cand.key] = f;
    cost[cand.key] = c;
  }
  return { cases: rows.length, rows, addedMax: added, asymMax: asym, farMaxAbs: far, costOnACleanRecordMax: cost };
}

/* ═══════════════════ PHASE 1b · THE PLANTER’S PHASE, CONTROLLED FOR ══════════════════ */
/* ⚠️ PHASE 1 ALONE CANNOT ANSWER THE QUESTION, and the reason is the planter. `plant` oscillates on
   ABSOLUTE time, so splicing a hole of `holeSec` shifts the phase of every post-hole beat by
   `holeSec / period` of a cycle: past the hole the two legs no longer carry the same beats at all.
   FAR from the hole that shows up as `deltaFar`, which the split above removes — but NEAR the hole
   no split can separate a phase-shifted dip from a fabricated one, and near the hole is the only
   place the edge term lives. Measured: the cases phase 1 reports unneutralised are exactly the holes
   whose shift lands near antiphase (11, 13, 15, and 45, 75, 105 — the last four all 15 mod 30).
   THE CONTROL is a period that DIVIDES the hole, which puts the two legs back in phase. The detector
   accepts cycles of 14–46 s, so a hole with no divisor in that band cannot be controlled this way;
   those holes are named rather than scored. Of the matched periods the one nearest the planted 30 s
   is used, so the dip stays where the detector is most sensitive. */
export const BAND_S = Object.freeze([14, 46]);
export function matchedPeriod(holeSec) {
  let best = null;
  for (let p = BAND_S[0]; p <= BAND_S[1]; p++) if (holeSec % p === 0 && (best === null || Math.abs(p - PERIOD_S) < Math.abs(best - PERIOD_S))) best = p;
  return best;
}
export function plantedMatched(P, E) {
  const rows = [],
    uncontrolled = [];
  for (const holeSec of HOLES_S) {
    const period = matchedPeriod(holeSec);
    if (period === null) {
      uncontrolled.push(holeSec);
      continue;
    }
    for (const stepBpm of STEPS_BPM) {
      const p = plantedCase((...a) => P.cvhrFromNN(...a), { holeSec, stepBpm, period });
      const e = plantedCase((...a) => E.detectCVHR(...a), { holeSec, stepBpm, period });
      rows.push({ ...p, period, ecgNear: e.deltaNear, ecgReason: e.reason || null });
    }
  }
  const added = {},
    asym = {};
  for (const cand of CANDIDATES) {
    let a = 0,
      d = 0;
    for (const r of rows) {
      if (!r.deltaNear) continue;
      for (const v of [r.deltaNear[cand.key], r.ecgNear ? r.ecgNear[cand.key] : 0]) {
        a = Math.max(a, v);
        d = Math.min(d, v);
      }
    }
    added[cand.key] = a;
    asym[cand.key] = -d;
  }
  return { cases: rows.length, rows, uncontrolled, addedMax: added, asymMax: asym };
}

/* ════════════════════════ PHASE 2 · THE HOLE POPULATION AND THE COST ══════════════════════════ */
/* The node's own discontinuity rule, applied to the axis the node applies it to. A hole is reported
   as the closed second interval the jump spans, on the same axis `tt` is measured on. */
export function holesOf(relSec, fs) {
  const out = [];
  if (!relSec || !(fs > 0) || relSec.length < 2) return out;
  const maxStep = TIME_GAP_STEPS / fs;
  for (let i = 1; i < relSec.length; i++) {
    const d = relSec[i] - relSec[i - 1];
    if (d > maxStep) out.push([Math.floor(relSec[i - 1]), Math.ceil(relSec[i])]);
  }
  return out;
}
/* nn-aligned, marking the interval ENDING at beat k, exactly as the detector indexes it: the mask is
   true where the interval `[tt[k-1], tt[k]]` contains a discontinuity. */
export function spansGapFromHoles(tt, holes) {
  const sg = new Uint8Array(tt.length);
  if (!holes.length) return sg;
  for (let k = 1; k < tt.length; k++) {
    const a = tt[k - 1],
      b = tt[k];
    for (const h of holes)
      if (h[0] < b && h[1] > a) {
        sg[k] = 1;
        break;
      }
  }
  return sg;
}

export function scoreNight(P, path) {
  /* ∅ P5 clause 2 — validity travels out of band, so the `_PPGRUNS.txt` companion goes in beside the
     stream whenever the writer left one. SIDECAR COVERAGE IS A PROPERTY OF THE TREE, NOT OF THE
     CORPUS, so it is named per tree rather than assumed: measured 2026-10-20 over `inputs()`, the
     flat `uploads` tree has 0 companions for its 59 streams, and `smoketest-captures` has 161 for
     its 4489. A leg over the first reports the no-sidecar figures; a leg over the second reads a
     sidecar for 161 of its streams and does not. */
  const runs = path.replace(/\.txt$/, 'RUNS.txt');
  const runsText = existsSync(runs) ? readFileSync(runs, 'utf8') : null;
  const rec = P.parsePPG(readFileSync(path, 'utf8'), runsText ? { runsText } : undefined);
  if (!rec || !rec.relSec || !(rec.n > 0)) return { reason: 'parsePPG returned no samples' };
  const r = P.analyze(rec, null);
  if (!r || !r.nn || !r.tt || r.tt.length !== r.nn.length) return { reason: 'analyze returned no beat series' };
  if (r.cvhrReason) return { reason: r.cvhrReason, beats: r.nn.length };
  const holes = holesOf(rec.relSec, rec.fs);
  /* ── THE MASK COMES FROM THE NODE, NOT FROM THIS FILE (residue
     `2026-10-19-the-cvhr-gap-mask-does-not-leave-the-node`) ───────────────────────────────────────
     `spansGapFromHoles` rebuilds only the half of the mask that a `relSec` discontinuity explains.
     The node's mask is `spansTime[i] || bridged[i]`, so the bridged half was unreachable from out
     here and the recomputation scored a DIFFERENT detector. The row's own measurement, taken 2026-10-19
     with this tool, is 68 of 418 eligible streams refused on exactly that disagreement. `analyze` now publishes the mask as `[first, n]` runs over the `nn`
     index space and exports its own decoder, so the mask below is the one the detector ran on.
     `--rebuilt-mask` forces the old reconstruction: it is the CONTROL for the refusal figure, and
     it keeps the reconstruction wired so the comparison can be re-run. */
  const nodeRuns = REBUILT_MASK ? null : r.spansGapRuns;
  const sg = nodeRuns != null ? P.maskFromRuns(nodeRuns, r.nn.length) : spansGapFromHoles(r.tt, holes);
  const maskSource = nodeRuns != null ? 'node' : REBUILT_MASK ? 'rebuilt (--rebuilt-mask)' : 'rebuilt (node published none)';
  const mine = P.cvhrFromNN(r.nn, r.tt, activeSecOf(r.tt), sg);
  /* THE CONTROL. The recomputation must land on the count the node published, or the figures below
     describe a pipeline nobody runs. A disagreement is a refusal, never a warning. */
  if (mine.events.length !== r.cvhrEvents)
    return {
      reason: `reconstruction disagrees with analyze: ${mine.events.length} events against ${r.cvhrEvents}`,
      beats: r.nn.length,
      maskSource
    };
  const row = {
    maskSource,
    beats: r.nn.length,
    spanSec: Math.round(r.tt[r.tt.length - 1]),
    fs: rec.fs,
    site: rec.site,
    holes: holes.length,
    holeSec: holes.reduce((a, h) => a + (h[1] - h[0]), 0),
    events: mine.events.length,
    coveredSec: mine.coveredSec,
    excluded: {}
  };
  for (const cand of CANDIDATES) row.excluded[cand.key] = mine.events.length - survivors(mine.events, holes, cand);
  return row;
}

/* ═════════════════════════════════ THE POPULATION ON DISK ══════════════════════════════════════
   Every optical stream the node accepts, from the capture tree and from the flat corpus directory,
   deduplicated by resolved path. Selection is by NAME only — the node's own floors do the excluding,
   inside the detector, with a reason. */
export const PPG_RE = /_PPG\.txt$/;
export function inputs(tree, flat) {
  const seen = new Map();
  const add = (p) => {
    try {
      const st = statSync(p);
      if (!st.isFile()) return;
      const key = st.dev + ':' + st.ino;
      if (!seen.has(key)) seen.set(key, { path: p, bytes: st.size });
    } catch {
      /* a dangling symlink into a corpus this machine does not mount */
    }
  };
  if (flat && existsSync(flat)) for (const f of readdirSync(flat)) if (PPG_RE.test(f)) add(join(flat, f));
  if (tree && existsSync(tree))
    for (const night of readdirSync(tree)) {
      const dir = join(tree, night);
      let kids = [];
      try {
        if (!statSync(dir).isDirectory()) continue;
        kids = readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of kids) if (PPG_RE.test(f)) add(join(dir, f));
    }
  return [...seen.values()].sort((a, b) => b.bytes - a.bytes);
}

/* ═══════════════════════════════════════ SELFTEST ══════════════════════════════════════════════ */
function selftest() {
  let fail = 0,
    n = 0;
  const ok = (c, m) => {
    n++;
    if (!c) fail++;
    console.log(`${c ? 'ok  ' : 'FAIL'}  ${m}`);
  };
  const ev = (secs) => secs.map((sec) => ({ sec }));
  const cur = CANDIDATES[0],
    full = CANDIDATES[3];
  ok(!excludedBy(100, [[200, 210]], cur), 'the shipped rule excludes nothing outside the hole itself');
  ok(excludedBy(205, [[200, 210]], cur), 'the shipped rule excludes a second the hole spans');
  ok(excludedBy(200 - SUP_REBOUND, [[200, 210]], full), 'the full window reaches 72 s BEFORE the hole, because the rebound search looks forward');
  ok(!excludedBy(200 - SUP_REBOUND - 1, [[200, 210]], full), 'and stops one second earlier');
  ok(excludedBy(210 + SUP_ENV, [[200, 210]], full), 'the full window reaches 37 s AFTER the hole, because the envelope looks back');
  ok(!excludedBy(210 + SUP_ENV + 1, [[200, 210]], full), 'and stops one second later');
  ok(survivors(ev([50, 205, 250]), [[200, 210]], cur) === 2, 'survivors counts what the rule keeps');
  ok(survivors(ev([50, 205, 250]), [[200, 210]], full) === 2, 'a second 40 s past the hole is outside the full window: the reach that way is 37 s');
  ok(survivors(ev([150, 205, 250]), [[200, 210]], full) === 1, 'a second 50 s before it is inside: the reach that way is 72 s');
  ok(
    CANDIDATES.every((c, i, a) => i === 0 || c.pre + c.post >= a[i - 1].pre + a[i - 1].post),
    'the candidates are ordered by width, so a wider one can never cost less'
  );
  const tt = Float64Array.from([0, 1, 2, 40, 41]);
  const sg = spansGapFromHoles(tt, [[2, 40]]);
  ok(sg[3] === 1 && sg[2] === 0 && sg[4] === 0, 'the mask marks the interval ENDING at the post-hole beat, and only it');
  ok(holesOf(Float64Array.from([0, 0.01, 5, 5.01]), 100).length === 1, 'a hole is a relSec step beyond two sample periods');
  ok(holesOf(Float64Array.from([0, 0.01, 0.02]), 100).length === 0, 'and a clean grid has none');
  ok(holesOf(Float64Array.from([0, 5, 4.9]), 100).length === 1, 'a BACKWARD step is not a hole, as it is not one to the node');
  ok(matchedPeriod(11) === null && matchedPeriod(13) === null && matchedPeriod(47) === null, 'a hole with no divisor in the detector’s band cannot be phase-matched');
  ok(matchedPeriod(15) === 15 && matchedPeriod(75) === 25 && matchedPeriod(105) === 35, 'the matched period divides the hole');
  ok(matchedPeriod(900) === PERIOD_S && matchedPeriod(120) === PERIOD_S, 'and of several divisors the one nearest the planted period wins');
  console.log(fail ? `\n✕ ${fail} of ${n} failed` : `\n✓ all ${n} selftests passed`);
  return fail ? 1 : 0;
}

/* ═══════════════════════════════════════════ MAIN ══════════════════════════════════════════════ */
async function main() {
  if (has('--selftest')) return selftest();
  /* What the adoption gate reads. Both phases together take longer than the gate's own timeout, and a
     real run needs a corpus the gate does not have, so the sample carries the pre-stated criterion
     and the only status that is true of a run that examined nothing. */
  if (has('--verdict-sample')) {
    console.log(
      JSON.stringify(
        Verdict.make({
          gate: 'cvhr-edge-widen',
          status: 'NOT_RUN',
          population: { checked: 0, eligible: 0, excluded: 0 },
          criterion: { name: 'excluded_events_per_hole_mean', threshold: COST_CEIL, unit: 'events', direction: 'lte' },
          result: null,
          evidence: ['tools/cvhr-edge-widen.mjs'],
          reason: 'neither phase ran (--verdict-sample): no planted case and no night was examined',
          producedBy: PRODUCED_BY
        }),
        null,
        1
      )
    );
    return 0;
  }
  const { P, E } = await realms();
  say('▸ phase 1 · planted — does widening by the detector’s own support neutralise the edge term?');
  const planted = plantedPhase(P, E);
  say(`  ${planted.cases} cases · NEAR the hole: what it still adds, and what the widen takes asymmetrically.`);
  say('  FAR from it: the planter\u2019s own phase shift. COST: events a widen takes from a CLEAN record.');
  for (const c of CANDIDATES)
    say(
      `    ${c.key.padEnd(8)} added ${String(planted.addedMax[c.key]).padStart(2)}  asym ${String(planted.asymMax[c.key]).padStart(2)}  far ${String(planted.farMaxAbs[c.key]).padStart(2)}  cost ${String(planted.costOnACleanRecordMax[c.key]).padStart(2)}   ${c.what}`
    );
  /* Every case the primary candidate does not neutralise is named, because a summary maximum says
     how bad and never says where. */
  for (const r of planted.rows) {
    if (!r.delta) {
      say(`    ⊘ hole ${r.holeSec}s step ${r.stepBpm}  ${r.reason}`);
      continue;
    }
    if (r.deltaNear[PRIMARY] !== 0 || (r.ecgNear && r.ecgNear[PRIMARY] !== 0))
      say(
        `    ! hole ${String(r.holeSec).padStart(4)}s step ${String(r.stepBpm).padStart(3)}  near[${PRIMARY}] ppg ${r.deltaNear[PRIMARY]} ecg ${r.ecgNear ? r.ecgNear[PRIMARY] : 'n/a'}  far ${r.deltaFar[PRIMARY]}`
      );
  }
  /* ⚠️ THE PHASE-MATCHED RUN IS THE ONE THAT DECIDES IT. Phase 1's positives survive a near/far
     split but not this control, so `neutralises` is read here and never off the line above. */
  say('\n▸ phase 1b · the same grid with the two legs IN PHASE — a period that divides the hole');
  const matched = plantedMatched(P, E);
  say(
    `  ${matched.cases} cases over ${HOLES_S.length - matched.uncontrolled.length} of ${HOLES_S.length} holes; no divisor in the ${BAND_S[0]}–${BAND_S[1]} s band for ${matched.uncontrolled.join(', ') || 'none'}`
  );
  for (const c of CANDIDATES) say(`    ${c.key.padEnd(8)} added ${String(matched.addedMax[c.key]).padStart(2)}  asym ${String(matched.asymMax[c.key]).padStart(2)}   ${c.what}`);
  for (const r of matched.rows)
    if (r.deltaNear && (r.deltaNear[PRIMARY] !== 0 || (r.ecgNear && r.ecgNear[PRIMARY] !== 0)))
      say(
        `    ! hole ${String(r.holeSec).padStart(4)}s period ${r.period} step ${String(r.stepBpm).padStart(3)}  near[${PRIMARY}] ppg ${r.deltaNear[PRIMARY]} ecg ${r.ecgNear ? r.ecgNear[PRIMARY] : 'n/a'}`
      );
  const neutralises = matched.addedMax[PRIMARY] === 0;
  const shippedStillAdds = matched.addedMax.current;

  if (has('--planted-only')) {
    /* A DIFFERENT GATE, because a verdict's criterion has to match the population it examined. The
       cost criterion is about nights and this run saw none; what it did see is the planted grid, whose
       question is whether anything survives the widen at all. */
    const v = Verdict.make({
      gate: 'cvhr-edge-widen-planted',
      status: neutralises ? 'PASS' : 'FAIL',
      population: { checked: planted.cases + matched.cases, eligible: planted.cases + matched.cases, excluded: 0 },
      criterion: { name: 'planted_events_added_max', threshold: 0, unit: 'events', direction: 'lte' },
      result: {
        plantedAddedMax: planted.addedMax,
        plantedAsymMax: planted.asymMax,
        plantedFarMaxAbs: planted.farMaxAbs,
        plantedCostOnACleanRecordMax: planted.costOnACleanRecordMax,
        matchedAddedMax: matched.addedMax,
        matchedAsymMax: matched.asymMax,
        matchedUncontrolledHoles: matched.uncontrolled,
        shippedRuleStillAdds: shippedStillAdds
      },
      evidence: ['tools/cvhr-edge-widen.mjs'],
      reason: neutralises
        ? null
        : `the widen does not neutralise the planted edge term under a phase-matched planter: a hole still adds up to ${matched.addedMax[PRIMARY]} event(s) the control does not have`,
      producedBy: PRODUCED_BY
    });
    console.log(JSON.stringify(v, null, 2));
    return 0;
  }

  /* `--from` re-aggregates a run already on disk. The per-night rows are the measurement; the
     aggregate over them is arithmetic, and re-reading 18 GB of optical stream to repeat arithmetic is
     not a measurement. It never widens the population: eligible is what that run examined. */
  const from = arg('--from', null);
  const saved = from ? JSON.parse(readFileSync(from, 'utf8')) : null;
  const flat = saved ? null : corpusSearch(ROOT).dir;
  const tree = saved ? null : arg('--tree', join(flat, 'vigil-archive', 'captures'));
  const all = saved ? [] : inputs(tree, flat);
  const limit = saved ? 0 : +arg('--limit', '0') || all.length;
  const take = saved ? (saved.rows || []).concat(saved.refused || []) : all.slice(0, limit);
  if (saved) say(`\n▸ phase 2 · cost — re-aggregated from ${from}: ${(saved.rows || []).length} night(s) measured, ${(saved.refused || []).length} refused`);
  else say(`\n▸ phase 2 · cost — ${take.length} optical stream(s) of ${all.length} found`);
  if (!saved && !all.length) {
    const v = Verdict.make({
      gate: 'cvhr-edge-widen',
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'excluded_events_per_hole_mean', threshold: COST_CEIL, unit: 'events', direction: 'lte' },
      result: null,
      evidence: ['tools/cvhr-edge-widen.mjs'],
      reason: `the planted grid ran and the cost did not: no _PPG.txt stream under ${tree} or ${flat} — point --tree at the corpus (docs/CORPUS-LOCATIONS.md; a worktree has no corpus)`,
      producedBy: PRODUCED_BY
    });
    console.log(JSON.stringify(v, null, 2));
    return 2;
  }
  const rows = saved ? saved.rows || [] : [];
  const refused = saved ? saved.refused || [] : [];
  for (const f of saved ? [] : take) {
    const t0 = Date.now();
    let row;
    try {
      row = scoreNight(P, f.path);
    } catch (err) {
      row = { reason: 'threw: ' + (err && err.message ? err.message : String(err)) };
    }
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    if (row.reason) {
      refused.push({ bytes: f.bytes, reason: row.reason });
      say(`  ⊘ ${String(Math.round(f.bytes / 1e6)).padStart(4)} MB  ${sec.padStart(5)} s  ${row.reason}`);
    } else {
      rows.push(row);
      say(
        `  ✓ ${String(Math.round(f.bytes / 1e6)).padStart(4)} MB  ${sec.padStart(5)} s  ${row.site.padEnd(6)} beats ${String(row.beats).padStart(6)}  holes ${String(row.holes).padStart(4)}  events ${String(row.events).padStart(4)}  lost ${CANDIDATES.map((c) => row.excluded[c.key]).join('/')}`
      );
    }
  }

  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const holes = sum((r) => r.holes);
  const events = sum((r) => r.events);
  const perHole = {};
  const share = {};
  for (const c of CANDIDATES) {
    const lost = sum((r) => r.excluded[c.key]);
    perHole[c.key] = holes ? +(lost / holes).toFixed(3) : null;
    share[c.key] = events ? +((100 * lost) / events).toFixed(1) : null;
  }
  /* WHERE THE MASK CAME FROM, over the rows AND the refusals, because the refusal population is the
     quantity this flag moves. A run that mixes the two sources measures neither detector. */
  const maskTally = {};
  for (const r of rows.concat(refused)) {
    /* A stream refused by a NODE guard (no samples, no beat series, a named `cvhrReason`) never
       reached the mask, so it is not evidence about either source. It is counted, under its own
       label, rather than folded into one of them. */
    const k = r.maskSource || 'refused before the mask';
    maskTally[k] = (maskTally[k] || 0) + 1;
  }
  say(`\n  nights ${rows.length} · refused ${refused.length} · holes ${holes} · events ${events}`);
  const maskLine = Object.entries(maskTally)
    .map(([k, n]) => `${k}: ${n}`)
    .join(' · ');
  say(`  mask source · ${maskLine || 'none'}`);
  say('  candidate   lost/hole   % of events   what it is');
  for (const c of CANDIDATES) say(`    ${c.key.padEnd(10)} ${String(perHole[c.key]).padStart(8)} ${String(share[c.key]).padStart(12)}   ${c.what}`);

  const nightsWithHoles = rows.filter((r) => r.holes > 0).length;
  let status, reason;
  if (!rows.length) {
    status = 'NOT_RUN';
    reason = `every one of ${refused.length} stream(s) refused — no night was measured`;
  } else if (!neutralises) {
    status = 'FAIL';
    reason = `the widen does not neutralise the planted edge term under a phase-matched planter: a hole still adds up to ${matched.addedMax[PRIMARY]} event(s) the control does not have`;
  } else if (!holes) {
    status = 'NOT_APPLICABLE';
    reason = `the node's discontinuity rule found no hole on any of ${rows.length} night(s), so there is no exclusion to widen`;
  } else if (perHole[PRIMARY] > COST_CEIL) {
    status = 'SHORTFALL';
    reason = `the widen removes ${perHole[PRIMARY]} real event(s) per hole, above the ${COST_CEIL} it prevents — measured, it does not pay for itself`;
  } else {
    status = 'PASS';
    reason = null;
  }
  const result = {
    plantedAddedMax: planted.addedMax,
    plantedAsymMax: planted.asymMax,
    plantedFarMaxAbs: planted.farMaxAbs,
    plantedCostOnACleanRecordMax: planted.costOnACleanRecordMax,
    matchedAddedMax: matched.addedMax,
    matchedAsymMax: matched.asymMax,
    matchedUncontrolledHoles: matched.uncontrolled,
    shippedRuleStillAdds: shippedStillAdds,
    nights: rows.length,
    nightsWithHoles,
    holes,
    events,
    lostPerHole: perHole,
    lostPctOfEvents: share,
    primary: PRIMARY,
    maskSource: maskTally
  };
  const v = Verdict.make({
    gate: 'cvhr-edge-widen',
    status,
    population: { checked: rows.length, eligible: take.length, excluded: refused.length },
    criterion: { name: 'excluded_events_per_hole_mean', threshold: COST_CEIL, unit: 'events', direction: 'lte' },
    result,
    evidence: ['tools/cvhr-edge-widen.mjs', 'tools/cvhr-gap-edge.mjs'],
    reason,
    producedBy: PRODUCED_BY
  });
  const out = arg('--out', null);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ verdict: v, rows, refused }, null, 2));
    say(`\n  detail → ${out}`);
  }
  console.log(JSON.stringify(v, null, 2));
  return status === 'PASS' || status === 'NOT_APPLICABLE' || status === 'SHORTFALL' ? 0 : 1;
}

/* Importing this file must not run the battery: a tool with no main-module guard consumes the
   importer’s argv and prints its own report instead. Measured here — a probe that imported
   `survivors` ran the whole real-night pass. */
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain)
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
