// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// PPGDEX-O2RING-FINGER-SITE §6 — the round-trip acceptance, on a REAL capture.
// The finger O2Ring PPI-HR must match (a) the ring's own 1 Hz HR field and (b) the paired H10 ECG HR
// within a couple bpm, with feet/peaks detected. Run against a real capture session on disk.
//
//   node tools/o2ring-finger-roundtrip.mjs <ppg.txt> <ecg.txt> <spo2.csv> [--json]
//   node tools/o2ring-finger-roundtrip.mjs --verdict-sample     the documented 2026-07-19 session, as an object
//   node tools/o2ring-finger-roundtrip.mjs --selftest
//
// VERDICT (tepna.verdict/1, wave 2 group C — read before flipping, the rule is exact): PASS iff
// |PPI-HR − ring 1 Hz| ≤ 3 bpm AND |PPI-HR − H10 ECG| ≤ 3 bpm AND > 10 feet on the foot spine — the
// three `chk` lines below, unchanged. FAIL names which check missed and by how much. NOT_RUN when no
// window holds all three sources (the old ❌ over an empty window was a FAIL about nothing). The
// population is the one pair the arguments name. `--json` prints the object on stdout (report → stderr).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { makeVerdict } from './verdict-emit.mjs';

/* ROOT is derived from THIS FILE's location, never hardcoded. Both O2Ring finger tools shipped with an
   absolute path to the author's throwaway worktree (`…/wt-fingerval`, `…/wt-fingerrt`) baked in. Those
   worktrees were removed the day they were made, so both tools have been UNRUNNABLE ANYWHERE since the
   commit that added them — including for the author — while two briefs cite them as the evidence for a
   hardware round-trip and for the ≥10-night tier call. Nothing caught it: they are operator sweeps over
   gitignored captures, so no gate runs them, and a tool that no gate runs is a tool nobody notices is
   dead. (ENGINE-VERIFICATION §0: a comment is not a measurement; a committed tool is not a working one.) */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { classicify } = createRequire(import.meta.url)(join(ROOT, 'tools/build-core.js'));
export const TOL = 3; // bpm — §6 "within a couple bpm", the pre-stated tolerance
export const MIN_FEET = 10;

function realm(files) {
  const sb = { console, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, appendChild() {} }), head: { appendChild() {} }, addEventListener() {} };
  sb.navigator = { userAgent: 'roundtrip' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const iqr = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return q(0.75) - q(0.25);
};

/* ── the verdict object — pure over the measured medians, so the selftest can drive it ─────────────── */
export function verdictObject(m, { ppg, ecg, spo2, commit, commitReason, at } = {}) {
  const evidence = [ppg, ecg, spo2].filter(Boolean);
  const d = (a, b) => (a == null || b == null ? null : Math.abs(a - b));
  const dR = d(m.mP, m.mR),
    dE = d(m.mP, m.mE);
  const criterion = {
    name: `finger_roundtrip_checks_missed (|PPI-HR − ring 1 Hz| ≤ ${TOL} bpm AND |PPI-HR − H10 ECG| ≤ ${TOL} bpm AND > ${MIN_FEET} feet on the foot spine)`,
    threshold: 0,
    unit: 'checks missed',
    direction: 'eq'
  };
  const base = { gate: 'o2ring-finger-roundtrip', criterion, evidence, tool: 'tools/o2ring-finger-roundtrip.mjs', commit, commitReason, at };
  if (!(m.winSec > 0) || m.mP == null || m.mE == null || m.mR == null) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 1, excluded: 1 },
      result: null,
      reason: `no window where all three sources exist (PPG ${m.nP ?? 0} beats, ECG ${m.nE ?? 0} beats, ring ${m.nR ?? 0} samples in the overlap) — nothing to compare`
    });
  }
  const missed = [];
  if (!(dR <= TOL)) missed.push(`|PPI-HR − ring| = ${dR.toFixed(1)} bpm > ${TOL}`);
  if (!(dE <= TOL)) missed.push(`|PPI-HR − ECG| = ${dE.toFixed(1)} bpm > ${TOL}`);
  if (!(m.feet > MIN_FEET && m.ppiSpine === 'foot')) missed.push(`feet ${m.feet} (need > ${MIN_FEET}) on spine '${m.ppiSpine}' (need 'foot')`);
  const result = {
    medianPpiHr: m.mP,
    medianRingHr: m.mR,
    medianEcgHr: m.mE,
    dRingBpm: dR,
    dEcgBpm: dE,
    feet: m.feet,
    ppiSpine: m.ppiSpine,
    winSec: m.winSec,
    nP: m.nP,
    nE: m.nE,
    nR: m.nR,
    checksMissed: missed.length
  };
  return makeVerdict({
    ...base,
    status: missed.length ? 'FAIL' : 'PASS',
    population: { checked: 1, eligible: 1, excluded: 0 },
    result,
    reason: missed.length ? `${missed.length} of 3 checks missed: ${missed.join('; ')}` : null
  });
}

