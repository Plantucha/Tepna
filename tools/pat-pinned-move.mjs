#!/usr/bin/env node
/*
 * tools/pat-pinned-move.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HOW FAR WOULD THE PAT FOOT SET MOVE IF THE PINNED-SPAN REFUSAL STOPPED WAITING FOR A SIDECAR?
 *
 * `pat-feasibility-worker.js ppgFootTimes` drops a consensus foot that every optical channel was
 * pinned through. It builds those ranges only where `rec.pinnedCrossCheck` exists, which needs an
 * ingested `_PPGRUNS.txt`. `PPGDSP.parsePPG` publishes `rec.spans` on EVERY path, so the ranges are
 * available without the companion and the refusal still does not fire. Row
 * `2026-10-28-pat-legs-refuse-only-the-spans-a-sidecar-confirmed` records the gate as deliberate:
 * consuming the recompute would move every existing PAT result, and the move was never measured.
 *
 * THE POPULATION, measured 2026-11-01 read-only over the corpus search: 3618 PPG recordings reach a
 * PAT tool after realpath dedup, 170 carry the companion, 3448 do not. So the refusal reaches 4.7 %
 * of them and the other 95.3 % can place a foot inside a span the file itself marks invalid.
 *
 * THE RUN OF RECORD, 2026-11-01, pre-stated before the run: a stride of 60 over the 3448
 * recordings without a companion, floor 3. It reads FAIL. 60 recordings read, 56 the switch
 * cannot bite, 4 it can, and all 4 lose a foot — 17 feet of 22577, or 0.075 %. Every mover is a
 * 1-channel Wellue finger recording, and no 3-channel Polar recording in the sample carries a
 * span that every channel was pinned through. The largest mover drops 14 feet of 22540 with 90 s
 * pinned through. So flipping the shipped default would move published PAT results. The switch
 * stays opt-in and the row stays open.
 *
 * THIS RUNS THE SHIPPED FUNCTION, NOT A PORT. Every PAT tool copies `ppgFootTimes` rather than
 * calling it, and #4220 measured the two copies drifting in opposite directions. So a move measured
 * over a copy measures a third pipeline. This loads the worker into a vm with its own co-load list
 * already resolved, and calls it twice per recording: once as it ships, once with the optional
 * `{ pinnedFromRecompute: true }` switch the worker now carries. The default leg is the control.
 *
 * ∅ AN EMPTY SAMPLE REPORTS ITS ABSENCE. A share over no recording is `null` with a named reason,
 * never 0, and a verdict over `checked: 0` is NOT_RUN — it examined nothing. A requirement over an
 * empty set reads as a pass, which is the failure mode this whole file exists to avoid.
 *
 * WHAT IT DOES NOT CLAIM. It measures the FOOT SET, not the published PAT lag. A lag move needs the
 * paired ECG leg and its own run, and this instrument states that rather than implying it. It also
 * decides nothing about the shipped default: the switch stays opt-in until the owner rules.
 *
 * CLI: --check (default) · --json · --selftest · --limit <n> · --tree <path>
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { populationVerdict, snapshotEntries } from './corpus-scope-core.mjs';
import { resolveCorpus } from './regen-goldens-core.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/pat-pinned-move.mjs';
/* The companion's own spelling, read off the corpus rather than derived from the stream name. The
   sidecars spell themselves `_PPGRUNS.txt` and `_PPG1WRUNS.txt`; a pairing that guessed
   `<base>RUNS.txt` from `<base>_PPG.txt` matched nothing, and a pairing that matches nothing reads
   as a population with no sidecars at all. */
export const COMPANION_SUFFIXES = Object.freeze(['_PPGRUNS.txt', '_PPG1WRUNS.txt']);
const PPG_SUFFIX = '_PPG.txt';
/* PRE-STATED, before any recording is read: the sample size, and the floor under which the run is
   UNDERPOWERED rather than a result. Both are arguments to the verdict, not conclusions from it. */
export const SAMPLE_DEFAULT = 10;
export const SAMPLE_FLOOR = 3;

/* 🔴 THE SAMPLE IS A STRIDE, AND THE FIRST VERSION OF THIS FILE TOOK A PREFIX. Measured 2026-11-01:
   `slice(0, 10)` over the path-sorted list returned ten Polar 3-channel recordings, every one with no
   span all channels were pinned through, so the run read PASS — 0 of 10 moved — over a population
   where the switch CANNOT change the answer. A strided read of the same list found a 1-channel Wellue
   recording dropping 27 feet and 171 s. A sorted path prefix is stratified by device, directory and
   date all at once, because a capture path begins with the device name. */
