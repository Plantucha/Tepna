#!/usr/bin/env node
/*
 * tools/nsrr-effort-typing.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * DOES RESPIRATORY EFFORT ACTUALLY COLLAPSE DURING A CENTRAL APNEA? — measured on RIP belts, at
 * cohort scale, against a number this repo currently CITES rather than measures.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * `integrator-dsp.js` and `papers/effort-typing-null.html` both turn on one comparison:
 *
 *     our chest accelerometer, central apneas below half baseline ....  16.5 %   MEASURED (26 nights)
 *     a single RIP belt ............................................... 84 %     CITED (Nassi 2022)
 *
 * One side is a measurement on our hardware; the other is a literature figure from a different
 * population, different belts and a different scoring convention. The conclusion drawn from their
 * ratio — that a chest accelerometer cannot substitute for an effort belt — is load-bearing for a
 * paper and for a shipped typing rule, and it has never been measured on one corpus.
 *
 * SHHS1 carries `THOR RES` and `ABDO RES` on **100 % of 5136 records** with expertly typed events
 * (~35 700 central and ~296 500 obstructive apneas projected). So the 84 % can be measured instead of
 * quoted, on belts, at a scale no single study has.
 *
 * ── PRE-STATED BANDS (fixed before the first run; do not move them afterwards) ────────────────
 *   ≥ 70 %  central below half baseline → Nassi transfers; our accelerometer really is ~5× worse.
 *   40–70 %                             → partial; 84 % is optimistic for this population.
 *   < 40 %                              → the 16.5-vs-84 contrast is substantially a population and
 *                                         method artifact, and BOTH the paper's conclusion and the
 *                                         Integrator's rationale need qualifying.
 *
 * ── WHAT IS MEASURED, AND THE TRAP IN IT ─────────────────────────────────────────────────────
 * "Effort collapses" is a claim about amplitude RELATIVE TO THAT NIGHT'S OWN BASELINE, never an
 * absolute one — AASM defines apnea against the patient's recent breathing, and belt gain is
 * arbitrary, posture-dependent and not comparable between recordings. `integrator-dsp.js` records
 * that an ABSOLUTE floor was exactly the defect: it read effort "present" through 83.5–95.4 % of
 * central apneas and typed them obstructive. So amplitude here is always a RATIO, and the baseline is
 * local (the surrounding quiet breathing), not the whole night.
 *
 * ⚠️ AND A CENTRAL APNEA IS NOT A QUIET WINDOW. Both are low-amplitude, so a detector that simply
 * finds low amplitude scores well on centrals and cannot be trusted. The obstructive arm is the
 * control that separates the two: if effort during obstructive events is ALSO near baseline, the
 * measurement is reading noise, not physiology.
 *
 * USAGE
 *   node tools/nsrr-effort-typing.mjs --selftest
 *   node tools/nsrr-effort-typing.mjs --limit 200 [--edfs <dir>] [--xml <dir>]
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { makeVerdict } from './verdict-emit.mjs';
import { isCliEntry } from './argv-guard.mjs';
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(ROOT, 'tools', 'x.js'));
const DexBuild = require_('./build-core.js');

/* pre-stated, as constants so a report cannot quietly use different ones */
export const BAND_TRANSFERS = 0.7;
export const BAND_PARTIAL = 0.4;
/* Nassi's statistic: the share of central apneas whose effort falls below HALF the local baseline */
export const COLLAPSE_FRACTION = 0.5;

/* ── tepna.verdict/1 (VERDICT-CONTRACT §1; wave-2 adopter) — the three bands as ONE object ──────
   Criterion, pre-stated above: the fraction of central apneas whose effort falls below half its local
   baseline must be ≥ BAND_TRANSFERS for the belt contrast to TRANSFER. PASS = TRANSFERS; FAIL = PARTIAL
   or ARTIFACT — both are "the criterion was not met", the band and the fraction are in `reason` and
   `result.band` (the closed enum has no graded pass, and a PARTIAL is not a SHORTFALL in the contract's
   sense — that word is reserved for a met headline with a failed sub-population). NOT_RUN = no central
   apnea produced a usable ratio. Population = central apneas scored; the obstructive control rides in
   `result`, never in the population. */
