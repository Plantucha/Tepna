#!/usr/bin/env node
/*
 * tools/pletha-marker-oracle.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the project root.
 * ═════════════════════════════════════════════════════════════════════════════
 * SCORE THE "ISOLATED 156 IS A MARKER" HEURISTIC AGAINST THE DEVICE'S OWN BEAT FLAG.
 *
 * `pinnedSpans` (ppgdex-dsp.js) steps over an ISOLATED `156` when merging spans — it treats a lone 156
 * as the O2Ring's inserted beat-marker row and a RUN of 156s as signal that happens to sit at 156.
 * That rule decides whether a marker-split plateau is one span or two, and residue
 * 2026-09-06-marker-isolation-heuristic-unvalidated recorded that it had never been scored against
 * its own failure mode, because `_PPG.txt` carries the marker IN-BAND and cannot say which 156s are
 * beats. The `0x03` pletha stream can: `_PLETHA.txt` carries `beat` OUT-OF-BAND beside every sample.
 *
 * This tool builds the 2×2 the heuristic implies — {lone 156, run 156} × {beat==1, beat==0} — plus the
 * one cell that would falsify the oracle itself (beat==1 on a non-156 row), over every PLETHA file
 * under a root. The heuristic HOLDS iff lone-156 rows are all beat==1, run-156 rows are all beat==0,
 * and no beat lands off a 156. ⚠️ A pass with an EMPTY run cell is vacuous — the 2026-09-06 attempt
 * scored 11/11 on a file with no run of 156s at all and licensed nothing; the run count is printed
 * beside the verdict so a reader can see whether the discriminating case occurred.
 *
 * Streams one file at a time; keeps counts, never rows (lazy-load rule).
 *
 *   node tools/pletha-marker-oracle.mjs <captures-root>     # e.g. …/vigil-archive/captures
 *   node tools/pletha-marker-oracle.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { makeVerdict } from './verdict-emit.mjs';

export function scoreRows(vals, beats) {
  const t = { rows: vals.length, loneB1: 0, loneB0: 0, runB1: 0, runB0: 0, beatOff156: 0, runs: 0, longest: 0 };
  let i = 0;
  while (i < vals.length) {
    if (vals[i] === 156) {
      let j = i;
      while (j + 1 < vals.length && vals[j + 1] === 156) j++;
      const n = j - i + 1;
      t.runs++;
      if (n > t.longest) t.longest = n;
      for (let k = i; k <= j; k++) {
        if (n === 1) beats[k] ? t.loneB1++ : t.loneB0++;
        else beats[k] ? t.runB1++ : t.runB0++;
      }
      i = j + 1;
    } else {
      if (beats[i]) t.beatOff156++;
      i++;
    }
  }
  return t;
}

export function verdict(t) {
  const holds = t.loneB0 === 0 && t.runB1 === 0 && t.beatOff156 === 0;
  const runRows = t.runB1 + t.runB0;
  return { holds, vacuous: runRows === 0, runRows, label: !holds ? 'FALSIFIED' : runRows === 0 ? 'HOLDS (vacuous — no run of 156s seen)' : 'HOLDS' };
}

/* ── tepna.verdict/1 (VERDICT-CONTRACT §1; wave-2 adopter) — the same decision as ONE object ──────
   The heuristic "a lone 156 is a beat marker, a run of 156s is signal" holds when three counts are all
   zero: lone-156 with beat=0, run-156 with beat=1, beat=1 off a 156. Pre-stated (#2758). Statuses:
     · PASS          holds, and ≥ 1 discriminating run row was seen (the pass is not vacuous)
     · UNDERPOWERED  holds but NO run of 156s occurred — the discriminating case never happened, so the
                     pass is vacuous; minimum 1 run row (memory: verify-the-plant-was-seen)
     · FAIL          falsified — names which count is non-zero
     · NOT_RUN       no PLETHA file could be scored
   Population = rows scored, as an equality. */
