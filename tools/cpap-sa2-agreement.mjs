#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * cpap-sa2-agreement.mjs — the CPAP's wired SpO₂ against the ring's
 *
 * WHY — CPAP-SA2-OXIMETRY-SOURCE-2026-08-01-BRIEF. The ResMed writes a
 * second, WIRED SpO₂ channel (`SA2.edf`, 1 Hz) on 194 nights at a median
 * 6.83 h, and nothing in the suite reads it. Every ODI/AHI-surrogate result
 * in this project rests on ONE consumer ring whose dropouts are BLE-driven;
 * a wired sensor over the identical interval fails for uncorrelated reasons,
 * which is the property that makes it useful as a check.
 *
 * TWO STATISTICS, AND THE BRIEF IS EMPHATIC THAT THEY ARE NOT THE SAME ONE.
 *
 *   ALIGNMENT uses correlation, and that is CORRECT here. The CPAP clock is
 *   wrong by a large, roughly constant offset (CROSS-DEVICE-CLOCK-SKEW
 *   measured ~39 min slow), so the traces must be aligned before anything is
 *   compared. An overnight SpO₂ trace is APERIODIC, so its cross-correlation
 *   has ONE peak — unlike a beat train, whose coincidence curve is a comb
 *   with no unique answer (IBI-ALIGNMENT-LIMIT). Aperiodic is exactly when a
 *   lag sweep is the right instrument.
 *
 *   AGREEMENT must NOT use correlation. §2: overnight SpO₂ sits flat near
 *   96 %, so Pearson r is dominated by noise about a near-constant mean and
 *   looks poor even for two sensors that agree perfectly. The brief's naive
 *   r = 0.296 is an artifact of both mistakes at once — unaligned traces
 *   judged by the wrong statistic. Agreement is Bland–Altman (bias + limits
 *   of agreement), ODI-4 agreement, and nadir/T90. `--selftest` plants a
 *   known bias and asserts precisely this: BA recovers it while r is
 *   misleading on the same data.
 *
 * GUARDRAIL (§6). Neither sensor is ground truth — the CPAP's oximeter is a
 * consumer sensor too. This tool REPORTS disagreement; it never tunes one
 * detector toward the other, and never averages the two into a single number
 * (MULTI-SENSOR-DERIVATIONS §2.2: publish every source and the SPREAD).
 *
 * USAGE
 *   node tools/cpap-sa2-agreement.mjs --selftest
 *     Planted bias, planted desaturations, a planted clock offset, and a
 *     flat-trace case. Known answers, no corpus.
 *
 *   node tools/cpap-sa2-agreement.mjs --cpap <dir> --ring <dir> [--night YYYY-MM-DD]
 *     `--cpap` is searched recursively for `<stamp>_SA2.edf`, DEDUPLICATED BY
 *     BASENAME — the same night appears in up to four capture trees and a raw
 *     count inflates 4×. `--ring` holds per-night dirs with an
 *     `OxyDex_<night>.node-export.json` carrying `timeseries.spo2` (v2.1.0+).
 *
 *   --coverage-only   skip the agreement pass (no ring dir needed)
 *   --max-lag <min>   alignment search half-width, default 90
 * ════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const MAX_LAG_MIN = parseFloat(opt('--max-lag', '90'));

/* ── statistics ────────────────────────────────────────────────────────── */

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

/**
 * Bland–Altman on paired samples. `bias` is mean(a−b); LoA is bias ± 1.96·SD
 * of the differences. This is the agreement instrument: it answers "by how
 * much, and how consistently", which is what r cannot.
 */
function blandAltman(a, b) {
  const d = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] == null || b[i] == null || !isFinite(a[i]) || !isFinite(b[i])) continue;
    d.push(a[i] - b[i]);
  }
  if (d.length < 10) return null;
  const bias = mean(d);
  const s = sd(d);
  const sorted = d.slice().sort((x, y) => x - y);
  return {
    n: d.length,
    bias,
    sd: s,
    loLoA: bias - 1.96 * s,
    hiLoA: bias + 1.96 * s,
    medianDiff: sorted[sorted.length >> 1],
    within1: d.filter((v) => Math.abs(v) <= 1).length / d.length,
    within3: d.filter((v) => Math.abs(v) <= 3).length / d.length
  };
}

