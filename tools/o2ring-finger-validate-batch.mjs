// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
// Batch real-data validation of the O2Ring finger-site round-trip (PPGDEX-O2RING-FINGER-SITE §6).
// Discovers every capture session with an O2Ring PPG + a paired H10 ECG + the ring's SPO2, matches
// each substantial PPG segment to the best-overlapping ECG, and runs the three-way HR comparison.
// One row per pair. NOT a CI gate (reads gitignored real captures) — an operator validation sweep.
//
//   node tools/o2ring-finger-validate-batch.mjs <dir> [<dir> ...]
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { gitShort } from './verdict-emit.mjs';
const Verdict = createRequire(import.meta.url)('../verdict.js');

/* ROOT is derived from THIS FILE's location, never hardcoded. Both O2Ring finger tools shipped with an
   absolute path to the author's throwaway worktree (`…/wt-fingerval`, `…/wt-fingerrt`) baked in. Those
   worktrees were removed the day they were made, so both tools have been UNRUNNABLE ANYWHERE since the
   commit that added them — including for the author — while two briefs cite them as the evidence for a
   hardware round-trip and for the ≥10-night tier call. Nothing caught it: they are operator sweeps over
   gitignored captures, so no gate runs them, and a tool that no gate runs is a tool nobody notices is
   dead. (ENGINE-VERIFICATION §0: a comment is not a measurement; a committed tool is not a working one.) */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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

/* Accept a shell glob without dying on it. `captures/*` expands to the session directories AND any
   stray file beside them (`status.json` here), and `readdirSync` on a file throws ENOTDIR — so the
   obvious invocation killed the whole sweep before a single row printed. Filter, don't assume. */
const dirs = process.argv.slice(2).filter((d) => {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
});
/* ── CHEAP EXITS BEFORE THE CORPUS IS TOUCHED ─────────────────────────────────────────────────────────
   `--verdict-sample` is what `tools/verdict-adoption.mjs --check` RUNS to read this tool's object (an
   adoption the gate cannot read is a claim, per its own message), and `--selftest` carries the plants.
   Both must answer without a capture directory, so they sit above the arg check. `gateVerdict` is a
   function DECLARATION and therefore hoisted, so it is callable here though it reads better at the tail
   beside the print it explains. */
if (process.argv.includes('--verdict-sample')) {
  /* A representative object, not a measurement: the shape a real run emits, with the batch counts of the
     documented sweep (88/92) so a reader sees the UNKNOWN in its natural setting. */
  console.log(JSON.stringify(gateVerdict({ pass: 88, tot: 92, errs: 0, medianDeltaRing: 0.4, commit: gitShort() })));
  process.exit(0);
}
if (process.argv.includes('--selftest')) {
  let bad = 0,
    good = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✕ ') + name + (detail ? '  — ' + detail : ''));
    if (cond) good++;
    else bad++;
  };
  /* PLANT 1 · no stated bar ⇒ UNKNOWN, never PASS. This is the row's whole point: `N/M` read as a pass. */
  const noBar = gateVerdict({ pass: 92, tot: 92, errs: 0, medianDeltaRing: 0.4, commit: null });
  ok('PLANT · a batch with NO stated aggregate bar is UNKNOWN, not PASS', noBar.status === 'UNKNOWN', 'got ' + noBar.status);
  ok(
    'PLANT · …even when every pair passes (92/92) — a clean batch cannot talk itself into a bar',
    noBar.status === 'UNKNOWN' && /no pre-stated aggregate criterion/.test(noBar.reason || ''),
    noBar.reason || 'no reason'
  );
  /* PLANT 2 · one failing pair still cannot read PASS. Under a stated bar it is judged; with none it stays
     UNKNOWN. Both halves asserted, because "not PASS" is satisfied by FAIL too and that would be the wrong
     answer when no bar exists. */
  const oneFail = gateVerdict({ pass: 91, tot: 92, errs: 0, medianDeltaRing: 0.4, commit: null });
  ok('PLANT · a batch with one failing pair does not read PASS', oneFail.status !== 'PASS', 'got ' + oneFail.status);
  ok('PLANT · …and it is UNKNOWN rather than FAIL, because no bar exists to fail against', oneFail.status === 'UNKNOWN', 'got ' + oneFail.status);
  /* CONTROL · the seam works, so UNKNOWN is a statement about the DOC and not about this code. */
  const withBar = gateVerdict({ pass: 91, tot: 92, errs: 0, medianDeltaRing: 0.4, commit: null, aggregateBar: { minFraction: 0.95 } });
  ok('CONTROL · given a bar, the tool decides (91/92 ≥ 0.95 ⇒ PASS)', withBar.status === 'PASS', 'got ' + withBar.status);
  const underBar = gateVerdict({ pass: 80, tot: 92, errs: 0, medianDeltaRing: 0.4, commit: null, aggregateBar: { minFraction: 0.95 } });
  ok('CONTROL · and fails below it (80/92 < 0.95 ⇒ FAIL)', underBar.status === 'FAIL', 'got ' + underBar.status);
  ok(
    'CONTROL · a bar is never inferred from the batch — the same counts give UNKNOWN without one',
    gateVerdict({ pass: 80, tot: 92, errs: 0, medianDeltaRing: 0.4, commit: null }).status === 'UNKNOWN'
  );
  /* NOT_RUN · no eligible pair examined nothing; it must not read as a clean batch. */
  const none = gateVerdict({ pass: 0, tot: 0, errs: 3, medianDeltaRing: null, commit: null });
  ok('no eligible pair ⇒ NOT_RUN with checked:0, never PASS', none.status === 'NOT_RUN' && none.population.checked === 0, none.status + ' checked=' + none.population.checked);
  ok(
    'every emitted object validates under verdict.js',
    [noBar, oneFail, withBar, underBar, none].every((v) => Verdict.validate(v).ok)
  );
  /* The summary line is the format `tools/selftest-all.mjs` parses — it refused the first version with
     "end its selftest with `all <N> selftests passed`", so a tool whose assertions all pass can still be
     reported as green-but-uncountable, which is how a tool quietly losing its selftest would hide. */
  console.log(bad ? '✕ ' + bad + ' of ' + (good + bad) + ' selftests failed' : '✓ all ' + good + ' selftests passed');
  process.exit(bad ? 1 : 0);
}
if (!dirs.length) {
  console.error('no directories given — usage: node tools/o2ring-finger-validate-batch.mjs <captures-dir> [...]');
  process.exit(2);
}
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

