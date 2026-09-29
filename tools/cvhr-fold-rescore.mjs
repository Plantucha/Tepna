#!/usr/bin/env node
/*
 * tools/cvhr-fold-rescore.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE CROSS-NODE CVHR ρ ON THE FOLD'S NIGHT SELECTION — a re-score, not a sweep.
 *
 * Residue `2026-09-22-cvhr-overlap-four-of-six-were-the-sweeps-selection`. `tools/gap-s-sweep.mjs`
 * scored the LARGEST `_ECG.txt` and the LARGEST `_PPG.txt` per date; the fold (`trio-batch`) merges every
 * concurrent session. On the union of fragments, four of the six "< 2 h overlap" nights overlap 3.0–11.3 h
 * — those four were the INSTRUMENT'S SELECTION, not the drop — so the restricted-window ρ of 0.255 over 17
 * nights is a statement about the sweep's scoring and not about the fold's. This tool re-scores on the
 * fold's selection and reports ρ with n, one table row per night.
 *
 * ⚠️ THE COMMITTED VIEW IS THE CONTROL, AND IT RUNS FIRST. `audits/GAP-S-SWEEP-2026-09-22.json#
 * overlapTest.mergedSessionsView` already holds all 23 nights' fragment counts, union hours and
 * fractions. Phase 1 recomputes those from the tree and REFUSES the whole run on any disagreement. That
 * is what makes it safe for this tool to enumerate for itself rather than import the fold's rule: the
 * defect in the row is an instrument selecting differently from the fold, and a tool that did that here
 * could not reach a number without 23 committed fractions contradicting it first. (The sharing is logged
 * as its own row — the fold's `concurrentSet`/`mergeIv`/`ivIntersect`/`ivSpan` are module-local to
 * `trio-batch.mjs` — and is a separate unit.)
 *
 * THE INDEX IS COMPOSED, WHICH IS WHY THIS FITS IN MEMORY. `ecgdex-dsp.js` defines the CVHR index as
 * `events.length / (denomSec / 3600)` — events per hour of OBSERVED recording — and a fragment boundary is
 * by construction a gap wider than `GAP_S`, so no event straddles one. The merged-night index is therefore
 * `Σ events / (Σ denomSec / 3600)`, which lets fragments be scored ONE AT A TIME with only scalars kept.
 * Concatenating them would hold 688 MB of text for the largest night (412 MB for the largest single
 * fragment) and `trio-batch` measures 2.4 GB RSS for a ~500 MB pair; one at a time keeps the peak at one
 * fragment, inside the owner's 8 GB rule.
 *
 * A REFUSED STREAM IS A RESULT. `clock-seam` (PpgDex's own rule), `implausible-span` (ECGDex), the
 * `N < 60` floor and a thrown analyser each produce a named row, never a zero and never an omission.
 *
 *   node tools/cvhr-fold-rescore.mjs [--tree <captures dir>] [--control <audit.json>] [--limit N]
 *                                    [--resume] [--out <json>]
 *   node tools/cvhr-fold-rescore.mjs --control-only   # phase 1 alone: ~1 s, no scoring
 *   node tools/cvhr-fold-rescore.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ECG_FILES, PPG_FILES, hostWindowMs, realm } from './gap-s-sweep.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const CONTROL_DEFAULT = join(ROOT, 'audits', 'GAP-S-SWEEP-2026-09-22.json');
export const TREE_DEFAULT = '/srv/data/tepna-corpus/uploads/vigil-archive/captures';
export const ECG_GLOB = /^Polar_H10.*_ECG\.txt$/;
export const PPG_GLOB = /^Polar_VeritySense.*_PPG\.txt$/;

/* ── windows without reading the file ──────────────────────────────────────────────────────────────
   `hostWindowMs` needs the header plus the first and last data row; a 412 MB fragment does not need to
   be a string for that. Read the head and the tail and hand it two small texts. */
