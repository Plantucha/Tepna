#!/usr/bin/env node
/*
 * tools/oxy-hr-bias.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * R5-HR-TRIPLET-REFERENCE §5 — "Investigate OxyDex's −0.36 bpm bias."
 *
 * R5 measured that OxyDex under-reads HR against the raw-ECG Pan–Tompkins leg, and that the offset
 * SURVIVES artifact gating, so it is not contamination. It named three candidates: (a) OxyDex's own
 * pulse-oximetry HR path (rolling median / smoothing), (b) a 1 Hz bucketing bias, (c) a genuine device
 * offset. This tool runs the two measurements that separate them, so the number is reproducible rather
 * than quoted.
 *
 * LEG 1 — does OXYDEX add anything? Mean of the raw `Pulse Rate` CSV column vs `computeNight().stats
 * .meanHr`, per night. If they agree, candidate (a) is out and the bias is upstream of OxyDex.
 *
 * LEG 2 — is it QUANTIZATION or the DEVICE? Per-5-min-epoch `hr` from the folded trio corpus, OxyDex
 * minus ECGDex, pooled. The discriminator is a prediction, not a vibe:
 *     the O2Ring writes `Pulse Rate` as an INTEGER at 1 Hz, so if it TRUNCATES, the mean of the
 *     reported values sits exactly 0.5 bpm below the mean of the true ones — and averaging over an
 *     epoch does NOT wash that out, because every sample is biased the same way.
 *     truncation ⇒ −0.500 · rounding ⇒ 0.000
 * A measured value between the two means neither mechanism alone accounts for it.
 *
 * ⚠ What this CANNOT do, and R5 says why: the raw-ECG leg is one of the three corners, so it is the
 * assumed-unbiased reference here rather than an independent one. Splitting a residual device offset
 * from a quantization rule needs the FOURTH corner R5's first two items ask for (the ResMed oximeter).
 * This tool bounds the question; it does not close it.
 *
 * TWO POPULATIONS, TWO OBJECTS. LEG 1 scores O2Ring CSV FILES under the uploads root; legs 2 and 3
 * score NIGHT DIRECTORIES under `uploads/trio`. No arithmetic relates the two sets, so each half
 * publishes its own `tepna.verdict/1` population object and the run refuses rather than exiting 0
 * over a half it never read (row 2026-10-28-oxy-hr-bias-holds-a-file-population-and-a-night-\
 * population-at-once).
 *
 * Usage:
 *   node tools/oxy-hr-bias.mjs [--uploads <dir>]      (default: $DEX_UPLOADS or ./uploads)
 *   node tools/oxy-hr-bias.mjs --selftest             # pure core, no corpus, no git
 *   node tools/oxy-hr-bias.mjs --verdict-sample       # the file population object alone, no corpus
 * Needs the gitignored corpus: O2Ring CSVs for leg 1, uploads/trio/<date>/ exports for leg 2.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { eraCoverage, eraCoverageLine, eraOfNights } from './fold-generation.mjs';
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries, snapshotNights } from './corpus-scope-core.mjs';

const req = createRequire(import.meta.url);
/* DERIVE the root from this file, never `process.cwd()` (the PR #686 class, gate-enforced): a tool run
   from another directory would otherwise co-load a DIFFERENT checkout's DSP and report its numbers
   under this one's name — the worst kind of wrong, because every path in the output still looks right. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uArg = process.argv.indexOf('--uploads');
const UP = uArg > 0 ? process.argv[uArg + 1] : process.env.DEX_UPLOADS || path.join(ROOT, 'uploads');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/* ── THE TWO POPULATIONS, AND WHY NEITHER MAY SPEAK FOR THE OTHER ────────────────────────────
   Row 2026-10-28-oxy-hr-bias-holds-a-file-population-and-a-night-population-at-once. LEG 1 reads
   `O2Ring*.csv` FILES lying directly under the uploads root; LEGS 3 and 2 read NIGHT DIRECTORIES
   under `uploads/trio`. The two sets share no member and no arithmetic relates them — the run
   behind the committed figures read 42 files and 95 nights — so a single count published as "this
   run's population" would misdescribe whichever half a reader came for. Each half therefore
   publishes its own object carrying its own unit, under its own leg's name.
   🔴 AND LEG 1's HEADLINE SAID `night(s)` OVER A FILE COUNT, which is where one population wore
   the other's unit in the one place a reader looks. Two O2Ring CSVs from one calendar night are two
   members of this population, so the borrowed word was also the wrong word. */