/**
 * ODI-4 on a 1 Hz trace: a ≥4 % fall from a rolling baseline, recovering.
 * Deliberately simple and IDENTICAL for both sensors — the point is to compare
 * the two counts under one rule, not to reproduce OxyDex's clinical detector
 * (which would import its whole desaturation model and make any disagreement
 * unattributable).
 */
function odi4(v, hz) {
  const H = hz || 1;
  const BASE = Math.round(120 * H); // 2-min rolling baseline
  let events = 0;
  let i = 0;
  const n = v.length;
  while (i < n) {
    if (v[i] == null || !isFinite(v[i])) {
      i++;
      continue;
    }
    const lo = Math.max(0, i - BASE);
    let base = -Infinity;
    for (let k = lo; k < i; k++) if (v[k] != null && isFinite(v[k]) && v[k] > base) base = v[k];
    if (!isFinite(base)) {
      i++;
      continue;
    }
    if (base - v[i] >= 4) {
      events++;
      // advance past the nadir and the recovery so one dip counts once
      let j = i;
      while (j + 1 < n && (v[j + 1] == null || !isFinite(v[j + 1]) || v[j + 1] <= v[j])) j++;
      while (j + 1 < n && (v[j + 1] == null || !isFinite(v[j + 1]) || v[j + 1] < base - 1)) j++;
      i = j + 1;
      continue;
    }
    i++;
  }
  const hours = n / H / 3600;
  return { events, perHour: hours > 0 ? events / hours : NaN };
}

/**
 * THE CHECK THE BRIEF DID NOT MAKE, and the reason its premise was wrong.
 *
 * `SA2.edf` is written on every therapy night whether or not the optional
 * oximeter accessory is attached. When it is not, BOTH channels are filled with
 * the physical value −1 for the whole session — a full-length, well-formed,
 * perfectly readable file containing no measurement at all.
 *
 * So file DURATION is not coverage. Measured over all 250 distinct SA2 files:
 * 193 of 194 nights are entirely sentinel; exactly one (2026-06-13, 2.50 h) has
 * real saturations. A coverage number counting hours-of-file reports 6.83 h
 * median across 194 nights and is wrong by a factor of ~194.
 *
 * Valid SpO₂ is 50–100 %; anything ≤ 0 is the "no sensor" fill. (This is the
 * same distinction PpgDex draws between a device PPI file that is ABSENT and one
 * that is PRESENT AND EMPTY — a well-formed container is not data.)
 */
function classifySpo2(v) {
  let real = 0;
  let sentinel = 0;
  let other = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!isFinite(x)) other++;
    else if (x <= 0) sentinel++;
    else if (x >= 50 && x <= 100) real++;
    else other++;
  }
  return { n: v.length, real, sentinel, other, realFrac: v.length ? real / v.length : 0 };
}

function nadirT90(v) {
  let nadir = Infinity;
  let below = 0;
  let valid = 0;
  for (const x of v) {
    if (x == null || !isFinite(x)) continue;
    valid++;
    if (x < nadir) nadir = x;
    if (x < 90) below++;
  }
  return { nadir: isFinite(nadir) ? nadir : null, t90Pct: valid ? (100 * below) / valid : null, valid };
}

/**
 * Clock alignment by lag sweep on the SpO₂ traces themselves. Correlation IS
 * the right tool here — see the header. Returns the lag (seconds, positive =
 * `b` must shift later to match `a`) maximising correlation over the overlap.
 */