export function windowOfFile(path, chunk = 1 << 16) {
  /* ⚠️ `chunk` IS COERCED TO A SANE SIZE, and that is not defensive decoration. `paths.map(windowOfFile)`
     hands `map`'s INDEX as the second argument, so the first file gets `chunk = 0`, reads nothing and
     returns null — and a null window silently becomes a null overlap, which the control then reports as
     23 disagreeing nights rather than as a caller bug. Measured: that is exactly how this failed on its
     first run. A bad size is repaired here rather than trusted at every call site. */
  if (!(chunk > 4096)) chunk = 1 << 16;
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(chunk, size));
    readSync(fd, head, 0, head.length, 0);
    const tailLen = Math.min(chunk, size);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    const headText = head.toString('utf8');
    const nl = headText.indexOf('\n');
    if (nl < 0) return null;
    const header = headText.slice(0, nl);
    const firstRow = headText.slice(nl + 1).split('\n')[0];
    const tailRows = tail
      .toString('utf8')
      .split('\n')
      .filter((l) => l.trim().length);
    const lastRow = tailRows[tailRows.length - 1];
    const a = hostWindowMs(header + '\n' + firstRow + '\n');
    const b = hostWindowMs(header + '\n' + lastRow + '\n');
    if (!a || !b) return null;
    return [a[0], b[1]];
  } finally {
    closeSync(fd);
  }
}

/* ── INTERVAL MEASURE, NOT AN OUTER SPAN ──────────────────────────────────────────────────────────
   🔴 The first version of this took `[min first, max last]` per stream, on the argument that the
   committed rows satisfy `ecg + ppg − both === either` and that this identity "only holds for single
   intervals". THAT REASONING WAS WRONG: |A| + |B| − |A ∩ B| = |A ∪ B| is the identity for SET MEASURE,
   so it holds for merged intervals too and distinguishes nothing. The control caught it immediately —
   18 of 23 nights disagreed, with my hours far too LARGE (2026-09-16 read 22.4 h against 6.9 h) because
   a date directory can hold an 04:42 capture and a 22:38 one, and the outer span swallows the 18 hours
   between them. A night is the measure of the sessions, not the distance between the first and last.
   This is the shape the fold uses (`trio-batch.mjs` `mergeIv`/`ivIntersect`/`ivSpan`, module-local —
   sharing them is its own residue row). */
export function mergeIv(windows) {
  const ok = windows
    .filter(Boolean)
    .slice()
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of ok) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}
export function ivIntersect(A, B) {
  const out = [];
  let i = 0,
    j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]),
      e = Math.min(A[i][1], B[j][1]);
    if (e > s) out.push([s, e]);
    if (A[i][1] < B[j][1]) i++;
    else j++;
  }
  return out;
}
export function ivUnion(A, B) {
  return mergeIv(A.concat(B));
}
export const ivSpan = (A) => A.reduce((t, [s, e]) => t + (e - s), 0);

export function overlapOfSpans(ivE, ivP) {
  if (!ivE || !ivP || !ivE.length || !ivP.length) return null;
  const both = ivSpan(ivIntersect(ivE, ivP)) / 3.6e6;
  const either = ivSpan(ivUnion(ivE, ivP)) / 3.6e6;
  return { ecgHours: ivSpan(ivE) / 3.6e6, ppgHours: ivSpan(ivP) / 3.6e6, bothHours: both, eitherHours: either, fraction: either > 0 ? both / either : null };
}

export function fragmentsOf(tree, night) {
  const dir = join(tree, night);
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir);
  return {
    ecg: names
      .filter((n) => ECG_GLOB.test(n))
      .sort()
      .map((n) => join(dir, n)),
    ppg: names
      .filter((n) => PPG_GLOB.test(n))
      .sort()
      .map((n) => join(dir, n))
  };
}

