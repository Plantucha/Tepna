#!/usr/bin/env node
/*
 * tools/treatment-response-yield-pin.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE PINNED YIELD — how many synthetic patients qualify for `papers/treatment-response.html`, and
 * which of the two inputs is answerable for the number.
 *
 * WHY THIS EXISTS (residue `2026-09-22-cohort-gen-yield-moved-again`). At the paper's stated
 * configuration — `nSubj 900, minN 10` — the qualifying cohort read 269 intervention / 317
 * flat-control on 2026-09-16/17 and 233 / 239 on 2026-09-22. Same configuration, same generator
 * version, different answer, and the ONLY thing that noticed was a re-cut run six days later. Five
 * OxyDex commits landed in between and were named as candidates, not verified as the cause. A number
 * that moves without anything reporting it is not a measurement; it is a coincidence that has not been
 * caught yet.
 *
 * ⚠️ THE DECOMPOSITION IS THE POINT, and it is what makes this more than a golden. The page reaches its
 * counts in two independent stages:
 *
 *   1 · SELECTION — `treatment-response-analysis.js` scans `CohortGen.sampleProfile(seed)` from 0 and
 *       keeps the seeds whose profile is an intervention arc with >= `minN` nights (and >= 2 pre- and
 *       >= 2 post-treatment), or a flat arc with >= `minN` nights, until it has `nSubj` of each. NO
 *       DETECTOR RUNS IN THIS STAGE. It is pure generator, it is deterministic, and it takes ~100 ms.
 *   2 · SURVIVAL — every selected seed is scored by the REAL detectors in a worker realm, and
 *       `measureFromResults` returns null — dropping the patient — whenever the ODI or rMSSD series
 *       has a gap or a non-finite value. NO GENERATOR RUNS IN THIS STAGE.
 *
 * So `nIntervention = txCandidates − txSkipped`, and the two terms have DIFFERENT owners. Pinning the
 * pair therefore answers a question a single committed count cannot: when the yield moves, the
 * selection count says whether the generator moved, and its stability says the detectors did.
 *
 * Measured 2026-09-28: selection yields 900 / 900 — it FILLS the target from 18,291 seeds against a
 * 2,000,000 cap. The generator has slack and is not the constraint, which means every one of the three
 * historical yields was set entirely by detector-side skips. That is a decided fact where the residue
 * row had a named-but-unverified candidate.
 *
 * ⚠️ WHAT THE KEY IS, AND WHY IT IS NOT A BUNDLE HASH. The page does not inline the detectors; it boots
 * `cohort-worker.js` realms that `importScripts` them. The pin therefore keys on the SHA of every file
 * in the `oxy` and `pulse` entries of that worker's own `SCRIPTS` table — the exact code that produced
 * the counts — and the list is READ FROM THE TABLE, never hand-copied here. A hand-maintained closure
 * that silently stopped covering a new realm file would reproduce this row's defect one layer up.
 * The consequence is deliberate and conservative: a comment-only edit to `oxydex-dsp.js` reds the pin.
 * That direction is the correct one to fail in — re-stamping a pin is four seconds and a re-cut that
 * nobody ran is what this row is about — and the suite's failure text says which file moved, so an
 * inert edit is cheap to dispose of.
 *
 * This tool WRITES the pin. It decides nothing and emits no verdict: the gates are
 * `treatment-response · pinned yield` (the closure the yield was measured under) and
 * the chain legs inside it (the pin holds no digest its own notes cannot explain), both in
 * `tests/dex-tests.js`, which is where the decision belongs.
 *
 *   node tools/analysis-rerun.mjs --only treatment-response-analysis.html --paper-scale --out <rerun.json>
 *   node tools/treatment-response-yield-pin.mjs --rerun <rerun.json> [--out analysis/treatment-response-yield-pin.json]
 *   node tools/treatment-response-yield-pin.mjs --chain [--pin <pin.json>]   # read the chain, write nothing
 *   node tools/treatment-response-yield-pin.mjs --blame [--pin <pin.json>] [--ref origin/main]   # resolve each gap to its revision
 *   node tools/treatment-response-yield-pin.mjs --selftest
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isCliEntry } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PIN = join(ROOT, 'analysis', 'treatment-response-yield-pin.json');

/* The page's stated configuration, and the seed cap it scans under. Read from
   `tools/analysis-rerun.mjs`'s inventory would be better still, but that file is an ESM module with a
   large side-effecting main; these three numbers are asserted against the page and the inventory by
   the suite instead, which is the same guarantee without importing a CLI. */
export const CONFIG = { page: 'treatment-response-analysis.html', nSubj: 900, minN: 10, seedCap: 2000000 };

export const sha12 = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);

/* ── STAGE 1 · SELECTION, replayed exactly as `treatment-response-analysis.js:323` runs it ──────────
   The predicate is transcribed from that loop and the suite asserts the transcription still matches
   the page's source, so a page edit cannot leave this replay quietly measuring a different cohort. */
export function selectionCounts(CohortGen, { nSubj, minN, seedCap }) {
  let tx = 0,
    flat = 0,
    seed = 0;
  while ((tx < nSubj || flat < nSubj) && seed < seedCap) {
    let pf;
    try {
      pf = CohortGen.sampleProfile(seed);
    } catch {
      seed++;
      continue;
    }
    if (pf) {
      if (pf.arc === 'intervention' && pf.nNights >= minN && pf.interventionNight >= 2 && pf.interventionNight <= pf.nNights - 2 && tx < nSubj) tx++;
      else if (pf.arc === 'flat' && pf.nNights >= minN && flat < nSubj) flat++;
    }
    seed++;
  }
  return { txCandidates: tx, flatCandidates: flat, seedsScanned: seed, filledTarget: tx >= nSubj && flat >= nSubj };
}

/* ── THE SCALE CHECK · the run must state the cohort it ran, or the skipped counts cross two cohorts ─
   `selectionCounts` replays the selector at `CONFIG`, so `txSkipped = txCandidates − nIntervention`
   subtracts a 900-candidate replay from whatever the rerun answered. Both terms are only comparable
   while the run WAS at `CONFIG`. Measured 2026-11-07 (board finding #4343;
   the ledger row for it rides a RESIDUE-only PR, and a key cited before its row lands reds
   `verify:residue-citations`): a page-default run of 45 per arm
   answered 10 tx / 17 flat, and this tool wrote `txSkipped 890` — 890 subjects the run never examined,
   published as 890 the detectors rejected, beside a yield that read as a collapse from 233 and was a
   change of scale. The page publishes `targetSubj` for this reason, and §∅ governs the older run that
   does not: an unstated cohort is a REFUSAL with its own token, never a match by default.

   `minNights` gets the same treatment. The rerun inventory's own comment records that the page
   defaults to 6 against the paper's 10, and that the difference changes who qualifies. The pin wrote
   it as `config.minNightsObserved` beside the stated `minN` and compared the two nowhere. */
export const SCALE_REASONS = ['cohort-size-absent', 'cohort-size-mismatch', 'min-nights-absent', 'min-nights-mismatch'];

export function scaleCheck(R, config = CONFIG) {
  const mk = (reason, field, ran, stated) => ({
    ok: false,
    reason,
    field,
    ran,
    stated,
    message:
      ran == null
        ? 'the rerun result does not state its ' + field + ', so the skipped counts cannot be derived — re-run the current page, which publishes it'
        : 'the rerun ran at ' + field + ' ' + ran + ' and the pinned configuration states ' + stated + ' — the skipped counts would cross two cohorts'
  });
  if (R == null) return mk('cohort-size-absent', 'targetSubj', null, config.nSubj);
  if (R.targetSubj == null) return mk('cohort-size-absent', 'targetSubj', null, config.nSubj);
  if (R.targetSubj !== config.nSubj) return mk('cohort-size-mismatch', 'targetSubj', R.targetSubj, config.nSubj);
  if (R.minNights == null) return mk('min-nights-absent', 'minNights', null, config.minN);
  if (R.minNights !== config.minN) return mk('min-nights-mismatch', 'minNights', R.minNights, config.minN);
  return { ok: true, reason: null, field: null, ran: R.targetSubj, stated: config.nSubj, message: null };
}

