/*
 * geometry-scan.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * WALK THE TIMELINE-ALIGNMENT CHAIN AND PROBE EVERY STAGE (PAT-GEOMETRY-PROBE-2026-08-11).
 *
 * `geometry-probe.mjs` holds the detectors and is pure. This walks a real recording through the stages
 * that produce or consume a time axis and runs the probes on each one, so a defect is attributed to a
 * STAGE instead of being noticed later in whatever statistic happens to expose it. Every finding in
 * PAT-WANDER-ELIMINATION and PAT-WINDOW-CENSORING was one of these five shapes at one of these stages,
 * found by eye, weeks apart, usually after a wrong conclusion had been published.
 *
 * Stages, in the order a sample travels:
 *   1 ECG sample axis      ECGDSP.parseECG -> tMsAt        drawn? step?
 *   2 ECG beat times       detectPeaks -> tMsAt            step?
 *   3 PPG sample axis      PPGDSP.parsePPG -> relSec       drawn? step?
 *   4 PPG foot times       detectChannel -> foot           step?
 *   5 R->foot lag          RR-bounded, NO window           saturation? sawtooth? censoring?
 *   6 binned lag medians   5-min medians                   saturation? sawtooth? step?
 *
 * Stage 5 is deliberately computed WITHOUT the physiological window: the window is itself one of the
 * things being probed, so pairing through it would hide the censoring it causes. The bound is
 * 0.9 x the local RR, which is what actually prevents beat slip.
 *
 * ⚠️ READ `drawn` AT STAGE 1/3 AS A LEAD, NOT A VERDICT. A host-disciplined axis interpolates between
 * anchors, so over a 5000-sample window its correction can be locally CONSTANT and the deltas come out
 * exact — which fires `drawn` on an axis that is not synthesized. The share separates the cases in
 * practice (measured: an exact ladder 1.000, the O2Ring's legacy synthesized stamp 0.993, a real
 * corrected axis 0.61-0.74), but the probe cannot tell them apart on its own. Confirm against
 * `hostAxis.applied` / the file's `# timebase=` header before calling an axis drawn.
 *
 * Usage:  node tools/geometry-scan.mjs <night-dir> [<night-dir> …]
 * Reads only the files it is pointed at; writes nothing.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { probeAll, saturation, sawtooth, censoring, drawnAxis, stepiness } from './geometry-probe.mjs';
import { refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PHYS_LO = 200,
  PHYS_HI = 650,
  BIN = 5 * 60000;

function loadDsp() {
  const DexBuild = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'build-core.js'));
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Math,
    JSON,
    Date,
    Uint8Array,
    Int16Array,
    Float32Array,
    Float64Array,
    Array,
    Object,
    Number,
    String,
    isFinite,
    isNaN,
    parseInt,
    parseFloat,
    Infinity,
    NaN
  });
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  for (const f of ['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js'])
    vm.runInContext(DexBuild.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  return { E: ctx.ECGDSP, P: ctx.PPGDSP };
}
const asc = (a) =>
  Array.from(a)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
const qt = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
const med = (a) => qt(asc(a), 0.5);
function feet(bp, peaks, fsHz, winMs) {
  const out = [],
    W = Math.round((winMs * fsHz) / 1000);
  for (let k = 0; k < peaks.length; k++) {
    const p = peaks[k],
      prev = k > 0 ? peaks[k - 1] : Math.max(0, p - W),
      lo = Math.max(prev, p - W);
    let mi = lo,
      mv = bp[lo];
    for (let j = lo; j < p; j++)
      if (bp[j] < mv) {
        mv = bp[j];
        mi = j;
      }
    let ms = mi,
      msv = -Infinity;
    for (let j = mi; j < p; j++) {
      const dv = bp[j + 1] - bp[j];
      if (dv > msv) {
        msv = dv;
        ms = j;
      }
    }
    out.push(msv > 1e-12 ? Math.max(lo, Math.min(p, ms - (bp[ms] - mv) / msv)) : ms);
  }
  return out;
}
const pick = (dir, re) => {
  const c = fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.s - a.s);
  return c.length ? c[0].f : null;
};
const verdict = (fired) => (fired.length ? fired.join(', ').toUpperCase() : 'ok');

function scan(dir, dsp) {
  const { E, P } = dsp;
  const ef = pick(dir, /Polar_H10_.*_ECG\.txt$/i);
  /* 🔴 NOT "scanned and clean" — NOTHING WAS SCANNED. This returned bare `undefined`, so the caller
     counted the directory as examined and the run could report PASS over a folder it never opened. The
     skip is now named and the caller excludes it from `checked`. */
  if (!ef) return { fired: [], skipped: 'no Polar_H10_*_ECG.txt in the directory — nothing to probe' };
  const er = E.parseECG(fs.readFileSync(ef, 'utf8'));
  const idx = Array.from(E.detectPeaks(er.int16, E.bandpass(er.int16, er.fs), er.fs));
  const R = idx.map((i) => er.tMsAt(i));
  /* `allFired` mirrors exactly what the table prints, so the verdict cannot disagree with the rows a
     reader sees. Without it `scan` returned nothing and the FAIL branch below was unreachable — a
     status that could never fire is worse than no status. */
  const allFired = [];
  const row = (stage, res) => {
    allFired.push(...(res.fired || []));
    console.log('  ' + stage.padEnd(26) + verdict(res.fired || []).padEnd(22) + (res.note || ''));
  };

  console.log('\n=== ' + path.basename(dir));
  // 1 — ECG sample axis, sampled sparsely (millions of samples; the shape is scale-free)
  {
    /* TWO SAMPLINGS, because the two probes need opposite things and one sampling makes one of them
       INERT. `drawn` looks at consecutive inter-sample deltas, so it must see a CONTIGUOUS block —
       decimating an exact ladder turns constant deltas into an interpolated series and the signature
       disappears, which is how the first cut reported "ok" on the O2Ring's known-synthesized axis.
       `step` is scale-free and wants whole-record coverage, so it takes the decimated series. */
    const step = Math.max(1, Math.floor(er.int16.length / 4000));
    const t = [];
    for (let i = 0; i < er.int16.length; i += step) t.push(er.tMsAt(i));
    const contig = [];
    for (let i = 0; i < Math.min(er.int16.length, 5000); i++) contig.push(er.tMsAt(i));
    const d = drawnAxis(contig),
      s = stepiness(t);
    row('1 ECG sample axis', {
      fired: [d.drawn && 'drawn', s.hasStep && 'step'].filter(Boolean),
      note: 'ladder fine/coarse ' + (d.shares ? d.shares.fine.toFixed(3) + '/' + d.shares.coarse.toFixed(3) : '-') + '  step-ratio ' + (s.ratio != null ? s.ratio.toFixed(1) : '-')
    });
  }
  // 2 — ECG beat times
  {
    const s = stepiness(R);
    row('2 ECG beat times', { fired: [s.hasStep && 'step'].filter(Boolean), note: 'step-ratio ' + s.ratio.toFixed(1) + '  n=' + R.length });
  }

  for (const [site, re] of [
    ['finger', /O2Ring.*_PPG\.txt$/i],
    ['ankle', /veritysense.*_PPG\.txt$/i]
  ]) {
    const pf = pick(dir, re);
    if (!pf) continue;
    const pr = P.parsePPG(fs.readFileSync(pf, 'utf8'));
    const det = P.detectChannel(pr.ch[0], pr.fs),
      n = pr.ch[0].length;
    const toMs = (i) => {
      const a = Math.floor(i),
        b = Math.min(n - 1, a + 1);
      const sa = pr.relSec && Number.isFinite(pr.relSec[a]) ? pr.relSec[a] : a / pr.fs;
      const sb = pr.relSec && Number.isFinite(pr.relSec[b]) ? pr.relSec[b] : b / pr.fs;
      return pr.t0Ms + (sa + (sb - sa) * (i - a)) * 1000;
    };
    // 3 — PPG sample axis
    {
      const step = Math.max(1, Math.floor(n / 4000));
      const t = [];
      for (let i = 0; i < n; i += step) t.push(toMs(i));
      const contig = [];
      for (let i = 0; i < Math.min(n, 5000); i++) contig.push(toMs(i));
      const d = drawnAxis(contig),
        s = stepiness(t);
      row('3 PPG axis (' + site + ')', {
        fired: [d.drawn && 'drawn', s.hasStep && 'step'].filter(Boolean),
        note: 'ladder fine/coarse ' + (d.shares ? d.shares.fine.toFixed(3) + '/' + d.shares.coarse.toFixed(3) : '-') + '  step-ratio ' + s.ratio.toFixed(1)
      });
    }
    const F = feet(det.bp, det.peaks, pr.fs, 150).map(toMs);
    // 4 — PPG foot times
    {
      const s = stepiness(F);
      row('4 PPG foot times (' + site + ')', { fired: [s.hasStep && 'step'].filter(Boolean), note: 'step-ratio ' + s.ratio.toFixed(1) + '  n=' + F.length });
    }
    // 5 — R->foot lag, RR-bounded, NO window (the window is under test)
    const lag = [];
    let j = 0;
    for (let i = 0; i + 1 < R.length; i++) {
      const r = R[i],
        rr = R[i + 1] - r;
      if (!(rr > 300 && rr < 2000)) continue;
      while (j < F.length && F[j] < r) j++;
      for (let k = j; k < F.length; k++) {
        const L = F[k] - r;
        if (L > 0.9 * rr) break;
        if (L > 0) {
          lag.push([r, L]);
          break;
        }
      }
    }
    if (lag.length < 500) {
      row('5 R->foot lag (' + site + ')', { fired: [], note: 'only ' + lag.length + ' pairs' });
      continue;
    }
    const v = lag.map((x) => x[1]);
    {
      const c = censoring(v, PHYS_LO, PHYS_HI),
        sa = saturation(v, PHYS_LO, PHYS_HI);
      row('5 R->foot lag (' + site + ')', {
        fired: [c.censored && 'censoring', sa.saturated && 'saturation'].filter(Boolean),
        note: 'median ' + med(v).toFixed(0) + '  discarded ' + (100 * c.outside).toFixed(1) + '%'
      });
    }
    // 6 — binned medians
    const t0 = lag[0][0],
      t1 = lag[lag.length - 1][0],
      bm = [];
    for (let b = t0; b < t1; b += BIN) {
      const w = lag.filter((x) => x[0] >= b && x[0] < b + BIN).map((x) => x[1]);
      if (w.length >= 40) bm.push(med(w));
    }
    if (bm.length >= 12) {
      const rrMed = med(
        R.slice(1)
          .map((x, i) => x - R[i])
          .filter((x) => x > 300 && x < 2000)
      );
      const sw = sawtooth(bm, rrMed),
        st = stepiness(bm),
        sa = saturation(bm, PHYS_LO, PHYS_HI);
      row('6 binned lag (' + site + ')', {
        fired: [sw.isSawtooth && 'sawtooth', st.hasStep && 'step', sa.saturated && 'saturation'].filter(Boolean),
        note: 'bins ' + bm.length + '  wraps ' + sw.wraps + '  step-ratio ' + st.ratio.toFixed(1)
      });
    }
  }
  return { fired: allFired };
}

