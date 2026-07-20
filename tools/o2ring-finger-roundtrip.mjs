// PPGDEX-O2RING-FINGER-SITE §6 — the round-trip acceptance, on a REAL capture.
// The finger O2Ring PPI-HR must match (a) the ring's own 1 Hz HR field and (b) the paired H10 ECG HR
// within a couple bpm, with feet/peaks detected. Run against a real capture session on disk.
//
//   node tools/o2ring-finger-roundtrip.mjs <ppg.txt> <ecg.txt> <spo2.csv>
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/run/media/michal/647A504F7A50205A/wt-fingerrt';
const [ppgPath, ecgPath, spo2Path] = process.argv.slice(2);
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;

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

console.log('=== PPGDEX-O2RING-FINGER-SITE §6 — REAL-CAPTURE ROUND-TRIP ===\n');
console.log('O2Ring PPG :', ppgPath.split('/').pop());
console.log('  site=' + pres.site, '· channels=' + prec.ch.length, '· fs=' + prec.fs.toFixed(1) + ' Hz', '· ledAgreementPct=' + pres.ledAgreementPct, '· ledSingleChannel=' + pres.ledSingleChannel);
console.log('  nBeats=' + pres.nBeats, '· ppiSpine=' + pres.ppiSpine, '· meanSQI=' + pres.meanSQI, '· cleanBeatPct=' + pres.cleanBeatPct);
console.log('  feet detected:', (pres.footSec || []).length, '· morphology:', pres.morph && pres.morph.delin ? 'present' : 'absent');
console.log('H10 ECG    :', ecgPath.split('/').pop(), '· fs=' + erec.fs.toFixed(1), '· nPeaks=' + (eres.peaks || []).length);
console.log('Ring 1 Hz  :', spo2Path.split('/').pop(), '· samples=' + ringHR.length);
console.log('\noverlap window (all three present):', fmt(lo), '→', fmt(hi), `(${((hi - lo) / 1000).toFixed(0)} s)`);

const pW = win(ppgBeats),
  eW = win(ecgBeats),
  rW = win(ringHR);
const mP = median(pW),
  mE = median(eW),
  mR = median(rW);
console.log('\n  source            median HR   IQR    n');
console.log(`  O2Ring PpgDex     ${mP == null ? '  —  ' : mP.toFixed(1).padStart(5)} bpm  ${mP == null ? '—' : iqr(pW).toFixed(1)}   ${pW.length}`);
console.log(`  Ring 1 Hz field   ${mR == null ? '  —  ' : mR.toFixed(1).padStart(5)} bpm  ${mR == null ? '—' : iqr(rW).toFixed(1)}   ${rW.length}`);
console.log(`  H10 ECG (gold)    ${mE == null ? '  —  ' : mE.toFixed(1).padStart(5)} bpm  ${mE == null ? '—' : iqr(eW).toFixed(1)}   ${eW.length}`);

console.log('\n=== ACCEPTANCE (§6: within a couple bpm) ===');
const chk = (name, a, b, tol) => {
  const d = a == null || b == null ? null : Math.abs(a - b);
  const ok = d != null && d <= tol;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: |${a == null ? '—' : a.toFixed(1)} − ${b == null ? '—' : b.toFixed(1)}| = ${d == null ? '—' : d.toFixed(1)} bpm  (tol ${tol})`);
  return ok;
};
const TOL = 3;
const a = chk('O2Ring PPI-HR vs ring 1 Hz HR', mP, mR, TOL);
const b = chk('O2Ring PPI-HR vs paired H10 ECG', mP, mE, TOL);
const c = (pres.footSec || []).length > 10 && pres.ppiSpine === 'foot';
console.log(`  ${c ? 'PASS' : 'FAIL'}  feet detected + PPI is foot-to-foot`);
console.log('\n' + (a && b && c ? '✅ ROUND-TRIP PASSES on real hardware.' : '❌ round-trip did not pass — see above.'));
