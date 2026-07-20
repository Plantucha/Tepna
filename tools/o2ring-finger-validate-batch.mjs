// Batch real-data validation of the O2Ring finger-site round-trip (PPGDEX-O2RING-FINGER-SITE §6).
// Discovers every capture session with an O2Ring PPG + a paired H10 ECG + the ring's SPO2, matches
// each substantial PPG segment to the best-overlapping ECG, and runs the three-way HR comparison.
// One row per pair. NOT a CI gate (reads gitignored real captures) — an operator validation sweep.
//
//   node tools/o2ring-finger-validate-batch.mjs <dir> [<dir> ...]
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/run/media/michal/647A504F7A50205A/wt-fingerval';
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;

function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, appendChild() {} }), head: { appendChild() {} }, addEventListener() {} };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;
const CK = realm(['clock.js']).DexClock;

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
// cheap window read: the Phone-timestamp ISO of the first and last data rows (string-comparable, same-day/format)
function isoWindow(path) {
  const t = readFileSync(path, 'utf8');
  const nl = t.indexOf('\n');
  const first = t.slice(nl + 1, t.indexOf('\n', nl + 1)).split(';')[0];
  const lastNl = t.lastIndexOf('\n', t.length - 2);
  const last = t.slice(lastNl + 1).split(';')[0];
  return [first, last];
}
const overlapSec = (a, b) => {
  const lo = a[0] > b[0] ? a[0] : b[0],
    hi = a[1] < b[1] ? a[1] : b[1];
  if (lo >= hi) return 0;
  return (Date.parse(hi) - Date.parse(lo)) / 1000;
};

function beatsFromPPG(path) {
  const rec = P.parsePPG(readFileSync(path, 'utf8'));
  const res = P.analyze(rec);
  const out = [];
  const feet = res.footSec || [];
  for (let k = 1; k < feet.length; k++) {
    const dt = feet[k] - feet[k - 1];
    if (dt > 0.3 && dt < 2) out.push({ tMs: rec.t0Ms + feet[k] * 1000, hr: 60 / dt });
  }
  return { out, res, rec };
}
function beatsFromECG(path) {
  const rec = E.parseECG(readFileSync(path, 'utf8'));
  const res = E.analyze(rec);
  const out = [];
  const pk = res.peaks || [];
  for (let k = 1; k < pk.length; k++) {
    const dt = (pk[k] - pk[k - 1]) / rec.fs;
    if (dt > 0.3 && dt < 2) out.push({ tMs: rec.t0Ms + (pk[k] / rec.fs) * 1000, hr: 60 / dt });
  }
  return out;
}
function ringHRSeries(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const hdr = lines[0].split(',').map((h) => h.trim());
  const iT = hdr.indexOf('Time'),
    iP = hdr.indexOf('Pulse Rate');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length <= iP) continue;
    const ts = CK.parseTimestamp((c[iT] || '').trim(), { preferDMY: true });
    const hr = parseFloat(c[iP]);
    if (ts && isFinite(hr) && hr > 0) out.push({ tMs: ts.tMs, hr });
  }
  return out;
}

const dirs = process.argv.slice(2);
const rows = [];
for (const d of dirs) {
  const files = readdirSync(d).map((f) => join(d, f));
  const ppgs = files.filter((f) => /O2Ring.*_PPG\.txt$/.test(f) && statSync(f).size > 200000);
  const ecgs = files.filter((f) => /H10.*_ECG\.txt$/.test(f) && statSync(f).size > 200000);
  const spo2s = files.filter((f) => /O2Ring.*_SPO2\.csv$/.test(f));
  if (!ppgs.length || !ecgs.length || !spo2s.length) continue;
  const ecgWin = ecgs.map((f) => ({ f, w: isoWindow(f) }));
  const spoWin = spo2s.map((f) => ({
    f,
    w: (() => {
      const l = readFileSync(f, 'utf8').split(/\r?\n/);
      const p = (s) => {
        const m = CK.parseTimestamp((s.split(',')[0] || '').trim(), { preferDMY: true });
        return m ? new Date(m.tMs).toISOString().slice(0, 19) : null;
      };
      return [p(l[1] || ''), p(l[l.length - 2] || l[l.length - 1] || '')];
    })()
  }));
  for (const pf of ppgs) {
    let pw;
    try {
      pw = isoWindow(pf);
    } catch {
      continue;
    }
    const be = ecgWin.map((e) => ({ ...e, ov: overlapSec(pw, e.w) })).sort((a, b) => b.ov - a.ov)[0];
    if (!be || be.ov < 45) continue; // need a real shared window
    const bs = spoWin.map((s) => ({ ...s, ov: s.w[0] && s.w[1] ? overlapSec(pw, s.w) : 0 })).sort((a, b) => b.ov - a.ov)[0];
    if (!bs || bs.ov < 45) continue;
    let pB, eB, rB;
    try {
      pB = beatsFromPPG(pf);
      eB = beatsFromECG(be.f);
      rB = ringHRSeries(bs.f);
    } catch (err) {
      rows.push({ sess: d, pf, err: String(err).slice(0, 60) });
      continue;
    }
    const lo = Math.max(pB.out[0]?.tMs ?? Infinity, eB[0]?.tMs ?? Infinity, rB[0]?.tMs ?? Infinity);
    const hi = Math.min(pB.out.at(-1)?.tMs ?? -Infinity, eB.at(-1)?.tMs ?? -Infinity, rB.at(-1)?.tMs ?? -Infinity);
    if (!(hi > lo)) continue;
    const win = (a) => a.filter((x) => x.tMs >= lo && x.tMs <= hi).map((x) => x.hr);
    const mP = median(win(pB.out)),
      mE = median(win(eB)),
      mR = median(win(rB));
    if (mP == null || mE == null || mR == null) continue;
    rows.push({
      sess: d.replace('/home/michal/', ''),
      file: pf.split('/').pop().slice(-22),
      winSec: Math.round((hi - lo) / 1000),
      mP,
      mE,
      mR,
      dR: Math.abs(mP - mR),
      dE: Math.abs(mP - mE),
      feet: (pB.res.footSec || []).length,
      single: pB.res.ledSingleChannel,
      led: pB.res.ledAgreementPct
    });
  }
}

console.log('=== O2Ring finger-site round-trip — REAL-DATA VALIDATION SWEEP ===\n');
console.log('sess/day       win(s)  PPG-HR  ring-HR  ECG-HR   Δring  ΔECG  feet  single  led   verdict');
let pass = 0,
  tot = 0;
for (const r of rows) {
  if (r.err) {
    console.log(`  ${r.sess}  ${r.file}  ERR ${r.err}`);
    continue;
  }
  tot++;
  const ok = r.dR <= 3 && r.dE <= 3 && r.feet > 10;
  if (ok) pass++;
  const day = r.sess.split('/').pop();
  console.log(
    `${day}   ${String(r.winSec).padStart(5)}  ${r.mP.toFixed(1).padStart(5)}  ${r.mR.toFixed(1).padStart(6)}  ${r.mE.toFixed(1).padStart(6)}   ${r.dR.toFixed(1).padStart(4)}  ${r.dE.toFixed(1).padStart(4)}  ${String(r.feet).padStart(4)}  ${String(r.single).padStart(5)}  ${String(r.led).padStart(4)}   ${ok ? 'PASS' : 'FAIL'}`
  );
}
console.log(`\n${pass}/${tot} pairs PASS (both Δ ≤ 3 bpm, feet detected).`);