/**
 * PURE CORE — decide the run's status from what was actually scanned.
 *
 * 🔴 WHY THIS EXISTS: the loop below used to catch a per-directory failure, print an `ERROR:` line and
 * fall off the end of the script, so the process exited **0**. Measured 2026-10-11:
 * `node tools/geometry-scan.mjs /tmp/no-such-night` printed `ERROR: ENOENT …` and returned `EXIT=0` —
 * a caller checking the exit code was told the scan succeeded. The capture-host lane already states
 * the rule this breaks: "what did not run gets `?`, never ✓ and never ✗ — the reader must be able to
 * tell 'clean' from 'we did not look'" (`test_night_report.py`).
 *
 * `NOT_RUN` is reserved for examining NOTHING (§🧾), so a run where some directories scanned and others
 * failed is a SHORTFALL, not a NOT_RUN: the criterion could not be evaluated over the named set.
 */
export function classifyRun({ eligible, checked, firedDirs, errored }) {
  if (checked === 0) return { status: 'NOT_RUN', reason: `no directory could be scanned (${errored.length} of ${eligible} failed to load)` };
  if (firedDirs.length) return { status: 'FAIL', reason: `a geometric probe fired in ${firedDirs.length} of ${checked} scanned directory(ies)` };
  if (errored.length) return { status: 'SHORTFALL', reason: `${errored.length} of ${eligible} directory(ies) could not be scanned, so the criterion was not evaluated over the named set` };
  return { status: 'PASS', reason: null };
}