export function sampleOf(list, limit) {
  if (!Array.isArray(list) || !list.length || limit < 1) return [];
  if (list.length <= limit) return list.slice();
  const step = Math.floor(list.length / limit);
  const out = [];
  for (let i = 0; i < limit; i++) out.push(list[i * step]);
  return out;
}

/* ── the corpus pairing ──────────────────────────────────────────────────────────────────────── */
/* A tree is NAMED repo-relative where it can be, and by a digest where it cannot. The corpus root
   and every capture path sit under a home directory, and a home path reaches a PR body or a board
   post the moment anyone quotes a verdict. */
export function displayTree(p, root = ROOT) {
  const rel = relative(root, String(p));
  if (rel && !rel.startsWith('..')) return rel;
  return `<outside the checkout>:${createHash('sha256').update(String(p)).digest('hex').slice(0, 8)}`;
}

export function pairRecordings(tree, opts = {}) {
  const read = opts.readdir || ((d) => readdirSync(d, { withFileTypes: true }));
  const real = opts.realpath || ((p) => realpathSync(p));
  const exists = opts.exists || ((p) => existsSync(p));
  const out = { withCompanion: [], withoutCompanion: [], scanned: 0 };
  if (!exists(tree)) return { ...out, reason: `the corpus tree is not here: ${displayTree(tree)}` };
  const seenDir = new Set();
  const seenFile = new Set();
  const stack = [tree];
  while (stack.length) {
    const dir = stack.pop();
    let key;
    try {
      key = real(dir);
    } catch {
      continue;
    }
    if (seenDir.has(key)) continue;
    seenDir.add(key);
    let entries = [];
    try {
      entries = read(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      // A symlinked directory is how the corpus is reached at all, so a dirent that is a link is
      // followed by stat rather than skipped by `isDirectory()` alone.
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) {
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) {
        stack.push(full);
        continue;
      }
      if (!e.name.endsWith(PPG_SUFFIX)) continue;
      let rp;
      try {
        rp = real(full);
      } catch {
        rp = full;
      }
      if (seenFile.has(rp)) continue;
      seenFile.add(rp);
      out.scanned++;
      const base = full.slice(0, full.length - PPG_SUFFIX.length);
      const paired = COMPANION_SUFFIXES.some((s) => exists(base + s));
      (paired ? out.withCompanion : out.withoutCompanion).push(full);
    }
  }
  out.withCompanion.sort();
  out.withoutCompanion.sort();
  return out;
}

/* ── the shipped worker, loaded ──────────────────────────────────────────────────────────────── */
export async function loadWorker() {
  // Both are classic scripts with a CommonJS tail, so they are REQUIRED, not imported: an
  // `import()` of `module.exports = <object>` depends on named-export detection, and the tree's own
  // idiom (`beat-correspondence.mjs:58`) is createRequire.
  const require_ = createRequire(import.meta.url);
  const { classicify } = require_(join(ROOT, 'tools/build-core.js'));
  const { PPG_REALM } = require_(join(ROOT, 'tools/realm-manifest.js'));
  if (typeof classicify !== 'function' || !Array.isArray(PPG_REALM)) throw new Error(`${TOOL}: build-core or realm-manifest did not expose what the loader needs`);
  const noop = () => {};
  const sb = { console: { log: noop, warn: noop, error: noop }, setTimeout, clearTimeout, navigator: { userAgent: 'node' } };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  // The worker's own loader calls `importScripts` first and falls back to fetch only when that
  // THROWS. Its deps are pre-loaded below, so the no-op is the same stub the offline analysis blob
  // ships with — and the fetch arm, which no node context can serve, is never reached.
  sb.importScripts = noop;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  const files = [...PPG_REALM, 'pat-gate.js', 'pat-align.js', 'analysis-stats.js', 'ecgdex-dsp.js', 'pat-feasibility-worker.js'];
  for (const f of files) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    vm.runInContext(classicify(readFileSync(p, 'utf8')), ctx, { filename: f });
  }
  if (typeof sb.ppgFootTimes !== 'function') throw new Error(`${TOOL}: the worker loaded but exposes no ppgFootTimes — the co-load list moved`);
  if (sb.DSP_OK !== true) throw new Error(`${TOOL}: the worker reports DSP_OK false (${sb.DSP_ERR || 'no reason given'})`);
  return sb;
}

