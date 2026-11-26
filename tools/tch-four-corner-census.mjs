#!/usr/bin/env node
/*
 * tools/tch-four-corner-census.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE FOUR-CORNER HAT, COUNTED OVER EVERY NIGHT THAT HOLDS FOUR CORNERS.
 *
 * WHY. `solveFourCorners` in `sensor-trio-worker.js` shipped on 2026-11-25 and added the Muse
 * forehead as a fourth corner of the night page. Nobody had run it over the real nights, so the
 * repository held a four-corner estimator and no four-corner measurement. This census is that
 * measurement, and it edits no estimator.
 *
 * ONE ESTIMATOR, NEVER A SECOND ONE. This tool loads the SHIPPED worker into a Node realm and
 * calls its own `runRealNight`, exactly as `tools/tch-third-corner.mjs` loads the shipped DSP
 * files. `tools/tch-fused-corpus.mjs` took the other road, re-deriving the worker's per-second
 * construction in Node, and its header records the price in full: two deliberate divergences
 * which move published numbers. A census of a shipped estimator must not pay that price, so the
 * realm below runs the worker's bytes and reads its return.
 *
 * THE THREE-CORNER HAT ON THE SAME SECONDS IS ALREADY IN THE RETURN. `AnalysisStats.nCornerHat`
 * solves every three-corner subset over the same pair dispersions and publishes them as
 * `subHats`. So the `h10 · verity · o2` sub-hat IS the classic hat over exactly the seconds the
 * four-way solve used, and the census reads it rather than re-aligning anything. The night page's
 * own three-corner card solves over the THREE-way overlap, which is a larger second set, so the
 * two numbers answer different questions and the census reports both.
 *
 * ∅ ABSENCE. A corner with a negative variance carries a null sigma and the reason
 * `negative-variance`, and this census never repairs one. A night the four-way overlap floor
 * refuses carries its own second count. A night the census cannot read is EXCLUDED and named,
 * never counted as a night without corners.
 *
 * PII. A capture file name carries a device serial, so no report row holds one. A night keys on
 * its date, a corner on its device class, and the per-night values stay out of the tracked tree.
 *
 * THE CRITERION, STATED BEFORE THE RUN (board #9094,
 * sha256 41c569e1bd522753aa6dc9965ff17681c48197de2f66142c9b9685d9578916bb):
 *   `nights_with_an_unnamed_refusal`, threshold 0, direction `lte`, unit `nights`.
 * A night breaks it when the solve returns no hat and no reason, when a corner holds a null
 * sigma and no `cornerReason`, or when a corner reports a sigma over a negative variance. The
 * criterion judges the absence discipline and never the size of a sigma, because a threshold
 * which the judged data derives is UNKNOWN by the verdict contract. Every sigma therefore
 * travels as data beside the verdict.
 *
 * USAGE
 *   node tools/tch-four-corner-census.mjs --selftest
 *   node tools/tch-four-corner-census.mjs --captures <dir>              # nights already on disk
 *   node tools/tch-four-corner-census.mjs --host <host> --captures <dir> [--scratch <dir>]
 *   node tools/tch-four-corner-census.mjs --captures <dir> --night 2026-11-21 --json
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { intersectSnapshots, populationVerdict, snapshotEntries, snapshotNights } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOL = 'tools/tch-four-corner-census.mjs';
export const GATE = 'tch-four-corner-census';
/** The pre-registration this census judges itself against. Board #9094, before any solve. */
export const CRITERION_SHA256 = '41c569e1bd522753aa6dc9965ff17681c48197de2f66142c9b9685d9578916bb';
export const CRITERION = { name: 'nights_with_an_unnamed_refusal', threshold: 0, unit: 'nights', direction: 'lte' };
/** The worker's own four-way overlap floor, read here for the UNDERPOWERED branch of the status rule. */
export const FOUR_MIN_SEC = 1000;
/** The four corner names, in the order the shipped page passes them. */
export const FOUR_NAMES = ['h10', 'verity', 'o2', 'forehead'];
/** The classic trio, whose sub-hat rides the four-way seconds. */
export const TRIO_NAMES = ['h10', 'verity', 'o2'];

/* ── 1 · WHICH FILES MAKE A NIGHT ─────────────────────────────────────────────────────────────
   The worker reads thirteen keys off `m.files`, and this table names the six roles a four-corner
   night needs plus the four sidecars its absence-handling reads. The ring takes its native 1 Hz
   `_SPO2.csv` rather than the 225 MB raw pleth, which is the `o2` role the page itself assigns.
   A role is OPTIONAL when the night still solves four corners without it: `h10rr` only feeds the
   firmware reference, and every `*RUNS` sidecar only annotates coverage. */
export const ROLES = [
  { key: 'h10ecg', re: /^Polar_H10_.*_ECG\.txt$/i, required: true, corner: 'h10' },
  { key: 'h10ecgRuns', re: /^Polar_H10_.*_ECGRUNS\.txt$/i, required: false, corner: 'h10' },
  { key: 'h10rr', re: /^Polar_H10_.*_RR\.txt$/i, required: false, corner: 'h10' },
  { key: 'verityPPG', re: /^Polar_VeritySense_.*_PPG\.txt$/i, required: true, corner: 'verity' },
  { key: 'verityPPGRuns', re: /^Polar_VeritySense_.*_PPGRUNS\.txt$/i, required: false, corner: 'verity' },
  { key: 'o2', re: /^(?:O2Ring.*|Wellue_O2Ring-S_[0-9A-Za-z]+)_\d{14}(?:_SPO2)?\.csv$/i, required: true, corner: 'o2' },
  { key: 'forehead', re: /^Muse_.*_RAW\.txt$/i, required: true, corner: 'forehead' },
  { key: 'foreheadRuns', re: /^Muse_.*_RAWRUNS\.txt$/i, required: false, corner: 'forehead' }
];

/* THE ONE PARSER, loaded once out of `clock.js` (§✅ — `parseTimestamp` is single-sourced there, and
   a second spelling of a stamp rule in this tool is exactly what §🔒.2 forbids). It is cached because
   a census picks files for every night of the tree and the realm costs a file read and a compile. */
let _clockParse = null;
export function clockParse(root = ROOT) {
  if (_clockParse) return _clockParse;
  const require = createRequire(import.meta.url);
  const DB = require(join(root, 'tools', 'build-core.js'));
  const ctx = { console: { log: () => {}, warn: () => {}, error: () => {} }, Date, Math, JSON };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(DB.classicify(fs.readFileSync(join(root, 'clock.js'), 'utf8')), ctx, { filename: 'clock.js' });
  if (!ctx.DexClock || typeof ctx.DexClock.parseTimestamp !== 'function') throw new Error('clock.js did not publish DexClock.parseTimestamp, so no stamp can be read');
  _clockParse = (s) => ctx.DexClock.parseTimestamp(s);
  return _clockParse;
}

/** The 14-digit session stamp a capture file name carries, or null. PURE. */
export function stampOf(name) {
  const m = String(name).match(/_(\d{8})_?(\d{6})_/);
  return m ? m[1] + m[2] : null;
}

/* A night directory holds SEVERAL sessions, and only one of them pairs four corners.
   THE PAGE'S OWN RULE DECIDES, AND THE CENSUS REPORTS WHERE A LOOSER RULE WOULD DIFFER.
   `sensor-trio-night.js` anchors on the ring (`anchor = o2 || o2p`, the largest ring file) and then
   takes each other role NEAREST that anchor's stamp. The census follows that rule exactly, because
   the page is the authority on which files make a night and a second rule here would assemble a
   file set the shipped estimator never would.
   MEASURED, and the reason this paragraph exists: 2026-11-21 holds FOUR headband sessions, and the
   largest is the 22:36 one while the ring's session starts at 19:41. A largest-file rule picks a
   headband stream which overlaps the other three corners barely or not at all, and the four-way
   hat then refuses or reports a sigma over the wrong stretch of the night. So `largestNotPicked`
   below NAMES every role where the two rules part, and the night report prints it beside the
   sigma — a divergence stated, never a divergence hidden (§∅). */