/* `cohort-gen.js` is a browser global module; load it the way the suite does rather than importing. */
export function loadCohortGen(root = ROOT) {
  const ctx = vm.createContext({ console, Math, Date, JSON });
  ctx.window = ctx;
  for (const f of ['kernel-constants.js', 'cohort-gen.js']) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx);
  return ctx.CohortGen || null;
}

/* ── THE DETECTOR CLOSURE, derived from `cohort-worker.js`'s own table ──────────────────────────────
   A realm the table does not name returns `null`, never `{}`: "the table moved" and "this realm loads
   nothing" must not reach a comparison wearing the same shape. */
export function realmDigests(workerSrc, realms, readFile) {
  const out = {};
  for (const realm of realms) {
    const m = workerSrc.match(new RegExp('\\b' + realm + ':\\s*\\[([^\\]]*)\\]'));
    const files = m ? (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)) : [];
    if (!files.length) {
      out[realm] = null;
      continue;
    }
    const d = {};
    for (const f of files) d[f] = readFile(f);
    out[realm] = d;
  }
  return out;
}

/* Which named digests differ between two closures — the answer the failure text needs, not a boolean. */
export function movedFiles(pinned, current) {
  const moved = [];
  for (const realm of Object.keys(pinned || {})) {
    const a = pinned[realm],
      b = (current || {})[realm];
    if (!a || !b) {
      moved.push(realm + ': realm absent on one side');
      continue;
    }
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[f] !== b[f]) moved.push(realm + '/' + f + ' ' + (a[f] || 'absent') + ' → ' + (b[f] || 'absent'));
    }
  }
  return moved;
}

/* ── THE CHAIN THE NOTES MAKE ──────────────────────────────────────────────────
   `history[]` is the one place the repo records WHY a closure digest moved, and nothing asked for a
   note. Measured over this pin at `2811ba8af`: the two detector files passed through 28 digests since
   the chain's first note, and 14 of those moves carry no note. Three unrecorded ones are shared-spine
   commits that moved both realms at once, so one PR owed two notes.

   So a re-cut compares the digest it is about to write against the last note's `new`, per file. A HEAD
   gap is the move this run owes a note for. An INTERNAL gap is a move no later RE-CUT can name,
   because the run that made it is over — and `--blame` still reads WHICH EDIT moved it out of git,
   because the digest is the file's own hash. The two are reported apart, because asking a session to explain someone
   else's edit invites a guessed reason, and a guessed reason is worse than an absent one.

   A note names a BARE basename, while a closure is per realm. The two realms agree on every shared
   file today. A basename whose realms hold DIFFERENT digests is AMBIGUOUS and gets no head entry,
   because no note in this shape can say which realm moved. */
function digestsByName(detector) {
  const byName = new Map();
  for (const realm of Object.keys(detector || {})) {
    const d = detector[realm];
    if (!d) continue;
    for (const f of Object.keys(d)) {
      if (!byName.has(f)) byName.set(f, new Map());
      const holders = byName.get(f);
      if (!holders.has(d[f])) holders.set(d[f], []);
      holders.get(d[f]).push(realm);
    }
  }
  return byName;
}

/* One digest, or `null` when the realms disagree — the AMBIGUOUS case, which no comparison may
   collapse by picking a side. */
const oneDigest = (holders) => (holders && holders.size === 1 ? [...holders][0] : null);

export function chainGaps(detector, history, prevDetector) {
  const notes = (Array.isArray(history) ? history : []).filter((e) => e && typeof e === 'object' && typeof e.file === 'string');
  const byFile = new Map();
  for (const e of notes) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  const internal = [];
  for (const [file, es] of byFile) {
    for (let i = 0; i + 1 < es.length; i++) {
      if (es[i].new !== es[i + 1].old) {
        internal.push({ file, closes: es[i].new ?? null, reopens: es[i + 1].old ?? null, after: es[i].date ?? null, before: es[i + 1].date ?? null });
      }
    }
  }
  const byName = digestsByName(detector);
  /* THE MOVE THIS RUN MAKES, against the pin it is about to overwrite. An absent previous pin is no
     record of a move rather than none, so `moves` is `null` and the run says it cannot name its own. */
  let moves = null;
  if (prevDetector) {
    moves = [];
    const prevByName = digestsByName(prevDetector);
    for (const [file, holders] of byName) {
      const cur = oneDigest(holders);
      if (!cur || cur[0] == null) continue;
      const prv = oneDigest(prevByName.get(file));
      const was = prv ? prv[0] : null;
      if (was === cur[0]) continue;
      moves.push({ file, realms: cur[1], old: was, new: cur[0] });
    }
  }
  const head = [];
  const uncovered = [];
  const ambiguous = [];
  for (const [file, holders] of byName) {
    if (holders.size > 1) {
      ambiguous.push({ file, holds: [...holders].map(([digest, realms]) => ({ digest: digest ?? null, realms })) });
      continue;
    }
    const [digest, realms] = [...holders][0];
    if (digest == null) continue;
    const es = byFile.get(file) || [];
    if (!es.length) {
      uncovered.push(file);
      continue;
    }
    const last = es[es.length - 1];
    if (last.new === digest) continue;
    head.push({ file, realms, pinned: digest, lastNote: last.new ?? null, noteDate: last.date ?? null });
  }
  return { moves, head, internal, uncovered, ambiguous };
}

/* The file's revisions on `ref`, NEWEST FIRST, each carrying the digest its bytes hash to. A path git
   does not know returns `[]` rather than throwing, because an absent path is a reading this mode has
   to report. The walk hashes one revision at a time and holds no blob after it. */
function gitRevisions(ref, file) {
  /* `stdio` silences git's own stderr: a ref this walk cannot read is a reading it REPORTS, and a
     `fatal:` line in the middle of a gate run reads as the gate breaking. */
  const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  let log;
  try {
    log = git(['log', '--format=%x01%h%x02%cs%x02%s', ref, '--', file]);
  } catch {
    return [];
  }
  const out = [];
  for (const rec of String(log).split('\u0001')) {
    if (!rec.trim()) continue;
    const [short, date, subject] = rec.replace(/\n$/, '').split('\u0002');
    if (!short) continue;
    let digest = null;
    try {
      digest = sha12(git(['show', short + ':' + file]));
    } catch {
      continue;
    }
    out.push({ short, date: date || null, subject: (subject || '').trim(), digest });
  }
  return out;
}

/* ── WHICH COMMIT PRODUCED A DIGEST ────────────────────────────────────────────
   An INTERNAL gap used to read as a reason the record lost for good. It is not one. A closure digest
   is `sha12` of that file's own bytes, and git holds every revision of the file, so the digest names
   a revision. Measured 2026-11-23 against `origin/main` at `bd49758cf9`: all 14 digests in this
   pin's 8 gaps resolve, each to exactly ONE revision, over 185 revisions of three files.

   What a revision CANNOT state is whether the cohort yield moved, because only a re-cut counts the
   cohort. So a resolved gap is a LEAD and never a note: a reason read off a subject line is still a
   guess about the counts. This mode answers WHICH EDIT MOVED THE DIGEST, and it leaves `history[]`
   alone.

   The walk is injected, so the arithmetic rests on no repository: `revisionsOf(file)` returns the
   file's revisions NEWEST FIRST, each `{ short, date, subject, digest }`. */
export function resolveGapDigests(gaps, revisionsOf) {
  const cache = new Map();
  const revs = (file) => {
    if (!cache.has(file)) cache.set(file, revisionsOf(file) || []);
    return cache.get(file);
  };
  /* An absent digest is not an unresolved one: the chain records `null` when a note names no side,
     and borrowing a revision for it would invent the very move the gap asks about. */
  const at = (file, digest) => {
    if (digest == null) return { digest: null, rev: null, index: -1, state: 'absent' };
    const list = revs(file);
    const index = list.findIndex((r) => r && r.digest === digest);
    if (index < 0) return { digest, rev: null, index: -1, state: 'unresolved' };
    return { digest, rev: list[index], index, state: 'resolved' };
  };
  const rows = [];
  const add = (kind, file, oldDigest, newDigest, when) => {
    const older = at(file, oldDigest);
    const newer = at(file, newDigest);
    /* NEWEST FIRST, so the newer revision carries the SMALLER index. A pair that reads the other way
       is an anomaly of the record, never a negative count of edits. */
    let span = null;
    let order = 'unknown';
    if (older.state === 'resolved' && newer.state === 'resolved') {
      order = older.index > newer.index ? 'forward' : 'reversed';
      span = order === 'forward' ? older.index - newer.index - 1 : null;
    }
    rows.push({ kind, file, when: when || null, old: older, new: newer, span, order, revisions: revs(file).length });
  };
  for (const g of gaps && gaps.head ? gaps.head : []) add('head', g.file, g.lastNote ?? null, g.pinned ?? null, g.noteDate ? 'last note ' + g.noteDate : null);
  for (const g of gaps && gaps.internal ? gaps.internal : []) add('internal', g.file, g.closes ?? null, g.reopens ?? null, g.after && g.before ? 'between ' + g.after + ' and ' + g.before : null);
  return rows;
}