/* The documented run — docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md: 2026-07-19 ~20:58, 96 s overlap,
   PpgDex 56.3 vs ring 57.0 vs H10 56.1, 313 feet, PPI foot-to-foot. No code identity is claimed. */
export function verdictSample() {
  return verdictObject(
    { mP: 56.3, mR: 57.0, mE: 56.1, feet: 313, ppiSpine: 'foot', winSec: 96, nP: 90, nE: 90, nR: 96 },
    {
      ppg: 'docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md',
      commit: null,
      commitReason: '--verdict-sample: the documented 2026-07-19 session, no code identity claimed',
      at: '2026-09-22T00:00:00Z'
    }
  );
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const ok = { mP: 56.3, mR: 57.0, mE: 56.1, feet: 313, ppiSpine: 'foot', winSec: 96, nP: 90, nE: 90, nR: 96 };
  const vo = (t) => verdictObject({ ...ok, ...t }, { ppg: 'a', ecg: 'b', spo2: 'c', commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' });
  eq(vo({}).status, 'PASS', 'PASS: all three checks hold');
  eq(vo({}).result.checksMissed, 0, 'PASS carries checksMissed = 0');
  eq(vo({}).population.checked, 1, 'population = the one pair');
  eq(vo({ mR: 60.5 }).status, 'FAIL', 'FAIL: ring off by 4.2 bpm');
  eq(/ring\| = 4\.2 bpm > 3/.test(vo({ mR: 60.5 }).reason), true, 'FAIL reason names the ring miss and the amount');
  eq(vo({ mE: 53.2 }).status, 'FAIL', 'FAIL: ECG off by 3.1 bpm (the boundary is inclusive at 3.0)');
  eq(vo({ mE: 53.3 }).status, 'PASS', 'PASS: ECG off by exactly 3.0 bpm is inside the tolerance');
  eq(vo({ feet: 10 }).status, 'FAIL', 'FAIL: 10 feet is not > 10');
  eq(vo({ ppiSpine: 'peak' }).status, 'FAIL', 'FAIL: PPI not foot-to-foot');
  eq(vo({ mR: 60.5, feet: 3 }).result.checksMissed, 2, 'FAIL counts every missed check');
  eq(vo({ winSec: 0, mP: null }).status, 'NOT_RUN', 'NOT_RUN: no window with all three sources');
  eq(vo({ winSec: 0, mP: null }).population.checked, 0, 'NOT_RUN examined nothing');
  eq(verdictSample().status, 'PASS', 'the documented 2026-07-19 session is a PASS');
  eq(verdictSample().producedBy.commit, null, 'the sample claims no code identity');
  console.log(`all ${n} selftests passed`);
}

function run(ppgPath, ecgPath, spo2Path, { json = false } = {}) {
  const log = json ? (...a) => console.error(...a) : (...a) => console.log(...a);
  // ── 1 · O2Ring finger PPG → PpgDex → per-beat HR series (absolute tMs) ──
  const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
  const prec = P.parsePPG(readFileSync(ppgPath, 'utf8'));
  const pres = P.analyze(prec);
  // per-beat instantaneous HR from foot-to-foot NN, stamped at the beat's absolute tMs
  const ppgBeats = [];
  {
    const feet = pres.footSec || [];
    for (let k = 1; k < feet.length; k++) {
      const dt = feet[k] - feet[k - 1];
      if (dt > 0.3 && dt < 2.0) ppgBeats.push({ tMs: prec.t0Ms + feet[k] * 1000, hr: 60 / dt });
    }
  }

  // ── 2 · paired H10 ECG → ECGDex (Pan–Tompkins) → per-beat HR series ──
  const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;
  const erec = E.parseECG(readFileSync(ecgPath, 'utf8'));
  const eres = E.analyze(erec);
  const ecgBeats = [];
  {
    const pk = eres.peaks || [];
    for (let k = 1; k < pk.length; k++) {
      const dt = (pk[k] - pk[k - 1]) / erec.fs;
      if (dt > 0.3 && dt < 2.0) ecgBeats.push({ tMs: erec.t0Ms + (pk[k] / erec.fs) * 1000, hr: 60 / dt });
    }
  }

  // ── 3 · ring's own 1 Hz HR (the SPO2.csv "Pulse Rate" column) ──
  const ringHR = [];
  {
    const lines = readFileSync(spo2Path, 'utf8').split(/\r?\n/);
    const hdr = lines[0].split(',').map((h) => h.trim());
    const iT = hdr.indexOf('Time'),
      iP = hdr.indexOf('Pulse Rate');
    const CK = realm(['clock.js']).DexClock;
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length <= iP) continue;
      const ts = CK.parseTimestamp((c[iT] || '').trim(), { preferDMY: true });
      const hr = parseFloat(c[iP]);
      if (ts && isFinite(hr) && hr > 0) ringHR.push({ tMs: ts.tMs, hr });
    }
  }

  // ── overlap window = where all three exist ──
  const span = (a) => (a.length ? [a[0].tMs, a[a.length - 1].tMs] : [Infinity, -Infinity]);
  const [p0, p1] = span(ppgBeats),
    [e0, e1] = span(ecgBeats),
    [r0, r1] = span(ringHR);
  const lo = Math.max(p0, e0, r0),
    hi = Math.min(p1, e1, r1);
  const win = (a) => a.filter((x) => x.tMs >= lo && x.tMs <= hi).map((x) => x.hr);
  const fmt = (ms) => new Date(ms).toISOString().slice(11, 19);

  log('=== PPGDEX-O2RING-FINGER-SITE §6 — REAL-CAPTURE ROUND-TRIP ===\n');
  log('O2Ring PPG :', ppgPath.split('/').pop());
  log('  site=' + pres.site, '· channels=' + prec.ch.length, '· fs=' + prec.fs.toFixed(1) + ' Hz', '· ledAgreementPct=' + pres.ledAgreementPct, '· ledSingleChannel=' + pres.ledSingleChannel);
  log('  nBeats=' + pres.nBeats, '· ppiSpine=' + pres.ppiSpine, '· meanSQI=' + pres.meanSQI, '· cleanBeatPct=' + pres.cleanBeatPct);
  log('  feet detected:', (pres.footSec || []).length, '· morphology:', pres.morph && pres.morph.delin ? 'present' : 'absent');
  log('H10 ECG    :', ecgPath.split('/').pop(), '· fs=' + erec.fs.toFixed(1), '· nPeaks=' + (eres.peaks || []).length);
  log('Ring 1 Hz  :', spo2Path.split('/').pop(), '· samples=' + ringHR.length);
  log('\noverlap window (all three present):', fmt(lo), '→', fmt(hi), `(${((hi - lo) / 1000).toFixed(0)} s)`);

  const pW = win(ppgBeats),
    eW = win(ecgBeats),
    rW = win(ringHR);
  const mP = median(pW),
    mE = median(eW),
    mR = median(rW);
  log('\n  source            median HR   IQR    n');
  log(`  O2Ring PpgDex     ${mP == null ? '  —  ' : mP.toFixed(1).padStart(5)} bpm  ${mP == null ? '—' : iqr(pW).toFixed(1)}   ${pW.length}`);
  log(`  Ring 1 Hz field   ${mR == null ? '  —  ' : mR.toFixed(1).padStart(5)} bpm  ${mR == null ? '—' : iqr(rW).toFixed(1)}   ${rW.length}`);
  log(`  H10 ECG (gold)    ${mE == null ? '  —  ' : mE.toFixed(1).padStart(5)} bpm  ${mE == null ? '—' : iqr(eW).toFixed(1)}   ${eW.length}`);

  log('\n=== ACCEPTANCE (§6: within a couple bpm) ===');
  const chk = (name, a, b, tol) => {
    const d = a == null || b == null ? null : Math.abs(a - b);
    const ok = d != null && d <= tol;
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: |${a == null ? '—' : a.toFixed(1)} − ${b == null ? '—' : b.toFixed(1)}| = ${d == null ? '—' : d.toFixed(1)} bpm  (tol ${tol})`);
    return ok;
  };
  const TOL = 3;
  const a = chk('O2Ring PPI-HR vs ring 1 Hz HR', mP, mR, TOL);
  const b = chk('O2Ring PPI-HR vs paired H10 ECG', mP, mE, TOL);
  const c = (pres.footSec || []).length > MIN_FEET && pres.ppiSpine === 'foot';
  log(`  ${c ? 'PASS' : 'FAIL'}  feet detected + PPI is foot-to-foot`);
  log('\n' + (a && b && c ? '✅ ROUND-TRIP PASSES on real hardware.' : '❌ round-trip did not pass — see above.'));
  const v = verdictObject(
    { mP, mE, mR, feet: (pres.footSec || []).length, ppiSpine: pres.ppiSpine, winSec: hi > lo ? (hi - lo) / 1000 : 0, nP: pW.length, nE: eW.length, nR: rW.length },
    { ppg: ppgPath, ecg: ecgPath, spo2: spo2Path }
  );
  if (json) console.log(JSON.stringify(v));
  return v;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) return console.log(JSON.stringify(verdictSample()));
  const json = argv.includes('--json');
  const [ppgPath, ecgPath, spo2Path] = argv.filter((a) => !a.startsWith('--'));
  if (!ppgPath || !ecgPath || !spo2Path) {
    console.error('usage: node tools/o2ring-finger-roundtrip.mjs <ppg.txt> <ecg.txt> <spo2.csv> [--json] | --verdict-sample | --selftest');
    process.exit(2);
  }
  run(ppgPath, ecgPath, spo2Path, { json });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