function alignByTrace(a, b, hz, maxLagSec) {
  const step = Math.max(1, Math.round(hz)); // 1 s resolution
  let best = { lag: 0, r: -Infinity };
  for (let lag = -maxLagSec; lag <= maxLagSec; lag += 1) {
    const shift = Math.round(lag * hz);
    const xs = [];
    const ys = [];
    for (let i = 0; i < a.length; i += step) {
      const j = i + shift;
      if (j < 0 || j >= b.length) continue;
      if (a[i] == null || b[j] == null || !isFinite(a[i]) || !isFinite(b[j])) continue;
      xs.push(a[i]);
      ys.push(b[j]);
    }
    if (xs.length < 600) continue; // need ≥10 min of overlap to mean anything
    const r = pearson(xs, ys);
    if (isFinite(r) && r > best.r) best = { lag, r, n: xs.length };
  }
  return best.r === -Infinity ? null : best;
}

/** Pair two traces at a known lag, on the shared grid. */
function pairAt(a, b, hz, lagSec) {
  const shift = Math.round(lagSec * hz);
  const xs = [];
  const ys = [];
  for (let i = 0; i < a.length; i++) {
    const j = i + shift;
    if (j < 0 || j >= b.length) continue;
    if (a[i] == null || b[j] == null || !isFinite(a[i]) || !isFinite(b[j])) continue;
    xs.push(a[i]);
    ys.push(b[j]);
  }
  return [xs, ys];
}

/* ── EDF realm ─────────────────────────────────────────────────────────── */

function realm(repo) {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    remove: noop,
    insertAdjacentHTML: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const sb = {
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
    },
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
      clear() {
        this._m.clear();
      }
    },
    console,
    setTimeout,
    clearTimeout
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  const classicify = (s) => s.replace(/^\s*export\s+/gm, '');
  for (const f of ['kernel-constants.js', 'clock.js', 'signal-frame.js', 'dex-export.js', 'metric-registry.js', 'crossnight-envelope.js', 'cpapdex-registry.js', 'cpapdex-edf.js'])
    vm.runInContext(classicify(fs.readFileSync(path.join(repo, f), 'utf8')), ctx, { filename: f });
  return ctx;
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const abuf = (p) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

/** Every `*_SA2.edf` under `dir`, DEDUPLICATED BY BASENAME (the §1 4× trap). */
function findSa2(dir) {
  const seen = new Map();
  const walk = (d) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/^(node_modules|\.git)$/.test(e.name)) walk(p);
      } else if (/_SA2\.edf$/.test(e.name) && !seen.has(e.name)) seen.set(e.name, p);
    }
  };
  walk(dir);
  return seen;
}

const SA2_STAMP = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_SA2\.edf$/;

/** Sessions grouped by night. A single SA2 file is NEVER "the night" (§1). */
function sa2Nights(seen, CpapEdf) {
  const nights = new Map();
  for (const [name, p] of seen) {
    const m = name.match(SA2_STAMP);
    if (!m) continue;
    let ed;
    try {
      ed = CpapEdf.readEDF(abuf(p));
    } catch {
      continue;
    }
    const spo2 = ed.signals && (ed.signals['SpO2.1s'] || ed.signals['SpO2']);
    if (!spo2) continue;
    const key = `${m[1]}-${m[2]}-${m[3]}`;
    const durSec = (ed.recordsRead || ed.numRecords || 0) * (ed.recDurSec || 0);
    if (!nights.has(key)) nights.set(key, []);
    const cls = classifySpo2(spo2.data);
    nights.get(key).push({
      file: name,
      cls,
      t0Ms: ed.clock ? ed.clock.t0Ms : null,
      hz: spo2.fs,
      durSec,
      values: Array.from(spo2.data),
      pulse: ed.signals['Pulse.1s'] ? Array.from(ed.signals['Pulse.1s'].data) : null
    });
  }
  for (const v of nights.values()) v.sort((a, b) => (a.t0Ms || 0) - (b.t0Ms || 0));
  return nights;
}