/* The lines the session reads for a blame. Pure, and empty on a clean chain: a mode that prints a
   heading over no rows reads as a finding about nothing. */
export function formatBlame(rows) {
  const L = [];
  if (!rows || !rows.length) return L;
  const side = (s) => {
    if (s.state === 'absent') return '(no digest)';
    if (s.state === 'unresolved') return s.digest + ' UNRESOLVED — no revision of this file on the walked ref hashes to it';
    return s.digest + '  ' + s.rev.short + ' ' + s.rev.date + ' ' + s.rev.subject;
  };
  const resolved = rows.filter((r) => r.old.state === 'resolved' && r.new.state === 'resolved').length;
  L.push('  ⓘ ' + resolved + ' of ' + rows.length + ' gap(s) resolve to the revisions that moved the digest. A revision names the EDIT and never the counts:');
  for (const r of rows) {
    L.push('    ' + r.file + ' · ' + r.kind.toUpperCase() + (r.when ? ' · ' + r.when : '') + '  (' + r.revisions + ' revision(s) walked)');
    L.push('      from  ' + side(r.old));
    L.push('      to    ' + side(r.new));
    if (r.order === 'reversed') L.push('      ⚠ the newer digest is the OLDER revision, so the record disagrees with the history');
    else if (r.span != null) L.push('      ' + r.span + ' further revision(s) of this file sit between them');
  }
  return L;
}

/* The lines the session reads. Pure, so a selftest can assert the gap reaches the text rather than
   asserting that a `console.log` was reached. A clean chain prints nothing. */
export function formatChain(gaps, out, today, opts) {
  /* `read` is the chain READ, which hashes the live tree against the pin on disk and writes
     nothing. The gap arithmetic is identical; only the sentence changes, because a read moved
     no digest. A re-cut says what IT moved, and a read says what the tree holds that the pin
     does not. The parameter is last and optional, so every earlier caller keeps its text. */
  const read = !!(opts && opts.read);
  const L = [];
  const skeleton = (file, old, now) => '    ' + JSON.stringify({ date: today, file, old, new: now, reason: '<why it moved, and whether the counts changed>' }) + ',';
  if (gaps.moves === null) {
    L.push(read ? '  ⓘ the pin at ' + out + ' carries no detector, so this read cannot name what moved.' : '  ⓘ no earlier pin stood at ' + out + ', so this run cannot name the move it just made.');
  } else if (gaps.moves.length) {
    L.push(
      read
        ? '  ⚠ the live tree holds ' + gaps.moves.length + ' closure digest(s) that ' + out + ' does not, so the next re-cut owes one note per line:'
        : '  ⚠ this run moved ' + gaps.moves.length + ' closure digest(s). Append one note per line to `history[]` in ' + out + ':'
    );
    for (const g of gaps.moves) L.push(skeleton(g.file, g.old, g.new));
  }
  if (gaps.head.length) {
    L.push('  ⚠ ' + gaps.head.length + ' file(s) carry notes that close at a digest this pin does not hold, so a move went unrecorded:');
    for (const g of gaps.head) L.push('    ' + g.file + ' (' + g.realms.join(', ') + ')  pin ' + g.pinned + '  last note ' + g.lastNote + ' on ' + g.noteDate);
  }
  if (gaps.internal.length) {
    L.push('  ⓘ ' + gaps.internal.length + ' earlier gap(s) this run cannot answer — never guess one; `--blame` names the revision that moved each digest:');
    for (const g of gaps.internal) {
      L.push('    ' + g.file + '  ' + g.closes + ' → (no note) → ' + g.reopens + '  between ' + g.after + ' and ' + g.before);
    }
  }
  if (gaps.uncovered.length) {
    L.push('  ⓘ ' + gaps.uncovered.length + ' closure file(s) the chain has never covered, which is not evidence that they moved: ' + gaps.uncovered.join(' '));
  }
  if (gaps.ambiguous.length) {
    L.push('  ⚠ ' + gaps.ambiguous.length + ' file(s) whose realms hold different digests, which a bare-basename note cannot name:');
    for (const g of gaps.ambiguous) {
      L.push('    ' + g.file + '  ' + g.holds.map((h) => h.realms.join('+') + ' ' + h.digest).join('  ·  '));
    }
  }
  return L;
}