/* ── one recording, both legs ────────────────────────────────────────────────────────────────── */
export function moveOne(worker, text) {
  const shipped = worker.ppgFootTimes(text);
  const recompute = worker.ppgFootTimes(text, null, { pinnedFromRecompute: true });
  const v = recompute.validity || null;
  /* CAN THE SWITCH BITE ON THIS RECORDING? The worker drops only a foot every optical channel was
     pinned through, and `unmeasuredSec` is exactly the size of that all-channel intersection. So
     `> 0` means there is a span to act on, `0` means there is none and no recompute could move the
     foot set, and ∅ `null` means no channel range was built at all — three states, never one. */
  const bites = v == null || v.unmeasuredSec == null ? null : v.unmeasuredSec > 0;
  return {
    bites,
    feetShipped: shipped.n,
    feetRecompute: recompute.n,
    dropped: v ? v.dropped : null,
    partial: v ? v.partial : null,
    channels: v ? v.channels : null,
    unmeasuredSec: v ? v.unmeasuredSec : null,
    source: v ? v.source : null,
    moved: shipped.n !== recompute.n
  };
}

/* ── the summary ─────────────────────────────────────────────────────────────────────────────── */
export function summarise(rows) {
  if (!rows.length) {
    /* ∅ No recording was read, so every share below would be a quotient of nothing. `null` plus a
       reason, never 0 — a 0 here says the recompute drops no foot, which is a measurement nobody
       made. */
    return { n: 0, moved: null, movedShare: null, droppedTotal: null, feetTotal: null, droppedShare: null, reason: 'no recording was read, so no share was computed' };
  }
  let moved = 0;
  let droppedTotal = 0;
  let feetTotal = 0;
  for (const r of rows) {
    if (r.moved) moved++;
    if (typeof r.dropped === 'number') droppedTotal += r.dropped;
    feetTotal += r.feetShipped;
  }
  return {
    n: rows.length,
    moved,
    movedShare: moved / rows.length,
    droppedTotal,
    feetTotal,
    droppedShare: feetTotal ? droppedTotal / feetTotal : null,
    reason: null
  };
}

/* ONE BUILDER. The sample below and a real run print the same object, so a reader never compares a
   hand-written sample against a verdict no run produced. */
export function buildVerdict({ rows, refused, paired }) {
  /* THE POPULATION THE CRITERION JUDGES is the recordings the switch can bite, not every recording
     read. A recording with no all-channel pinned span is EXCLUDED with its reason rather than counted
     as a recording that held still, because it was never at risk of moving. */
  const biting = rows.filter((r) => r.bites === true);
  const noBite = rows.filter((r) => r.bites === false);
  const unknownBite = rows.filter((r) => r.bites === null || r.bites === undefined);
  const sum = summarise(biting);
  const eligible = paired.withoutCompanion.length;
  const byVendor = {};
  for (const r of rows) {
    const k = String(r.rec || '').split(':')[0] || 'unknown';
    byVendor[k] = (byVendor[k] || 0) + 1;
  }
  let status = 'UNKNOWN';
  let reason = null;
  if (sum.n === 0) {
    /* NOT_RUN carries `result: null` by contract — it examined nothing, so it measured nothing. The
       pairing census IS real, so it travels in the reason, where no reader can mistake it for a
       result the move produced. */
    if (rows.length) {
      /* It READ recordings and none of them could bite, so it examined something and measured
         nothing the criterion can judge: UNDERPOWERED, naming why — never a PASS over 0 at risk. */
      status = 'UNDERPOWERED';
      reason = `${rows.length} recording(s) read and none carries a span every channel was pinned through, so the sample holds no recording whose foot set could move (${noBite.length} with no such span, ${unknownBite.length} with no channel range built at all)`;
    } else {
      status = 'NOT_RUN';
      reason =
        (paired.reason || 'no companion-less recording was read, so the move was not measured') +
        ` (the walk saw ${paired.scanned} recording(s): ${paired.withCompanion.length} with a companion, ${eligible} without)`;
    }
  } else if (sum.n < SAMPLE_FLOOR) {
    status = 'UNDERPOWERED';
    reason = `${sum.n} recording(s) whose foot set could move, against a pre-stated floor of ${SAMPLE_FLOOR} (${rows.length} read, ${noBite.length + unknownBite.length} with nothing for the switch to act on)`;
  } else if (sum.moved === 0) {
    status = 'PASS';
  } else {
    status = 'FAIL';
    reason = `${sum.moved} of ${sum.n} recording(s) lose at least one foot when the refusal reads the recompute, so the shipped default and the recompute do not agree`;
  }
  return makeVerdict({
    tool: TOOL,
    gate: 'pat-pinned-move',
    status,
    population: {
      checked: sum.n,
      eligible: sum.n + noBite.length + unknownBite.length + refused.length,
      excluded: noBite.length + unknownBite.length + refused.length
    },
    criterion: { name: 'recordings_whose_foot_set_moves', threshold: 0, unit: 'recordings', direction: 'lte' },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            moved: sum.moved,
            movedShare: sum.movedShare,
            droppedFeet: sum.droppedTotal,
            feetShipped: sum.feetTotal,
            droppedShare: sum.droppedShare,
            companionLess: eligible,
            withCompanion: paired.withCompanion.length,
            scanned: paired.scanned,
            read: rows.length,
            couldNotBite: noBite.length,
            noChannelRange: unknownBite.length,
            unreadable: refused.length,
            byVendor
          },
    evidence: [TOOL, 'pat-feasibility-worker.js'],
    reason
  });
}

