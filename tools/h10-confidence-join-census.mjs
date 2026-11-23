/*
 * tools/h10-confidence-join-census.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * H10 CONFIDENCE-JOIN CENSUS — what `conf.h10` reads before and after the absence guard.
 *
 * Row `2026-11-23-the-h10-confidence-join-reads-two-axes`. The H10 corner of
 * `sensor-trio-worker.js` keys its HR map on the host-disciplined axis (`rec.tMsAt`) and keys its
 * confidence map on the index axis (`beatConfidence` in `ecgdex-dsp.js` floors
 * `t0 + peaks[k] / fs * 1000`). So a second graded under one key can be absent under the other, and
 * the join answered an absent key with a trust of 1.
 *
 * IT PUBLISHES ONE `tepna.verdict/1` — the `corpus-population` object that `populationVerdict`
 * builds from a night snapshot taken before the walk and a second taken after it. That object
 * answers which nights this run covered, and every corpus enumerator here owes that answer
 * (`tests/dex-tests.js`, group `tools · corpus-reads · source-scan`). The census states no pass
 * band of its own: the defect's size IS the measurement, and the pull request carries the decision.
 * `--verdict-sample` prints the object alone over synthetic night names, which is what the
 * adoption gate parses; `--json` writes the object beside the per-night rows.
 *
 * POPULATION — stated, not implied. The worker averages over `ks`, the THREE-WAY overlap of the
 * three corners' second sets. Reproducing `ks` needs the Verity and the ring as well, which is a
 * full `runRealNight` per night. This census runs the H10 corner ALONE and measures over the H10
 * HR-map seconds. The ungraded share is a property of the H10 corner's own two maps, so it carries
 * over; `conf.h10` itself is reported on this population and labelled as such.
 *
 * PRIVACY. It reads raw capture text and prints DERIVED counts only. No filename, no device serial
 * and no address reaches stdout: a night is keyed by its own directory date.
 *
 * MEMORY. One session file at a time, scalars kept, samples released between files.
 *
 *   node tools/h10-confidence-join-census.mjs [--root <dir>] [--limit <n>] [--night <d,..>] [--json <path>]
 *   node tools/h10-confidence-join-census.mjs --verdict-sample
 *   node tools/h10-confidence-join-census.mjs --selftest
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOTS = ['/srv/data/tepna-corpus/smoketest-captures', join(HERE, '..', 'uploads', 'captures')];

const IS_CLI = isCliEntry(import.meta.url);
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const ROOT = argOf('--root') || DEFAULT_ROOTS.find((r) => existsSync(r)) || null;
const LIMIT = argOf('--limit') ? Number(argOf('--limit')) : Infinity;
const JSON_OUT = argOf('--json');
const ONLY = argOf('--night') ? new Set(argOf('--night').split(',')) : null;

const SAMPLE_AT = '2026-11-23T00:00:00Z';

/* THE POPULATION UNIT IS THE NIGHT DIRECTORY, so one named lister serves the snapshot and the walk.
   `snapshotEntries` publishes `list.name` as the rule, and it reads an inline arrow as no rule at
   all, so this lister carries a name on purpose. */
const listNights = (root) =>
  readdirSync(root).filter((n) => {
    try {
      return statSync(join(root, n)).isDirectory();
    } catch {
      return false;
    }
  });

/* THE SAMPLE LIVES IN A HELPER, and that placement is the assertion. `corpus-reads.mjs` blanks a
   body named `verdictSample` before it classifies this file, so the clearance comes off the REAL
   walk below. A sample at top level would read as a population over names no run enumerated. */
function verdictSample() {
  const sampleNights = () => ['2026-06-10', '2026-06-11', '2026-06-12'];
  const snap = snapshotEntries('(sample)', { list: sampleNights, unit: 'nights', at: SAMPLE_AT });
  return populationVerdict(snap, snap, {
    tool: 'tools/h10-confidence-join-census.mjs',
    evidence: ['tools/h10-confidence-join-census.mjs'],
    at: SAMPLE_AT,
    commit: null,
    commitReason: '--verdict-sample: synthetic night names, no code identity claimed'
  });
}

/* THE SELFTEST A `decides` PRODUCER OWES. `verdict-adoption.mjs` reds a binned producer with no
   test, and the count below is COMPUTED by the assertion helper — a typed total keeps printing the
   old number after an assertion goes away. Every leg here is pure: no corpus, no DSP, no night. */