/** The ring's 1 Hz SpO₂, from the v2.1.0 `timeseries.spo2` block. */
function ringSpo2(dir, night) {
  const p = path.join(dir, night, `OxyDex_${night}.node-export.json`);
  if (!fs.existsSync(p)) return null;
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const ts = d.timeseries && d.timeseries.spo2;
  if (!ts || !ts.values || !ts.values.length) return null;
  return { hz: ts.hz || 1, t0Ms: (d.recording && d.recording.startEpochMs) || 0, values: ts.values };
}

/* ── selftest ──────────────────────────────────────────────────────────── */

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
    }
  };

  let s = 20260801;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const N = 8 * 3600; // 8 h at 1 Hz
  const BIAS = 1.8; // planted: sensor A reads this much HIGHER than B
  const PLANTED_DESATS = 40;
  const PLANTED_LAG = 137; // s — the clock offset the alignment pass must find

  /* A near-flat overnight trace with planted desaturations. Flat-plus-dips is
     the shape §2 says defeats Pearson, so it is the shape the selftest uses. */
  const base = new Array(N);
  for (let i = 0; i < N; i++) base[i] = 96 + (rnd() - 0.5) * 0.8;
  const at = [];
  for (let k = 0; k < PLANTED_DESATS; k++) at.push(Math.floor(((k + 0.5) * N) / PLANTED_DESATS));
  for (const c of at) {
    const depth = 6 + rnd() * 4;
    const half = 15;
    for (let i = -half; i <= half; i++) {
      const j = c + i;
      if (j < 0 || j >= N) continue;
      base[j] -= depth * Math.exp(-(i * i) / (2 * 7 * 7));
    }
  }
  const A = base.map((v) => v + BIAS / 2 + (rnd() - 0.5) * 0.3);
  const Braw = base.map((v) => v - BIAS / 2 + (rnd() - 0.5) * 0.3);
  // B is recorded on a clock running PLANTED_LAG seconds behind
  const B = new Array(PLANTED_LAG).fill(null).concat(Braw);

  // ── alignment: correlation IS right here, because the trace is aperiodic
  const al = alignByTrace(A, B, 1, 600);
  ok('the planted clock offset is recovered within 2 s', al && Math.abs(al.lag - PLANTED_LAG) <= 2, al ? `found ${al.lag} s (planted ${PLANTED_LAG})` : 'no alignment');

  const [pa, pb] = pairAt(A, B, 1, al ? al.lag : 0);
  ok('alignment yields a usable overlap', pa.length > N * 0.9, `${pa.length} paired samples`);

  // ── agreement: Bland–Altman recovers the planted bias
  const ba = blandAltman(pa, pb);
  ok('Bland–Altman recovers the planted bias within 0.2 %', ba && Math.abs(ba.bias - BIAS) < 0.2, ba ? `bias ${ba.bias.toFixed(2)} % (planted ${BIAS})` : 'null');
  ok('…with limits of agreement tight around it', ba && ba.hiLoA - ba.loLoA < 3, ba ? `LoA ${ba.loLoA.toFixed(2)} … ${ba.hiLoA.toFixed(2)}` : '');

  /* ── THE POINT OF §2, stated more carefully than the brief stated it ──────
     The brief says r "will look poor even for two sensors that agree perfectly".
     That is only half true, and the half matters. What r actually tracks is how
     much variance the two traces SHARE — which depends on the night, not on the
     sensors:

       · flat-region wander that is PHYSIOLOGICAL is shared, and r stays high
         (measured 0.88 on flat windows of the pair above);
       · flat-region wander that is SENSOR NOISE is independent, and r collapses.

     A real night mixes the two in unknown proportion. So r is not "pessimistic";
     it is UNINFORMATIVE ABOUT AGREEMENT, because it moves with something that is
     not agreement. Bland–Altman is invariant to the mix — same bias, same LoA.
     That is the assertion worth gating, and it is stronger than the brief's. */
  const flatA = [];
  const flatB = [];
  const W = 30;
  for (let i = W; i < pa.length - W; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = i - W; k <= i + W; k++) {
      if (pa[k] < lo) lo = pa[k];
      if (pa[k] > hi) hi = pa[k];
    }
    if (hi - lo < 1) {
      flatA.push(pa[i]);
      flatB.push(pb[i]);
    }
  }
  const rFull = pearson(pa, pb);
  const rFlatShared = pearson(flatA, flatB);
  const baShared = blandAltman(flatA, flatB);

  /* The same sensors and the SAME planted bias, but with the flat-region wander
     made independent instead of shared — i.e. sensor noise rather than
     physiology. Nothing about the agreement changed. */
  const indA = [];
  const indB = [];
  for (let i = 0; i < flatA.length; i++) {
    const level = 96;
    indA.push(level + BIAS / 2 + (rnd() - 0.5) * 0.8);
    indB.push(level - BIAS / 2 + (rnd() - 0.5) * 0.8);
  }
  const rFlatInd = pearson(indA, indB);
  const baInd = blandAltman(indA, indB);

  ok('r on the full trace is high (desaturations dominate the variance)', rFull > 0.9, `r=${rFull.toFixed(3)}`);
  ok('r stays high on flat windows when the wander is SHARED (physiology)', rFlatShared > 0.7, `r=${rFlatShared.toFixed(3)} over ${flatA.length} samples`);
  ok('r COLLAPSES on flat windows when the wander is INDEPENDENT (sensor noise)', Math.abs(rFlatInd) < 0.2, `r=${rFlatInd.toFixed(3)}`);
  ok(
    'r therefore swings 0.9 → 0 with NO change in agreement — it is not an agreement statistic',
    rFull - Math.abs(rFlatInd) > 0.7,
    `${rFull.toFixed(2)} vs ${Math.abs(rFlatInd).toFixed(2)}, same planted bias throughout`
  );
  ok(
    'Bland–Altman is INVARIANT across all three: same bias',
    baShared && baInd && Math.abs(baShared.bias - BIAS) < 0.2 && Math.abs(baInd.bias - BIAS) < 0.2,
    baShared && baInd ? `shared ${baShared.bias.toFixed(2)} · independent ${baInd.bias.toFixed(2)} · planted ${BIAS}` : 'null'
  );

  // ── ODI-4 under one shared rule
  const oa = odi4(pa, 1);
  const ob = odi4(pb, 1);
  ok('ODI-4 finds most of the planted desaturations', oa.events >= PLANTED_DESATS * 0.7, `${oa.events} of ${PLANTED_DESATS}`);
  ok('…and the two sensors agree on the count within 15 %', Math.abs(oa.events - ob.events) <= Math.max(2, 0.15 * oa.events), `${oa.events} vs ${ob.events}`);

  // ── nadir / T90
  const na = nadirT90(pa);
  const nb = nadirT90(pb);
  ok('nadir differs by about the planted bias', Math.abs(na.nadir - nb.nadir - BIAS) < 1.5, `${na.nadir.toFixed(1)} vs ${nb.nadir.toFixed(1)}`);

  // ── the §1 trap: a night is the SUM of its sessions
  const sessions = [{ durSec: 2.5 * 3600 }, { durSec: 4.35 * 3600 }];
  const summed = sessions.reduce((t, x) => t + x.durSec, 0) / 3600;
  ok('a night is the SUM of its sessions, never one file', Math.abs(summed - 6.85) < 0.01, `${summed.toFixed(2)} h from ${sessions.length} sessions`);

  /* ── THE PREMISE FAILURE, as a known answer ────────────────────────────
     A full-length, well-formed SA2 session whose SpO2 is entirely the -1 fill
     must read as ZERO coverage, not as 7.2 hours. Measuring file duration
     instead reported a 194-night, 6.83 h/night "second SpO2 source" that does
     not exist — the accessory was attached once, for 2.5 h, on 2026-06-13. */
  const sentinelSession = new Array(7.2 * 3600).fill(-1);
  const cs = classifySpo2(sentinelSession);
  ok('a full-length all-sentinel session has ZERO real samples', cs.real === 0, `${cs.real} real of ${cs.n}, ${cs.sentinel} sentinel`);
  ok('…and is not rescued by being long', sentinelSession.length / 3600 > 7 && cs.realFrac === 0, `${(sentinelSession.length / 3600).toFixed(1)} h of file, 0 h of data`);

  const mixed = new Array(1800).fill(-1).concat(new Array(3600).fill(96.5));
  const cm = classifySpo2(mixed);
  ok('a partly-attached session counts only the attached part', cm.real === 3600 && cm.sentinel === 1800, `${cm.real} real / ${cm.sentinel} sentinel`);
  ok('valid saturations are 50–100 %, so 0 and negatives are never data', classifySpo2([0, -1, -100, 49, 96, 100]).real === 2);

  // ── guardrail: nothing here averages the two sources
  ok('no fused/averaged SpO₂ is produced (MULTI-SENSOR-DERIVATIONS §2.2)', typeof globalThis.fuseSpo2 === 'undefined');

  console.log(`\n${fail === 0 ? '✓' : '✗'} selftest — ${pass} passed, ${fail} failed`);
  return fail === 0;
}