export function verdictObject(tot, { files, scored, root, commit, commitReason, at } = {}) {
  const v = verdict(tot);
  const bad = [
    ['loneB0', tot.loneB0, 'lone 156 with beat=0'],
    ['runB1', tot.runB1, 'run 156 with beat=1'],
    ['beatOff156', tot.beatOff156, 'beat=1 off a 156']
  ].filter((x) => x[1] > 0);
  const status = !scored ? 'NOT_RUN' : !v.holds ? 'FAIL' : v.vacuous ? 'UNDERPOWERED' : 'PASS';
  const reason =
    status === 'PASS'
      ? null
      : status === 'NOT_RUN'
        ? (files || 0) + ' PLETHA file(s) found, none scored'
        : status === 'FAIL'
          ? 'FALSIFIED — ' + bad.map((x) => x[2] + ': ' + x[1]).join(', ')
          : 'vacuous — 0 run rows of 156 seen, minimum 1 for a non-vacuous verdict (' + tot.rows + ' rows, ' + tot.runs + ' runs)';
  return makeVerdict({
    gate: 'pletha-marker-oracle',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : tot.rows, eligible: tot.rows, excluded: status === 'NOT_RUN' ? tot.rows : 0 },
    criterion: { name: 'lone_156_is_beat_and_run_156_is_signal', threshold: 0, unit: 'disagreeing rows', direction: 'eq' },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            rows: tot.rows,
            loneB1: tot.loneB1,
            loneB0: tot.loneB0,
            runB1: tot.runB1,
            runB0: tot.runB0,
            beatOff156: tot.beatOff156,
            runs: tot.runs,
            longest: tot.longest,
            runRows: v.runRows,
            files: files ?? null,
            scored: scored ?? null
          },
    evidence: ['tools/pletha-marker-oracle.mjs'].concat(root ? [String(root)] : []),
    reason,
    tool: 'tools/pletha-marker-oracle.mjs',
    commit,
    commitReason,
    at
  });
}
/* What the adoption gate runs: the corpus-measured counts of #2758 through the real decision. */
export function verdictSample() {
  return verdictObject(
    { rows: 4361226, loneB1: 5455, loneB0: 0, runB1: 0, runB0: 4, beatOff156: 0, runs: 5407, longest: 3 },
    { files: 4, scored: 4, commit: null, commitReason: '--verdict-sample: the #2758 corpus counts, no code identity claimed', at: '2026-09-22T00:00:00Z' }
  );
}