function maskPath(p) {
  // Raw capture filenames carry a device serial, so a report names a recording by a digest of its
  // path and the vendor word, never by its name.
  const h = createHash('sha256').update(p).digest('hex').slice(0, 8);
  const vendor = /Wellue/.test(p) ? 'Wellue' : /Polar/.test(p) ? 'Polar' : 'unknown';
  return `${vendor}:${h}`;
}

/* ── selftest ────────────────────────────────────────────────────────────────────────────────── */
function selftest() {
  let ran = 0;
  const ok = (what, cond) => {
    ran++;
    if (!cond) {
      process.exitCode = 1;
      throw new Error(`selftest: ${what}`);
    }
  };
  const planted = {
    '/c/n1_PPG.txt': 1,
    '/c/n1_PPGRUNS.txt': 1,
    '/c/n2_PPG.txt': 1,
    '/c/n3_PPG.txt': 1,
    '/c/n3RUNS.txt': 1
  };
  const fake = {
    readdir: (d) => (d === '/c' ? Object.keys(planted).map((k) => ({ name: k.slice(3), isDirectory: () => false, isSymbolicLink: () => false })) : []),
    realpath: (p) => p,
    exists: (p) => p === '/c' || planted[p] === 1
  };
  const paired = pairRecordings('/c', fake);
  ok('the companion is paired on its own spelling', paired.withCompanion.length === 1);
  ok('a recording with no companion is counted, not skipped', paired.withoutCompanion.length === 2);
  ok('CONTROL · the `<base>RUNS.txt` guess pairs nothing, which is why it is not in the list', !COMPANION_SUFFIXES.includes('RUNS.txt'));
  ok('every scanned recording lands in exactly one bin', paired.scanned === paired.withCompanion.length + paired.withoutCompanion.length);
  const absent = pairRecordings('/nowhere', { ...fake, exists: (p) => p === '/c' });
  ok('an absent tree names its absence rather than reporting an empty corpus', typeof absent.reason === 'string' && absent.scanned === 0);
  ok('an absent tree is named repo-relative, never by a home path', !/\/home\//.test(absent.reason));
  ok('a tree outside the checkout is named by a digest, not by its path', displayTree('/elsewhere/captures', '/repo').startsWith('<outside the checkout>:'));
  ok('a tree inside the checkout is named by its repo-relative path', displayTree('/repo/uploads', '/repo') === 'uploads');
  const s0 = summarise([]);
  ok('∅ an empty sample reports null shares', s0.movedShare === null && s0.droppedShare === null);
  ok('∅ and it names the reason', typeof s0.reason === 'string');
  const s1 = summarise([
    { moved: true, dropped: 3, feetShipped: 100 },
    { moved: false, dropped: 0, feetShipped: 100 }
  ]);
  ok('the moved share counts recordings', s1.moved === 1 && s1.movedShare === 0.5);
  ok('the dropped share counts feet', s1.droppedTotal === 3 && s1.feetTotal === 200 && Math.abs(s1.droppedShare - 0.015) < 1e-12);
  const s2 = summarise([{ moved: false, dropped: null, feetShipped: 0 }]);
  ok('∅ a recording with no foot leaves the dropped share null, never 0', s2.droppedShare === null);
  const vAbsent = buildVerdict({ rows: [], refused: [], paired: { withCompanion: [], withoutCompanion: [], scanned: 0, reason: 'the corpus tree is not here' } });
  ok('∅ a walk that read nothing is NOT_RUN, never PASS over an empty set', vAbsent.status === 'NOT_RUN');
  ok('∅ and NOT_RUN carries result null by contract', vAbsent.result === null);
  ok('∅ and the census travels in the reason, not in a result', /the walk saw 0 recording\(s\)/.test(vAbsent.reason));
  const vMoved = buildVerdict({
    rows: [
      { bites: true, moved: true, dropped: 2, feetShipped: 50 },
      { bites: true, moved: false, dropped: 0, feetShipped: 50 },
      { bites: true, moved: false, dropped: 0, feetShipped: 50 }
    ],
    refused: [],
    paired: { withCompanion: ['a'], withoutCompanion: ['b', 'c', 'd'], scanned: 4 }
  });
  ok('one recording moving reads FAIL against a threshold of 0', vMoved.status === 'FAIL' && vMoved.result.moved === 1);
  ok('and a FAIL names its reason', typeof vMoved.reason === 'string' && vMoved.reason.length > 0);
  const vUnder = buildVerdict({ rows: [{ bites: true, moved: false, dropped: 0, feetShipped: 1 }], refused: [], paired: { withCompanion: [], withoutCompanion: ['b'], scanned: 1 } });
  ok('a sample under the pre-stated floor is UNDERPOWERED, not a PASS', vUnder.status === 'UNDERPOWERED');
  /* 🔴 THE REGRESSION THIS FILE WAS BUILT WRONG ONCE TO LEARN. Ten recordings read, none of them at
     risk, 0 moved — and the first version called that a PASS. */
  const vNoBite = buildVerdict({
    rows: [
      { bites: false, moved: false, dropped: 0, feetShipped: 10 },
      { bites: false, moved: false, dropped: 0, feetShipped: 10 },
      { bites: null, moved: false, dropped: null, feetShipped: 10 }
    ],
    refused: [],
    paired: { withCompanion: [], withoutCompanion: ['a', 'b', 'c'], scanned: 3 }
  });
  ok('a sample where the switch cannot bite is UNDERPOWERED, never a PASS over 0 at risk', vNoBite.status === 'UNDERPOWERED');
  ok('and it names how many could not bite rather than reporting them as held still', /none carries a span every channel was pinned through/.test(vNoBite.reason));
  ok('a recording that could not bite is EXCLUDED, not checked', vNoBite.population.checked === 0 && vNoBite.population.excluded === 3);
  ok('checked + excluded = eligible holds across the partition', vMoved.population.checked + vMoved.population.excluded === vMoved.population.eligible);
  const strided = sampleOf(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'], 3);
  ok('the sample strides the whole list rather than taking its head', strided.join(',') === 'a0,a3,a6');
  ok('a list no longer than the limit is taken whole', sampleOf(['x', 'y'], 5).length === 2);
  ok('∅ an empty list yields an empty sample, never a fabricated member', sampleOf([], 5).length === 0);
  ok('a masked name carries no serial', !/S\dAW/.test(maskPath('/x/Wellue_O2Ring-S_S4AW1234_20260824052358_PPG.txt')));
  ok('a masked name still names the vendor', maskPath('/x/Polar_VeritySense_0C301E3F_1_PPG.txt').startsWith('Polar:'));
  console.log(`selftest: all ${ran} assertions passed`);
}

/* ── main ────────────────────────────────────────────────────────────────────────────────────── */
/* THE LISTER IS THIS POPULATION'S RULE, and it publishes MASKED record ids. A capture filename
   carries a device serial, so the member list of a published population verdict cannot hold one. The
   mask is deterministic per path, so a recording that arrives or leaves still moves the digest. */
export function listMaskedPpgRecordings(root) {
  const paired = pairRecordings(root);
  return [...paired.withCompanion, ...paired.withoutCompanion].map(maskPath);
}
/* THE ARGV HELPERS SIT AT MODULE SCOPE, not inside `main`. The suite bounds a helper's body at the
   next column-0 declaration, so an indented pair reads as ONE body: `has` inherits `valueOf`'s
   `indexOf` and every boolean flag reports as value-reading. Row
   2026-11-01-the-flag-arity-scan-bounds-a-helper-body-at-column-0. */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};
async function main() {
  refuseUnknownArgvOrExit(argv, { valued: ['--limit', '--tree'], boolean: ['--check', '--json', '--selftest', '--verdict-sample'] }, { tool: 'pat-pinned-move' });
  if (has('--selftest')) {
    selftest();
    process.exit(process.exitCode || 0);
  }
  if (has('--verdict-sample')) {
    /* The same walk over a root that cannot exist: it reads no recording, so the one builder above
       prints NOT_RUN — the status that says it examined nothing, never a PASS over an empty set. */
    const paired = pairRecordings(join(ROOT, 'no-such-tree-for-a-verdict-sample'));
    printVerdict(buildVerdict({ rows: [], refused: [], paired }));
    process.exit(0);
  }
  const limitRaw = valueOf('--limit');
  const limit = limitRaw == null ? SAMPLE_DEFAULT : Number(limitRaw);
  if (!Number.isFinite(limit) || limit < 1) {
    console.error(`${TOOL}: --limit must be a positive number, read ${String(limitRaw)}`);
    process.exit(2);
  }
  const tree = valueOf('--tree') || resolveCorpus(ROOT);
  /* THE POPULATION IS REPORTED SEPARATELY FROM THE MOVE. This verdict answers "which records did
     this run's root offer, and did that set move while I walked it"; the move verdict below answers
     "how far did the foot set shift". One cannot stand in for the other. */
  const popBefore = snapshotEntries(String(tree), { list: listMaskedPpgRecordings, unit: 'records' });
  const paired = pairRecordings(String(tree));
  const eligible = paired.withoutCompanion.length;
  const sample = sampleOf(paired.withoutCompanion, limit);
  const rows = [];
  const refused = [];
  let worker = null;
  if (sample.length) worker = await loadWorker();
  for (const p of sample) {
    let text = null;
    try {
      text = readFileSync(p, 'utf8');
    } catch (e) {
      refused.push({ rec: maskPath(p), reason: `unreadable: ${(e && e.message) || e}` });
      continue;
    }
    try {
      rows.push({ rec: maskPath(p), ...moveOne(worker, text) });
    } catch (e) {
      refused.push({ rec: maskPath(p), reason: String((e && e.message) || e) });
    }
    text = null; // one recording at a time: the next read must not wait on this buffer
  }
  const verdict = buildVerdict({ rows, refused, paired });
  for (const r of rows)
    console.log(
      `  ${r.bites !== true ? '⊘' : r.moved ? '△' : '='} ${r.rec} — feet ${r.feetShipped} shipped · ${r.feetRecompute} with the recompute · dropped ${r.dropped == null ? 'null' : r.dropped} over ${r.channels == null ? 'null' : r.channels} channel(s) · pinned-through ${r.unmeasuredSec == null ? 'null' : r.unmeasuredSec} s${r.bites === true ? '' : ' — the switch cannot bite here'}`
    );
  for (const r of refused) console.log(`  ⊘ ${r.rec} — ${r.reason}`);
  console.log(
    `pat-pinned-move: ${rows.length} of ${eligible} companion-less recording(s) read · ${paired.withCompanion.length} carry a companion · ${verdict.population.checked} could move · ${verdict.result ? verdict.result.moved : 'no'} moved`
  );
  const population = populationVerdict(popBefore, snapshotEntries(String(tree), { list: listMaskedPpgRecordings, unit: 'records' }), { tool: TOOL, evidence: [TOOL] });
  console.log(`  population: ${popBefore.n} record(s) offered under ${displayTree(String(tree))} · movement ${population.status}${population.reason ? ` — ${population.reason}` : ''}`);
  console.log(`POPULATION ${JSON.stringify(population)}`);
  printVerdict(verdict, { json: has('--json') });
  process.exit(verdict.status === 'FAIL' ? 1 : verdict.status === 'NOT_RUN' ? 2 : 0);
}

if (isCliEntry(import.meta.url)) await main();