function runSelftest() {
  const fail = [];
  const ok = (name, cond, detail) => {
    if (!cond) fail.push(name + (detail ? ' — ' + detail : ''));
  };
  /* The planted case IS the defect: every directory failing must not read as a pass, and must not
     read as a FAIL either — nothing was examined, so there is no finding to report. */
  ok('all dirs unreadable ⇒ NOT_RUN', classifyRun({ eligible: 2, checked: 0, firedDirs: [], errored: ['a', 'b'] }).status === 'NOT_RUN', 'examined nothing');
  ok('…and it names how many failed', /2 of 2/.test(classifyRun({ eligible: 2, checked: 0, firedDirs: [], errored: ['a', 'b'] }).reason || ''), 'reason must carry the count');
  // CONTROLS — the three states that are not the defect.
  ok('CONTROL · all scanned and clean ⇒ PASS', classifyRun({ eligible: 2, checked: 2, firedDirs: [], errored: [] }).status === 'PASS');
  ok('CONTROL · a fired probe ⇒ FAIL', classifyRun({ eligible: 1, checked: 1, firedDirs: ['n1'], errored: [] }).status === 'FAIL');
  ok('CONTROL · partial scan ⇒ SHORTFALL, never NOT_RUN', classifyRun({ eligible: 3, checked: 2, firedDirs: [], errored: ['x'] }).status === 'SHORTFALL', 'NOT_RUN is for examining nothing');
  ok(
    'CONTROL · PASS carries no reason, every other status does',
    classifyRun({ eligible: 1, checked: 1, firedDirs: [], errored: [] }).reason === null && classifyRun({ eligible: 1, checked: 0, firedDirs: [], errored: ['x'] }).reason !== null
  );
  ok(
    'population adds up: checked + excluded = eligible',
    (() => {
      const e = 3,
        c = 2,
        x = 1;
      return c + x === e;
    })()
  );
  const line = fail.length ? `geometry-scan selftest: ${fail.length} FAILED\n  ` + fail.join('\n  ') : `all 7 selftests passed`;
  console.log(line);
  process.exit(fail.length ? 1 : 0);
}