async function scoreFile(p) {
  const vals = [];
  const beats = [];
  let vi = -1;
  let bi = -1;
  const rl = readline.createInterface({ input: fs.createReadStream(p, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const c = line.split(';');
    if (vi < 0) {
      vi = c.indexOf('sample');
      bi = c.indexOf('beat');
      if (vi < 0 || bi < 0) return null; // not a pletha file
      continue;
    }
    vals.push(+c[vi]);
    beats.push(c[bi] === '1');
  }
  return scoreRows(vals, beats);
}

function selftest() {
  let ok = 0;
  const eq = (a, b, m) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      console.error('✗ ' + m + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
      process.exit(1);
    }
    ok++;
  };
  // lone markers with beats, one run of 156s without, one beat off a 156
  const v = [97, 156, 98, 156, 156, 99, 156, 100];
  const b = [false, true, false, false, false, false, true, true];
  const t = scoreRows(v, b);
  eq([t.loneB1, t.loneB0, t.runB1, t.runB0, t.beatOff156, t.runs, t.longest], [2, 0, 0, 2, 1, 3, 2], 'the 2x2 and the off-156 cell');
  eq(verdict(t).holds, false, 'a beat off a 156 falsifies');
  const clean = scoreRows([97, 156, 98, 156, 156, 99], [false, true, false, false, false, false]);
  eq(verdict(clean), { holds: true, vacuous: false, runRows: 2, label: 'HOLDS' }, 'lone=beat, run=signal → holds, non-vacuous');
  const vac = scoreRows([97, 156, 98], [false, true, false]);
  eq(verdict(vac).vacuous, true, 'no run of 156s → the pass is VACUOUS and says so');
  eq(verdict(scoreRows([156, 156], [true, false])).holds, false, 'a beat inside a run falsifies');
  // ── the object: every status through the real decision ──
  const base = { rows: 10, loneB1: 2, loneB0: 0, runB1: 0, runB0: 3, beatOff156: 0, runs: 3, longest: 2 };
  const vo = (t, o) => verdictObject({ ...base, ...t }, { files: 1, scored: 1, commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z', ...o });
  eq(vo({}).status, 'PASS', 'object: holds + run rows seen ⇒ PASS');
  eq(vo({}).reason, null, 'object: PASS carries no reason');
  eq(vo({ runB0: 0, runs: 0 }).status, 'UNDERPOWERED', 'object: holds but no run of 156s ⇒ UNDERPOWERED (vacuous), never PASS');
  eq(vo({ loneB0: 1 }).status, 'FAIL', 'object: a lone 156 with beat=0 ⇒ FAIL');
  eq(/beat=1 off a 156: 2/.test(vo({ beatOff156: 2 }).reason), true, 'object: FAIL names WHICH count');
  eq(vo({}, { scored: 0, files: 0 }).status, 'NOT_RUN', 'object: nothing scored ⇒ NOT_RUN');
  eq(verdictSample().status, 'PASS', 'object: the #2758 corpus sample is a non-vacuous PASS');
  console.log('✓ all ' + ok + ' assertions passed');
}

const arg = process.argv[2];
const JSON_OUT = process.argv.includes('--json');
const out = (line) => (JSON_OUT ? console.error(line) : console.log(line));
/* `includes('--selftest')` in CALL position — the shape selftest-all's discovery reads; the `arg ===`
   form this shipped with was invisible to it, so this selftest never ran in the sweep (caught by the
   decides-are-gated ratchet the day it landed). */
if (process.argv.includes('--selftest')) selftest();
else if (arg === '--verdict-sample') console.log(JSON.stringify(verdictSample()));
else if (!arg || !fs.existsSync(arg)) {
  console.error('usage: node tools/pletha-marker-oracle.mjs <captures-root> [--json] | --selftest | --verdict-sample');
  process.exit(2);
} else {
  const files = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const q = path.join(d, n);
      if (fs.statSync(q).isDirectory()) walk(q);
      else if (/_PLETHA\.txt$/.test(n)) files.push(q);
    }
  };
  walk(arg);
  const tot = { rows: 0, loneB1: 0, loneB0: 0, runB1: 0, runB0: 0, beatOff156: 0, runs: 0, longest: 0 };
  let scored = 0;
  for (const f of files.sort()) {
    const t = await scoreFile(f);
    if (!t) continue;
    scored++;
    for (const k of Object.keys(tot)) tot[k] = k === 'longest' ? Math.max(tot[k], t[k]) : tot[k] + t[k];
    const v = verdict(t);
    out(`${path.basename(f).slice(-24, -11)}  rows ${String(t.rows).padStart(6)}  runs≥2 ${String(t.runB1 + t.runB0).padStart(3)}  ${v.label}`);
  }
  const v = verdict(tot);
  out(`\n${scored} of ${files.length} PLETHA file(s) scored · ${tot.rows} rows`);
  out(`  lone 156 · beat=1 ${tot.loneB1}   beat=0 ${tot.loneB0}`);
  out(`  run  156 · beat=1 ${tot.runB1}   beat=0 ${tot.runB0}   (runs ${tot.runs}, longest ${tot.longest})`);
  out(`  beat=1 on a non-156 row: ${tot.beatOff156}`);
  out(`VERDICT: ${v.label}${v.holds && !v.vacuous ? ` — discriminating run rows: ${v.runRows}` : ''}`);
  // the object IS the verdict; the lines above are its explanation
  if (JSON_OUT) console.log(JSON.stringify(verdictObject(tot, { files: files.length, scored, root: arg })));
  process.exit(v.holds ? 0 : 1);
}