function selftest() {
  let ran = 0;
  let bad = 0;
  const ok = (what, cond) => {
    ran++;
    if (cond) return;
    bad++;
    console.error(`  \u2715 ${what}`);
  };

  /* 1 · THE PUBLISHED OBJECT. The adoption gate parses this exact shape off stdout. */
  const V = createRequire(import.meta.url)(join(HERE, '..', 'verdict.js'));
  const v = verdictSample();
  ok('the sample validates against verdict.js', V.validate(v).ok === true);
  ok('it is the corpus-population gate', v.gate === 'corpus-population' && v.schema === 'tepna.verdict/1');
  ok('checked + excluded = eligible', v.population.checked + v.population.excluded === v.population.eligible);
  ok('a PASS carries evidence and no reason', v.status !== 'PASS' || (v.evidence.length > 0 && v.reason === null));
  ok('the sample claims no code identity', v.producedBy.commit === null && typeof v.producedBy.commitReason === 'string');

  /* 2 · ABSENCE IS NULL at the recording start. A zero IS a measured epoch, so the two answers
     must differ — that difference is the whole of the `|| 0` defect. */
  ok('an absent t0Ms refuses', sessionT0({ t0Ms: null }) === null);
  ok('a t0Ms-less record refuses', sessionT0({}) === null);
  ok('a null record refuses', sessionT0(null) === null);
  ok('a NaN t0Ms refuses', sessionT0({ t0Ms: NaN }) === null);
  ok('a string t0Ms refuses', sessionT0({ t0Ms: '1766000000000' }) === null);
  ok('a measured zero survives, and it is not the absent answer', sessionT0({ t0Ms: 0 }) === 0);
  ok('a real start passes through', sessionT0({ t0Ms: 1766000000000 }) === 1766000000000);

  /* 3 · THE PER-SECOND REDUCTION. An even count takes the upper middle, which is the worker's own
     `a[a.length >> 1]`, and a lone sample is its own median. */
  const m = medMap([
    [10, 70],
    [10, 60],
    [10, 65],
    [11, 50],
    [12, 80],
    [12, 90]
  ]);
  ok('a per-second median over three samples', m.get(10) === 65);
  ok('a lone sample is its own median', m.get(11) === 50);
  ok('an even count takes the upper middle', m.get(12) === 90);
  ok('every second present, and no other', m.size === 3);

  /* 4 · THE POPULATION RULE. The lister admits a directory and refuses a file, so a stray capture
     at the root cannot read as a night. */
  const tmp = mkdtempSync(join(tmpdir(), 'h10conf-selftest-'));
  try {
    mkdirSync(join(tmp, '2026-06-10'));
    mkdirSync(join(tmp, '2026-06-11'));
    writeFileSync(join(tmp, 'README.txt'), 'not a night\n');
    const got = listNights(tmp).sort();
    ok('the lister admits both night directories', got.length === 2 && got[0] === '2026-06-10');
    ok('the lister refuses a file at the root', !got.includes('README.txt'));
    const snap = snapshotEntries(tmp, { list: listNights, unit: 'nights' });
    ok('the snapshot publishes the lister as its rule', snap.ok === true && snap.rule === 'listNights');
    ok('the snapshot counts what the lister offered', snap.n === 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (bad) {
    console.error(`\u2715 ${bad} of ${ran} selftests failed`);
    return 1;
  }
  console.log(`\u2713 all ${ran} selftests passed`);
  return 0;
}

if (IS_CLI && argv.includes('--selftest')) process.exit(selftest());

/* The object ALONE on stdout, because `verdict-adoption` parses this as JSON. It runs before the
   root check, so a box with no corpus still answers the gate. */
if (IS_CLI && argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

/* THE DSP LOAD LIVES INSIDE `main`, and that placement is the assertion. `flag-exit-scan.mjs` puts a
   tool in its census when a module-scope flag guard exits ABOVE a module-scope statement able to
   throw, because the flag's green then says nothing about the rest of the file. A load inside a
   function body evaluates only when a caller runs it, so the two guards above hide nothing. */
let ECGDSP = null;

const HR_MIN = 30,
  HR_MAX = 220;
const secFloor = (ms) => Math.floor(ms / 1000);

/* The worker's own per-second reduction, replicated: a median per second, then a 5-wide running
   median with a 20 bpm rejection band. The SECOND SET is what this census counts, so the filter
   has to be the same one. */
function medMap(pairs) {
  const by = new Map();
  for (const [s, v] of pairs) {
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(v);
  }
  const out = new Map();
  for (const [s, a] of by) {
    a.sort((p, q) => p - q);
    out.set(s, a[a.length >> 1]);
  }
  return out;
}

/* ABSENCE IS NULL. `rec.t0Ms || 0` anchored a session with no recording start at 1970-01-01, which
   fabricates BOTH second keys and then reads as a clean census. A session with no start is refused
   and counted, never anchored (§∅; gate `tools/absence-regression.mjs`). PURE. */
function sessionT0(rec) {
  return rec && Number.isFinite(rec.t0Ms) ? rec.t0Ms : null;
}

function h10SecondSets(text, runsText) {
  const rec = runsText ? ECGDSP.parseECG(text, { runsText }) : ECGDSP.parseECG(text);
  if (!rec || !rec.int16 || !rec.int16.length || !rec.fs) return { skip: 'parseECG empty' };
  const bp = ECGDSP.bandpass(rec.int16, rec.fs);
  const peaks = ECGDSP.detectPeaks(rec.int16, bp, rec.fs);
  if (!peaks || peaks.length < 20) return { skip: 'QRS <20 peaks' };
  const t0 = sessionT0(rec);
  if (t0 == null) return { skip: 'no recording start (t0Ms absent)' };
  const fs = rec.fs;
  const spans = Array.isArray(rec.blankingSpans) ? rec.blankingSpans : null;
  const blanked = (a0, a1) => (spans ? ECGDSP.intersectsRun(spans, a0, a1 - a0) : false);
  const hostAxis = typeof rec.tMsAt === 'function';
  /* The two keys differ by the host-axis correction alone, so the census measures it directly. A
     `tMsAt` that returns device time gives 0 here, which is how a refused axis is told from an
     applied one — `typeof rec.tMsAt === 'function'` is true either way. */
  const deltas = [];
  const pairs = [];
  for (let i = 1; i < peaks.length; i++) {
    if (blanked(peaks[i - 1], peaks[i] + 1)) continue;
    const rr = ((peaks[i] - peaks[i - 1]) / fs) * 1000;
    if (!(rr > 250 && rr < 2200)) continue;
    const hr = 60000 / rr;
    if (!(hr >= HR_MIN && hr <= HR_MAX)) continue;
    const devMs = t0 + (peaks[i] / fs) * 1000;
    const hostMs = hostAxis ? rec.tMsAt(peaks[i]) : devMs;
    deltas.push(Math.abs(hostMs - devMs));
    pairs.push([secFloor(hostMs), hr]);
  }
  if (pairs.length < 30) return { skip: 'HR beats <30' };
  const perSec = medMap(pairs);
  const secs = Array.from(perSec.keys()).sort((a, b) => a - b);
  const vals = secs.map((s) => perSec.get(s));
  const hrSecs = [];
  for (let j = 0; j < secs.length; j++) {
    const win = vals.slice(Math.max(0, j - 2), Math.min(vals.length, j + 3)).sort((a, b) => a - b);
    const med = win[win.length >> 1];
    if (Math.abs(vals[j] - med) <= 20) hrSecs.push(secs[j]);
  }
  /* The production confidence map, through the same wrapper the worker calls. */
  const conf = ECGDSP.hrConfidence ? ECGDSP.hrConfidence(rec.int16, bp, peaks, fs, t0) : null;
  deltas.sort((a, b) => a - b);
  return { hrSecs, conf, hostAxis, fs, deltaMed: deltas.length ? deltas[deltas.length >> 1] : 0, deltaMax: deltas.length ? deltas[deltas.length - 1] : 0 };
}

async function main() {
  if (!ROOT) {
    console.error('no corpus root — pass --root; see docs/CORPUS-LOCATIONS.md');
    return 2;
  }
  const { getDsps } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  ECGDSP = getDsps().ECGDSP;

  const popBefore = snapshotEntries(ROOT, { list: listNights, unit: 'nights' });
  if (!popBefore.ok) {
    console.error(`✕ h10-confidence-join-census: ${popBefore.reason} — ${ROOT}`);
    process.exit(2);
  }
  const nights = popBefore.members.slice().sort();

  const rows = [];
  let done = 0;
  for (const night of nights) {
    if (done >= LIMIT) break;
    if (ONLY && !ONLY.has(night)) continue;
    const dir = join(ROOT, night);
    let names;
    try {
      names = readdirSync(dir).filter((n) => /_ECG\.txt$/.test(n));
    } catch {
      continue;
    }
    if (!names.length) continue;
    let T = 0,
      G = 0,
      sumG = 0,
      hostAxis = 0,
      sessions = 0,
      skipped = 0,
      dMed = 0,
      dMax = 0;
    for (const n of names) {
      let r;
      try {
        const runsName = n.replace(/_ECG\.txt$/, '_ECGRUNS.txt');
        const runsPath = join(dir, runsName);
        r = h10SecondSets(readFileSync(join(dir, n), 'utf8'), existsSync(runsPath) ? readFileSync(runsPath, 'utf8') : null);
      } catch {
        skipped++;
        continue;
      }
      if (r.skip) {
        skipped++;
        continue;
      }
      sessions++;
      if (r.deltaMax > 0) hostAxis++;
      if (r.deltaMed > dMed) dMed = r.deltaMed;
      if (r.deltaMax > dMax) dMax = r.deltaMax;
      for (const s of r.hrSecs) {
        T++;
        const v = r.conf && r.conf.has(s) ? r.conf.get(s) : null;
        if (v != null && Number.isFinite(v)) {
          G++;
          sumG += v;
        }
      }
    }
    if (!T) continue;
    const after = G ? sumG / G : null;
    const before = (sumG + (T - G)) / T;
    rows.push({ night, sessions, skipped, hostAxis, T, G, ungraded: T - G, share: (T - G) / T, before, after, dMed, dMax });
    done++;
    console.log(
      `${night}  sessions ${sessions}  seconds ${T}  graded ${G}  ungraded ${T - G} (${(((T - G) / T) * 100).toFixed(2)} %)  ` +
        `conf.h10 before ${before.toFixed(4)}  after ${after == null ? 'null' : after.toFixed(4)}  axis delta med ${dMed.toFixed(0)} ms max ${dMax.toFixed(0)} ms`
    );
  }

  /* THE CLOSING SNAPSHOT IS A SECOND WALK, not a copy: the corpus is one NFS export and a fold can
     land while this run reads. A moved population is SHORTFALL, so the numbers below name the set they
     were computed over rather than a set that has since changed. */
  const population = populationVerdict(popBefore, snapshotEntries(ROOT, { list: listNights, unit: 'nights' }), {
    tool: 'tools/h10-confidence-join-census.mjs',
    evidence: ['tools/h10-confidence-join-census.mjs']
  });

  const q = (a, p) => {
    if (!a.length) return null;
    const b = a.slice().sort((x, y) => x - y);
    return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))];
  };
  const T = rows.reduce((s, r) => s + r.T, 0);
  const G = rows.reduce((s, r) => s + r.G, 0);
  const sumBefore = rows.reduce((s, r) => s + r.before * r.T, 0);
  const sumAfter = rows.reduce((s, r) => s + (r.after == null ? 0 : r.after * r.G), 0);
  const shares = rows.map((r) => r.share);
  const deltas = rows.filter((r) => r.after != null).map((r) => r.before - r.after);

  console.log('');
  console.log(`population ${population.status} — ${population.population.checked} night(s) offered, rule ${popBefore.rule}` + (population.reason ? ` — ${population.reason}` : ''));
  console.log(`nights with an H10 HR map       : ${rows.length}`);
  console.log(`nights where the axis corrected : ${rows.filter((r) => r.hostAxis > 0).length}`);
  console.log(
    `per-night axis delta            : median ${q(
      rows.map((r) => r.dMed),
      0.5
    ).toFixed(0)} ms  p75 ${q(
      rows.map((r) => r.dMed),
      0.75
    ).toFixed(0)} ms  max ${Math.max(...rows.map((r) => r.dMax)).toFixed(0)} ms`
  );
  console.log(`HR-map seconds                  : ${T}`);
  console.log(`graded seconds                  : ${G}`);
  console.log(`ungraded seconds                : ${T - G}  (${((100 * (T - G)) / T).toFixed(2)} % of all seconds)`);
  console.log(`per-night ungraded share        : median ${(100 * q(shares, 0.5)).toFixed(2)} %  p75 ${(100 * q(shares, 0.75)).toFixed(2)} %  max ${(100 * Math.max(...shares)).toFixed(2)} %`);
  console.log(`conf.h10 BEFORE (absent = 1)    : ${(sumBefore / T).toFixed(4)}  (seconds-weighted over the census)`);
  console.log(`conf.h10 AFTER  (absent = null) : ${(sumAfter / G).toFixed(4)}  (graded seconds only)`);
  console.log(`per-night overstatement         : median ${q(deltas, 0.5).toFixed(4)}  p75 ${q(deltas, 0.75).toFixed(4)}  max ${Math.max(...deltas).toFixed(4)}`);
  console.log(`fused weight on an ungraded second: 1 -> 0, so ${T - G} of ${T} H10 pair weights drop out`);

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        {
          tool: 'tools/h10-confidence-join-census.mjs',
          population: 'H10 HR-map seconds, not the three-way overlap',
          nights: rows.length,
          seconds: T,
          graded: G,
          ungraded: T - G,
          confH10Before: sumBefore / T,
          confH10After: sumAfter / G,
          verdict: population,
          rows
        },
        null,
        2
      )
    );
    console.log(`wrote ${JSON_OUT}`);
  }

  return 0;
}

if (IS_CLI) process.exit(await main());