/* ── real corpus ───────────────────────────────────────────────────────── */

function run() {
  const cpapDir = opt('--cpap', null);
  const ringDir = opt('--ring', null);
  const only = opt('--night', null);
  if (!cpapDir || !fs.existsSync(cpapDir)) {
    console.error('cpap-sa2-agreement: --cpap <dir> is required (or --selftest)');
    process.exit(2);
  }
  const { CpapEdf } = realm(REPO);
  const seen = findSa2(cpapDir);
  const nights = sa2Nights(seen, CpapEdf);

  const hours = [...nights.entries()].map(([k, v]) => [k, v.reduce((t, x) => t + x.durSec, 0) / 3600]);
  const sorted = hours.map((h) => h[1]).sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  const sessDist = {};
  for (const v of nights.values()) sessDist[v.length] = (sessDist[v.length] || 0) + 1;

  console.log(`── SA2 coverage ────────────────────────────────────────────────`);
  console.log(`  distinct files (deduped by basename): ${seen.size}`);
  console.log(`  distinct nights                     : ${nights.size}`);
  console.log(
    `  sessions/night                      : ${Object.entries(sessDist)
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}→${v}`)
      .join('  ')}`
  );
  console.log(
    `  SUMMED hours/night                  : median ${q(0.5).toFixed(2)}  p10 ${q(0.1).toFixed(2)}  p90 ${q(0.9).toFixed(2)}  min ${sorted[0].toFixed(2)}  max ${sorted[sorted.length - 1].toFixed(2)}`
  );
  console.log(`  nights under 4 h                    : ${sorted.filter((v) => v < 4).length} of ${sorted.length}`);

  /* File hours vs DATA hours. These are the same number only if the oximeter
     accessory was actually attached — see classifySpo2. */
  let allSentinel = 0;
  let anyReal = 0;
  const realHours = [];
  for (const [k, v] of nights) {
    const real = v.reduce((t, x) => t + x.cls.real, 0);
    if (real === 0) allSentinel++;
    else {
      anyReal++;
      realHours.push([k, real / 3600]);
    }
  }
  const dataH = realHours.reduce((t, x) => t + x[1], 0);
  console.log(`\n  ── and now the same files, measured as DATA rather than duration ──`);
  console.log(`  nights whose SpO2 is ENTIRELY the -1 "no sensor" fill : ${allSentinel} of ${nights.size}`);
  console.log(`  nights carrying ANY real saturation                   : ${anyReal}`);
  console.log(`  total REAL SpO2 across the whole corpus               : ${dataH.toFixed(2)} h`);
  if (realHours.length) {
    realHours.sort((a, b) => b[1] - a[1]);
    console.log(`  the night(s) with data                               : ${realHours.map(([k, h]) => `${k} (${h.toFixed(2)} h)`).join(', ')}`);
  }
  if (!anyReal) console.log(`  → there is nothing here to cross-validate against.`);

  if (flag('--coverage-only') || !ringDir) {
    if (!ringDir) console.log('\n  (no --ring given — coverage only)');
    return;
  }

  console.log(`\n── agreement vs the ring, per night ────────────────────────────`);
  console.log('night         SA2 h  ring h   lag(s)   n      bias    LoA              |Δ|≤1  ODI4 SA2/ring   nadir SA2/ring');
  const biases = [];
  const odiPairs = [];
  let compared = 0;
  let skippedSentinel = 0;
  for (const [night, sess] of [...nights].sort()) {
    if (only && night !== only) continue;
    const ring = ringSpo2(ringDir, night);
    if (!ring) continue;
    // The longest session stands for the night in the agreement pass: stitching
    // sessions across a mask-off gap would fabricate samples across the hole.
    const withData = sess.filter((x) => x.cls.real > 0);
    if (!withData.length) {
      skippedSentinel++;
      continue; // counted and reported below — never a silent drop
    }
    const s0 = withData.slice().sort((a, b) => b.durSec - a.durSec)[0];
    const sa2Hours = sess.reduce((t, x) => t + x.durSec, 0) / 3600;
    const hz = 1;
    // put both on a common index origin using their own stamps, then let the
    // sweep absorb whatever the CPAP clock is wrong by
    const offsetSec = s0.t0Ms != null && ring.t0Ms ? Math.round((s0.t0Ms - ring.t0Ms) / 1000) : 0;
    const ringShifted = offsetSec >= 0 ? ring.values.slice(offsetSec) : new Array(-offsetSec).fill(null).concat(ring.values);
    const al = alignByTrace(s0.values, ringShifted, hz, MAX_LAG_MIN * 60);
    if (!al) continue;
    const [pa, pb] = pairAt(s0.values, ringShifted, hz, al.lag);
    const ba = blandAltman(pa, pb);
    if (!ba) continue;
    compared++;
    biases.push(ba.bias);
    const oa = odi4(pa, hz);
    const ob = odi4(pb, hz);
    odiPairs.push([oa.perHour, ob.perHour]);
    const na = nadirT90(pa);
    const nb = nadirT90(pb);
    console.log(
      night.padEnd(12),
      sa2Hours.toFixed(2).padStart(6),
      (ring.values.length / 3600).toFixed(2).padStart(7),
      String(al.lag + offsetSec).padStart(8),
      String(ba.n).padStart(6),
      ba.bias.toFixed(2).padStart(8),
      `  ${ba.loLoA.toFixed(1)}…${ba.hiLoA.toFixed(1)}`.padEnd(16),
      (100 * ba.within1).toFixed(0).padStart(4) + '%',
      `   ${oa.perHour.toFixed(1)}/${ob.perHour.toFixed(1)}`.padEnd(14),
      `${na.nadir}/${nb.nadir}`
    );
  }
  if (skippedSentinel) console.log(`\n  ${skippedSentinel} night(s) skipped: SA2 present but its SpO2 is entirely the -1 "no sensor" fill.`);
  if (!compared) {
    console.log('  (no night had BOTH real SA2 saturations and a ring timeseries.spo2)');
    return;
  }
  const mb = mean(biases);
  const sb2 = sd(biases);
  console.log(`\n  ${compared} night(s) compared.`);
  console.log(`  Per-night bias (SA2 − ring): mean ${mb.toFixed(2)} %  SD ${sb2.toFixed(2)}  range ${Math.min(...biases).toFixed(2)} … ${Math.max(...biases).toFixed(2)}`);
  const dOdi = odiPairs.map(([a, b]) => a - b);
  console.log(`  ODI-4 /h difference (SA2 − ring): mean ${mean(dOdi).toFixed(2)}  SD ${sd(dOdi).toFixed(2)}`);
  console.log(`\n  Neither sensor is ground truth (§6). This is a report of disagreement,`);
  console.log(`  not a correction: no detector is tuned toward the other, and the two`);
  console.log(`  SpO2 sources are never averaged.`);
}

if (flag('--selftest')) process.exit(selftest() ? 0 : 1);
else run();