/* 🔴 NEARNESS IS A TIME, AND A STAMP IS NOT A NUMBER. The first spelling of this function scored
   candidates by `Math.abs(Number(stamp) - Number(anchorStamp))` over the 14 digits. Digit-positional
   arithmetic is not a duration in any unit, and it inverts across every field boundary: against an
   anchor of `…195959`, a session at `…200000` — one second later — scores 40041 while one at
   `…195000`, ten minutes earlier, scores 959, so the later-by-a-second file LOSES. The page compares
   `x.ms`, a real instant, so the digit form was also a silent deviation from the authority this
   census follows. Both stamps now go through `DexClock.parseTimestamp`, the single parser, which
   range-validates all six components and returns null on an impossible one (§🔒.2, §🔒.4).

   ⚠ A KNOWN DIFFERENCE FROM THE PAGE, STATED: the page prefers each file's FIRST DATA ROW stamp and
   falls back to the name (`sensor-trio-night.js:345`), because a name is written at offload and the
   row at recording — measured there at a 3.9 s median error over 9853 files, with 74 over 5 min. A
   listing carries names alone, so this census compares names and NAMES THE RISK: `closeCalls` below
   reports every role where the two best candidates sit within `CLOSE_CALL_MS`, which is where that
   error could choose differently. */
export const CLOSE_CALL_MS = 5 * 60 * 1000;

/** The 14-digit name stamp as a real instant through the ONE parser, or null. */
export function stampMsOf(name, parse = clockParse()) {
  const s = stampOf(name);
  if (s == null) return null;
  const t = parse(s);
  return t && Number.isFinite(t.tMs) ? t.tMs : null;
}

/**
 * @param {Array<{name:string,size:number}>} entries
 * @param {(s:string)=>({tMs:number}|null)} [parse]
 * @returns {{picked:Object,missing:string[],candidates:Object,anchorStamp:string|null,anchorMs:number|null,largestNotPicked:string[],closeCalls:string[],nearnessBasis:string}}
 */
export function pickRoleFiles(entries, parse = clockParse()) {
  const list = (entries || []).filter((e) => e && typeof e.name === 'string');
  const byRole = {};
  for (const r of ROLES) byRole[r.key] = list.filter((e) => r.re.test(basename(e.name)));
  const biggest = (a) => a.slice().sort((p, q) => q.size - p.size || p.name.localeCompare(q.name))[0] || null;
  /* THE ANCHOR IS THE RING, which is what the night page's own ingest picks (`anchor = o2 || o2p`
     in `sensor-trio-night.js`). An anchor taken from the heaviest required file of ANY role lets
     one long unrelated session hijack it, and then every nearest-pick agrees with every largest-
     pick and the disagreement test below can never fire. The chest ECG is the fallback, because a
     night with no ring has no `o2` corner and the missing list already refuses it. */
  const anchorFrom = biggest(byRole.o2) || biggest(byRole.h10ecg);
  const anchorStamp = anchorFrom ? stampOf(anchorFrom.name) : null;
  const anchorMs = anchorFrom ? stampMsOf(anchorFrom.name, parse) : null;
  const closeCalls = [];
  /* `aroundMs == null` is the page's own fallback to the largest file (`if (nt.startMs == null)
     return largest(a)`), reached by returning null here and letting the caller take `big`. */
  const nearestTo = (a, aroundMs, key) => {
    if (!a.length || aroundMs == null) return null;
    const scored = a
      .map((e) => ({ e, ms: stampMsOf(e.name, parse) }))
      .filter((x) => x.ms != null)
      .map((x) => ({ e: x.e, d: Math.abs(x.ms - aroundMs) }));
    if (!scored.length) return null;
    scored.sort((p, q) => p.d - q.d || q.e.size - p.e.size);
    if (scored.length > 1 && scored[1].d - scored[0].d < CLOSE_CALL_MS && key) closeCalls.push(key);
    return scored[0].e;
  };
  const picked = {};
  const candidates = {};
  const missing = [];
  const disagree = [];
  /* THE FIRMWARE RR IS PAIRED WITH THE ECG, NOT WITH THE NIGHT. `sensor-trio-night.js:294` states
     the reason: the RR must come from the SAME recording as the ECG it is paired against, so it is
     chosen nearest the ECG's start. This census builds its firmware reference out of that pair, so
     anchoring the RR on the ring would have paired an ECG with another session's beats. */
  const ecgPick = nearestTo(byRole.h10ecg, anchorMs, 'h10ecg') || biggest(byRole.h10ecg);
  const ecgMs = ecgPick ? stampMsOf(ecgPick.name, parse) : null;
  for (const r of ROLES) {
    const a = byRole[r.key];
    candidates[r.key] = a.length;
    const big = biggest(a);
    const near = r.key === 'h10rr' ? nearestTo(a, ecgMs, 'h10rr') : nearestTo(a, anchorMs, r.key);
    if (!big) {
      if (r.required) missing.push(r.key);
      continue;
    }
    if (near && near.name !== big.name) disagree.push(r.key);
    picked[r.key] = (near || big).name;
  }
  return { picked, missing, candidates, anchorStamp, anchorMs, largestNotPicked: disagree, closeCalls, nearnessBasis: 'name-stamp' };
}

/** A night is ELIGIBLE when every required role is present. PURE — the population's definition. */
export function nightEligible(pick) {
  return !!pick && Array.isArray(pick.missing) && pick.missing.length === 0;
}

/** The classic hat over the four-way seconds, out of `nCornerHat`'s own subset table. PURE. */
export function sameSecondsSubHat(four) {
  const subs = (four && four.subHats) || [];
  const want = TRIO_NAMES.slice().sort().join('|');
  for (const sh of subs) {
    const have = (sh.names || []).slice().sort().join('|');
    if (have === want) return sh;
  }
  return null;
}

/* ── 2 · THE CRITERION, APPLIED TO ONE NIGHT ──────────────────────────────────────────────────
   Three ways a night breaks it, each one a named string so the report prints the finding rather
   than a count nobody can trace. */
/** @returns {string[]} one entry per broken rule; empty means the night kept the criterion. */
export function unnamedRefusals(row) {
  const out = [];
  const four = (row && row.four) || null;
  if (!four) {
    out.push('the night carries no four-corner result object at all');
    return out;
  }
  if (!four.ok) {
    if (!four.reason) out.push('the four-corner solve refused and named no reason');
    return out;
  }
  for (const nm of four.names || FOUR_NAMES) {
    const sg = four.sigma ? four.sigma[nm] : undefined;
    const vr = four.variance ? four.variance[nm] : undefined;
    const rs = four.cornerReason ? four.cornerReason[nm] : undefined;
    if (sg == null && !rs) out.push(`corner ${nm} holds a null sigma and names no cornerReason`);
    if (sg != null && Number.isFinite(vr) && vr < 0) out.push(`corner ${nm} reports a sigma over a negative variance`);
  }
  return out;
}

/* ── 3 · THE VERDICT, UNDER THE PRE-STATED STATUS RULE ────────────────────────────────────────
   `checked + excluded = eligible` holds by construction: a night the census read is checked, a
   night it could not read is excluded with a reason. A PASS over `checked: 0` is invalid by the
   verdict contract, and the NOT_RUN branch below is what an empty population produces instead. */
/**
 * @param {{rows:Array,excluded:Array,eligible:number,walked:number,at?:string,commit?:string,popStability?:object|null,dropped?:Array<string>}} a
 */