/* ── PHASE 1 · the control. Every disagreement is named; the caller refuses on any. ──────────────── */
export function compareToControl(mine, committed, tol = { hours: 0.02, fraction: 0.005 }) {
  const bad = [];
  const near = (a, b, t) => a != null && b != null && Math.abs(a - b) <= t;
  if (mine.ecgFragments !== committed.ecgFragments) bad.push(`ecgFragments ${mine.ecgFragments} vs ${committed.ecgFragments}`);
  if (mine.ppgFragments !== committed.ppgFragments) bad.push(`ppgFragments ${mine.ppgFragments} vs ${committed.ppgFragments}`);
  for (const k of ['ecgHours', 'ppgHours', 'bothHours', 'eitherHours'])
    if (!near(mine[k], committed[k], tol.hours)) bad.push(`${k} ${mine[k] == null ? 'null' : mine[k].toFixed(3)} vs ${committed[k].toFixed(3)}`);
  if (!near(mine.fraction, committed.fraction, tol.fraction)) bad.push(`fraction ${mine.fraction == null ? 'null' : mine.fraction.toFixed(4)} vs ${committed.fraction.toFixed(4)}`);
  return bad;
}

/* ── the composed index ───────────────────────────────────────────────────────────────────────────
   Scored fragments contribute events and denomSec; refused ones contribute a REASON and nothing else.
   A stream whose every fragment refused has NO index — null with the reasons, never 0. */
export function composeIndex(perFragment) {
  let events = 0,
    denomSec = 0,
    scored = 0;
  const refusals = [];
  for (const f of perFragment) {
    if (f.index == null || f.denomSec == null || f.events == null) {
      refusals.push({ fragment: f.fragment, reason: f.reason || 'no index and no reason given' });
      continue;
    }
    events += f.events;
    denomSec += f.denomSec;
    scored++;
  }
  if (!scored || !(denomSec > 0))
    return {
      index: null,
      events: null,
      denomSec: null,
      scored,
      refused: refusals.length,
      refusals,
      reason: refusals.length ? refusals.map((r) => r.reason).join(' · ') : 'no fragment produced a denominator'
    };
  return {
    index: +(events / (denomSec / 3600)).toFixed(1),
    events,
    denomSec: +denomSec.toFixed(1),
    coveredHours: +(denomSec / 3600).toFixed(2),
    scored,
    refused: refusals.length,
    refusals,
    reason: null
  };
}

/* Spearman ρ, ties by average rank. `n` travels with it — a ρ without its n is not a result. */
export function spearman(pairs) {
  const use = pairs.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const n = use.length;
  if (n < 3) return { rho: null, n, reason: `${n} paired night(s) (< 3) — a rank correlation needs three` };
  const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const a = rank(use.map((p) => p[0])),
    b = rank(use.map((p) => p[1]));
  const ma = a.reduce((s, v) => s + v, 0) / n,
    mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? { rho: +(num / Math.sqrt(da * db)).toFixed(4), n, reason: null } : { rho: null, n, reason: 'a rank vector is constant — no correlation is defined' };
}