/* The `detector` of the pin this run is about to overwrite, read beside its `history`. */
export function detectorOnDisk(path, read) {
  try {
    const prev = JSON.parse(read(path));
    const d = prev && prev.detector;
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

/* The three yields this pin exists because of. Appended to, never rewritten: the point of the row is
   that a single number replaced another with nothing recording that it had. */
export const HISTORY = [
  { measured: '2026-09-16', nIntervention: 269, nFlatControl: 317, source: 'residue 2026-09-17-treatment-response-gap-is-not-the-generator (identical under cohort-gen 1.9 and 2.0)' },
  { measured: '2026-09-22', nIntervention: 233, nFlatControl: 239, source: '#2825 analysis/published-numbers/treatment-response-2026-09-22.json' }
];

/* ⚠️ THE PIN ON DISK IS THE RECORD; THIS CONSTANT IS ONLY THE PART THE TOOL CAN DERIVE. `history[]`
   also carries digest-move notes a session wrote by hand, and each states a REASON only a human knows:
   whether a moved closure changed the computation. A re-cut that rebuilt the array from the constant
   alone deleted them. Measured on main: the pin carried 5 entries at `bc84db9f6` and 2 at `f71d741ec`,
   so #3689's correct re-stamp dropped three notes (residue
   `2026-10-18-yield-pin-rerun-deletes-hand-appended-history`).

   The merge keeps every on-disk entry the constant cannot reproduce, in its on-disk order, after the
   derived ones. Reproducible means EXACTLY equal, field for field. An entry that differs by one
   character is kept rather than dropped, so a hand-edited copy of a derived entry survives as a
   duplicate. That direction is the conservative one: this tool may add a line to the record and must
   never remove one. */
export function mergeHistory(onDisk, derived) {
  const base = Array.isArray(derived) ? derived : [];
  const key = (e) => JSON.stringify(e, Object.keys(e || {}).sort());
  const seen = new Set(base.map(key));
  const kept = [];
  for (const e of Array.isArray(onDisk) ? onDisk : []) {
    if (e == null || typeof e !== 'object') continue;
    if (seen.has(key(e))) continue;
    kept.push(e);
  }
  return base.concat(kept);
}

/* Read the `history[]` of the pin this run is about to overwrite. An absent or unparseable file is not
   an empty record — it is no record — and either way there is nothing to preserve, so the caller gets
   `[]` and the derived entries stand alone. */
export function historyOnDisk(path, read) {
  try {
    const raw = read(path);
    const prev = JSON.parse(raw);
    return Array.isArray(prev && prev.history) ? prev.history : [];
  } catch {
    return [];
  }
}

export function buildPin({ nIntervention, nFlatControl, minNights, selection, detector, commit, at, history }) {
  return {
    schema: 'tepna.yield-pin/1',
    config: { ...CONFIG, minNightsObserved: minNights },
    generator: { version: selection.version, ...selection.counts },
    detector,
    yield: {
      nIntervention,
      nFlatControl,
      txSkipped: selection.counts.txCandidates - nIntervention,
      flatSkipped: selection.counts.flatCandidates - nFlatControl
    },
    history: Array.isArray(history) ? history : HISTORY,
    measuredAt: at,
    producedBy: { tool: 'tools/treatment-response-yield-pin.mjs', commit }
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function selftest() {
  let fail = 0;
  let ran = 0; // incremented by the assertion helper itself — a count is computed, never typed
  const ok = (name, cond, detail) => {
    ran++;
    if (!cond) fail++;
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
  };

  /* SELECTION replays without a detector, and it is the generator alone that answers. A stub whose
     profiles are all flat must therefore yield zero intervention candidates and stop at the cap — the
     shape that proves the predicate is doing the selecting rather than the loop running out. */
  const allFlat = { sampleProfile: (s) => ({ arc: 'flat', nNights: 12, interventionNight: 0 }) };
  const sFlat = selectionCounts(allFlat, { nSubj: 5, minN: 10, seedCap: 1000 });
  ok('selection: a generator that emits only flat arcs yields no intervention candidates', sFlat.txCandidates === 0 && sFlat.flatCandidates === 5, JSON.stringify(sFlat));
  ok('selection: …and says it did NOT fill the target rather than reporting 0 as an answer', sFlat.filledTarget === false, JSON.stringify(sFlat));

  /* The `minN` filter must BITE — a profile one night short of the floor is not a candidate. */
  const short = { sampleProfile: () => ({ arc: 'flat', nNights: 9, interventionNight: 0 }) };
  const sShort = selectionCounts(short, { nSubj: 5, minN: 10, seedCap: 500 });
  ok('selection: minN excludes a profile one night short, and the cap ends the scan', sShort.flatCandidates === 0 && sShort.seedsScanned === 500, JSON.stringify(sShort));

  /* The intervention arm needs >= 2 pre and >= 2 post; a change-point at night 1 is excluded. */
  const edge = { sampleProfile: () => ({ arc: 'intervention', nNights: 12, interventionNight: 1 }) };
  ok('selection: an intervention night at index 1 fails the >= 2-pre rule', selectionCounts(edge, { nSubj: 3, minN: 10, seedCap: 200 }).txCandidates === 0);
  const good = { sampleProfile: () => ({ arc: 'intervention', nNights: 12, interventionNight: 5 }) };
  ok('selection: …and one at index 5 of 12 passes', selectionCounts(good, { nSubj: 3, minN: 10, seedCap: 200 }).txCandidates === 3);

  /* A throwing generator must not end the scan — the page catches and steps past. */
  let n = 0;
  const throwy = {
    sampleProfile: () => {
      if (n++ % 2) throw new Error('bad seed');
      return { arc: 'flat', nNights: 12, interventionNight: 0 };
    }
  };
  ok('selection: a throwing seed is stepped past, not fatal', selectionCounts(throwy, { nSubj: 4, minN: 10, seedCap: 100 }).flatCandidates === 4);

  /* The closure is read from the table. A realm the table does not name is null, not empty. */
  const W = "var SCRIPTS = {\n  oxy: ['a.js', 'b.js'],\n  pulse: ['a.js']\n};";
  const D = realmDigests(W, ['oxy', 'pulse', 'nope'], (f) => 'sha:' + f);
  ok('closure: the file list is READ from the SCRIPTS table', JSON.stringify(D.oxy) === JSON.stringify({ 'a.js': 'sha:a.js', 'b.js': 'sha:b.js' }), JSON.stringify(D.oxy));
  ok('closure: a realm the table does not name is null, never an empty object', D.nope === null, JSON.stringify(D.nope));

  /* The failure has to NAME the file. A boolean "something moved" sends the reader to re-cut before
     they know whether the edit could have moved a number at all. */
  const a = { oxy: { 'x.js': '111', 'y.js': '222' } };
  const b = { oxy: { 'x.js': '111', 'y.js': '999' } };
  ok('moved: only the file that changed is named, with both digests', JSON.stringify(movedFiles(a, b)) === JSON.stringify(['oxy/y.js 222 → 999']), JSON.stringify(movedFiles(a, b)));
  ok('moved: an unchanged closure names nothing', movedFiles(a, a).length === 0);
  ok('moved: a file ADDED to the realm is named too, not silently tolerated', movedFiles(a, { oxy: { 'x.js': '111', 'y.js': '222', 'z.js': '333' } }).length === 1);

  /* ── THE SCALE CHECK · each case names its own token, and the measured defect is the first leg ──── */
  const paper = { targetSubj: 900, minNights: 10, nIntervention: 233, nFlatControl: 239 };
  const dflt = { targetSubj: 45, minNights: 10, nIntervention: 10, nFlatControl: 17 };
  ok('scale: THE DEFECT · the page-default run of 45 per arm is refused, not pinned', scaleCheck(dflt).reason === 'cohort-size-mismatch', JSON.stringify(scaleCheck(dflt)));
  ok(
    'scale: …and the refusal names both cohort sizes, so the reader sees a scale and not a collapse',
    /\b45\b/.test(scaleCheck(dflt).message) && /\b900\b/.test(scaleCheck(dflt).message),
    scaleCheck(dflt).message
  );
  ok('scale CONTROL · the paper-scale run passes, and says what it ran at', scaleCheck(paper).ok === true && scaleCheck(paper).ran === 900, JSON.stringify(scaleCheck(paper)));
  ok(
    'scale: a run that states no cohort size gets its OWN token, never the mismatch one',
    scaleCheck({ minNights: 10, nIntervention: 233 }).reason === 'cohort-size-absent',
    JSON.stringify(scaleCheck({ minNights: 10 }))
  );
  ok(
    'scale: …and that refusal quotes no ran-at number, because none was measured',
    scaleCheck({ minNights: 10 }).ran === null && !/\b45\b|\b900\b/.test(scaleCheck({ minNights: 10 }).message.replace(/targetSubj/g, '')),
    scaleCheck({ minNights: 10 }).message
  );
  ok(
    'scale: the page default of 6 minimum nights is refused under its own token',
    scaleCheck({ targetSubj: 900, minNights: 6 }).reason === 'min-nights-mismatch',
    JSON.stringify(scaleCheck({ targetSubj: 900, minNights: 6 }))
  );
  ok('scale: an absent minimum-nights field is refused, never read as the stated 10', scaleCheck({ targetSubj: 900 }).reason === 'min-nights-absent', JSON.stringify(scaleCheck({ targetSubj: 900 })));
  ok('scale: a null result refuses rather than throwing', scaleCheck(null).ok === false, JSON.stringify(scaleCheck(null)));
  ok(
    'scale: each of the four cases carries its own declared token, by name',
    JSON.stringify([scaleCheck(dflt).reason, scaleCheck({ minNights: 10 }).reason, scaleCheck({ targetSubj: 900, minNights: 6 }).reason, scaleCheck({ targetSubj: 900 }).reason]) ===
      JSON.stringify(['cohort-size-mismatch', 'cohort-size-absent', 'min-nights-mismatch', 'min-nights-absent']),
    JSON.stringify(SCALE_REASONS)
  );
  ok(
    'scale: a zero cohort size is a MEASURED zero and still mismatches, rather than reading as absent',
    scaleCheck({ targetSubj: 0, minNights: 10 }).reason === 'cohort-size-mismatch',
    JSON.stringify(scaleCheck({ targetSubj: 0, minNights: 10 }))
  );

  /* ── THE WIRING · the refusal has to be on the path that WRITES, not only exported ───────────────
     `scaleCheck` green in isolation is the shape the defect already had: the numbers were all
     available and nothing on the writing path read them. So `main` runs here against a default-scale
     rerun file, and the leg is the exit code plus the ABSENCE of an output file. */
  const tmpIn = join(tmpdir(), 'tepna-pin-scale-in.json');
  const tmpOut = join(tmpdir(), 'tepna-pin-scale-out.json');
  writeFileSync(tmpIn, JSON.stringify({ tools: { [CONFIG.page]: { ms: 1200, result: dflt } } }));
  if (existsSync(tmpOut)) rmSync(tmpOut);
  const rc = main(['--rerun', tmpIn, '--out', tmpOut]);
  ok('wiring: the CLI refuses a default-scale rerun with exit 2', rc === 2, String(rc));
  ok('wiring: …and writes no pin, so the previous measurement stands', !existsSync(tmpOut), tmpOut);
  writeFileSync(tmpIn, JSON.stringify({ tools: { [CONFIG.page]: { ms: 1200, result: { nIntervention: 233, nFlatControl: 239, minNights: 10 } } } }));
  ok('wiring: a rerun that states no cohort size is refused by the CLI too', main(['--rerun', tmpIn, '--out', tmpOut]) === 2 && !existsSync(tmpOut), 'refused');
  rmSync(tmpIn, { force: true });
  rmSync(tmpOut, { force: true });

  /* ── THE CHAIN READ · the gaps must reach a session WITHOUT the 8-minute re-cut ─────────────
     Residue `2026-11-21-the-cohort-yield-pin-names-closure-moves-with-no-history-note`. The report
     was reachable only beside a run that OVERWRITES the pin, so these legs drive `main` over a pin
     file they write themselves. The leg is the printed text plus the pin's bytes, because a read
     that rewrites the record would destroy the thing it reports on. The live digests come from the
     real tree, so a note is built to close AT one of them for the clean case. */
  const tmpPin = join(tmpdir(), 'tepna-pin-chain.json');
  const cap = (fn) => {
    const lines = [];
    const orig = console.log;
    console.log = (...x) => lines.push(x.join(' '));
    try {
      return { rc: fn(), lines };
    } finally {
      console.log = orig;
    }
  };
  const liveNow = realmDigests(readFileSync(join(ROOT, 'cohort-worker.js'), 'utf8'), ['oxy', 'pulse'], (f) => (existsSync(join(ROOT, f)) ? sha12(readFileSync(join(ROOT, f), 'utf8')) : null));
  const liveOxy = (liveNow.oxy && liveNow.oxy['oxydex-dsp.js']) || null;
  ok('chain read: the live closure digest of oxydex-dsp.js reads as a digest, so these legs rest on a real tree', typeof liveOxy === 'string' && liveOxy.length === 12, String(liveOxy));
  const pinWith = (note) => JSON.stringify({ detector: liveNow, history: note ? [note] : [] });
  writeFileSync(tmpPin, pinWith({ date: '2026-11-01', file: 'oxydex-dsp.js', old: 'aaaaaaaaaaaa', new: 'cccccccccccc', reason: 'r' }));
  const before = sha12(readFileSync(tmpPin, 'utf8'));
  const chGap = cap(() => main(['--chain', '--pin', tmpPin]));
  ok('chain read: the CLI names the head gap over a pin on disk and exits 0', chGap.rc === 0 && chGap.lines.some((l) => l.includes('last note cccccccccccc')), JSON.stringify(chGap.lines.slice(0, 4)));
  ok(
    'chain read: …and it reports the note count it actually read',
    chGap.lines.some((l) => l.includes('record     1 note(s), pinned detector present')),
    JSON.stringify(chGap.lines[1])
  );
  ok('chain read: …and it writes NOTHING, so the record it reports on survives the read', sha12(readFileSync(tmpPin, 'utf8')) === before, before);
  /* The moves branch must be EXERCISED, or the wording control is vacuous: with the pin's own
     detector equal to the live tree, `moves` is empty and that branch never runs. So this pin holds
     a bogus digest, which is the real case — a pin cut before the code moved. */
  writeFileSync(tmpPin, JSON.stringify({ detector: { oxy: { ...liveNow.oxy, 'oxydex-dsp.js': 'bbbbbbbbbbbb' }, pulse: liveNow.pulse }, history: [] }));
  const chMoved = cap(() => main(['--chain', '--pin', tmpPin]));
  ok(
    'chain read: a pin cut before the code moved reports the live tree holding a digest the pin does not',
    chMoved.rc === 0 && chMoved.lines.some((l) => l.includes('the live tree holds 1 closure digest(s)')),
    JSON.stringify(chMoved.lines.slice(0, 3))
  );
  ok('chain read CONTROL: …and the read never borrows the re-cut wording, because it moved no digest', !chMoved.lines.some((l) => l.includes('this run moved')), 'no re-cut wording');
  writeFileSync(tmpPin, pinWith({ date: '2026-11-01', file: 'oxydex-dsp.js', old: 'aaaaaaaaaaaa', new: liveOxy, reason: 'r' }));
  const chClean = cap(() => main(['--chain', '--pin', tmpPin]));
  ok(
    'chain read: a note closing AT the live digest clears every warning, and the uncovered files stay a note rather than a warning',
    chClean.rc === 0 && !chClean.lines.some((l) => l.includes('⚠')) && chClean.lines.some((l) => l.includes('ⓘ') && l.includes('never covered')),
    JSON.stringify(chClean.lines)
  );
  writeFileSync(tmpPin, JSON.stringify({ history: [{ date: '2026-11-01', file: 'oxydex-dsp.js', old: 'aaaaaaaaaaaa', new: 'cccccccccccc', reason: 'r' }] }));
  const chNoDet = cap(() => main(['--chain', '--pin', tmpPin]));
  ok(
    'chain read ∅: a pin carrying no detector reports that it cannot name what moved, rather than borrowing the live digests',
    chNoDet.rc === 0 && chNoDet.lines.some((l) => l.includes('carries no detector')) && chNoDet.lines.some((l) => l.includes('NO pinned detector')),
    JSON.stringify(chNoDet.lines.slice(0, 3))
  );
  rmSync(tmpPin, { force: true });
  const chAbsent = cap(() => main(['--chain', '--pin', tmpPin]));
  ok('chain read: an absent pin answers 2 and prints no report, because it examined nothing', chAbsent.rc === 2 && chAbsent.lines.length === 0, JSON.stringify(chAbsent));

  /* The pin carries the decomposition, not just the two counts. */
  const P = buildPin({
    nIntervention: 233,
    nFlatControl: 239,
    minNights: 10,
    selection: { version: 'cohort-gen/2.0', counts: { txCandidates: 900, flatCandidates: 900, seedsScanned: 18291, filledTarget: true } },
    detector: a,
    commit: 'deadbeef',
    at: '2026-09-28T00:00:00Z'
  });
  ok('pin: the skipped counts are derived, so the two stages stay separable', P.yield.txSkipped === 667 && P.yield.flatSkipped === 661, JSON.stringify(P.yield));
  /* The pin carries the two EARLIER yields; the third is the pin's own `yield`, which is why HISTORY
     has two rows and not three. Saying "three historical yields" here would be the kind of off-by-one
     prose that makes a reader trust a count nobody checked. */
  ok(
    "pin: both earlier yields travel with it, and today's is the pin itself",
    P.history.length === 2 && P.history[0].nIntervention === 269 && P.yield.nIntervention === 233,
    JSON.stringify(P.history.map((h) => h.nIntervention).concat(P.yield.nIntervention))
  );
  ok('pin: schema + producedBy present, and it claims no verdict of its own', P.schema === 'tepna.yield-pin/1' && P.producedBy.tool.endsWith('treatment-response-yield-pin.mjs') && !('status' in P));

  /* THE RECORD SURVIVES A RE-CUT. Three real notes are planted here, copied from the pin as `bc84db9f6`
     held it, because the regression this group exists for is their deletion at `f71d741ec`. */
  const note17 = { date: '2026-10-17', file: 'oxydex-dsp.js', old: 'a50aa3668d52', new: '67823e8864cb', reason: 'PR #3595: UI-level changes — no DSP computation change' };
  const note18 = { date: '2026-10-18', file: 'oxydex-dsp.js', old: '67823e8864cb', new: 'cffb6d120b0f', reason: 'OxyDex night traces: additive computeSleepWake. 233 tx / 239 flat, unchanged' };
  const note18b = { date: '2026-10-18', file: 'oxydex-dsp.js', old: 'cffb6d120b0f', new: 'c7db8721e42f', reason: 'CT seconds from the stamps. 233 tx / 239 flat, unchanged' };
  const onDisk = HISTORY.concat([note17, note18, note18b]);
  const merged = mergeHistory(onDisk, HISTORY);
  ok('history: the three notes main lost at f71d741ec survive a re-cut', merged.length === 5 && merged[2] === note17 && merged[4] === note18b, String(merged.length));
  ok('history: a derived entry the file already holds is not duplicated', merged.filter((h) => h.nIntervention === 269).length === 1, JSON.stringify(merged.map((h) => h.date || h.measured)));
  ok('history: a derived entry absent from the file is emitted anyway', mergeHistory([note17], HISTORY).length === 3, JSON.stringify(mergeHistory([note17], HISTORY).map((h) => h.date || h.measured)));
  ok('history: preserved entries keep their file order, after the derived ones', JSON.stringify(mergeHistory([note18b, note17], HISTORY).slice(2)) === JSON.stringify([note18b, note17]), 'order');
  /* DECOY · the comparison is EXACT. A hand-edited copy of a derived entry is a line somebody wrote, so
     it is kept as a duplicate rather than matched loosely and dropped. Losing it is the defect; a
     duplicate a reader can see is not. */
  const edited = { ...HISTORY[1], source: HISTORY[1].source + ' (corrected)' };
  ok('history DECOY · an entry one character from a derived one is KEPT, never silently dropped', mergeHistory([edited], HISTORY).length === 3, 'kept');
  ok('history DECOY · a non-object member is not carried into the record', mergeHistory([null, 7, 'x', note17], HISTORY).length === 3, 'guarded');
  /* An absent file is NO record, not an empty one — and either way nothing is preserved, so the two
     cases agree on the answer and the tool never invents a note. */
  ok(
    'history: an absent file preserves nothing rather than throwing',
    historyOnDisk('/nonexistent/pin.json', () => {
      throw new Error('ENOENT');
    }).length === 0,
    'absent'
  );
  ok('history: a file with no history field preserves nothing', historyOnDisk('x', () => '{"schema":"tepna.yield-pin/1"}').length === 0, 'fieldless');
  ok('history: an unparseable file preserves nothing rather than throwing', historyOnDisk('x', () => 'not json').length === 0, 'unparseable');
  ok('history: a real pin body is read through its history field', JSON.stringify(historyOnDisk('x', () => JSON.stringify({ history: [note17] }))) === JSON.stringify([note17]), 'read');
  const PH = buildPin({
    nIntervention: 233,
    nFlatControl: 239,
    minNights: 10,
    selection: { version: 'cohort-gen/2.0', counts: { txCandidates: 900, flatCandidates: 900, seedsScanned: 18291, filledTarget: true } },
    detector: a,
    commit: 'deadbeef',
    at: '2026-09-28T00:00:00Z',
    history: merged
  });
  ok(
    'pin: a merged history reaches the written pin, and the constant is only the fallback',
    PH.history.length === 5 && P.history.length === 2,
    String(PH.history.length) + '/' + String(P.history.length)
  );

  /* ── THE CHAIN ─ every gap shape, planted, plus the two the tool must NOT read as a gap ───── */
  const cgA = { date: '2026-11-01', file: 'oxydex-dsp.js', old: 'aaaaaaaaaaaa', new: 'bbbbbbbbbbbb', reason: 'r1' };
  const cgB = { date: '2026-11-02', file: 'oxydex-dsp.js', old: 'bbbbbbbbbbbb', new: 'cccccccccccc', reason: 'r2' };
  const cgC = { date: '2026-11-03', file: 'oxydex-dsp.js', old: 'dddddddddddd', new: 'eeeeeeeeeeee', reason: 'r3' };
  const cgD = (oxy) => ({ oxy, pulse: null });
  const cgAt = cgD({ 'oxydex-dsp.js': 'cccccccccccc' });
  const cg1 = chainGaps(cgAt, [HISTORY[0], cgA, cgB], cgAt);
  ok('chain: a note closing at the pinned digest is no gap, and an unmoved closure is no move', cg1.head.length === 0 && cg1.internal.length === 0 && cg1.moves.length === 0, JSON.stringify(cg1));
  const cg2 = chainGaps(cgD({ 'oxydex-dsp.js': 'ffffffffffff' }), [cgA, cgB], cgAt);
  ok(
    'chain: the move this run makes is named with the digest the previous pin held',
    cg2.moves.length === 1 && cg2.moves[0].old === 'cccccccccccc' && cg2.moves[0].new === 'ffffffffffff' && cg2.moves[0].realms.join() === 'oxy',
    JSON.stringify(cg2.moves)
  );
  ok('chain: that same move also reads as a HEAD gap, because no note closes at the new digest', cg2.head.length === 1 && cg2.head[0].lastNote === 'cccccccccccc', JSON.stringify(cg2.head));
  const cg3 = chainGaps(cgD({ 'oxydex-dsp.js': 'ffffffffffff' }), [], cgD({}));
  ok('chain: a file the previous pin did not carry reads old null, never a borrowed digest', cg3.moves.length === 1 && cg3.moves[0].old === null, JSON.stringify(cg3.moves));
  ok('chain: a closure file with NO note is UNCOVERED, which is not evidence that it moved', cg3.uncovered.join() === 'oxydex-dsp.js' && cg3.head.length === 0, JSON.stringify(cg3));
  const cg4 = chainGaps(cgD({ 'oxydex-dsp.js': 'eeeeeeeeeeee' }), [cgA, cgB, cgC], cgD({ 'oxydex-dsp.js': 'eeeeeeeeeeee' }));
  ok(
    'chain: a break between two notes is INTERNAL, and this run owes nothing for it',
    cg4.internal.length === 1 && cg4.internal[0].closes === 'cccccccccccc' && cg4.internal[0].reopens === 'dddddddddddd' && cg4.moves.length === 0,
    JSON.stringify(cg4)
  );
  const cg5 = chainGaps({ oxy: { 'clock.js': '111111111111' }, pulse: { 'clock.js': '222222222222' } }, [], { oxy: { 'clock.js': '000000000000' }, pulse: { 'clock.js': '000000000000' } });
  ok(
    'chain: a basename whose realms disagree is AMBIGUOUS, and neither a head nor a move is invented for it',
    cg5.ambiguous.length === 1 && cg5.head.length === 0 && cg5.moves.length === 0,
    JSON.stringify(cg5.ambiguous)
  );
  const cg6 = chainGaps(cgD({ 'oxydex-dsp.js': null }), [], cgD({ 'oxydex-dsp.js': 'cccccccccccc' }));
  ok('chain: an absent file is not a moved closure', cg6.head.length === 0 && cg6.moves.length === 0 && cg6.uncovered.length === 0, JSON.stringify(cg6));
  const cg7 = chainGaps(cgAt, [null, 7, 'x', HISTORY[1], cgA, cgB], cgAt);
  ok('chain: a fileless or non-object history member is skipped rather than read as a note', cg7.head.length === 0 && cg7.internal.length === 0, JSON.stringify(cg7));
  const cg8 = chainGaps(cgD({ 'oxydex-dsp.js': 'bbbbbbbbbbbb' }), [cgA, cgB], cgD({ 'oxydex-dsp.js': 'bbbbbbbbbbbb' }));
  ok(
    'chain DECOY · an EARLIER note closing at the pinned digest is not the head, so the gap stands',
    cg8.head.length === 1 && cg8.head[0].pinned === 'bbbbbbbbbbbb' && cg8.head[0].lastNote === 'cccccccccccc',
    JSON.stringify(cg8.head)
  );
  const cg9 = chainGaps(cgAt, [cgA, cgB]);
  ok('chain: with no previous pin, moves is null rather than an empty list (∅)', cg9.moves === null, JSON.stringify(cg9.moves));
  const cgT9 = formatChain(cg9, 'analysis/pin.json', '2026-11-09');
  ok('chain: and the text says the run cannot name its own move', cgT9.length === 1 && cgT9[0].includes('cannot name the move'), JSON.stringify(cgT9));
  const cgT2 = formatChain(cg2, 'analysis/pin.json', '2026-11-09');
  ok(
    'chain: the move reaches the printed text as a note skeleton the session can paste',
    cgT2.some((l) => l.includes('"old":"cccccccccccc"') && l.includes('"new":"ffffffffffff"') && l.includes('"reason"')),
    JSON.stringify(cgT2.length)
  );
  ok('chain: a clean chain prints nothing', formatChain(cg1, 'analysis/pin.json', '2026-11-09').length === 0, 'silent');

  /* ── BLAME · WHICH REVISION MOVED THE DIGEST ─────────────────────────────────
     The walk is INJECTED in these legs, so they assert the arithmetic and never a repository. The
     three ANTI-VACUITY legs at the end hold that arithmetic against the real git walk. */
  const REVS = {
    'oxydex-dsp.js': [
      { short: 'ddd4444', date: '2026-11-10', subject: 'the newest revision', digest: 'dddddddddddd' },
      { short: 'ccc3333', date: '2026-11-09', subject: 'one between the two', digest: 'cccccccccccc' },
      { short: 'bbb2222', date: '2026-11-08', subject: 'the one the note closes at', digest: 'bbbbbbbbbbbb' },
      { short: 'aaa1111', date: '2026-10-28', subject: 'the oldest revision', digest: 'aaaaaaaaaaaa' }
    ]
  };
  const walk = (f) => REVS[f] || [];
  const headGap = (lastNote, pinned) => ({ head: [{ file: 'oxydex-dsp.js', realms: ['oxy'], lastNote, pinned, noteDate: '2026-11-08' }], internal: [] });
  const bl1 = resolveGapDigests(headGap('bbbbbbbbbbbb', 'dddddddddddd'), walk);
  ok(
    'blame: a HEAD gap resolves both sides to the revisions that hold those digests',
    bl1.length === 1 && bl1[0].old.rev.short === 'bbb2222' && bl1[0].new.rev.short === 'ddd4444',
    JSON.stringify(bl1.map((r) => [r.old.state, r.new.state]))
  );
  ok('blame: and the edits between them are counted, because the gap covers every one of them', bl1[0].span === 1 && bl1[0].order === 'forward', JSON.stringify([bl1[0].span, bl1[0].order]));
  const bl2 = resolveGapDigests({ head: [], internal: [{ file: 'oxydex-dsp.js', closes: 'aaaaaaaaaaaa', reopens: 'cccccccccccc', after: '2026-10-28', before: '2026-11-09' }] }, walk);
  ok(
    'blame: an INTERNAL gap resolves too, so the record never lost which edit moved it',
    bl2.length === 1 && bl2[0].kind === 'internal' && bl2[0].old.rev.short === 'aaa1111' && bl2[0].new.rev.short === 'ccc3333' && bl2[0].span === 1,
    JSON.stringify(bl2)
  );
  /* EDGE · a digest no revision holds. The honest answer is UNRESOLVED, because the nearest revision
     is a borrowed one, and a borrowed revision is the guessed reason this mode exists to refuse. */
  const bl3 = resolveGapDigests(headGap('ffffffffffff', 'dddddddddddd'), walk);
  ok('blame EDGE · a digest no revision holds reads UNRESOLVED and borrows nothing', bl3[0].old.state === 'unresolved' && bl3[0].old.rev === null && bl3[0].span === null, JSON.stringify(bl3[0].old));
  ok(
    'blame EDGE · and the text says UNRESOLVED, rather than printing a revision beside it',
    formatBlame(bl3).some((l) => l.includes('UNRESOLVED')) && !formatBlame(bl3).some((l) => /ffffffffffff\s{2}[0-9a-f]{7}/.test(l)),
    JSON.stringify(formatBlame(bl3))
  );
  /* EDGE · a side the record never named is ABSENT, never unresolved: nothing was asked of the walk. */
  const bl4 = resolveGapDigests(headGap(null, 'dddddddddddd'), walk);
  ok(
    'blame EDGE · a null side reads ABSENT rather than unresolved, because the record named no digest',
    bl4[0].old.state === 'absent' && formatBlame(bl4).some((l) => l.includes('(no digest)')),
    JSON.stringify(bl4[0].old)
  );
  /* EDGE · the pair the other way round. A negative count of edits would read as a measurement. */
  const bl5 = resolveGapDigests(headGap('dddddddddddd', 'aaaaaaaaaaaa'), walk);
  ok(
    'blame EDGE · a pair that reads backwards is flagged, never a negative count of edits',
    bl5[0].order === 'reversed' && bl5[0].span === null && formatBlame(bl5).some((l) => l.includes('disagrees with the history')),
    JSON.stringify([bl5[0].order, bl5[0].span])
  );
  /* CONTROL · a clean chain. A heading over no rows reads as a finding about nothing. */
  ok('blame CONTROL · a clean chain resolves nothing and prints nothing', resolveGapDigests({ head: [], internal: [] }, walk).length === 0 && formatBlame([]).length === 0, 'silent');
  /* CONTROL · a path the walk does not know. Both sides stay unresolved and the walked count is 0. */
  const bl6 = resolveGapDigests({ head: [{ file: 'no-such-file.js', lastNote: 'aaaaaaaaaaaa', pinned: 'dddddddddddd', noteDate: '2026-11-08' }], internal: [] }, walk);
  ok(
    'blame CONTROL · a path the walk does not know leaves both sides unresolved over 0 revisions',
    bl6[0].old.state === 'unresolved' && bl6[0].new.state === 'unresolved' && bl6[0].revisions === 0,
    JSON.stringify(bl6[0])
  );
  /* ANTI-VACUITY · every leg above rests on an injected table, so the walk itself is held against the
     real repository here: the parse, the hash, and the pointer the chain text gives its reader. */
  const realRevs = gitRevisions('HEAD', 'oxydex-profile.js');
  ok(
    'blame ANTI-VACUITY · the git walk parses a real revision: a 12-hex digest, a short sha, a date and a subject',
    realRevs.length > 0 && /^[0-9a-f]{12}$/.test(realRevs[0].digest) && /^[0-9a-f]{7,}$/.test(realRevs[0].short) && /^\d{4}-\d{2}-\d{2}$/.test(realRevs[0].date) && realRevs[0].subject.length > 0,
    JSON.stringify(realRevs[0] || null)
  );
  const headBytes = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:oxydex-profile.js'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  ok('blame ANTI-VACUITY · and its digest is the digest of that revision read independently', realRevs[0].digest === sha12(headBytes), realRevs[0].digest + ' vs ' + sha12(headBytes));
  ok(
    'blame ANTI-VACUITY · the chain text sends its reader to --blame, so the pointer names a real mode',
    formatChain({ moves: null, head: [], internal: [{ file: 'x.js', closes: 'a', reopens: 'b', after: '2026-11-01', before: '2026-11-02' }], uncovered: [], ambiguous: [] }, 'p', '2026-11-23').some(
      (l) => l.includes('`--blame`')
    ),
    'pointer'
  );
  /* …and the mode behind that pointer is reachable from the CLI. An absent pin answers 2 in its OWN
     words, which is what says the dispatch reached the blame branch and not the chain one. */
  const blAbsent = cap(() => main(['--blame', '--pin', tmpPin]));
  ok('blame ANTI-VACUITY · an absent pin answers 2 and prints no report, because it examined nothing', blAbsent.rc === 2 && blAbsent.lines.length === 0, JSON.stringify(blAbsent));
  /* …and the dispatch reaches the walk. A ref git does not know makes every side unresolved, which no
     other mode prints, and it costs one failed `git log` rather than a hash of every revision. */
  const blNoRef = cap(() => main(['--blame', '--ref', 'refs/tepna/no-such-ref']));
  ok(
    'blame ANTI-VACUITY · the CLI dispatches --blame, and a ref git does not know resolves nothing',
    blNoRef.rc === 0 && blNoRef.lines.some((l) => l.includes('walked refs/tepna/no-such-ref')) && blNoRef.lines.some((l) => l.includes('UNRESOLVED')),
    JSON.stringify(blNoRef.lines.slice(0, 3))
  );

  /* The real generator, at the real configuration — the number the pin is built on. */
  const CG = loadCohortGen();
  ok('the real CohortGen loads outside a browser', !!(CG && typeof CG.sampleProfile === 'function'), CG ? CG.VERSION : 'null');
  if (CG) {
    const real = selectionCounts(CG, CONFIG);
    ok('selection FILLS the target at the stated configuration — the generator is not the constraint', real.filledTarget === true && real.txCandidates === CONFIG.nSubj, JSON.stringify(real));
  } else fail++;

  console.log(fail ? `${fail} failed of ${ran}` : `all ${ran} selftests passed`);
  return fail ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  /* ── THE CHAIN READ (residue `2026-11-21-the-cohort-yield-pin-names-closure-moves-with-no-history-note`)
     The gap report used to reach a session only beside a re-cut. A re-cut costs an 8-minute
     paper-scale `analysis-rerun.mjs` pass, and it OVERWRITES the pin. So the one record of why a
     closure digest moved could not be read without spending the run that rewrites it, and the row
     above carries no count for that reason. This mode reads the pin on disk, hashes the live
     closure files, and prints the same gaps. It runs no generator, boots no page and writes no
     file. The exit code follows the consumer: this mode is the READER's view of the live tree, so
     a GAP is the finding rather than a failure, and only a pin it cannot read answers 2. The GATE
     over the same arithmetic sits in `treatment-response · pinned yield` in `tests/dex-tests.js` (residue
     `2026-11-22-eight-closure-moves-in-the-yield-pin-chain-carry-no-note`). It judges the PIN
     against its own notes, never the tree, and it reds on a digest pair its baseline does not
     name — so a re-cut that skips its note no longer lands quietly. */
  /* `--blame` RESOLVES EACH GAP TO THE REVISION THAT MOVED IT, and writes nothing. It walks only the
     files the chain names, because a walk hashes every revision of a file. It decides nothing: a
     revision answers WHICH EDIT, while whether the cohort yield moved stays a question only a re-cut
     answers, so this mode exits 0 over a gap it resolved and over one it could not. */
  if (argv.includes('--blame')) {
    const pinPath = arg('--pin', PIN);
    if (!existsSync(pinPath)) {
      console.error('no such pin: ' + pinPath);
      console.error('  the blame read needs the record on disk, because it derives nothing and invents nothing');
      return 2;
    }
    const ref = arg('--ref', 'origin/main');
    const history = historyOnDisk(pinPath, (f) => readFileSync(f, 'utf8'));
    const pinned = detectorOnDisk(pinPath, (f) => readFileSync(f, 'utf8'));
    const workerSrc = readFileSync(join(ROOT, 'cohort-worker.js'), 'utf8');
    const live = realmDigests(workerSrc, ['oxy', 'pulse'], (f) => (existsSync(join(ROOT, f)) ? sha12(readFileSync(join(ROOT, f), 'utf8')) : null));
    const rows = resolveGapDigests(chainGaps(live, history, pinned), (f) => gitRevisions(ref, f));
    console.log('read ' + pinPath + '  \u00b7 walked ' + ref);
    const lines = formatBlame(rows);
    for (const line of lines) console.log(line);
    if (!lines.length) console.log('  the chain is clean, so no gap asks for a revision');
    return 0;
  }
  if (argv.includes('--chain')) {
    const pinPath = arg('--pin', PIN);
    if (!existsSync(pinPath)) {
      console.error('no such pin: ' + pinPath);
      console.error('  the chain read needs the record on disk, because it derives nothing and invents nothing');
      return 2;
    }
    const history = historyOnDisk(pinPath, (f) => readFileSync(f, 'utf8'));
    const pinned = detectorOnDisk(pinPath, (f) => readFileSync(f, 'utf8'));
    const workerSrc = readFileSync(join(ROOT, 'cohort-worker.js'), 'utf8');
    const live = realmDigests(workerSrc, ['oxy', 'pulse'], (f) => (existsSync(join(ROOT, f)) ? sha12(readFileSync(join(ROOT, f), 'utf8')) : null));
    console.log('read ' + pinPath);
    console.log('  record     ' + history.length + ' note(s), ' + (pinned ? 'pinned detector present' : 'NO pinned detector'));
    const lines = formatChain(chainGaps(live, history, pinned), pinPath, new Date().toISOString().slice(0, 10), { read: true });
    for (const line of lines) console.log(line);
    if (!lines.length) console.log('  the chain is clean: every closure digest the pin holds carries a note that closes at it');
    return 0;
  }
  const rerunPath = arg('--rerun', null);
  if (!rerunPath) {
    console.error(
      'usage: node tools/treatment-response-yield-pin.mjs --rerun <analysis-rerun-results.json> [--out <pin.json>] | --chain [--pin <pin.json>] | --blame [--pin <pin.json>] [--ref <ref>] | --selftest'
    );
    return 2;
  }
  if (!existsSync(rerunPath)) {
    console.error('no such rerun result: ' + rerunPath);
    return 2;
  }
  const raw = JSON.parse(readFileSync(rerunPath, 'utf8'));
  /* `analysis-rerun` writes `{ tools: { <page>: { ms, err, result } } }` — keyed by the PAGE, which is
     why `CONFIG.page` is the lookup rather than a literal. The fallbacks are for a bare result global
     handed in directly; the shape is asserted, never assumed. */
  const entry = (raw.tools && raw.tools[CONFIG.page]) || raw[CONFIG.page] || null;
  /* ⚠️ THE ERROR IS READ BEFORE THE COUNTS, and it is the case this refusal exists for. On 2026-09-28 a
     paper-scale run sat for 7203 s and wrote `{ result: null, err: "window.TREATMENT_RESPONSE never
     appeared within 120 min" }` because the page could not boot (#3209). A refusal that says only "no
     counts" sends the reader to look for a missing field; naming the run's own error sends them to the
     page. Same rule as the §∅ work everywhere else in this repo: report the absence you measured. */
  if (entry && entry.err) {
    console.error('the re-cut did not complete — refusing to write a pin over a run that examined nothing:');
    console.error('  ' + entry.err + (entry.ms ? '  (after ' + Math.round(entry.ms / 1000) + ' s)' : ''));
    return 2;
  }
  const R = (entry && entry.result) || raw.TREATMENT_RESPONSE || (raw.results && raw.results.TREATMENT_RESPONSE) || null;
  if (R == null || R.nIntervention == null || R.nFlatControl == null) {
    console.error('the rerun result carries no nIntervention/nFlatControl — refusing to write a pin over a run that examined nothing');
    console.error('  looked for tools["' + CONFIG.page + '"].result in ' + rerunPath);
    return 2;
  }
  const scale = scaleCheck(R);
  if (!scale.ok) {
    console.error('refusing to write a pin over a run at a different configuration (' + scale.reason + '):');
    console.error('  ' + scale.message);
    console.error('  re-run: node tools/analysis-rerun.mjs --only ' + CONFIG.page + ' --paper-scale --out <rerun.json>');
    return 2;
  }
  const CG = loadCohortGen();
  if (!CG) {
    console.error('cohort-gen.js did not load — refusing to write a pin with no selection term');
    return 2;
  }
  const counts = selectionCounts(CG, CONFIG);
  const workerSrc = readFileSync(join(ROOT, 'cohort-worker.js'), 'utf8');
  const detector = realmDigests(workerSrc, ['oxy', 'pulse'], (f) => (existsSync(join(ROOT, f)) ? sha12(readFileSync(join(ROOT, f), 'utf8')) : null));
  const out = arg('--out', PIN);
  /* Read the record BEFORE overwriting it: the hand-written notes live only in the file. */
  const prevHistory = historyOnDisk(out, (p) => readFileSync(p, 'utf8'));
  const prevDetector = detectorOnDisk(out, (p) => readFileSync(p, 'utf8'));
  const history = mergeHistory(prevHistory, HISTORY);
  const pin = buildPin({
    nIntervention: R.nIntervention,
    nFlatControl: R.nFlatControl,
    minNights: R.minNights,
    selection: { version: CG.VERSION, counts },
    detector,
    commit: gitCommit(),
    at: new Date().toISOString(),
    history
  });
  writeFileSync(out, JSON.stringify(pin, null, 2) + '\n');
  console.log('wrote ' + out);
  console.log(
    '  selection  ' + counts.txCandidates + ' tx / ' + counts.flatCandidates + ' flat candidates (' + counts.seedsScanned + ' seeds, target ' + (counts.filledTarget ? 'FILLED' : 'NOT filled') + ')'
  );
  console.log('  yield      ' + pin.yield.nIntervention + ' tx / ' + pin.yield.nFlatControl + ' flat  (skipped ' + pin.yield.txSkipped + ' / ' + pin.yield.flatSkipped + ' by the detectors)');
  console.log('  history    ' + HISTORY.length + ' derived + ' + (history.length - HISTORY.length) + ' preserved from the file this run overwrote');
  for (const line of formatChain(chainGaps(detector, history, prevDetector), out, pin.measuredAt.slice(0, 10))) console.log(line);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