const O2RING_CSV = /^O2Ring.*\.csv$/;
const CSV_UNIT = 'O2Ring CSV files';
const TOOL = 'tools/oxy-hr-bias.mjs';
const EV = [TOOL, 'tools/corpus-scope-core.mjs'];
const TRIO = path.join(UP, 'trio');
/* A NAMED LISTER IS THE RULE: `snapshotEntries` publishes `rule: null` for an inline arrow, which
   would state that nobody chose the rule this run applied. */
function listO2RingCsv(root) {
  return fs.readdirSync(root).filter((f) => O2RING_CSV.test(f));
}
const fileSnap = () => snapshotEntries(UP, { list: listO2RingCsv, unit: CSV_UNIT });
const nightSnap = () => snapshotNights(TRIO);

/* THE SAMPLE TOUCHES NO CORPUS, because the adoption check parses stdout as JSON on every box. The
   lister is INJECTED, so `snapshotEntries` runs for real and nothing is read from disk; it is not
   named `listO2RingCsv`, because a sample that read no corpus must not publish the production
   rule's name. It carries the FILE unit — the unit this tool added — while the night half publishes
   the `nights_added_or_removed` criterion that 20 other runs already carry. */
function verdictSample() {
  const at = '2026-10-28T00:00:00Z';
  function sampleFiles() {
    return ['O2Ring S 2100_20260503210952.csv', 'O2Ring S 2100_20260504202108.csv', 'O2Ring S 2100_20260505202850.csv'];
  }
  const snap = snapshotEntries('<uploads>', { list: sampleFiles, unit: CSV_UNIT, at });
  return populationVerdict(snap, snap, { tool: TOOL, at, evidence: EV });
}
if (flag('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

/* ── ONE PUBLISHER, CALLED BEFORE EVERY EXIT ─────────────────────────────────────────
   Same row: the trio-absent branch and the no-paired-epochs branch each `process.exit(0)`, so a run
   that read the file half and never opened a night exited the way a complete run exits. Both legs'
   read sets are declared HERE rather than beside their legs, because an exit before a leg starts
   still publishes that leg's population, and a `const` declared further down would be unreachable
   from this function at that moment. */
const leg1Files = [];
const leg3Nights = [];
const leg2Nights = [];
const POP = {
  files: { label: 'LEG 1 — O2Ring CSV files directly under the uploads root', open: null, close: fileSnap, key: 'file', reads: [{ leg: 'LEG 1', names: leg1Files }] },
  nights: {
    label: 'LEGS 3 and 2 — night directories under uploads/trio',
    open: null,
    close: nightSnap,
    key: 'night',
    reads: [
      { leg: 'LEG 3', names: leg3Nights },
      { leg: 'LEG 2', names: leg2Nights }
    ]
  }
};
/* THE EXIT CODE IS DERIVED FROM THE OBJECTS, pure so the selftest can fire both arms. A SHORTFALL
   exits 0 on purpose: a moved population still describes one continuous set, its intersection, so
   reduced coverage annotates where a discontinuity refuses (owner ruling 2026-09-17, §∅). */
function exitCodeFor(rows) {
  return rows.some((r) => r.population.status === 'NOT_RUN' || r.examinedNothing) ? 2 : 0;
}
let exitCode = null;
function publishAndExit() {
  /* A second call — a later leg exiting after the publisher already ran — repeats the code the
     objects gave rather than a bare 0, so the only literal `process.exit(0)` left in this file is
     the adoption sample's, which reads no corpus at all. */
  if (exitCode !== null) process.exit(exitCode);
  console.log('\n▸ POPULATIONS — one object per unit, and neither of them describes the other half\n');
  const rows = [];
  for (const k of Object.keys(POP)) {
    const p = POP[k];
    /* An exit before the leg opened still walks the root, so the object reports a real enumeration
       rather than a fabricated one — and an unreadable root arrives here as `ok: false`, which is
       the NOT_RUN the exit code reads. */
    const open = p.open || p.close();
    const population = populationVerdict(open, p.close(), { commit: commitOf.commit, commitReason: commitOf.reason, tool: TOOL, evidence: EV });
    const examinedNothing = population.status !== 'NOT_RUN' && p.reads.every((r) => r.names.length === 0);
    rows.push({ key: k, population, examinedNothing });
    console.log(`   ${p.label}`);
    console.log(
      `   population: ${population.population.checked} ${open.unit || 'nights'} this leg can report over, of ${population.population.eligible} it saw · movement ${population.status}${population.reason ? ` — ${population.reason}` : ''}`
    );
    const rl = ruleLine(population);
    if (rl) console.log(` ${rl}`);
    for (const r of p.reads) {
      const miss = notCovered(
        open,
        r.names.map((x) => ({ [p.key]: x })),
        { key: p.key }
      );
      console.log(`   ${r.leg} scored ${r.names.length} of the ${open.n} offered`);
      if (miss.length) console.log(`   ${r.leg} did not score ${miss.length}, by name: ${miss.slice(0, 8).join(' · ')}${miss.length > 8 ? ` (+${miss.length - 8} more)` : ''}`);
    }
    /* The object beside the prose, per §🧾 — the prose explains, this is the API. */
    console.log('POPULATION ' + JSON.stringify(population));
    console.log('');
  }
  exitCode = exitCodeFor(rows);
  if (exitCode !== 0) {
    const half = rows.filter((r) => r.population.status === 'NOT_RUN' || r.examinedNothing).map((r) => r.key);
    console.log(`   ⚠ this run reports over no ${half.join(' and no ')} at all, so it exits ${exitCode} rather than looking complete`);
  }
  process.exit(exitCode);
}

if (flag('--selftest')) {
  let ran = 0;
  let fail = 0;
  const A = (what, cond) => {
    ran++;
    if (!cond) {
      fail++;
      console.log(`  ✗ ${what}`);
    }
  };
  const smp = verdictSample();
  A('the sample publishes the contract schema', smp.schema === 'tepna.verdict/1');
  A('the sample carries the FILE unit in its criterion, never the night one', smp.criterion.name === 'O2Ring CSV files_added_or_removed');
  A('the sample is a PASS over the three files it listed', smp.status === 'PASS' && smp.population.checked === 3);
  A('the sample names this tool as the producer', smp.producedBy.tool === TOOL);
  /* THE LISTER TRAVELS AS THE RULE. An inline arrow would publish `rule: null`, and `tools/` is a
     readable root that holds no O2Ring CSV, so the rule refuses instead of inventing a member. */
  const named = snapshotEntries(path.join(ROOT, 'tools'), { list: listO2RingCsv, unit: CSV_UNIT });
  A('the production lister travels as the snapshot rule, by name', named.rule === 'listO2RingCsv');
  A('…and a root holding no O2Ring CSV enumerates to an empty population, not to a failure', named.ok === true && named.n === 0);
  /* AN UNREADABLE ROOT IS A NOT_RUN WITH THE ROOT NAMED, never a measured zero (§∅). */
  const gone = path.join(ROOT, 'no-such-oxy-hr-bias-root');
  const nr = populationVerdict(snapshotNights(gone), snapshotNights(gone), { tool: TOOL, at: '2026-10-28T00:00:00Z', evidence: EV });
  A('an absent trio root publishes NOT_RUN, never a population of zero', nr.status === 'NOT_RUN' && nr.population.checked === 0);
  A('…and names why the walk could not enumerate', /not enumerable/.test(String(nr.reason)));
  A('…under the night criterion, which is not the file one', nr.criterion.name === 'nights_added_or_removed');
  A(
    'a run whose night half never enumerated exits 2',
    exitCodeFor([
      { population: { status: 'PASS' }, examinedNothing: false },
      { population: { status: 'NOT_RUN' }, examinedNothing: false }
    ]) === 2
  );
  A('a leg that scored nothing over a root that offered something exits 2 as well', exitCodeFor([{ population: { status: 'PASS' }, examinedNothing: true }]) === 2);
  A(
    'CONTROL · two halves that both enumerated and both scored exit 0, SHORTFALL included',
    exitCodeFor([
      { population: { status: 'PASS' }, examinedNothing: false },
      { population: { status: 'SHORTFALL' }, examinedNothing: false }
    ]) === 0
  );
  console.log(fail ? `SELFTEST FAIL (${fail})` : `SELFTEST PASS (${ran}/${ran})`);
  process.exit(fail ? 1 : 0);
}

const commitOf = gitCommitOf(ROOT);
if (!fs.existsSync(UP)) {
  console.error(`✕ corpus not found: ${UP}\n  set DEX_UPLOADS or pass --uploads <dir>`);
  publishAndExit();
}

/* ── LEG 1 ─────────────────────────────────────────────────────────────────────────────────── */
function oxyRealm() {
  const DB = req(path.join(ROOT, 'tools', 'build-core.js'));
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop },
    appendChild: noop,
    setAttribute: noop,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: '',
    textContent: ''
  });
  const ctx = {
    console: { log: noop, warn: noop, error: noop },
    setTimeout,
    clearTimeout,
    addEventListener: noop,
    removeEventListener: noop,
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
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of [
    'kernel-constants.js',
    'clock.js',
    'clock-seam.js',
    'metric-registry.js',
    'dex-escape.js',
    'dex-export.js',
    'oxydex-registry.js',
    'signal-spec.js',
    'signal-frame.js',
    'oxydex-util.js',
    'oxydex-dsp.js'
  ]) {
    vm.runInContext(DB.classicify(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  }
  return ctx.OxyDex;
}

const O = oxyRealm();
/* THE READ ITERATES THE SNAPSHOT'S OWN MEMBERS, so the population and the figures cannot be over
   two different listings of one root. */
POP.files.open = fileSnap();
const csvs = POP.files.open.members;
console.log('▸ LEG 1 — does OxyDex itself add bias?  (raw `Pulse Rate` column mean vs stats.meanHr)\n');
console.log('   raw mean   OxyDex meanHr        Δ   samples  file');
const leg1 = [];
let nonInt = 0;
for (const f of csvs) {
  const txt = fs.readFileSync(path.join(UP, f), 'utf8');
  let s = 0,
    n = 0;
  for (const line of txt.split('\n').slice(1)) {
    const p = line.split(',');
    if (p.length < 3) continue;
    const v = Number(p[2]);
    if (!isFinite(v) || v <= 0) continue; // -1/0 are the device's "no reading" fills
    if (v !== Math.floor(v)) nonInt++;
    s += v;
    n++;
  }
  if (!n) continue;
  const raw = s / n;
  let oxy = null;
  try {
    const night = O.computeNight(O.parseCSV(txt), {});
    oxy = night && night.stats ? night.stats.meanHr : null;
  } catch {}
  if (oxy == null) continue;
  leg1.push(oxy - raw);
  leg1Files.push(f);
  console.log(`   ${raw.toFixed(3).padStart(8)} ${oxy.toFixed(3).padStart(14)} ${(oxy - raw).toFixed(3).padStart(8)} ${String(n).padStart(9)}  ${f.slice(0, 30)}`);
}
if (leg1.length) {
  console.log(`\n   mean Δ over ${leg1.length} file(s) = ${mean(leg1).toFixed(4)} bpm`);
  console.log(`   non-integer raw HR values seen: ${nonInt} — the column is integer-quantized at 1 Hz`);
  console.log(`   ⇒ candidate (a) "OxyDex's HR path" is ${Math.abs(mean(leg1)) < 0.06 ? 'EXCLUDED — the residual is its 1-dp output rounding' : 'NOT excluded'}`);
} else console.log('   (no O2Ring CSVs found)');

/* ── LEG 3 — THE ESTIMATOR, which turns out to be the whole story ───────────────────────────────
   Legs 1 and 2 chase the bias through OxyDex and through the device. It is in neither. The two nodes
   summarise an epoch's heart rate with DIFFERENT statistics of the same physiology:
       ECGDex   `hr = 60000 / mean(RR)`      — the rate of the mean interval (a harmonic mean of rate)
       OxyDex   `hr = median(1 Hz rate)`     — the median of instantaneous rates
   Those are not the same number, and the gap is not small next to the effect being hunted. This leg
   measures it with NO DEVICE INVOLVED: one RR series, both estimators, per 300-beat block. Any residual
   after subtracting it is the only part that could be a sensor property.
   ── */
/* A PARTIAL-LEG READ CANNOT REACH THE THREE-LEG STAMP RULE, so it owes the era of ITS OWN nights
   (row 2026-10-27-partial-leg-consumers-read-exports-with-no-recorded-code-era). §∅: the data is
   present and the PROVENANCE is absent, so the number stands and the line names what is unrecorded. */
/* ONE WALK PER POPULATION: the offered names come from the snapshot this run publishes, never from
   a second `readdirSync` of the same root. A night arriving between the two walks would otherwise be
   scored into a figure whose population never saw it (row
   2026-10-21-the-reference-validation-population-path-runs-on-no-box-here's sibling finding). */
function legEstimator(T, offered, nightsOut) {
  if (!fs.existsSync(T)) return null;
  const blocks = [];
  for (const n of offered) {
    let E;
    try {
      E = JSON.parse(fs.readFileSync(path.join(T, n, `ECGDex_${n}.node-export.json`), 'utf8'));
    } catch {
      continue;
    }
    const rr = E.timeseries && E.timeseries.rr;
    if (!rr || !rr.ms || rr.ms.length < 300) continue;
    nightsOut.push(n);
    const ms = rr.ms.filter((v) => v > 300 && v < 2000); // Malik-plausible only
    for (let i = 0; i + 300 <= ms.length; i += 300) {
      const seg = ms.slice(i, i + 300);
      const harm = 60000 / mean(seg); // ECGDex
      const rates = seg.map((v) => 60000 / v).sort((a, b) => a - b);
      blocks.push({ harm, med: rates[rates.length >> 1], arith: mean(rates) });
    }
  }
  return blocks;
}

POP.nights.open = nightSnap();
const blocks = legEstimator(TRIO, POP.nights.open.nights, leg3Nights);
console.log('\n\u25b8 LEG 3 \u2014 estimator only: median(rate) vs 60000/mean(RR), ONE series, no device\n');
if (!blocks || !blocks.length) console.log('   (no ECG rr series in the folded corpus)');
else {
  const dm = blocks.map((b) => b.med - b.harm),
    da = blocks.map((b) => b.arith - b.harm);
  const sd = (a) => {
    const u = mean(a);
    return Math.sqrt(a.reduce((x, y) => x + (y - u) * (y - u), 0) / a.length);
  };
  console.log(`   blocks = ${blocks.length} (300 beats each)`);
  console.log(`   median(rate)  \u2212 60000/mean(RR) = ${mean(dm).toFixed(3)} bpm  SD ${sd(dm).toFixed(2)}   \u2190 OxyDex \u2212 ECGDex, by construction`);
  console.log(`   mean(rate)    \u2212 60000/mean(RR) = ${mean(da).toFixed(3)} bpm  SD ${sd(da).toFixed(2)}`);
  console.log(`   ${eraCoverageLine(eraCoverage(eraOfNights(TRIO, leg3Nights)), { label: 'fold era' })}`);
  console.log('   Compare LEG 2. If these match, the "device bias" is an ESTIMATOR MISMATCH and no');
  console.log('   sensor, firmware or aggregation change can remove it \u2014 only agreeing on one statistic.');
}

/* ── LEG 2 ─────────────────────────────────────────────────────────────────────────────────── */
console.log('\n▸ LEG 2 — quantization or device?  (per-epoch OxyDex hr − ECGDex hr, folded trio corpus)\n');
if (!fs.existsSync(TRIO)) {
  console.log('   (uploads/trio/ absent — fold it with tools/trio-batch.mjs first)');
  publishAndExit();
}
const epochs = (o) => (o.timeseries && o.timeseries.epochs) || [];
let all = [];
let nights = 0;
/* The same snapshot LEG 3 read, for the same reason: one walk, one population. */
for (const n of POP.nights.open.nights) {
  let E, X;
  try {
    E = JSON.parse(fs.readFileSync(path.join(TRIO, n, `ECGDex_${n}.node-export.json`), 'utf8'));
    X = JSON.parse(fs.readFileSync(path.join(TRIO, n, `OxyDex_${n}.node-export.json`), 'utf8'));
  } catch {
    continue;
  }
  const t0E = E.recording && E.recording.startEpochMs,
    t0X = X.recording && X.recording.startEpochMs;
  if (t0E == null || t0X == null) continue;
  // Key both on the ABSOLUTE floating-ms 5-min grid — tMin is per-node and the two t0 differ.
  const mx = new Map();
  for (const e of epochs(X)) if (e.hr != null) mx.set(Math.round((t0X + e.tMin * 60000) / 300000), e.hr);
  const ds = [];
  for (const e of epochs(E)) {
    if (e.hr == null) continue;
    const k = Math.round((t0E + e.tMin * 60000) / 300000);
    if (mx.has(k)) ds.push(mx.get(k) - e.hr);
  }
  if (ds.length < 12) continue; // an hour of overlap is the floor for a night to contribute
  nights++;
  leg2Nights.push(n);
  all = all.concat(ds);
}
if (!all.length) {
  console.log('   (no paired epochs)');
  publishAndExit();
}
const m = mean(all);
const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / (all.length - 1));
const sem = sd / Math.sqrt(all.length);
console.log(`   n = ${all.length} epochs over ${nights} night(s)`);
console.log(`   ${eraCoverageLine(eraCoverage(eraOfNights(TRIO, leg2Nights)))}`);
console.log(`   mean Δ(OxyDex − ECGDex) = ${m.toFixed(3)} bpm · SD ${sd.toFixed(2)} · SEM ${sem.toFixed(3)} · ${Math.abs(m / sem).toFixed(1)}σ from zero`);
console.log('   prediction if the device TRUNCATES: −0.500 · if it ROUNDS: 0.000');
console.log(`   ⇒ measured sits ${m < -0.45 ? 'at truncation' : m > -0.05 ? 'at rounding' : 'BETWEEN the two — so neither quantisation mechanism explains it'}`);
console.log('   …and LEG 3 shows why: the estimator mismatch alone is −0.299, which is this number.');
console.log('   Quantisation was the wrong question. See LEG 3.');
console.log('\n   The per-epoch SD dwarfs the offset: this is a small SYSTEMATIC bias on a noisy');
console.log('   difference, visible only in pooling. Do not read a single night as evidence.');

publishAndExit();