export function censusVerdict(a) {
  const rows = a.rows || [];
  const excluded = a.excluded || [];
  const eligible = a.eligible == null ? rows.length + excluded.length : a.eligible;
  const broken = rows.filter((r) => unnamedRefusals(r).length > 0);
  const solved = rows.filter((r) => r.four && r.four.ok);
  const underFloor = rows.filter((r) => r.four && !r.four.ok && /under the \d+-s floor/.test(String(r.four.reason || '')));
  let status, reason;
  if (eligible === 0) {
    status = 'NOT_RUN';
    reason = 'no night in the walked tree holds all four corner roles, so the census examined nothing';
  } else if (rows.length === 0) {
    status = 'UNKNOWN';
    reason = `the census could not read any of the ${eligible} eligible night(s)`;
  } else if (broken.length > 0) {
    status = 'FAIL';
    reason = `${broken.length} night(s) carry an unnamed refusal: ${broken.map((r) => r.night + ' — ' + unnamedRefusals(r).join('; ')).join(' | ')}`;
  } else if (solved.length === 0 && underFloor.length === rows.length) {
    status = 'UNDERPOWERED';
    reason = `all ${rows.length} checked night(s) fall under the ${FOUR_MIN_SEC}-s four-way overlap floor`;
  } else if (solved.length === 0) {
    status = 'UNDERPOWERED';
    reason = `no checked night solved a four-corner hat; every refusal is named`;
  } else {
    status = 'PASS';
    reason = null;
  }
  /* §🧾 A `NOT_RUN` examined nothing, so it measures nothing and `result` is null. A census which
     published a counted-zero there would report a measurement over a population it never read. */
  const result =
    status === 'NOT_RUN'
      ? null
      : {
          criterionSha256: CRITERION_SHA256,
          nights_with_an_unnamed_refusal: broken.length,
          nightsSolved: solved.length,
          nightsRefused: rows.length - solved.length,
          nightsWalked: a.walked == null ? null : a.walked,
          refusalsByReason: countReasons(rows),
          cornerReasons: countCornerReasons(rows),
          /* the corner-ordering question, with its span caveat recorded beside it (§3b) */
          referenceDirection: referenceDirection(rows),
          fourthCornerShift: fourthCornerShift(rows),
          /* THE POPULATION'S OWN STABILITY, carried so a reader of this verdict alone can see
             whether the root moved under the run and which nights that cost (§∅ — a move is
             reduced coverage, which annotates, and never a silent narrowing). */
          populationStability: a.popStability ? { status: a.popStability.status, reason: a.popStability.reason } : null,
          nightsDroppedForPopulationMove: a.dropped && a.dropped.length ? a.dropped : [],
          referenceSpanCaveat: 'the firmware reference is scored over the three-way overlap, not the four-way one, so read the per-night direction and not the ratio',
          excludedNights: excluded.map((e) => ({ night: e.night, reason: e.reason }))
        };
  return {
    schema: 'tepna.verdict/1',
    gate: GATE,
    status,
    scope: 'internal',
    population: { checked: rows.length, eligible, excluded: excluded.length },
    criterion: { ...CRITERION },
    result,
    evidence: [TOOL, 'sensor-trio-worker.js', 'analysis-stats.js'],
    reason,
    producedBy: a.commit ? { tool: TOOL, commit: a.commit } : { tool: TOOL, commit: null, commitReason: 'the census ran outside a readable git checkout, so no commit stamps it' },
    at: a.at || new Date().toISOString()
  };
}

/* ── 3b · THE TWO AGGREGATES THE CORNER ORDERING NEEDS ────────────────────────────────────────
   A hat recovers precision with no reference, so it can be internally consistent and still charge
   one corner for an error the corners share. Two counts separate the question into its parts.

   ⚠ THE SECOND SETS DIFFER. `nightReference` scores each corner over the seconds the reference and
   the three HR series share (`sensor-trio-worker.js:1315`), which is the three-way overlap, not the
   four-way one — measured here at 9,197–30,850 s against a four-way 4,420–21,555 s. So a RATIO of
   the two sigmas is not a same-seconds comparison, and the per-night DIRECTION, which survives a
   change of span far better than a median does, is the figure to read. A same-seconds reference
   needs `scoreSeries` restricted to the four-way key set, which is a change to the shipped worker
   and a separate unit. */

/** Per corner: how often the four-corner sigma sits ABOVE the night's own firmware reference. PURE. */
export function referenceDirection(rows) {
  const out = {};
  for (const nm of TRIO_NAMES) {
    const ratios = [];
    let above = 0;
    let below = 0;
    for (const r of rows || []) {
      const rf = r && r.reference;
      const sg = r && r.four && r.four.sigma ? r.four.sigma[nm] : null;
      const rs = rf && rf.ok && rf.sigma ? rf.sigma[nm] : null;
      if (!Number.isFinite(sg) || !Number.isFinite(rs) || rs <= 0) continue;
      ratios.push(sg / rs);
      if (sg > rs) above++;
      else below++;
    }
    out[nm] = { n: ratios.length, above, below, medianRatio: median(ratios) };
  }
  return out;
}

/** Per corner: how far the FOURTH corner moved it off the same-seconds three-corner hat. PURE. */
export function fourthCornerShift(rows) {
  const out = {};
  for (const nm of TRIO_NAMES) {
    const rel = [];
    for (const r of rows || []) {
      const sg = r && r.four && r.four.sigma ? r.four.sigma[nm] : null;
      const tri = sameSecondsSubHat(r && r.four);
      const t3 = tri && tri.sigma ? tri.sigma[nm] : null;
      if (!Number.isFinite(sg) || !Number.isFinite(t3) || t3 <= 0) continue;
      rel.push(Math.abs(sg - t3) / t3);
    }
    out[nm] = { n: rel.length, medianRelShift: median(rel) };
  }
  return out;
}

/** The median of a numeric list, or null over an empty one (§∅ — never 0). PURE. */
export function median(xs) {
  const s = (xs || [])
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);
  if (!s.length) return null;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Every named four-corner refusal, counted by its reason. A solved night contributes nothing. PURE. */
export function countReasons(rows) {
  const out = {};
  for (const r of rows || []) {
    const four = r.four;
    if (!four || four.ok) continue;
    const key = normalizeReason(four.reason);
    out[key] = (out[key] || 0) + 1; // absence-ok: a tally's zero is the identity of a count, not an unmeasured value — the key is absent until a refusal creates it
  }
  return out;
}

/** A refusal which carries a night-specific number collapses onto its CLASS, so the tally groups. PURE. */
export function normalizeReason(reason) {
  const s = String(reason == null ? 'unnamed' : reason);
  return s.replace(/\b\d+(\.\d+)?\b/g, 'N');
}

/** Every per-corner reason the solve named, counted. `negative-variance` is the one the row asks for. PURE. */
export function countCornerReasons(rows) {
  const out = {};
  for (const r of rows || []) {
    const four = r.four;
    if (!four || !four.ok || !four.cornerReason) continue;
    for (const nm of Object.keys(four.cornerReason)) {
      const v = four.cornerReason[nm];
      if (v == null) continue;
      const k = nm + ' · ' + v;
      out[k] = (out[k] || 0) + 1; // absence-ok: a tally's zero is the identity of a count, not an unmeasured value — the key is absent until a corner names this reason
    }
  }
  return out;
}

/* ── 4 · THE REALM ────────────────────────────────────────────────────────────────────────────
   The shipped worker, in a Node context, with the nine dependency files it loads through
   `importScripts`. The shim resolves a repository-relative path and runs the file's classicified
   bytes, which is the pattern `tools/tch-third-corner.mjs` established. A missing `postMessage`
   or `self` would read as a dead corner rather than a throw, so both exist before the load.
   `TextDecoderStream` stays ABSENT on purpose: `PATAlign.decodeMuseOptics` then takes its
   documented one-read path, which is the branch the test suite's shim realm also exercises. */
export function workerRealm(root = ROOT) {
  const require = createRequire(import.meta.url);
  const DB = require(join(root, 'tools', 'build-core.js'));
  const progress = [];
  const posted = [];
  const ctx = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    Date,
    Math,
    JSON,
    performance
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.postMessage = (m) => {
    if (m && m.type === 'progress') progress.push(m.phase);
    else posted.push(m);
  };
  ctx.importScripts = function (...urls) {
    for (const u of urls) {
      const p = join(root, String(u));
      ctx.__lastScript = u;
      vm.runInContext(DB.classicify(fs.readFileSync(p, 'utf8')), ctx, { filename: String(u) });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(DB.classicify(fs.readFileSync(join(root, 'sensor-trio-worker.js'), 'utf8')), ctx, { filename: 'sensor-trio-worker.js' });
  return { ctx, progress, posted };
}

/** A file handle shaped like the `File` the worker reads: `.text()` and nothing else it calls. */
export function fileShim(path) {
  return { name: basename(path), text: async () => fs.readFileSync(path, 'utf8') };
}

/* ── 5 · WALKING THE TREE ─────────────────────────────────────────────────────────────────────
   Two transports, one listing shape. A local tree reads through `fs`; a remote tree lists over
   ssh and copies ONE night at a time into scratch, then deletes it. A full night of four corners
   is about 670 MB and eleven of them is 7 GB, so the census never holds more than one night. */
/* 🔴 THE NIGHT RULE IS THE CORE'S, NOT A SECOND COPY. `snapshotNights` is the one-level night walk
   eleven shipped scorers already use, and it records what its rule admitted and passed over. A
   private `/^\d{4}-\d{2}-\d{2}$/` here would be a second authority on what a night directory IS, and
   the population this tool publishes would describe a listing the core never agreed with. */
export function listLocal(root) {
  const snap = snapshotNights(root);
  if (!snap.ok) throw new Error(`the captures root is not enumerable: ${snap.reason}`);
  const out = [];
  for (const night of snap.nights) {
    const entries = [];
    for (const f of fs.readdirSync(join(root, night), { withFileTypes: true })) {
      if (!f.isFile()) continue;
      /* §∅ A FILE WHOSE SIZE WILL NOT READ LEAVES THE LISTING. It used to enter it at `size: 0`,
         where the picker ranks by size and a zero sorts as the smallest real file — an unreadable
         capture would have lost a largest-file comparison it never took part in. */
      let size;
      try {
        size = fs.statSync(join(root, night, f.name)).size;
      } catch {
        continue;
      }
      entries.push({ name: f.name, size });
    }
    out.push({ night, entries });
  }
  return out.sort((a, b) => a.night.localeCompare(b.night));
}

/** The population of ONE already-taken listing, in the core's snapshot shape.
 *
 *  🔴 THE LISTER DOES NOT WALK. `snapshotEntries` documents that the caller's own lister IS the
 *  enumeration, and here that listing has already happened: the names come off the `tree` this run
 *  scores, so the population and the scored set cannot disagree. A lister that re-walked the root
 *  would reintroduce exactly the two-walk defect this is here to avoid. The unit is `nights`
 *  because a member is a night directory, and the ssh transport has no `readdirSync` for
 *  `snapshotNights` to use. */
export function treeSnapshot(root, tree, at = null) {
  const listWalkedNights = () => (tree || []).map((t) => t.night);
  return snapshotEntries(root, { list: listWalkedNights, unit: 'nights', at });
}

/** `find`-free remote listing: one ssh call for the whole tree, parsed by the pure function below. */
export function listRemote(host, root) {
  const txt = execFileSync('ssh', ['-o', 'BatchMode=yes', host, `cd ${shq(root)} && for d in */; do for f in "$d"*; do [ -f "$f" ] && stat -c '%n %s' "$f"; done; done`], {
    encoding: 'utf8',
    maxBuffer: 1 << 28
  });
  return parseRemoteListing(txt);
}

/** PURE — the remote listing's text into the same shape `listLocal` returns. */
export function parseRemoteListing(txt) {
  const by = new Map();
  for (const line of String(txt).split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2})\/(.+)\s(\d+)$/);
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], []);
    by.get(m[1]).push({ name: m[2], size: Number(m[3]) });
  }
  return [...by.entries()].map(([night, entries]) => ({ night, entries })).sort((a, b) => a.night.localeCompare(b.night));
}