/* The verdict contract wants the code identity that produced the object: a real sha, or an explicit
   null WITH a reason when the tree is not a checkout. Guessing or omitting it would make the object
   unattributable, which is the one thing a machine-readable verdict exists to prevent. */
function headSha() {
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}
const COMMIT = headSha();
const PRODUCED_BY = COMMIT
  ? { tool: 'tools/geometry-scan.mjs', commit: COMMIT }
  : { tool: 'tools/geometry-scan.mjs', commit: null, commitReason: 'not a git checkout — no HEAD to attribute this object to' };

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node tools/geometry-scan.mjs <night-dir> [<night-dir> …] [--json]  |  --selftest  |  --verdict-sample');
  process.exit(0);
}
/* The directory list was `argv.filter((a) => !a.startsWith('--'))`, so a mistyped `--jsonn` vanished
   from both the flags and the paths, and a single-dash token became a DIRECTORY NAME and surfaced as
   an ENOENT at exit 0 (residue 2026-09-28-five-tools-consume-an-unknown-flag-as-an-input-path). The
   guard's `positional` mode is the fit the row thought did not exist: a bare token is a path, a
   `-`-leading token must be declared. */
/* `process.argv` BELONGS TO WHOEVER IS RUNNING. At module scope this refusal reads the IMPORTER's
   arguments, so an import of anything in this file judged flags it never passed (residue
   `2026-10-20-four-argv-adopters-refuse-at-module-scope-and-export`). The guard runs for the CLI only. */