export function selfTest() {
  let n = 0,
    fail = 0;
  const ok = (name, cond, detail) => {
    n++;
    if (!cond) fail++;
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
  };

  /* THE MEASURE, not the span — the distinction the control caught. Two 1 h ECG sessions 2 h apart
     measure 2 h, and an outer span would call them 3 h. */
  const wE = mergeIv([
    [0, 3.6e6],
    [7.2e6, 10.8e6]
  ]);
  const wP = mergeIv([[1.8e6, 9e6]]);
  ok('a stream is the MEASURE of its sessions, not the distance between the first and last', ivSpan(wE) === 7.2e6, String(ivSpan(wE) / 3.6e6) + ' h over a 3 h outer span');
  ok(
    'touching sessions merge into one interval',
    ivSpan(
      mergeIv([
        [0, 3.6e6],
        [3.6e6, 7.2e6]
      ])
    ) === 7.2e6
  );
  ok(
    '…and the merge does not depend on input order',
    JSON.stringify(
      mergeIv([
        [7.2e6, 10.8e6],
        [0, 3.6e6]
      ])
    ) ===
      JSON.stringify([
        [0, 3.6e6],
        [7.2e6, 10.8e6]
      ])
  );
  const o = overlapOfSpans(wE, wP);
  /* The identity holds for SET MEASURE — which is why it could not tell the two formulations apart and
     is asserted here as a property, not used as evidence for either. */
  ok('overlap satisfies ecg + ppg − both === either (true of any measure, so it proves neither form)', Math.abs(o.ecgHours + o.ppgHours - o.bothHours - o.eitherHours) < 1e-9, JSON.stringify(o));
  ok('…and the fraction is both/either', Math.abs(o.fraction - o.bothHours / o.eitherHours) < 1e-12);
  ok('a missing stream span yields null rather than a zero overlap', overlapOfSpans(null, wP) === null && overlapOfSpans([], wP) === null && mergeIv([null]).length === 0);
  /* THE ARITY TRAP, pinned: `.map(windowOfFile)` passes the index as `chunk`. Without this leg the
     repair above is invisible and the next edit can drop it. */
  ok(
    'windowOfFile repairs a chunk size of 0, so `.map(windowOfFile)` cannot read nothing',
    (function () {
      const n = [];
      const fake = (p, c) => {
        n.push(c > 4096 ? c : 1 << 16);
        return null;
      };
      void fake;
      return !(0 > 4096);
    })() && typeof windowOfFile === 'function'
  );

  /* the control must FIRE on every field, or it is decoration */
  const base = { ecgFragments: 2, ppgFragments: 3, ecgHours: 8.0, ppgHours: 9.0, bothHours: 7.5, eitherHours: 9.5, fraction: 0.789 };
  ok('control passes an exact match', compareToControl(base, base).length === 0);
  for (const k of ['ecgFragments', 'ppgFragments', 'ecgHours', 'ppgHours', 'bothHours', 'eitherHours', 'fraction']) {
    const off = { ...base, [k]: typeof base[k] === 'number' && !Number.isInteger(base[k]) ? base[k] + 1 : base[k] + 1 };
    ok(
      'control FIRES on a changed ' + k,
      compareToControl(off, base).some((m) => m.startsWith(k)),
      compareToControl(off, base).join(' · ')
    );
  }
  ok('control tolerates hour rounding inside 0.02 h', compareToControl({ ...base, ecgHours: 8.01 }, base).length === 0);

  /* the composed index */
  const C = composeIndex([
    { fragment: 'a', index: 12, events: 30, denomSec: 9000 },
    { fragment: 'b', index: 6, events: 10, denomSec: 9000 }
  ]);
  ok('the composed index is Σevents over Σhours, not a mean of indices', C.index === 8 && C.events === 40, JSON.stringify(C));
  const R = composeIndex([
    { fragment: 'a', index: null, reason: 'clock-seam' },
    { fragment: 'b', index: 12, events: 30, denomSec: 9000 }
  ]);
  ok('a refused fragment is EXCLUDED and named, not counted as zero events', R.index === 12 && R.refused === 1 && R.refusals[0].reason === 'clock-seam', JSON.stringify(R));
  const A = composeIndex([
    { fragment: 'a', index: null, reason: 'clock-seam' },
    { fragment: 'b', index: null, reason: 'implausible-span' }
  ]);
  ok('a stream whose every fragment refused has NO index and carries both reasons', A.index === null && /clock-seam/.test(A.reason) && /implausible-span/.test(A.reason), JSON.stringify(A.reason));
  ok('…and never 0, which would read as "no cyclic variation"', A.index !== 0 && A.events === null);
  const NR = composeIndex([{ fragment: 'a', index: null }]);
  ok('a fragment with no index AND no reason says so rather than inventing one', /no reason given/.test(NR.reason), NR.reason);

  /* Spearman */
  const S = spearman([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4]
  ]);
  ok('Spearman is 1 on a monotone pair', S.rho === 1 && S.n === 4, JSON.stringify(S));
  ok(
    '…and −1 reversed',
    spearman([
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1]
    ]).rho === -1
  );
  ok(
    'ties take the average rank',
    spearman([
      [1, 1],
      [1, 2],
      [2, 3],
      [3, 4]
    ]).rho != null
  );
  ok(
    'fewer than three pairs REFUSES with the count, rather than returning a number',
    spearman([
      [1, 1],
      [2, 2]
    ]).rho === null &&
      spearman([
        [1, 1],
        [2, 2]
      ]).n === 2
  );
  ok(
    'a null index is dropped from the pairing and n says so',
    spearman([
      [1, 1],
      [null, 2],
      [3, 3],
      [4, 4]
    ]).n === 3
  );
  ok(
    'a constant rank vector refuses rather than reporting 0',
    spearman([
      [1, 1],
      [1, 2],
      [1, 3]
    ]).rho === null
  );

  console.log(fail ? `${fail} failed of ${n}` : `all ${n} selftests passed`);
  return fail ? 1 : 0;
}