/** Single-quote one shell word. The paths here are operator-supplied, never capture content. */
export function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/* ── 6 · ONE NIGHT ────────────────────────────────────────────────────────────────────────────
   The realm is rebuilt per night on purpose: a night holds hundreds of megabytes of decoded
   signal, and a shared realm would carry every night's at once past the memory ceiling. */
export async function solveNight(dir, pick, root = ROOT) {
  const { ctx, progress } = workerRealm(root);
  const files = {};
  for (const k of Object.keys(pick.picked)) files[k] = fileShim(join(dir, pick.picked[k]));
  const res = await ctx.runRealNight({ files, reqId: 1, label: 'census', wantSeries: true });
  return { res, progress };
}

/** The night ROW the report prints — no file name, no device serial, no per-second value. */
export function nightRow(night, pick, res) {
  const four = (res && res.four) || null;
  const sub = four && four.ok ? sameSecondsSubHat(four) : null;
  return {
    night,
    candidates: pick.candidates,
    largestNotPicked: pick.largestNotPicked,
    /* where the page's row-stamp preference could have chosen the other session (§ pickRoleFiles) */
    closeCalls: pick.closeCalls || [],
    nearnessBasis: pick.nearnessBasis || null,
    skip: res && res.skip ? res.skip : false,
    skipReason: res && res.skip ? res.reason || null : null,
    threeWaySeconds: res && res.n != null ? res.n : null,
    three: res && res.sigma ? res.sigma : null,
    four,
    sameSecondsTrio: sub ? { names: sub.names, sigma: sub.sigma, reason: sub.reason == null ? null : sub.reason } : null,
    fourSeconds: four && four.seconds != null ? four.seconds : null,
    fourSpanMin: four && four.spanMin != null ? four.spanMin : null,
    /* THE INDEPENDENT CHECK ON THE CORNER ORDERING, and the reason this field is not optional.
       A hat recovers precision with no reference, so a hat which ranks the chest ECG WORSE than an
       optical corner cannot tell a real device sigma from its own bias on that corner. The worker
       already builds the night's firmware-RR reference (`nightReference`, ECGDex beats paired with
       the H10 firmware's own) and scores every corner against it. The census carries that result
       beside the hat so a reader holds the two together, and names the refusal when the reference
       could not be built. The H10's reference sigma is a LOWER BOUND by construction, because the
       reference comes from its own beats. */
    reference: res && res.reference ? res.reference : null,
    /* The page's own H10 lead gate and its negative-variance flag, carried as DATA. A night the
       page would have flagged is a night whose four-corner sigma a reader must not quote alone. */
    h10Fault: res && res.h10Fault != null ? res.h10Fault : null,
    h10Unreliable: res && res.h10Unreliable != null ? res.h10Unreliable : null,
    threeWayNegative: res && res.neg != null ? !!res.neg : null,
    coverage: res && res.coverage != null ? res.coverage : null,
    correlations: res ? { hv: res.rHV == null ? null : res.rHV, ho: res.rHO == null ? null : res.rHO, vo: res.rVO == null ? null : res.rVO } : null,
    cornerSource: res ? { verity: res.source || null, o2: res.o2Source || null, h10: res.h10Source || null } : null
  };
}

/* ── 7 · THE REPORT ───────────────────────────────────────────────────────────────────────────
   Prose to stderr, the verdict object to stdout. A reader of the prose sees every corner sigma
   with its second count and its covered span, and every refusal by its reason. */
export function reportLines(rows, excluded, verdict) {
  const L = [];
  L.push('tch-four-corner-census — the four-corner hat over every night that holds four corners');
  L.push(`criterion sha256 ${CRITERION_SHA256}`);
  L.push('');
  for (const r of rows) {
    L.push(`${r.night}`);
    if (r.largestNotPicked && r.largestNotPicked.length) {
      L.push(`  the night holds more than one session for ${r.largestNotPicked.join(', ')}; the page's nearest-the-ring rule picked, and the largest file is a different session`);
    }
    if (r.closeCalls && r.closeCalls.length) {
      L.push(`  CLOSE CALL on ${r.closeCalls.join(', ')} — two sessions sit within ${CLOSE_CALL_MS / 1000} s, and this census ranks them by NAME stamp while the page prefers the first data row`);
    }
    if (r.skip) {
      L.push(`  the three-corner night itself was skipped: ${r.skipReason}`);
      continue;
    }
    const f = r.four;
    if (!f || !f.ok) {
      L.push(`  four corners REFUSED — ${(f && f.reason) || 'no reason given'}`);
    } else {
      L.push(`  four-way overlap ${f.seconds} s over ${f.spanMin} min`);
      for (const nm of f.names || FOUR_NAMES) {
        const sg = f.sigma ? f.sigma[nm] : null;
        const rs = f.cornerReason ? f.cornerReason[nm] : null;
        const vr = f.variance ? f.variance[nm] : null;
        L.push(sg == null ? `  σ ${nm.padEnd(8)} —        ${rs || 'no sigma'}, variance ${fmt(vr)} bpm²` : `  σ ${nm.padEnd(8)} ${sg.toFixed(3).padStart(7)} bpm`);
      }
      /* THE RESIDUAL IS THE ONLY READING OF FIT, and the fourth corner is what creates one. Six
         pair dispersions over four unknowns leave df = 2; at three corners df is 0 and every
         residual is 0 by construction, which says "nothing to check" and never "it fits". */
      const rs2 = f.residual;
      if (rs2) L.push(`  residual rms ${fmt(rs2.rms)} bpm² over df ${rs2.df} · worst pair ${worstPair(rs2.perPair)}`);
      /* EVERY THREE-CORNER SUBSET, BESIDE THE JOINT SOLVE. A corner the four-way reads as small
         and one subset reads as negative is a corner whose independence the design does not
         support, and that disagreement is visible only when each subset is published. */
      for (const sh of f.subHats || []) {
        L.push(`  sub-hat ${sh.names.join(' · ')} — ${sh.names.map((nm) => `${sh.sigma[nm] == null ? '—' : sh.sigma[nm].toFixed(3)}`).join(' · ')}${sh.reason ? ' (' + sh.reason + ')' : ''}`);
      }
      const sub = r.sameSecondsTrio;
      if (sub) {
        L.push(
          `  the classic hat on the SAME seconds — ${sub.names.map((nm) => `${nm} ${sub.sigma[nm] == null ? '—' : sub.sigma[nm].toFixed(3)}`).join(' · ')}${sub.reason ? ' (' + sub.reason + ')' : ''}`
        );
      }
      const rf = r.reference;
      if (rf && rf.ok) {
        L.push(
          `  against the night's firmware-RR reference over ${rf.n} s — ${TRIO_NAMES.map((nm) => `${nm} ${rf.sigma && rf.sigma[nm] == null ? '—' : Number(rf.sigma[nm]).toFixed(3)}`).join(' · ')} (the h10 figure is a LOWER BOUND, built from its own beats)`
        );
      } else if (rf) {
        L.push(`  no firmware-RR reference — ${rf.reason}`);
      }
      if (r.h10Unreliable || r.h10Fault) L.push(`  the page's H10 lead gate flags this night: ${r.h10Fault || 'unreliable'}`);
      if (r.three) {
        L.push(
          `  the night page's three-corner hat over its own ${r.threeWaySeconds} three-way seconds — ${TRIO_NAMES.map((nm) => `${nm} ${r.three[nm] == null ? '—' : Number(r.three[nm]).toFixed(3)}`).join(' · ')}`
        );
      }
    }
  }
  /* THE CORNER ORDERING, OVER THE WHOLE POPULATION. Two counts, because they answer two
     questions: did the fourth corner MOVE a corner, and does a corner stand where its own
     independent reference puts it. Read the direction, not the ratio — §3b names why. */
  const rd = referenceDirection(rows);
  const fs2 = fourthCornerShift(rows);
  if (TRIO_NAMES.some((nm) => rd[nm].n > 0)) {
    L.push('');
    L.push("corner ordering · the four-corner sigma against each night's own firmware reference");
    L.push('  ⚠ the reference is scored over the THREE-way overlap, so a ratio is not same-seconds; the per-night direction is the figure');
    for (const nm of TRIO_NAMES) {
      const d = rd[nm];
      if (!d.n) {
        L.push(`  ${nm.padEnd(8)} no night carries both a four-corner sigma and a reference sigma`);
        continue;
      }
      L.push(
        `  ${nm.padEnd(8)} above the reference on ${d.above}/${d.n} night(s) · median ratio ${fmt(d.medianRatio)}${nm === 'h10' ? ' (and the reference is a LOWER BOUND, so this understates it)' : ''}`
      );
    }
    L.push('  how far the FOURTH corner moved each corner off the same-seconds three-corner hat');
    for (const nm of TRIO_NAMES) {
      const s = fs2[nm];
      L.push(s.n ? `  ${nm.padEnd(8)} median |Δσ|/σ ${fmt(s.medianRelShift)} over ${s.n} night(s)` : `  ${nm.padEnd(8)} no night supports the comparison`);
    }
  }
  L.push('');
  for (const e of excluded) L.push(`EXCLUDED ${e.night} — ${e.reason}`);
  L.push('');
  L.push(`population checked ${verdict.population.checked} · excluded ${verdict.population.excluded} · eligible ${verdict.population.eligible}`);
  L.push(`status ${verdict.status}${verdict.reason ? ' — ' + verdict.reason : ''}`);
  return L;
}