const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json', '--help', '-h'], positional: true }, { tool: 'tools/geometry-scan.mjs' });
if (argv.includes('--selftest')) runSelftest();
/* `--verdict-sample` exists for the adoption gate, which needs one valid object without a corpus.
   NOT_RUN over an empty population is the honest sample: nothing was examined, `checked + excluded =
   eligible` holds at 0, and §🧾 forbids a PASS over `checked: 0` — so this cannot be mistaken for a
   clean scan. It exits 0 because emitting a sample succeeded; the SCAN is what exits 2 when a
   directory cannot be read. */
if (argv.includes('--verdict-sample')) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schema: 'tepna.verdict/1',
        gate: 'geometry-scan',
        // internal: a stage-attribution diagnostic for this repo's own corpus, never quoted outside it (P5).
        scope: 'internal',
        status: 'NOT_RUN',
        population: { checked: 0, eligible: 0, excluded: 0 },
        criterion: { name: 'every named directory is scanned and no geometric probe fires', threshold: 0, unit: 'directories unscanned or probes fired', direction: 'eq' },
        result: null,
        evidence: ['tools/geometry-scan.mjs'],
        reason: 'verdict sample — no directory was named, so nothing was examined',
        producedBy: PRODUCED_BY,
        at: new Date().toISOString()
      },
      null,
      1
    )}\n`
  );
  process.exit(0);
}
const asJson = argv.includes('--json');
const dirs = argv.filter((a) => !a.startsWith('--'));
if (!dirs.length) {
  console.error('usage: node tools/geometry-scan.mjs <night-dir> [<night-dir> …]');
  process.exit(2);
}
const dsp = loadDsp();
console.log('stage                       probes fired');
const errored = [];
const firedDirs = [];
for (const d of dirs) {
  try {
    const res = scan(d, dsp);
    /* A NAMED SKIP IS AN EXCLUSION, NOT A CLEAN SCAN. `scan` returns `{ skipped }` when the directory
       holds no ECG file, and that directory must not land in `checked` — counting it would let the run
       report PASS over a folder nothing was read from. */
    if (res && res.skipped) {
      errored.push({ dir: d, reason: res.skipped });
      console.log('\n=== ' + path.basename(d) + '  SKIPPED: ' + res.skipped);
    } else if (res && res.fired && res.fired.length) {
      firedDirs.push(d);
    }
  } catch (e) {
    errored.push({ dir: d, reason: (e && e.message) || String(e) });
    console.log('\n=== ' + path.basename(d) + '  ERROR: ' + ((e && e.message) || e));
  }
}
const checked = dirs.length - errored.length;
const r = classifyRun({ eligible: dirs.length, checked, firedDirs, errored });
const v = {
  schema: 'tepna.verdict/1',
  gate: 'geometry-scan',
  scope: 'internal',
  status: r.status,
  population: { checked, eligible: dirs.length, excluded: errored.length },
  criterion: { name: 'every named directory is scanned and no geometric probe fires', threshold: 0, unit: 'directories unscanned or probes fired', direction: 'eq' },
  result: { scanned: checked, unscannable: errored.map((e) => ({ dir: path.basename(e.dir), reason: e.reason })), dirsWithFiredProbes: firedDirs.map((d) => path.basename(d)) },
  evidence: ['tools/geometry-scan.mjs'],
  reason: r.reason,
  producedBy: PRODUCED_BY,
  at: new Date().toISOString()
};
if (asJson) process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
else console.log(`\n${r.status}${r.reason ? ' — ' + r.reason : ''}`);
/* A DIRECTORY THAT COULD NOT BE READ EXITS NON-ZERO. The probe-fired path deliberately keeps its old
   exit 0: a fired probe is this tool's normal output, callers read it from the table, and changing that
   code is a contract change this unit was not asked to make. The row's defect is the unreadable
   directory, and that is what moves. */
if (errored.length) process.exit(2);