export function bandOf(fraction) {
  return fraction >= BAND_TRANSFERS ? 'TRANSFERS' : fraction >= BAND_PARTIAL ? 'PARTIAL' : 'ARTIFACT';
}
export function verdictObject(C, O, { records, commit, commitReason, at } = {}) {
  const status = !C || !C.n ? 'NOT_RUN' : bandOf(C.belowHalfPct / 100) === 'TRANSFERS' ? 'PASS' : 'FAIL';
  const band = C && C.n ? bandOf(C.belowHalfPct / 100) : null;
  const ctrlNote = O
    ? ' (obstructive control ' +
      O.belowHalfPct +
      ' % — ' +
      (Math.abs(O.belowHalfPct - C.belowHalfPct) < 10 ? 'close to the central figure: the measure may be reading low amplitude, not effort' : 'separated from the central figure') +
      ')'
    : '';
  return makeVerdict({
    gate: 'nsrr-effort-typing',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : C.n, eligible: C && C.n ? C.n : 0, excluded: 0 },
    criterion: { name: 'central_apneas_below_half_baseline_fraction', threshold: BAND_TRANSFERS, unit: 'fraction', direction: 'gte' },
    result:
      status === 'NOT_RUN' ? null : { band, central: C, obstructive: O || null, records: records ?? null, bands: { transfers: BAND_TRANSFERS, partial: BAND_PARTIAL, collapse: COLLAPSE_FRACTION } },
    evidence: ['tools/nsrr-effort-typing.mjs'],
    reason:
      status === 'PASS'
        ? null
        : status === 'NOT_RUN'
          ? 'no central apnea produced a usable amplitude ratio'
          : band + ' — ' + C.belowHalfPct + ' % of central apneas fall below half baseline, band needs ≥ ' + 100 * BAND_TRANSFERS + ' %' + ctrlNote,
    tool: 'tools/nsrr-effort-typing.mjs',
    commit,
    commitReason,
    at
  });
}
/* What the adoption gate runs: summary numbers of the measured shape, through the real bands. */
export function verdictSample() {
  return verdictObject(
    { n: 812, median: 0.31, belowHalfPct: 76.4 },
    { n: 4140, median: 0.71, belowHalfPct: 22.9 },
    { records: 150, commit: null, commitReason: '--verdict-sample: synthetic summary numbers, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

/* ── realm ────────────────────────────────────────────────────────────────────────────────────
   Only the EDF reader is needed; no DSP runs here. Loaded through `classicify` because the shipped
   modules carry ESM exports that `vm` cannot evaluate as a script. */
export function makeRealm() {
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    isNaN,
    isFinite,
    parseFloat,
    parseInt,
    Uint8Array,
    Int8Array,
    Int16Array,
    Uint16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    DataView,
    ArrayBuffer,
    Map,
    Set,
    RegExp,
    Error,
    TextDecoder,
    TextEncoder
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { outerHTML: '' },
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  sandbox.navigator = { userAgent: 'node', hardwareConcurrency: 1 };
  const ctx = vm.createContext(sandbox);
  for (const f of ['clock.js', 'kernel-constants.js', 'cpapdex-edf.js']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) throw new Error('co-load missing: ' + f);
    vm.runInContext(DexBuild.classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  if (!ctx.CpapEdf || typeof ctx.CpapEdf.readEDF !== 'function') throw new Error('CpapEdf.readEDF did not load');
  return ctx;
}

export function toArrayBuffer(b) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/* ── events ───────────────────────────────────────────────────────────────────────────────────
   The suite's own `nsrr-adapter.js` collapses every apnea subtype into one `apnea` kind, because it
   computes AHI and AHI does not care. This study is entirely about the subtype, so it reads them
   here rather than reusing that path — a collapse upstream is not a bug, it is the wrong instrument
   for this question. */
export const APNEA_KIND = { central: /central\s*apnea/i, obstructive: /obstructive\s*apnea/i, mixed: /mixed\s*apnea/i };

export function parseTypedApneas(xmlText) {
  const out = [];
  const blocks = String(xmlText || '').match(/<ScoredEvent>[\s\S]*?<\/ScoredEvent>/g) || [];
  for (const b of blocks) {
    const g = (t) => {
      const m = b.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>'));
      return m ? m[1].trim() : null;
    };
    const concept = g('EventConcept');
    if (!concept) continue;
    let kind = null;
    for (const k of Object.keys(APNEA_KIND)) if (APNEA_KIND[k].test(concept)) kind = k;
    if (!kind) continue;
    const start = Number(g('Start'));
    const dur = Number(g('Duration'));
    /* §∅: an event without a usable time is DROPPED and counted, never defaulted to 0 — a zero start
       would silently sample the recording's first seconds for every malformed event. */
    if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) continue;
    out.push({ kind, start, dur });
  }
  return out;
}

/* ── effort amplitude ─────────────────────────────────────────────────────────────────────────
   Peak-to-peak of the belt over a window, which is what "effort amplitude" means for a RIP signal.
   RMS about the window mean would be defensible too and tracks it closely; peak-to-peak is used
   because it is what a collapse threshold is conventionally stated against. */
export function windowAmp(sig, fs, t0Sec, tEndSec) {
  if (!sig || !(fs > 0)) return null;
  const a = Math.max(0, Math.round(t0Sec * fs));
  const b = Math.min(sig.length, Math.round(tEndSec * fs));
  if (b - a < Math.max(4, fs)) return null; // under a second of samples is not an amplitude
  let lo = Infinity,
    hi = -Infinity,
    n = 0;
  for (let i = a; i < b; i++) {
    const v = sig[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    n++;
  }
  if (n < Math.max(4, fs) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return hi - lo;
}

/* Local baseline: the quiet breathing AROUND the event, excluding the event itself and a guard band.
   A whole-night baseline would be contaminated by the events themselves on a severe night — which is
   precisely the population this question lives in. */
export function localBaseline(sig, fs, ev, padSec = 60, guardSec = 10) {
  const preEnd = ev.start - guardSec;
  const preStart = preEnd - padSec;
  const postStart = ev.start + ev.dur + guardSec;
  const postEnd = postStart + padSec;
  const amps = [windowAmp(sig, fs, preStart, preEnd), windowAmp(sig, fs, postStart, postEnd)].filter((v) => v != null && v > 0);
  if (!amps.length) return null;
  return amps.reduce((x, y) => x + y, 0) / amps.length;
}

export function median(v) {
  const a = v.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c, d) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
    }
  };
  console.log('▸ nsrr-effort-typing --selftest\n');

  const xml = `<ScoredEvent><EventConcept>Central apnea|Central Apnea</EventConcept><Start>100.0</Start><Duration>12.5</Duration></ScoredEvent>
    <ScoredEvent><EventConcept>Obstructive apnea|Obstructive Apnea</EventConcept><Start>200.0</Start><Duration>20.0</Duration></ScoredEvent>
    <ScoredEvent><EventConcept>Hypopnea|Hypopnea</EventConcept><Start>300.0</Start><Duration>10.0</Duration></ScoredEvent>
    <ScoredEvent><EventConcept>Central apnea|Central Apnea</EventConcept><Start>abc</Start><Duration>9</Duration></ScoredEvent>`;
  const ev = parseTypedApneas(xml);
  A('events: reads central and obstructive, ignores hypopnea', ev.length === 2 && ev[0].kind === 'central' && ev[1].kind === 'obstructive', JSON.stringify(ev));
  A('events: §∅ — an unparseable Start is DROPPED, not defaulted to 0', !ev.some((e) => e.start === 0));
  A('events: carries start and duration in seconds', ev[0].start === 100 && ev[0].dur === 12.5);

  /* a synthetic belt: 1 unit peak-to-peak everywhere, collapsing to 0.1 during 100–112.5 s */
  const fs = 10,
    sig = new Float32Array(400 * fs);
  for (let i = 0; i < sig.length; i++) {
    const t = i / fs;
    const amp = t >= 100 && t < 112.5 ? 0.05 : 0.5;
    sig[i] = amp * Math.sin((2 * Math.PI * t) / 4);
  }
  const during = windowAmp(sig, fs, 100, 112.5);
  const base = localBaseline(sig, fs, { start: 100, dur: 12.5 });
  A('amplitude: peak-to-peak recovers the planted collapse', during < 0.25 && base > 0.8, 'during ' + during?.toFixed(2) + ' base ' + base?.toFixed(2));
  A('amplitude: the ratio lands near the planted 0.1', Math.abs(during / base - 0.1) < 0.05, String((during / base).toFixed(3)));
  A('amplitude: a window shorter than a second refuses', windowAmp(sig, fs, 10, 10.2) === null);
  A('amplitude: a zero sample rate refuses rather than dividing', windowAmp(sig, 0, 1, 2) === null);
  A('baseline: excludes the event itself (guard band)', localBaseline(sig, fs, { start: 100, dur: 12.5 }) > 0.8);
  A('baseline: refuses when there is no usable surrounding signal', localBaseline(sig, fs, { start: 0, dur: 5 }, 60, 10) === null || localBaseline(sig, fs, { start: 0, dur: 5 }, 60, 10) > 0);

  /* the control that makes a positive interpretable: a belt with NO collapse must not score one */
  const flat = new Float32Array(400 * fs);
  for (let i = 0; i < flat.length; i++) flat[i] = 0.5 * Math.sin((2 * Math.PI * (i / fs)) / 4);
  const dFlat = windowAmp(flat, fs, 100, 112.5),
    bFlat = localBaseline(flat, fs, { start: 100, dur: 12.5 });
  A('CONTROL: an uncollapsed belt gives a ratio near 1, not near 0', Math.abs(dFlat / bFlat - 1) < 0.1, String((dFlat / bFlat).toFixed(3)));

  A('bands: pre-stated and constant', BAND_TRANSFERS === 0.7 && BAND_PARTIAL === 0.4 && COLLAPSE_FRACTION === 0.5);
  // ── the object: every status through the real bands ──
  const vo = (c, o) => verdictObject(c, o, { records: 1, commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' });
  A('object: ≥ 70 % below half ⇒ PASS, reason null', vo({ n: 10, median: 0.3, belowHalfPct: 80 }, null).status === 'PASS' && vo({ n: 10, median: 0.3, belowHalfPct: 80 }, null).reason === null);
  A('object: 40–70 % ⇒ FAIL naming PARTIAL', vo({ n: 10, median: 0.5, belowHalfPct: 55 }, null).status === 'FAIL' && /PARTIAL/.test(vo({ n: 10, median: 0.5, belowHalfPct: 55 }, null).reason));
  A('object: < 40 % ⇒ FAIL naming ARTIFACT', /ARTIFACT/.test(vo({ n: 10, median: 0.9, belowHalfPct: 10 }, null).reason));
  A(
    'object: an obstructive control close to the central figure is named in the reason',
    /reading low amplitude/.test(vo({ n: 10, median: 0.5, belowHalfPct: 55 }, { n: 20, median: 0.5, belowHalfPct: 52 }).reason)
  );
  A('object: no central apnea scored ⇒ NOT_RUN, result null', vo(null, null).status === 'NOT_RUN' && vo(null, null).result === null);
  A('object: the sample is a PASS (validated by makeVerdict)', verdictSample().status === 'PASS');
  A('median: ignores nulls rather than scoring them 0', median([null, 3, 3, null]) === 3);

  let ctx = null;
  try {
    ctx = makeRealm();
  } catch (e) {
    console.log('    (realm: ' + String(e.message).slice(0, 70) + ')');
  }
  A('realm: CpapEdf loads headlessly (readEDF, not parseEdf — the name was assumed twice)', !!(ctx && typeof ctx.CpapEdf.readEDF === 'function'));

  /* ── THE POPULATION, TESTED BOTH WAYS ───────────────────────────────────────────────────────
     The lister IS the rule this tool publishes, so a leg reads it off a real directory in both
     directions: an annotation is admitted and anything else is passed over. A count would pass a
     lister that admitted everything. */
  const tmp = mkdtempSync(join(tmpdir(), 'nsrr-effort-'));
  try {
    for (const f of ['rec-0001-nsrr.xml', 'rec-0002-nsrr.xml', 'rec-0003-profusion.xml', 'README.txt']) writeFileSync(join(tmp, f), 'x');
    A('lister: one record per annotation file, keyed by the stem', listAnnotatedRecords(tmp).join(',') === 'rec-0001,rec-0002');
    A('lister CONTROL: a non-annotation file in the same tree is passed over', listAnnotatedRecords(tmp).length === 2);
    const snap = snapshotEntries(tmp, { list: listAnnotatedRecords, unit: 'records' });
    A('snapshot: the published rule NAMES the lister rather than reading `list`', snap.rule === 'listAnnotatedRecords', String(snap.rule));
    A('snapshot: the unit is RECORDS, not nights', snap.unit === 'records' && snap.n === 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const dead = snapshotEntries(join(tmp, 'gone'), { list: listAnnotatedRecords, unit: 'records' });
  A('snapshot: a tree nobody can enumerate is not a population of 0', dead.ok === false && dead.reason !== null);
  /* The arithmetic control's key is `record`, and `notCovered` defaults to `night` — a record
     population addressed through the night key names every offered record as unscored. */
  A('unscored: the offer minus the score, read through the RECORD key', notCovered({ members: ['a', 'b', 'c'], n: 3, unit: 'records' }, [{ record: 'b' }], { key: 'record' }).join(',') === 'a,c');
  A('exit: a tree nobody can enumerate exits 2', exitCodeFor({ status: 'NOT_RUN' }, 0, 0) === 2);
  A('exit: a root that offered nothing exits 2', exitCodeFor({ status: 'PASS' }, 0, 0) === 2);
  A('exit: a run that scored no record exits 2 \u2014 it exited 0 before', exitCodeFor({ status: 'PASS' }, 150, 0) === 2);
  A('exit CONTROL: reduced coverage annotates and exits 0 (owner ruling 2026-09-17)', exitCodeFor({ status: 'PASS' }, 5136, 150) === 0);

  console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
  return bad ? 1 : 0;
}

if (process.argv.includes('--selftest') && isCliEntry(import.meta.url)) process.exit(selftest());
if (process.argv.includes('--verdict-sample') && isCliEntry(import.meta.url)) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

/* ── THE POPULATION THIS RUN SCORES OVER ──────────────────────────────────────────────────────
   Row 2026-10-28-two-nsrr-readers-are-excluded-where-three-were-debt. `POPULATION_EXCLUSIONS`
   excused this tool because the NSRR mount is not the capture corpus, while three siblings reading
   the same two trees publish a population anyway. A population is about the enumeration a run
   scores over, not about the filesystem the bytes came off, so the exclusion is gone and this is
   the verdict it was excused from.

   THE OFFER IS THE ANNOTATED RECORDS. An annotation with no EDF has nothing to score, and the
   pairing below drops it BY NAME rather than shrinking the offer — and `--limit` is reduced
   coverage, which annotates rather than refusing (owner ruling 2026-09-17, §∅). */
const POP_TOOL = 'tools/nsrr-effort-typing.mjs';
const POP_EV = [POP_TOOL, 'tools/corpus-scope-core.mjs'];
/* A NAMED lister: `snapshotEntries` publishes `rule: list.name`, and an inline arrow publishes
   `rule: null`. One record per annotation file, keyed by the stem every path below is built from. */
export function listAnnotatedRecords(root) {
  return readdirSync(root)
    .filter((f) => f.endsWith('-nsrr.xml'))
    .map((f) => f.slice(0, -9))
    .sort();
}
/* The shared exit rule, pure so the run and a leg read the same one: a tree nobody can enumerate, a
   root that offered nothing, and a run that scored no record all exit 2. The first of those was an
   uncaught ENOENT out of `readdirSync` before this, which is a crash rather than a verdict; reduced
   coverage still annotates and exits 0 (owner ruling 2026-09-17, §∅). */
export function exitCodeFor(population, offered, scored) {
  return population.status === 'NOT_RUN' || offered === 0 || scored === 0 ? 2 : 0;
}

/* ── the run ══════════════════════════════════════════════════════════════════════════════════ */
function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const edfDir = arg('--edfs', '/mnt/synology/nsrr-shhs1/shhs/polysomnography/edfs/shhs1');
  const xmlDir = arg('--xml', '/srv/data/shhs/polysomnography/annotations-events-nsrr/shhs1');
  const limit = Number(arg('--limit', '150'));
  const beltPref = ['THOR RES', 'ABDO RES'];

  const json = argv.includes('--json');

  const ctx = makeRealm();
  /* ONE WALK FOR THE OFFER, and every path below is rebuilt from its member names rather than taken
     off a second `readdirSync` — a verdict that describes one walk while the run scores another is
     the defect this primitive exists to catch (measured 2026-10-21 on `tch-firmware-reference.mjs`). */
  const commitOf = gitCommitOf();
  const snapOf = (dir) => snapshotEntries(dir, { list: listAnnotatedRecords, unit: 'records' });
  const snapBefore = snapOf(xmlDir);
  const ids = snapBefore.members.filter((id) => existsSync(join(edfDir, id + '.edf')));

  console.log('▸ does effort collapse during a central apnea? — RIP belts, SHHS1');
  console.log('  bands (pre-stated)  ≥' + 100 * BAND_TRANSFERS + ' % transfers · ' + 100 * BAND_PARTIAL + '–' + 100 * BAND_TRANSFERS + ' % partial · <' + 100 * BAND_PARTIAL + ' % artifact');
  console.log('  reference figures   accelerometer 16.5 % (measured, 26 nights) · RIP belt 84 % (Nassi 2022, CITED)\n');

  const per = { central: [], obstructive: [] };
  /* A record is SCORED when it contributed at least one amplitude ratio. A record that was read and
     produced none is covered by the offer and absent from the score, which is what the names below
     are for. */
  const scoredRows = [];
  let scanned = 0,
    withCentral = 0,
    noBelt = 0;
  for (const id of ids) {
    if (scanned >= limit) break;
    let evs;
    try {
      evs = parseTypedApneas(readFileSync(join(xmlDir, id + '-nsrr.xml'), 'utf8'));
    } catch {
      continue;
    }
    if (!evs.some((e) => e.kind === 'central')) continue; // only nights that can answer the question
    scanned++;
    withCentral++;
    let edf;
    try {
      edf = ctx.CpapEdf.readEDF(toArrayBuffer(readFileSync(join(edfDir, id + '.edf'))));
    } catch {
      continue;
    }
    const sigs = edf && edf.signals;
    const key = sigs && beltPref.find((k) => sigs[k] && sigs[k].data && sigs[k].data.length);
    if (!key) {
      noBelt++;
      continue;
    }
    const sig = sigs[key].data,
      fs = sigs[key].fs;
    let ratios = 0;
    for (const ev of evs) {
      if (ev.kind === 'mixed') continue;
      const during = windowAmp(sig, fs, ev.start, ev.start + ev.dur);
      const base = localBaseline(sig, fs, ev);
      if (during == null || base == null || !(base > 0)) continue;
      per[ev.kind].push(during / base);
      ratios++;
    }
    if (ratios) scoredRows.push({ record: id });
  }

  const summarise = (v) => {
    if (!v.length) return null;
    const below = v.filter((r) => r < COLLAPSE_FRACTION).length;
    return { n: v.length, median: +median(v).toFixed(3), belowHalfPct: +((100 * below) / v.length).toFixed(1) };
  };
  const C = summarise(per.central),
    O = summarise(per.obstructive);
  /* The offer against the score. `notCovered` reads `row[key]`, and the arithmetic THROWS rather
     than printing a coverage line that contradicts its own headline. */
  const population = populationVerdict(snapBefore, snapOf(xmlDir), { commit: commitOf.commit, commitReason: commitOf.reason, tool: POP_TOOL, evidence: POP_EV });
  const unscored = notCovered(snapBefore, scoredRows, { key: 'record' });
  if (unscored.length !== snapBefore.n - scoredRows.length) throw new Error(`population arithmetic: ${snapBefore.n} offered − ${scoredRows.length} scored ≠ ${unscored.length} unscored`);
  const sayPopulation = () => {
    console.log(`\npopulation: ${snapBefore.n} record(s) offered under ${xmlDir} · ${scoredRows.length} scored · movement ${population.status}` + (population.reason ? ` — ${population.reason}` : ''));
    const popRule = ruleLine(population);
    if (popRule) console.log(popRule);
    if (unscored.length)
      console.log(`  ${unscored.length} offered record(s) produced no amplitude ratio, by name: ${unscored.slice(0, 8).join(' · ')}${unscored.length > 8 ? ` · … (+${unscored.length - 8})` : ''}`);
    console.log('POPULATION ' + JSON.stringify(population));
  };
  console.log('  records with ≥1 central apnea scanned: ' + withCentral + (noBelt ? '   (' + noBelt + ' had no usable belt)' : ''));
  if (!C) {
    console.error('✕ no central apnea produced a usable amplitude ratio');
    /* A `--json` run stays ONE parseable object, so the population rides inside it rather than on a
       line beside it. */
    if (json) console.log(JSON.stringify({ verdict: verdictObject(null, null, { records: withCentral }), population, unscored }));
    else sayPopulation();
    return 2;
  }
  console.log('');
  console.log('  effort / local baseline        n        median   below half');
  console.log('    CENTRAL apneas      ' + String(C.n).padStart(9) + '   ' + String(C.median).padStart(9) + '   ' + String(C.belowHalfPct + ' %').padStart(10));
  if (O) console.log('    obstructive (control)' + String(O.n).padStart(8) + '   ' + String(O.median).padStart(9) + '   ' + String(O.belowHalfPct + ' %').padStart(10));
  console.log('');
  const f = C.belowHalfPct / 100;
  const verdict = f >= BAND_TRANSFERS ? 'NASSI TRANSFERS' : f >= BAND_PARTIAL ? 'PARTIAL' : 'ARTIFACT — the 16.5-vs-84 contrast does not survive one corpus';
  console.log('  VERDICT  ' + C.belowHalfPct + ' % of central apneas fall below half baseline → ' + verdict);
  if (O) console.log('  CONTROL  obstructive at ' + O.belowHalfPct + ' % — if this is close to the central figure, the measure is reading low amplitude, not effort');
  // the object IS the verdict (stdout under --json; the report above is its explanation)
  if (json) console.log(JSON.stringify({ verdict: verdictObject(C, O, { records: withCentral }), population, unscored }));
  else sayPopulation();
  return exitCodeFor(population, snapBefore.n, scoredRows.length);
}

/* ⚠️ ENTRY-POINT GUARD. Without it, `import`ing this module RUNS THE WHOLE ANALYSIS — which it did:
   a sibling script imported it to reuse `windowAmp`/`parseTypedApneas` and got a 150-record cohort
   run instead, twice, before printing anything of its own. A tool that cannot be imported without
   executing is not reusable, and the reuse is the whole reason these helpers are exported. */
const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI && !process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) process.exit(main(process.argv.slice(2)));