function fmt(v) {
  return v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(3);
}

/** The pair whose dispersion the four-corner model fits worst, by absolute residual. PURE. */
export function worstPair(perPair) {
  const e = Object.entries(perPair || {});
  if (!e.length) return 'none';
  e.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return `${e[0][0]} ${e[0][1] > 0 ? '+' : ''}${e[0][1].toFixed(3)}`;
}

/** Corners the solve could not give a sigma, by name. A night with none returns an empty list. PURE. */
export function nullCorners(hat) {
  if (!hat || !hat.sigma) return [];
  return Object.keys(hat.sigma).filter((k) => hat.sigma[k] == null);
}

/* ── 8 · SELFTEST ─────────────────────────────────────────────────────────────────────────────
   Every assertion here is over a PURE function and a planted input. The realm and the corpus are
   out: a selftest which needs a 670 MB night cannot run in CI, and `pat-mask-census` learned
   that lesson the expensive way. */
function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
    }
  };
  console.log('tch-four-corner-census selftest');

  /* ── the stamp ── */
  ok('a 14-digit session stamp is read', stampOf('Polar_H10_02849638_20261121194041_ECG.txt') === '20261121194041');
  ok('a split stamp is read', stampOf('Muse_S-Athena_DAB_20261121_021514_RAW.txt') === '20261121021514');
  ok('a stamp-less name reads null, never a zero', stampOf('OXYLIFE.csv') === null);

  /* ── the role picker ── */
  const night = [
    { name: 'Polar_H10_AAA_20261121194041_ECG.txt', size: 342 },
    { name: 'Polar_H10_AAA_20261121194041_ECGRUNS.txt', size: 1 },
    { name: 'Polar_H10_AAA_20261121194041_RR.txt', size: 2 },
    { name: 'Polar_VeritySense_BBB_20261121193835_PPG.txt', size: 162 },
    { name: 'Polar_VeritySense_BBB_20261121193835_PPGRUNS.txt', size: 1 },
    { name: 'Wellue_O2Ring-S_CCC_20261121194125_SPO2.csv', size: 3 },
    { name: 'Muse_S-Athena_DDD_20261121194137_RAW.txt', size: 160 },
    { name: 'Muse_S-Athena_DDD_20261121194137_RAWRUNS.txt', size: 1 }
  ];
  const p = pickRoleFiles(night);
  ok('a complete night is eligible', nightEligible(p), JSON.stringify(p.missing));
  ok(
    'every required role is picked',
    ['h10ecg', 'verityPPG', 'o2', 'forehead'].every((k) => p.picked[k]),
    JSON.stringify(Object.keys(p.picked))
  );
  ok('the optional sidecars are picked too', !!(p.picked.foreheadRuns && p.picked.h10ecgRuns && p.picked.verityPPGRuns));
  ok('the firmware RR file is picked', p.picked.h10rr === 'Polar_H10_AAA_20261121194041_RR.txt');
  ok('one session per role leaves the two rules agreeing', p.largestNotPicked.length === 0, JSON.stringify(p.largestNotPicked));
  ok('the anchor is the ring session, as on the page', p.anchorStamp === '20261121194125', String(p.anchorStamp));

  /* a night with no Muse file is the three-corner night the page already solves */
  const three = night.filter((e) => !/^Muse_/.test(e.name));
  const p3 = pickRoleFiles(three);
  ok('a Muse-less night is NOT eligible', !nightEligible(p3));
  ok('the missing role is NAMED, never a count', p3.missing.join(',') === 'forehead', p3.missing.join(','));

  /* the two picks disagreeing must refuse by name rather than publish quietly */
  const twoSessions = night.concat([{ name: 'Muse_S-Athena_DDD_20261105010101_RAW.txt', size: 400 }]);
  const pd = pickRoleFiles(twoSessions);
  ok('the page rule picks the session NEAREST the ring', pd.picked.forehead === 'Muse_S-Athena_DDD_20261121194137_RAW.txt', String(pd.picked.forehead));
  ok('the larger far session is NAMED, never silently taken', pd.largestNotPicked.join(',') === 'forehead', pd.largestNotPicked.join(','));
  ok('the candidate count is published per role', pd.candidates.forehead === 2, String(pd.candidates.forehead));
  /* CONTROL — the same two files with the far session SMALLER leaves the two rules agreeing */
  const pq = pickRoleFiles(night.concat([{ name: 'Muse_S-Athena_DDD_20261105010101_RAW.txt', size: 1 }]));
  ok('a smaller far session names nothing', pq.largestNotPicked.length === 0, pq.largestNotPicked.join(','));
  ok('the near session is still the pick', pq.picked.forehead === 'Muse_S-Athena_DDD_20261121194137_RAW.txt', String(pq.picked.forehead));

  /* ── the same-seconds sub-hat ── */
  const four = {
    ok: true,
    names: FOUR_NAMES,
    sigma: { h10: 1, verity: 2, o2: 3, forehead: null },
    variance: { h10: 1, verity: 4, o2: 9, forehead: -2 },
    cornerReason: { h10: null, verity: null, o2: null, forehead: 'negative-variance' },
    seconds: 4000,
    spanMin: 70,
    residual: { rms: 0.5, df: 2, perPair: { 'h10|verity': -0.2, 'h10|o2': 0.7 } },
    subHats: [
      { names: ['h10', 'verity', 'forehead'], sigma: { h10: 1, verity: 2, forehead: null } },
      { names: ['h10', 'verity', 'o2'], sigma: { h10: 1.1, verity: 2.1, o2: 3.1 } }
    ]
  };
  const sub = sameSecondsSubHat(four);
  ok('the classic trio sub-hat is found', !!sub && sub.names.join(',') === 'h10,verity,o2');
  ok('a sub-hat table without the trio reads null', sameSecondsSubHat({ ok: true, subHats: [{ names: ['h10', 'verity', 'forehead'] }] }) === null);
  ok('an absent sub-hat table reads null, never an empty hat', sameSecondsSubHat({ ok: true }) === null);

  /* ── the criterion ── */
  ok('a named negative variance keeps the criterion', unnamedRefusals({ four }).length === 0, JSON.stringify(unnamedRefusals({ four })));
  const unnamed = JSON.parse(JSON.stringify(four));
  unnamed.cornerReason.forehead = null;
  ok('a null sigma with no reason BREAKS the criterion', unnamedRefusals({ four: unnamed }).length === 1, JSON.stringify(unnamedRefusals({ four: unnamed })));
  const repaired = JSON.parse(JSON.stringify(four));
  repaired.sigma.forehead = 1.4;
  ok(
    'a sigma over a negative variance BREAKS the criterion',
    unnamedRefusals({ four: repaired }).some((s) => /negative variance/.test(s)),
    JSON.stringify(unnamedRefusals({ four: repaired }))
  );
  ok('a named refusal keeps the criterion', unnamedRefusals({ four: { ok: false, reason: '12-s four-way overlap under the 1000-s floor' } }).length === 0);
  ok('an unnamed refusal BREAKS the criterion', unnamedRefusals({ four: { ok: false, reason: null } }).length === 1);
  ok('a missing result object BREAKS the criterion', unnamedRefusals({}).length === 1);

  /* ── the verdict and its population arithmetic ── */
  const rowOK = { night: '2026-11-21', four };
  const vp = censusVerdict({ rows: [rowOK], excluded: [], eligible: 1, walked: 20, commit: 'abc' });
  ok('a solved night passes', vp.status === 'PASS', vp.status + ' ' + vp.reason);
  ok('the population adds up', vp.population.checked + vp.population.excluded === vp.population.eligible);
  ok('the pre-stated criterion travels in the object', vp.criterion.name === 'nights_with_an_unnamed_refusal' && vp.criterion.threshold === 0);
  ok('the criterion hash travels in the result', vp.result.criterionSha256 === CRITERION_SHA256);
  ok('a PASS carries no reason', vp.reason === null);
  ok('the negative-variance corner is counted by name', vp.result.cornerReasons['forehead · negative-variance'] === 1, JSON.stringify(vp.result.cornerReasons));

  const vf = censusVerdict({ rows: [{ night: '2026-11-21', four: unnamed }], excluded: [], eligible: 1 });
  ok('an unnamed refusal FAILS the census', vf.status === 'FAIL', vf.status);
  ok('the FAIL names the night', /2026-11-21/.test(vf.reason), vf.reason);

  const vn = censusVerdict({ rows: [], excluded: [], eligible: 0, walked: 90 });
  ok('an empty population is NOT_RUN, never a PASS', vn.status === 'NOT_RUN', vn.status);
  ok('NOT_RUN carries a reason', !!vn.reason);
  ok('NOT_RUN reports checked 0', vn.population.checked === 0);
  ok('NOT_RUN measures nothing, so result is null', vn.result === null, JSON.stringify(vn.result));
  ok('every verdict declares its scope', vn.scope === 'internal' && vp.scope === 'internal');

  const vu = censusVerdict({ rows: [{ night: '2026-11-20', four: { ok: false, reason: '12-s four-way overlap under the 1000-s floor' } }], excluded: [], eligible: 1 });
  ok('a night under the floor is UNDERPOWERED', vu.status === 'UNDERPOWERED', vu.status);
  ok('the floor refusal is counted by its CLASS', vu.result.refusalsByReason['N-s four-way overlap under the N-s floor'] === 1, JSON.stringify(vu.result.refusalsByReason));

  const vx = censusVerdict({ rows: [], excluded: [{ night: '2026-11-19', reason: 'the night directory is unreadable' }], eligible: 1 });
  ok('an unreadable eligible night is UNKNOWN', vx.status === 'UNKNOWN', vx.status);
  ok('the excluded night is named in the result', vx.result.excludedNights[0].night === '2026-11-19');
  ok('exclusion keeps the arithmetic', vx.population.checked + vx.population.excluded === vx.population.eligible);

  /* a mixed census: one solved, one refused by name */
  const vm2 = censusVerdict({ rows: [rowOK, { night: '2026-11-20', four: { ok: false, reason: '12-s four-way overlap under the 1000-s floor' } }], excluded: [], eligible: 2 });
  ok('one solved night with one named refusal passes', vm2.status === 'PASS', vm2.status);
  ok('the solved and refused counts are both published', vm2.result.nightsSolved === 1 && vm2.result.nightsRefused === 1);

  /* ── the remote listing parser ── */
  const rl = parseRemoteListing('2026-11-21/Polar_H10_AAA_20261121194041_ECG.txt 342\n2026-11-21/OXYLIFE.csv 7\nnot a line\n2026-11-20/x 1\n');
  ok('the remote listing groups by night', rl.length === 2 && rl[0].night === '2026-11-20');
  ok('a size is read as a number', rl[1].entries.find((e) => /ECG/.test(e.name)).size === 342);
  ok('a name with a space survives', parseRemoteListing('2026-11-21/a b.txt 5\n')[0].entries[0].name === 'a b.txt');
  ok('an unparseable line is dropped, never counted', rl[1].entries.length === 2, String(rl[1].entries.length));

  /* ── the shell quoter ── */
  ok('a plain path quotes', shq('/srv/tepna/captures') === `'/srv/tepna/captures'`);
  ok('an embedded quote cannot escape', shq(`a'b`) === `'a'\\''b'`);

  /* ── the row shape carries no file name ── */
  const row = nightRow('2026-11-21', p, { four, sigma: { h10: 1, verity: 2, o2: 3 }, n: 9000 });
  ok('the row keys on the night alone', row.night === '2026-11-21');
  ok('no row field holds a file name', !JSON.stringify(row).includes('Polar_H10_AAA'), JSON.stringify(row).slice(0, 120));
  ok('the row publishes both hats', !!row.four && !!row.sameSecondsTrio && !!row.three);
  ok('the row publishes the four-way second count and span', row.fourSeconds === 4000 && row.fourSpanMin === 70);
  ok('the row carries the session divergence', Array.isArray(row.largestNotPicked));
  ok('an absent reference reads null, never an empty object', row.reference === null);
  const rowR = nightRow('2026-11-24', p, { four, reference: { ok: true, n: 800, sigma: { h10: 1, verity: 2, o2: 3 } }, h10Fault: 'lead off', neg: true });
  ok('the reference travels on the row', rowR.reference.n === 800);
  ok('the page H10 gate travels on the row', rowR.h10Fault === 'lead off');
  ok('the page negative-variance flag travels as a boolean', rowR.threeWayNegative === true);
  const lr = reportLines([rowR], [], vp).join('\n');
  ok('the prose names the reference as a lower bound for the chest corner', /LOWER BOUND/.test(lr));
  ok('the prose names a flagged lead', /H10 lead gate flags this night: lead off/.test(lr));
  const lr2 = reportLines([nightRow('x', p, { four, reference: { ok: false, reason: 'no H10 _RR.txt was selected for this night' } })], [], vp).join('\n');
  ok('a refused reference is NAMED, never dropped', /no firmware-RR reference — no H10 _RR.txt/.test(lr2));
  /* ── the corner ordering (§3b) ── */
  ok('median over an empty list is null, never 0', median([]) === null);
  ok('median takes the mean of the middle pair on an even count', median([1, 2, 3, 4]) === 2.5);
  /* a corner the hat reads at 2 against a reference of 1 is ABOVE it; the reference of 4 is not */
  const rdRows = [
    nightRow('a', p, {
      four: { ok: true, seconds: 4000, spanMin: 70, names: FOUR_NAMES, sigma: { h10: 2, verity: 1, o2: 3, forehead: 1 }, subHats: [] },
      reference: { ok: true, n: 9000, sigma: { h10: 1, verity: 4, o2: 3 } }
    }),
    nightRow('b', p, {
      four: { ok: true, seconds: 4000, spanMin: 70, names: FOUR_NAMES, sigma: { h10: 6, verity: 1, o2: 3, forehead: 1 }, subHats: [] },
      reference: { ok: true, n: 9000, sigma: { h10: 2, verity: 4, o2: 3 } }
    })
  ];
  const rd = referenceDirection(rdRows);
  ok('the chest corner is counted above its reference on both nights', rd.h10.above === 2 && rd.h10.below === 0, JSON.stringify(rd.h10));
  ok('the chest median ratio is the median of the per-night ratios', rd.h10.medianRatio === 2.5, String(rd.h10.medianRatio));
  ok('a corner under its reference counts BELOW, never above', rd.verity.above === 0 && rd.verity.below === 2);
  ok('an equal pair is not counted as above', rd.o2.above === 0 && rd.o2.below === 2);
  ok('a night with no reference contributes to no count', referenceDirection([nightRow('c', p, { four })]).h10.n === 0);
  ok(
    'a zero reference sigma is skipped, never divided by',
    referenceDirection([
      nightRow('d', p, {
        four: { ok: true, seconds: 4000, spanMin: 70, names: FOUR_NAMES, sigma: { h10: 2, verity: 1, o2: 3, forehead: 1 }, subHats: [] },
        reference: { ok: true, n: 9000, sigma: { h10: 0, verity: 1, o2: 1 } }
      })
    ]).h10.n === 0
  );
  const rdL = reportLines(rdRows, [], vp).join('\n');
  ok('the prose names the per-night direction', /h10 {6}above the reference on 2\/2 night\(s\)/.test(rdL), rdL.slice(rdL.indexOf('corner ordering'), rdL.indexOf('corner ordering') + 300));
  ok('the prose carries the differing-span caveat beside the ratio', /not same-seconds; the per-night direction is the figure/.test(rdL));
  ok('the prose says the chest reference understates the gap', /LOWER BOUND, so this understates it/.test(rdL));
  ok('the ordering block is absent when no night carries a reference', !/corner ordering/.test(reportLines([nightRow('c', p, { four })], [], vp).join('\n')));
  /* the fourth corner's own displacement: sigma 2 against a same-seconds trio sigma of 1 is 1.0 */
  const fsh = fourthCornerShift([
    nightRow('e', p, {
      four: { ok: true, seconds: 4000, spanMin: 70, names: FOUR_NAMES, sigma: { h10: 2, verity: 1, o2: 3, forehead: 1 }, subHats: [{ names: TRIO_NAMES, sigma: { h10: 1, verity: 1, o2: 3 } }] }
    })
  ]);
  ok('the fourth-corner shift is relative to the same-seconds trio', fsh.h10.medianRelShift === 1 && fsh.verity.medianRelShift === 0, JSON.stringify(fsh.h10));
  ok(
    'the verdict publishes both aggregates and the span caveat',
    (() => {
      const v = censusVerdict({ rows: rdRows, excluded: [], eligible: 2 });
      return !!v.result.referenceDirection && !!v.result.fourthCornerShift && /not the four-way one/.test(v.result.referenceSpanCaveat);
    })()
  );
  ok('a NOT_RUN still publishes no aggregate', censusVerdict({ rows: [], excluded: [], eligible: 0 }).result === null);

  /* ── NEARNESS IS A TIME, not digit arithmetic over the stamp ── */
  const P = clockParse();
  ok('a name stamp reads as a real instant through the one parser', stampMsOf('Muse_x_20261121194125_RAW.txt', P) === Date.UTC(2026, 10, 21, 19, 41, 25));
  ok('an impossible stamp is null, never a rolled date', stampMsOf('Muse_x_20261132194125_RAW.txt', P) === null);
  ok('a name with no stamp is null', stampMsOf('Muse_RAW.txt', P) === null);
  /* THE INVERSION THE DIGIT FORM GOT WRONG. Anchor 19:59:59; one candidate one second later across
     the minute-and-hour boundary, one ten minutes earlier. The digit difference ranks the 1-second
     file at 40041 and the 10-minute file at 959, so the old rule picked the FAR one. */
  const invEntries = [
    { name: 'O2Ring_20261121195959_SPO2.csv', size: 500 },
    { name: 'Polar_H10_A_20261121195959_ECG.txt', size: 100 },
    { name: 'Polar_VeritySense_A_20261121200000_PPG.txt', size: 100 },
    { name: 'Polar_VeritySense_A_20261121195000_PPG.txt', size: 100 },
    { name: 'Muse_A_20261121195959_RAW.txt', size: 100 }
  ];
  const invPick = pickRoleFiles(invEntries, P);
  ok('the nearest wrist file is the one a SECOND away, not the one ten minutes away', invPick.picked.verityPPG === 'Polar_VeritySense_A_20261121200000_PPG.txt', String(invPick.picked.verityPPG));
  ok(
    'REGRESSION · the digit form it replaced would have picked the far file',
    Math.abs(Number('20261121200000') - Number('20261121195959')) > Math.abs(Number('20261121195000') - Number('20261121195959'))
  );
  ok('the anchor instant travels on the pick beside its stamp', invPick.anchorMs === Date.UTC(2026, 10, 21, 19, 59, 59) && invPick.anchorStamp === '20261121195959');
  ok('the nearness basis is NAMED, because the page prefers the first data row', invPick.nearnessBasis === 'name-stamp');
  ok('ten minutes apart is NOT a close call, so the window does not cry wolf', !invPick.closeCalls.includes('verityPPG'), JSON.stringify(invPick.closeCalls));
  /* A GENUINE CLOSE CALL: two wrist sessions two seconds apart, where the page's preference for the
     first data row (median 3.9 s off the name) could choose the other one. */
  const ccPick = pickRoleFiles(
    [
      { name: 'O2Ring_20261121195959_SPO2.csv', size: 500 },
      { name: 'Polar_H10_A_20261121195959_ECG.txt', size: 100 },
      { name: 'Polar_VeritySense_A_20261121200000_PPG.txt', size: 100 },
      { name: 'Polar_VeritySense_A_20261121200002_PPG.txt', size: 100 },
      { name: 'Muse_A_20261121195959_RAW.txt', size: 100 }
    ],
    P
  );
  ok('two candidates inside the close-call window are reported', ccPick.closeCalls.includes('verityPPG'), JSON.stringify(ccPick.closeCalls));
  ok('…and the nearer of the two is still the pick', ccPick.picked.verityPPG === 'Polar_VeritySense_A_20261121200000_PPG.txt', String(ccPick.picked.verityPPG));
  /* THE RR IS PAIRED WITH THE ECG, as the page pairs it. The ring anchor sits three hours off the
     ECG here, so a ring-anchored RR pick would take the other session's beats. */
  const rrEntries = [
    { name: 'O2Ring_20261121160000_SPO2.csv', size: 500 },
    { name: 'Polar_H10_A_20261121190000_ECG.txt', size: 100 },
    { name: 'Polar_H10_A_20261121190001_RR.txt', size: 100 },
    { name: 'Polar_H10_A_20261121160500_RR.txt', size: 900 },
    { name: 'Polar_VeritySense_A_20261121190000_PPG.txt', size: 100 },
    { name: 'Muse_A_20261121190000_RAW.txt', size: 100 }
  ];
  const rrPick = pickRoleFiles(rrEntries, P);
  ok('the firmware RR is chosen nearest the ECG, never nearest the ring', rrPick.picked.h10rr === 'Polar_H10_A_20261121190001_RR.txt', String(rrPick.picked.h10rr));
  ok('…and the larger RR of the other session is reported as the largest not picked', rrPick.largestNotPicked.includes('h10rr'), JSON.stringify(rrPick.largestNotPicked));
  /* A ROOT WITH NO READABLE ANCHOR falls back to the largest file, which is the page's own branch. */
  const noAnchor = pickRoleFiles(
    [
      { name: 'O2Ring_nostamp_SPO2.csv', size: 10 },
      { name: 'Polar_H10_A_nostamp_ECG.txt', size: 10 },
      { name: 'Polar_VeritySense_A_20261121190000_PPG.txt', size: 10 },
      { name: 'Polar_VeritySense_A_20261121200000_PPG.txt', size: 99 },
      { name: 'Muse_A_20261121190000_RAW.txt', size: 10 }
    ],
    P
  );
  ok('with no readable anchor the largest file is taken, as the page does', noAnchor.picked.verityPPG === 'Polar_VeritySense_A_20261121200000_PPG.txt' && noAnchor.anchorMs === null);

  /* ── ONE WALK: the population comes off the listing, not off a second enumeration ── */
  const treeFix = [
    { night: '2026-11-15', entries: [] },
    { night: '2026-11-16', entries: [] }
  ];
  const snapT = treeSnapshot('/srv/tepna/captures', treeFix, '2026-11-26T00:00:00Z');
  ok('the snapshot counts the nights of the listing it was given', snapT.ok && snapT.n === 2, JSON.stringify({ ok: snapT.ok, n: snapT.n }));
  ok('its members are the night names, in the snapshot shape', JSON.stringify(snapT.members) === JSON.stringify(['2026-11-15', '2026-11-16']), JSON.stringify(snapT.members));
  ok('the unit is nights, so the criterion reads nights_added_or_removed', snapT.unit === 'nights', String(snapT.unit));
  ok('the snapshot NAMES the lister that chose the population', snapT.rule === 'listWalkedNights', String(snapT.rule));
  /* the lister must not re-walk: handed an empty listing it reports an empty population and never
     reaches a disk, which is what makes the population and the scored set the same listing */
  ok('an empty listing is an empty population, not a walk of the root', treeSnapshot('/nonexistent-root-xyz', [], '2026-11-26T00:00:00Z').n === 0);
  const popS = populationVerdict(treeSnapshot('/r', treeFix, '2026-11-26T00:00:00Z'), treeSnapshot('/r', [treeFix[0]], '2026-11-26T00:01:00Z'), { tool: TOOL, evidence: [TOOL], commit: 'abc1234' });
  ok('a night that LEFT mid-run is a SHORTFALL, never a silent narrowing', popS.status === 'SHORTFALL', popS.status + ' — ' + popS.reason);
  ok(
    'the intersection names the night both listings held',
    JSON.stringify(intersectSnapshots(treeSnapshot('/r', treeFix), treeSnapshot('/r', [treeFix[0]])).members) === JSON.stringify(['2026-11-15'])
  );
  const vPop = censusVerdict({ rows: rdRows, excluded: [], eligible: 2, popStability: popS, dropped: ['2026-11-16'] });
  ok('the verdict carries the population move and the nights it cost', vPop.result.populationStability.status === 'SHORTFALL' && vPop.result.nightsDroppedForPopulationMove[0] === '2026-11-16');
  ok('a run whose population held still carries a null move, never a fabricated PASS', censusVerdict({ rows: rdRows, excluded: [], eligible: 2 }).result.populationStability === null);

  const rowD = nightRow('2026-11-21', pd, { four });
  ok('the prose names a multi-session role', /more than one session for forehead/.test(reportLines([rowD], [], vp).join('\n')));

  /* ── the report prose ── */
  const lines = reportLines([row], [{ night: '2026-11-19', reason: 'unreadable' }], vp).join('\n');
  ok('the prose names the negative-variance corner', /negative-variance/.test(lines));
  ok('the prose gives the covered span beside the count', /4000 s over 70 min/.test(lines));
  ok('the prose names the excluded night', /EXCLUDED 2026-11-19/.test(lines));
  ok('the prose carries the criterion hash', lines.includes(CRITERION_SHA256));
  ok('the prose publishes the residual with its df', /residual rms 0\.500 bpm² over df 2/.test(lines), lines);
  ok('the prose names the worst-fitting pair', /worst pair h10\|o2 \+0\.700/.test(lines), lines);
  ok('the prose publishes every sub-hat', (lines.match(/sub-hat /g) || []).length === 2);
  ok('the worst pair of an empty table reads none', worstPair({}) === 'none');
  ok('the worst pair is chosen by MAGNITUDE, not by sign', worstPair({ a: 0.1, b: -0.9 }) === 'b -0.900');
  ok('a null corner is named', nullCorners(four).join(',') === 'forehead');
  ok('a night with every corner solved names none', nullCorners({ sigma: { h10: 1, verity: 2 } }).length === 0);
  ok('the prose holds no file name', !lines.includes('Polar_H10_AAA'));

  if (fail === 0) console.log(`\n✓ all ${pass} selftests passed`);
  else console.log(`\n✗ selftest — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

/* ── 9 · CLI ──────────────────────────────────────────────────────────────────────────────── */
async function main() {
  refuseUnknownArgvOrExit({
    boolean: ['--selftest', '--json', '--verdict-sample'],
    valued: ['--captures', '--host', '--night', '--scratch', '--limit']
  });
  const argv = process.argv;
  const arg = (k, d = null) => {
    const i = argv.indexOf(k);
    return i > 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(censusVerdict({ rows: [], excluded: [], eligible: 0, walked: 0 }), null, 1));
    return;
  }
  const captures = arg('--captures');
  const host = arg('--host');
  const only = arg('--night');
  /* §∅ AN ABSENT `--limit` IS NO LIMIT, WHICH IS NOT A LIMIT OF ZERO. `Number(x) || 0` collapsed
     both an absent flag and an unreadable one onto 0, and 0 then read as a legal "take none". */
  const limitRaw = arg('--limit');
  const limit = limitRaw == null ? null : Number(limitRaw);
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) {
    console.error(`--limit must be a whole number of nights above 0; got ${JSON.stringify(limitRaw)}`);
    process.exit(2);
  }
  const scratch = arg('--scratch', join(process.env.TMPDIR || '/tmp', 'tch4-census'));
  if (!captures) {
    console.error('usage: --captures <dir> [--host <host>] [--night <YYYY-MM-DD>] [--scratch <dir>] [--limit N]');
    process.exit(2);
  }
  const commit = (() => {
    try {
      return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  })();

  /* ONE WALK, AND THE POPULATION IS DERIVED FROM IT — never re-enumerated. Both the night set this
     census publishes and the files it scores come off `tree`, the single listing. The snapshot is
     taken FROM that listing rather than from a second walk, which is the defect measured on
     `tools/tch-firmware-reference.mjs` 2026-10-21: a night arriving between two walks was scored
     into a figure whose population never saw it. */
  const tree = host ? listRemote(host, captures) : listLocal(captures);
  const popBefore = treeSnapshot(captures, tree);
  const walked = tree.length;
  const picks = tree.map((n) => ({ night: n.night, pick: pickRoleFiles(n.entries) }));
  let eligibleNights = picks.filter((x) => nightEligible(x.pick));
  if (only) eligibleNights = eligibleNights.filter((x) => x.night === only);
  if (limit != null) eligibleNights = eligibleNights.slice(0, limit);
  console.error(`walked ${walked} night(s) under ${captures}${host ? ' on ' + host : ''} · ${eligibleNights.length} hold all four corner roles`);

  const rows = [];
  const excluded = [];
  for (const { night, pick } of eligibleNights) {
    let dir = join(captures, night);
    let staged = null;
    try {
      if (host) {
        staged = join(scratch, night);
        fs.mkdirSync(staged, { recursive: true });
        const names = Object.values(pick.picked);
        console.error(`  ${night} · copying ${names.length} file(s) from ${host}`);
        execFileSync('rsync', ['-a', '--', ...names.map((n) => `${host}:${join(captures, night, n)}`), staged + '/'], { stdio: ['ignore', 'ignore', 'inherit'] });
        dir = staged;
      }
      console.error(`  ${night} · solving`);
      const { res } = await solveNight(dir, pick, ROOT);
      rows.push(nightRow(night, pick, res));
    } catch (e) {
      excluded.push({ night, reason: 'the census could not read this night: ' + String((e && e.message) || e).slice(0, 200) });
    } finally {
      if (staged) fs.rmSync(staged, { recursive: true, force: true });
    }
  }

  /* THE CLOSING POPULATION. A census of eleven nights runs about forty minutes against a capture
     box that is still recording, so the root genuinely moves under it. A night that arrived mid-run
     is not scored into a population that was blind to it, and one that left is not counted present. */
  const popAfter = treeSnapshot(captures, host ? listRemote(host, captures) : listLocal(captures));
  const popStability = populationVerdict(popBefore, popAfter, { commit, tool: TOOL, evidence: [TOOL] });
  if (popStability.status !== 'PASS') console.error(`population: ${popStability.reason}`);
  let scored = rows;
  let dropped = [];
  if (popStability.status === 'SHORTFALL') {
    const keep = new Set(intersectSnapshots(popBefore, popAfter).members);
    dropped = rows.filter((r) => !keep.has(r.night)).map((r) => r.night);
    scored = rows.filter((r) => keep.has(r.night));
    if (dropped.length) console.error(`population: ${dropped.length} night(s) left out of every figure: ${dropped.join(', ')}`);
  }
  console.error(`POPULATION ${popStability.status} · ${walked} night(s) walked under ${captures} · ${scored.length} scored`);
  const verdict = censusVerdict({ rows: scored, excluded, eligible: eligibleNights.length, walked, commit, popStability, dropped });
  console.error('\n' + reportLines(scored, excluded, verdict).join('\n') + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify({ verdict, rows: scored, populationStability: popStability, droppedForPopulationMove: dropped }, null, 1));
  else console.log(JSON.stringify(verdict));
}

if (isCliEntry(import.meta.url)) await main();