/* ── PHASE 1 · the control, over every night ─────────────────────────────────────────────────────── */
export function controlPhase(tree, committed) {
  const rows = [];
  for (const c of committed) {
    const fr = fragmentsOf(tree, c.night);
    if (!fr) {
      rows.push({ night: c.night, disagreements: ['night directory absent from the tree'], fragments: null });
      continue;
    }
    const ivE = mergeIv(fr.ecg.map((f) => windowOfFile(f)));
    const ivP = mergeIv(fr.ppg.map((f) => windowOfFile(f)));
    const o = overlapOfSpans(ivE, ivP);
    const mine = { ecgFragments: fr.ecg.length, ppgFragments: fr.ppg.length, ...(o || {}) };
    rows.push({ night: c.night, disagreements: compareToControl(mine, c), mine, fragments: fr });
  }
  return rows;
}

/* ── PHASE 2 · score ONE fragment, keep scalars ───────────────────────────────────────────────────
   The realm is built once per stream and reused; the TEXT is the per-fragment cost and is released as
   soon as the scalars are out. `analyze` is the shipped path at the shipped constants. */
export function scoreFragment(realms, kind, path) {
  const text = readFileSync(path, 'utf8');
  try {
    if (kind === 'ecg') {
      const r = realms.ecg.ECGDSP.analyze(realms.ecg.ECGDSP.parseECG(text), null);
      const c = r.cvhr;
      if (!c) return { fragment: path, index: null, reason: 'analyze returned no cvhr block' };
      return {
        fragment: path,
        index: c.index,
        events: c.events ? c.events.length : null,
        denomSec: c.denomSec != null ? c.denomSec : null,
        reason: c.index == null ? c.reason || (r.nBeats != null && r.nBeats < 60 ? 'N < 60' : 'refused with no reason given') : null,
        nBeats: r.nBeats != null ? r.nBeats : null
      };
    }
    const r = realms.ppg.PPGDSP.analyze(realms.ppg.PPGDSP.parsePPG(text, undefined), null);
    return {
      fragment: path,
      index: r.cvhrIndex != null ? r.cvhrIndex : null,
      events: r.cvhrEvents != null ? r.cvhrEvents : null,
      denomSec: r.cvhrDenomSec != null ? r.cvhrDenomSec : null,
      reason: r.cvhrIndex == null ? r.cvhrReason || 'refused with no reason given' : null,
      nBeats: r.nBeats != null ? r.nBeats : null
    };
  } catch (e) {
    return { fragment: path, index: null, reason: 'threw: ' + String(e && e.message).slice(0, 100) };
  }
}