/* ── ONE tepna.verdict/1, AND IT SAYS UNKNOWN (CLAUDE.md §🧾) ──────────────────────────────────────────
   PRE-STATED CRITERION, with its source:
     · PER PAIR — `|PPG − ring| ≤ 3 bpm` AND `|PPG − ECG| ≤ 3 bpm` AND `feet > 10`. Exact, and it is the
       rule the per-pair column already applies; source `docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md`
       §"Validation sweep — not one session, ninety-two".
     · AGGREGATE — **none exists**. That same doc records the accepted run as 88/92 and attributes each of
       the four non-passes to the reference side individually (a ring field reading 70 where PpgDex tracked
       the ECG; two short/noisy ECG clips; one flat ECG that parseECG refused). It states a MEASUREMENT of
       that batch, not a bar for future batches.

   🔴 SO THE BATCH-LEVEL STATUS IS UNKNOWN, and inventing a bar here would be the one thing the contract
   forbids: "a threshold derived from the data it judges emits status: UNKNOWN with that as the reason"
   (VERDICT-CONTRACT §criterion). An all-pairs rule would also CONVICT the run the doc ratified — a
   post-hoc band in reverse — and a fraction chosen to clear 88/92 would be a band fitted to its own
   evidence. The bar belongs in that doc (a fraction, or "every non-pass attributed to the reference
   side"), authored by whoever owns the finger-path claim; until then this tool decides per pair and says
   so, which is strictly more than the bare `N/M` it printed before.
   Residue 2026-09-22-finger-validate-batch-has-no-aggregate-bar.

   Pure and exported so the plants can drive it without a capture corpus. */
export function gateVerdict({ pass: nPass, tot: nTot, errs, medianDeltaRing, commit, at, aggregateBar }) {
  const producedBy = { tool: 'tools/o2ring-finger-validate-batch.mjs', commit: commit == null ? null : commit };
  if (commit == null) producedBy.commitReason = 'not run inside a git checkout';
  /* `aggregateBar` is a seam for the day the doc states one — NOT a default. Absent ⇒ UNKNOWN. It is
     never derived from nPass/nTot here, and the plant below asserts that a batch cannot talk itself into
     a bar. */
  const decided = aggregateBar && typeof aggregateBar.minFraction === 'number';
  const status = nTot === 0 ? 'NOT_RUN' : decided ? (nPass / nTot >= aggregateBar.minFraction ? 'PASS' : 'FAIL') : 'UNKNOWN';
  const v = Verdict.make({
    gate: 'o2ring-finger-validate-batch',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : nTot, eligible: nTot + errs, excluded: status === 'NOT_RUN' ? nTot + errs : errs },
    criterion: decided
      ? { name: 'pairs_passing_fraction', threshold: aggregateBar.minFraction, unit: 'fraction', direction: 'gte' }
      : { name: 'per_pair_hr_agreement_abs_delta', threshold: 3, unit: 'bpm', direction: 'lte' },
    result: status === 'NOT_RUN' ? null : { pairsPass: nPass, pairsTotal: nTot, pairsErrored: errs, medianAbsDeltaRing: medianDeltaRing == null ? null : medianDeltaRing },
    evidence: ['tools/o2ring-finger-validate-batch.mjs', 'docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md'],
    reason:
      status === 'NOT_RUN'
        ? 'no eligible pair: no capture session on disk carried an O2Ring PPG with a paired H10 ECG and the ring SPO2'
        : status === 'UNKNOWN'
          ? 'no pre-stated aggregate criterion — the per-pair rule is exact, but docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md records 88/92 as a measurement and states no batch-level bar. Deriving one from this batch would be a threshold taken from the data it judges.'
          : status === 'FAIL'
            ? nPass +
              ' of ' +
              nTot +
              ' pairs passed (' +
              (nTot ? (nPass / nTot).toFixed(3) : '0') +
              '), below the stated bar of ' +
              aggregateBar.minFraction +
              ' — short by ' +
              (nTot ? (aggregateBar.minFraction - nPass / nTot).toFixed(3) : '0')
            : null,
    producedBy,
    at: (at || new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z')
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error('o2ring-finger-validate-batch produced an invalid verdict: ' + chk.errors.join('; '));
  return v;
}

const _errs = rows.filter((r) => r.err).length;
const _dRs = rows
  .filter((r) => !r.err)
  .map((r) => r.dR)
  .sort((a, b) => a - b);
const _med = _dRs.length ? (_dRs.length % 2 ? _dRs[_dRs.length >> 1] : (_dRs[(_dRs.length >> 1) - 1] + _dRs[_dRs.length >> 1]) / 2) : null;
console.log('\nVERDICT (tepna.verdict/1) ' + JSON.stringify(gateVerdict({ pass, tot, errs: _errs, medianDeltaRing: _med, commit: gitShort() })));
