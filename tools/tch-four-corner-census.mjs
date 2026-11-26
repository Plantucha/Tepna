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
/**
 * @param {Array<{name:string,size:number}>} entries
 * @returns {{picked:Object,missing:string[],candidates:Object,anchorStamp:string|null,largestNotPicked:string[]}}
 */
export function pickRoleFiles(entries) {
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
  const nearest = (a) => {
    if (!a.length || anchorStamp == null) return null;
    const scored = a
      .map((e) => ({ e, s: stampOf(e.name) }))
      .filter((x) => x.s != null)
      .map((x) => ({ e: x.e, d: Math.abs(Number(x.s) - Number(anchorStamp)) }));
    if (!scored.length) return null;
    scored.sort((p, q) => p.d - q.d || q.e.size - p.e.size);
    return scored[0].e;
  };
  const picked = {};
  const candidates = {};
  const missing = [];
  const disagree = [];
  for (const r of ROLES) {
    const a = byRole[r.key];
    candidates[r.key] = a.length;
    const big = biggest(a);
    const near = nearest(a);
    if (!big) {
      if (r.required) missing.push(r.key);
      continue;
    }
    if (near && near.name !== big.name) disagree.push(r.key);
    picked[r.key] = (near || big).name;
  }
  return { picked, missing, candidates, anchorStamp, largestNotPicked: disagree };
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
 * @param {{rows:Array,excluded:Array,eligible:number,walked:number,at?:string,commit?:string}} a
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

/** Every named four-corner refusal, counted by its reason. A solved night contributes nothing. PURE. */
export function countReasons(rows) {
  const out = {};
  for (const r of rows || []) {
    const four = r.four;
    if (!four || four.ok) continue;
    const key = normalizeReason(four.reason);
    out[key] = (out[key] || 0) + 1;
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
      out[k] = (out[k] || 0) + 1;
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
export function listLocal(root) {
  const out = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue;
    const entries = [];
    for (const f of fs.readdirSync(join(root, d.name), { withFileTypes: true })) {
      if (!f.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(join(root, d.name, f.name)).size;
      } catch {
        size = 0;
      }
      entries.push({ name: f.name, size });
    }
    out.push({ night: d.name, entries });
  }
  return out.sort((a, b) => a.night.localeCompare(b.night));
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
  const limit = Number(arg('--limit', '0')) || 0;
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

  const tree = host ? listRemote(host, captures) : listLocal(captures);
  const walked = tree.length;
  const picks = tree.map((n) => ({ night: n.night, pick: pickRoleFiles(n.entries) }));
  let eligibleNights = picks.filter((x) => nightEligible(x.pick));
  if (only) eligibleNights = eligibleNights.filter((x) => x.night === only);
  if (limit) eligibleNights = eligibleNights.slice(0, limit);
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

  const verdict = censusVerdict({ rows, excluded, eligible: eligibleNights.length, walked, commit });
  console.error('\n' + reportLines(rows, excluded, verdict).join('\n') + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify({ verdict, rows }, null, 1));
  else console.log(JSON.stringify(verdict));
}

if (isCliEntry(import.meta.url)) await main();