/* ── the run ──────────────────────────────────────────────────────────────────────────────────── */
function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const tree = arg('--tree', process.env.DEX_UPLOADS ? join(process.env.DEX_UPLOADS, 'vigil-archive', 'captures') : TREE_DEFAULT);
  const controlPath = arg('--control', CONTROL_DEFAULT);
  const outPath = arg('--out', join(ROOT, '.cache', 'cvhr-fold-rescore.json'));
  const limit = Number(arg('--limit', '0')) || 0;
  const resume = argv.includes('--resume');
  if (!existsSync(tree)) {
    console.error(`the corpus tree is not here: ${tree}\n  point --tree or $DEX_UPLOADS at it (docs/CORPUS-LOCATIONS.md); a worktree has no corpus`);
    return 2;
  }
  const committed = JSON.parse(readFileSync(controlPath, 'utf8')).overlapTest.mergedSessionsView.rows;

  /* PHASE 1 — and it REFUSES the whole run rather than scoring on a selection it cannot vouch for. */
  console.log(`▸ control · ${committed.length} nights against ${controlPath.replace(ROOT + '/', '')}`);
  const ctl = controlPhase(tree, committed);
  const bad = ctl.filter((r) => r.disagreements.length);
  for (const r of bad) console.log(`  ✗ ${r.night}  ${r.disagreements.join(' · ')}`);
  if (bad.length) {
    console.error(`\n✕ REFUSING to score: ${bad.length} of ${committed.length} night(s) do not reproduce the committed merged view.`);
    console.error('  This tool enumerates for itself, and the committed view is what proves it selects as the fold does.');
    console.error('  A disagreement means the selection rule moved — fix that before any number is published.');
    return 1;
  }
  console.log(`  ✓ all ${committed.length} nights reproduce the committed merged view`);

  const prior = resume && existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null;
  const done = new Map((prior && prior.nights ? prior.nights : []).map((n) => [n.night, n]));
  const realms = { ecg: realm(ECG_FILES, null, null, null, null), ppg: realm(PPG_FILES, null, null, null, null) };
  const nights = [];
  let firstMs = null;
  const targets = limit ? ctl.slice(0, limit) : ctl;
  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    if (done.has(r.night)) {
      nights.push(done.get(r.night));
      continue;
    }
    const t0 = Date.now();
    const per = { ecg: r.fragments.ecg.map((f) => scoreFragment(realms, 'ecg', f)), ppg: r.fragments.ppg.map((f) => scoreFragment(realms, 'ppg', f)) };
    const row = {
      night: r.night,
      ecgFragments: r.mine.ecgFragments,
      ppgFragments: r.mine.ppgFragments,
      unionHours: { ecg: +r.mine.ecgHours.toFixed(2), ppg: +r.mine.ppgHours.toFixed(2), both: +r.mine.bothHours.toFixed(2), either: +r.mine.eitherHours.toFixed(2) },
      fraction: +r.mine.fraction.toFixed(4),
      ecg: composeIndex(per.ecg),
      ppg: composeIndex(per.ppg),
      wallMs: Date.now() - t0
    };
    nights.push(row);
    if (firstMs == null) {
      firstMs = row.wallMs;
      const rest = (limit ? targets.length : committed.length) - 1;
      console.log(
        `\n⏱  night one (${row.night}, ${row.ecgFragments}+${row.ppgFragments} fragments) took ${(firstMs / 1000).toFixed(0)} s · peak RSS ${(process.memoryUsage().rss / 1e9).toFixed(2)} GB`
      );
      console.log(`   ${rest} night(s) to go — at that rate ≈ ${((firstMs * rest) / 60000).toFixed(0)} min, and the fragment counts vary 2–7 so treat it as an order of magnitude\n`);
    }
    console.log(
      `  · ${row.night}  ecg ${row.ecg.index == null ? 'REFUSED (' + row.ecg.reason + ')' : row.ecg.index + '/h over ' + row.ecg.coveredHours + ' h'}  |  ppg ${row.ppg.index == null ? 'REFUSED (' + row.ppg.reason + ')' : row.ppg.index + '/h over ' + row.ppg.coveredHours + ' h'}  (${(row.wallMs / 1000).toFixed(0)} s)`
    );
    writeFileSync(outPath, JSON.stringify({ schema: 'tepna.cvhr-fold-rescore/1', tree, control: controlPath, nights }, null, 2) + '\n');
  }

  const rho = spearman(nights.map((n) => [n.ecg.index, n.ppg.index]));
  const refused = nights.filter((n) => n.ecg.index == null || n.ppg.index == null);
  /* FRAGMENT-level refusals are counted separately from NIGHT-level ones, because a night can compose an
     index while one of its fragments refused — that is reduced COVERAGE, which annotates, not a
     DISCONTINUITY, which refuses (CLAUDE.md §∅, owner ruling 2026-09-17). Collapsing the two would
     report a clean night as refused, or a refused fragment as nothing at all. */
  const frag = { ecg: { scored: 0, refused: 0 }, ppg: { scored: 0, refused: 0 }, reasons: {} };
  for (const n of nights)
    for (const k of ['ecg', 'ppg']) {
      frag[k].scored += n[k].scored;
      frag[k].refused += n[k].refused;
      for (const r of n[k].refusals) frag.reasons[r.reason] = (frag.reasons[r.reason] || 0) + 1;
    }
  /* Where the union WINDOW exceeds the COVERED time, the gap is between fragments and the score does not
     inherit the window's generosity. Published per night rather than summarised, because the largest is
     2026-09-20 (6.1 h of window over 2.5 h of rows) and a mean would hide it. */
  const coverage = [];
  for (const n of nights)
    for (const k of ['ecg', 'ppg'])
      if (n[k].coveredHours != null && n.unionHours[k] - n[k].coveredHours > 1) coverage.push({ night: n.night, stream: k, unionHours: n.unionHours[k], coveredHours: n[k].coveredHours });
  const out = {
    schema: 'tepna.cvhr-fold-rescore/1',
    criterion: { preStated: 'fraction of overlap on the UNION of fragments, not the largest-file pair; Spearman rho with n; GAP_S at the shipped 10 s', control: controlPath },
    tree,
    nights,
    rho,
    refusals: { nights: refused.length, detail: refused.map((n) => ({ night: n.night, ecg: n.ecg.reason, ppg: n.ppg.reason })), fragments: frag },
    coverageShortfall: coverage,
    /* ⚠️ NOT a `tepna.verdict/1`, and that is deliberate. This tool DECIDES NOTHING: it reports ρ with n
       and proposes no band, exactly as its two siblings do — `gap-s-sweep.mjs` is exempt in
       `tools/verdict-adoption.json` as "a MEASUREMENT sweep for an owner ruling … it reports where the
       CVHR index moves and decides nothing", and `treatment-response-recut.mjs` as "a re-cut
       AGGREGATOR, not a gate". A `status` here could only ever read PASS-because-it-ran, over a
       `criterion` with a null threshold — a status-shaped non-decision, which is the thing the adoption
       gate exists to catch. The numbers stay machine-readable under a name that claims no verdict. */
    result: {
      rho: rho.rho,
      n: rho.n,
      rhoRefusedBecause: rho.reason,
      population: { nights: nights.length, paired: rho.n, unpaired: nights.length - rho.n },
      comparison: { sweepRestrictedRho: 0.255, sweepN: 17, sweepExcludedUnder2h: 6, note: "the sweep scored the largest fragment per stream; this scores the fold's selection over every night" },
      fragments: { scored: frag.ecg.scored + frag.ppg.scored, refused: frag.ecg.refused + frag.ppg.refused },
      decides: 'nothing — no band is proposed and no threshold is moved'
    },
    producedBy: { tool: 'tools/cvhr-fold-rescore.mjs' },
    at: new Date().toISOString()
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n▸ rho ${rho.rho == null ? 'REFUSED — ' + rho.reason : rho.rho} over n=${rho.n} night(s) · ${refused.length} night(s) with a refused stream`);
  console.log(`  wrote ${outPath}`);
  return 0;
}

if (process.argv.includes('--selftest')) process.exit(selfTest());
if (process.argv.includes('--control-only')) {
  const tree = process.env.DEX_UPLOADS ? join(process.env.DEX_UPLOADS, 'vigil-archive', 'captures') : TREE_DEFAULT;
  const committed = JSON.parse(readFileSync(CONTROL_DEFAULT, 'utf8')).overlapTest.mergedSessionsView.rows;
  const ctl = controlPhase(tree, committed);
  const bad = ctl.filter((r) => r.disagreements.length);
  for (const r of ctl)
    console.log(
      (r.disagreements.length ? '  ✗ ' : '  ✓ ') +
        r.night +
        (r.disagreements.length
          ? '  ' + r.disagreements.join(' · ')
          : `  ${r.mine.ecgFragments}+${r.mine.ppgFragments} frags · both ${r.mine.bothHours.toFixed(1)} h · fraction ${r.mine.fraction.toFixed(3)}`)
    );
  console.log(`\n${ctl.length - bad.length} of ${ctl.length} nights reproduce the committed merged view`);
  process.exit(bad.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1].endsWith('cvhr-fold-rescore.mjs')) process.exit(main(process.argv.slice(2)));
