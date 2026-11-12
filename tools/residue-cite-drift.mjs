#!/usr/bin/env node
/*
 * tools/residue-cite-drift.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * WHICH RESIDUE ROWS CITE A LINE THAT HAS MOVED — residue `2026-09-20-ledger-line-citations-rot`.
 *
 * Every row in `briefs/RESIDUE.md` cites source LINES (`capture.py:5306`), and ordinary code motion
 * rots them into false refutations of TRUE rows: a verifier opens the cited line, finds unrelated code,
 * and closes a correct row by drift rather than by evidence. Measured on the sweep brief itself:
 * `capture.py:5306` for `import pull_session` on 2026-09-18 was `:5520` two days later. The remedy
 * stated there — cite by IDENTIFIER, with the line as a dated hint — is a rule; this tool is the check.
 *
 * For every `path:line` a row cites it asks ONE question against the ref (default `origin/main`):
 * does any identifier the ROW ITSELF names (a backticked token or a quoted string in that row) appear
 * on that line? Verdicts, per citation:
 *   anchored     an identifier from the row is on the cited line — the pointer still points
 *   moved        none is on that line, but ≥ 1 is elsewhere in the file — reported with where it is now
 *   unanchored   the row names no identifier that occurs anywhere in the file — the pointer cannot be
 *                judged (the row cites by line ALONE, which is the class the residue names); not drift
 *   beyond-eof   the file is shorter than the cited line — the pointer cannot resolve at all
 *   missing-file the path resolves nowhere, AND this repo can be shown to relate to it — its
 *                history carries one of the tried spellings, or a tracked file has that basename
 *   off-tree     the path resolves nowhere, no spelling of it appears anywhere in this repo's
 *                history, and no tracked file carries its basename — so this repo never held it
 * The identifiers are the ROW'S, never a guess of this tool's: a citation is judged against what its
 * author wrote beside it, so "anchored" means the author's own words still hold at that line.
 *
 * Every verdict but `anchored` is printed WITH ITS ROW KEY, because a count names nothing a reader
 * can chase. `unanchored` was a bare integer and `beyond-eof` had no field at all until row
 * 2026-10-26-the-unanchored-class-is-counted-and-never-named.
 *
 * `off-tree` splits a bin that used to hold two unlike things (row
 * 2026-10-26-the-missing-file-bin-counts-paths-this-repo-never-carried). A row may cite the Python
 * standard library, an installed package or a vendor daemon config, and such a path resolves nowhere
 * for the same reason a deleted repo file does. The first is not this repo's defect and the second
 * is. The split is decided by EVIDENCE, never by a list of external names: `git log --all` over the
 * same spellings the reader tried answers "did this repo ever carry it", and the tracked basenames
 * answer "is this a repo file cited under the wrong directory". A list of external prefixes would
 * age, and a basename rule alone misbins both ways — measured on the 17 citations of 2026-10-26, a
 * suffix rule catching `Data Unifier.html` for `Unifier.html` also claims `ecg_parity_harness.py`
 * for bleak's `harness.py`.
 *
 * ∅ THE PROBE IS A MEASUREMENT AND ITS ABSENCE IS NOT A CLEAN ANSWER. A caller that passes no
 * provenance probe, and a shallow clone whose history cannot answer, both leave every unresolved
 * path in `missing-file`, which is the class that still decides `--strict`. Nothing becomes
 * `off-tree` unless the history was read and came back empty.
 *
 * ── `--base <ref>`: THE GATE, AND IT JUDGES ONLY THE ROWS A BRANCH ADDS ─────────────────────────
 *
 * This file was a census nothing invoked. Four rows refined its classification — #3956 named the
 * unanchored class, #3968 inverted the strict ordering, #3987 split `off-tree` out of
 * `missing-file` — while `grep` over `package.json`, `.github/workflows/` and every `*.sh` named no
 * caller, so the exit those rows argued about could not fire anywhere. Row
 * `2026-10-26-three-of-six-cited-printer-lines-name-no-printer` states the harm the tool exists to
 * catch, and three of that row's own six citations named no printer at its own commit, which is the
 * class a gate at APPEND time catches and a census never does.
 *
 * THE WHOLE LEDGER CAN NEVER GO GREEN, SO THE GATE DOES NOT ASK IT TO. §📌 forbids editing a row
 * cell, so the 79 defect-class citations standing on `origin/main` may not be repaired where they
 * sit, and a gate over every row would be red forever on work nobody is allowed to do. `--base`
 * reads the ledger at that ref, keeps the rows whose KEY it does not carry, and judges only those.
 * Rows are append-only, so a key absent from the base is a row this branch wrote. That is the idiom
 * of `verify:residue-ids`, `verify:xss-sink` and `verify:absence-regression`: the debt stands and
 * the growth stops.
 *
 * THE EXIT IS NOT A SECOND FLAG HERE. `--strict` was latent because nothing passed it; a gate whose
 * exit needs one more flag than its caller passes is that same defect wearing a mode name. So
 * `--base` decides on the defect classes with no `--strict`, and the files are read at `HEAD` by
 * default, because a row this branch adds must point into the tree this branch has.
 *
 * ∅ A BASE THAT CANNOT BE READ IS NOT AN EMPTY SET OF ADDED ROWS. An unfetched ref or a clone
 * without the base would otherwise report `0 rows added` and pass, which is CLAUDE.md §4b's
 * examined-nothing. The mode emits `NOT_RUN` with its reason and exits 2 — it could not look —
 * where exit 1 means it looked and a citation failed.
 *
 * THE GATE WATCHES A LEVEL AND `--delta` WATCHES A TRANSITION. `--base` judges only the rows a
 * branch ADDS, so a citation that anchored yesterday and stopped anchoring because the CODE under it
 * moved is in no population: the defect-class count grew from the 79 this header documents to 113
 * with nothing watching (row 2026-11-12-cite-drift-rot-grows-under-the-base-only-caller). `--delta`
 * judges the rows BOTH ledgers carry at two refs and reports the transitions. It is advisory by the
 * same ruling that keeps the whole-ledger form advisory: nobody may repair a row cell where it sits,
 * so a branch that moves code under someone else's citation has no legal repair.
 *
 * ADVISORY: exits 0 and prints the list. `--strict` exits 1 on the three classes this file ranks as
 * defects — `missing-file`, `unanchored`, `beyond-eof` — and never on `moved`. A row's line hint
 * moving is not a defect in the row; it is the reason the identifier rule exists. The flag read
 * `moved` alone until row 2026-10-26-the-strict-exit-reads-the-one-class-the-tool-calls-benign, which
 * inverted that ordering and made the flag's green unreachable: rows are append-only, so nobody may
 * repair a line hint where it sits. Rows are never edited by this tool.
 *
 *   node tools/residue-cite-drift.mjs                 # every row, against origin/main
 *   node tools/residue-cite-drift.mjs --ref HEAD      # against the checkout's HEAD
 *   node tools/residue-cite-drift.mjs --json
 *   node tools/residue-cite-drift.mjs --selftest      # the plants: moved · anchored · unanchored · eof · missing · off-tree
 *   node tools/residue-cite-drift.mjs --base origin/main   # THE GATE: only the rows this branch ADDS
 *   node tools/residue-cite-drift.mjs --delta [ref]        # THE CENSUS OF GROWTH: the same rows at two refs, advisory, exit 0
 *   node tools/residue-cite-drift.mjs --delta [ref] --full # the same, over every citation rather than only the diff's
 *   node tools/residue-cite-drift.mjs --verdict-sample     # the tepna.verdict/1 object alone
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { escapeRe } from './regex-escape-core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* `verdict.js` is CommonJS and sits at the repo root; this is the idiom `tools/residue-citations.mjs` uses. */
const Verdict = createRequire(import.meta.url)('../verdict.js');
const LEDGER = 'briefs/RESIDUE.md';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};

/* A citation: an optional backtick, a path with an extension, `:line`, an optional `-line2` range. */
const CITE_RE = /`?((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:py|js|mjs|sh|md|html|json|yml|yaml|toml|css|txt)):(\d+)(?:-(\d+))?`?/g;
/* ⚠️ CITE_RE'S PATH CLASS HOLDS NO SPACE AND NO APOSTROPHE, AND 68 TRACKED PATHS CARRY ONE.
   Measured 2026-11-08 over `git ls-files`: 0 of those 68 read back whole through CITE_RE alone. The
   regex matches the TAIL that begins after the last unreadable character, so the citation silently
   becomes a pointer at some other path — and the error goes in BOTH directions:
     · 50 of 68 truncate onto nothing tracked, so a live file is reported as rot or as off-tree;
     · 18 of 68 truncate onto a DIFFERENT TRACKED FILE — every `wiring/How It's Wired - OxyDex.html`
       reads as `OxyDex.html` — and the judge then scores drift against the wrong file and publishes
       `anchored` or `moved`. That half is silent, and it names a real path, so nothing in the report
       looks wrong.
   The ledger already pays the loud half. `briefs/RESIDUE.md` cites `Data Unifier.html:412`, a file of
   44705 lines; the match is `Unifier.html:412`; and a bare `Unifier.html` really did sit on main,
   added by `d0e67d0cb` as the product of a SHELL WORD-SPLIT on the same filename and deleted at
   `9d93ca3ac`. So the provenance probe finds the phantom, answers `carried`, and `binMissing` bins the
   citation `missing-file` — the one class that decides `--strict`. One of that bin's 3 members is an
   artifact of this regex.
   THE REPAIR RESOLVES, IT DOES NOT WIDEN THE CLASS. Widening the path class to admit a space makes the
   match swallow the prose to its left, so instead the match is EXTENDED leftward and an extension is
   kept only when it names a path the judged tree really tracks. Prose cannot win, because prose is not
   tracked. The longest tracked candidate wins, which is what repairs the 18 — `OxyDex.html` is tracked
   and `wiring/How It's Wired - OxyDex.html` is tracked and longer. Without a tracked set the function
   answers exactly as it did before, so the pure callers and the selftest keep reading one behaviour.
   A space-bearing path the tree does NOT track still truncates; no text-only rule can tell that case
   from prose, and the selftest pins it as the known limit rather than guessing. */
const PATH_EXTEND_CH = /[A-Za-z0-9_.\u2019'\/ -]/;
const PATH_EXTEND_WINDOW = 120;

export function extendCitedPath(rowText, startIdx, matched, isTracked) {
  if (!isTracked) return matched;
  let best = isTracked(matched) ? matched : null;
  const floor = Math.max(0, startIdx - PATH_EXTEND_WINDOW);
  for (let i = startIdx; i > floor && PATH_EXTEND_CH.test(rowText[i - 1]); ) {
    i--;
    const cand = rowText.slice(i, startIdx) + matched;
    if (isTracked(cand)) best = cand; // keep scanning: the LONGEST tracked candidate wins
  }
  return best || matched;
}

/* What the author anchored the line to: every identifier-shaped token inside a backticked span (so
   `import pull_session` yields `pull_session`, `foo(bar)` yields `foo`), plus quoted strings. */
const SPAN_RE = /`([^`\n]{1,160})`|"([^"`\n]{3,80})"|'([^'`\n]{3,80})'/g;
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
const STOP = new Set([
  'null',
  'true',
  'false',
  'None',
  'True',
  'False',
  'self',
  'this',
  'return',
  'import',
  'from',
  'def',
  'const',
  'var',
  'let',
  'function',
  'and',
  'or',
  'not',
  'the',
  'for',
  'if',
  'else',
  'in',
  'is',
  'at',
  'to',
  'of',
  'with',
  'as',
  'was',
  'now',
  'line',
  'lines'
]);
/* ∅ ONE EXTENSION LIST FEEDS BOTH THE REJECTION AND THE TAIL, so the two cannot drift apart. */
const EXTS = 'py|js|mjs|md|html|json|sh|yml|yaml|toml|css|txt';
const PATHLIKE = new RegExp(`\\.(${EXTS})$`);
const BARE_EXT = new RegExp(`^(${EXTS})$`);

export function parseRows(ledgerText) {
  const out = [];
  for (const line of ledgerText.split('\n')) {
    if (!line.startsWith('| 20')) continue;
    const cells = line.split(' | ');
    if (cells.length < 6) continue;
    out.push({ key: cells[0].slice(2).trim(), text: line, state: cells[cells.length - 1].replace(/\s*\|\s*$/, '').trim() });
  }
  return out;
}

export function citations(rowText, isTracked = null) {
  const out = [];
  for (const m of rowText.matchAll(CITE_RE)) {
    /* m[0] may open with a backtick, so the path's own start is found inside the match, never at
       `m.index`. Extending from the wrong index would prepend the backtick and track nothing. */
    const startIdx = m.index + m[0].indexOf(m[1]);
    out.push({ path: extendCitedPath(rowText, startIdx, m[1], isTracked), line: +m[2], to: m[3] ? +m[3] : null });
  }
  return out;
}

export function identifiers(rowText) {
  const ids = new Set();
  const add = (t) => {
    if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t) && !PATHLIKE.test(t)) ids.add(t);
  };
  for (const m of rowText.matchAll(SPAN_RE)) {
    const span = m[1] || m[2] || m[3];
    if (!span) continue;
    if (!m[1]) {
      add(span); // a quoted string is matched whole — it is a literal the code carries verbatim
      continue;
    }
    for (const t of span.match(TOKEN_RE) || []) {
      add(t);
      /* ∅ THE TAIL OF A REJECTED FILENAME IS NOT AN IDENTIFIER. `tri_device_nights.json` is
         rejected as path-like, and then its own tail admitted `json`, which stood as an anchor on
         any line that names any JSON file. Measured 2026-11-08 over 1302 rows: mjs×553, json×219,
         txt×97, html×96, yml×28, yaml×12, toml×5, css×3. */
      if (t.includes('.')) {
        const tail = t.split('.').pop(); // `mod.alpha` → also `alpha`
        if (!BARE_EXT.test(tail)) add(tail);
      }
    }
  }
  return [...ids];
}

/* The judgement, pure: one citation against the file's lines and the row's identifiers. */
/* ∅ AN IDENTIFIER OCCURS WHERE IT STANDS ON ITS OWN, NEVER INSIDE A LONGER WORD. A bare `includes`
   read `file` out of `fileURLToPath`, `fixture` out of `fixtureNames`, `pat` out of `path` and `dex`
   out of `index`, so a short identifier anchored a citation to a line that never names it. Measured
   2026-11-08: 33 of 249 anchored citations held no standalone occurrence on the cited line.
   `_` is a word character, so `pull_session` still fails inside `foo_pull_session`; `-`, `.`, `(`
   and a backtick are not, so `trio-batch`, `mod.alpha` and `foo(` still match. A quoted-string
   identifier can open or close on a non-word character, which carries no boundary, so each end is
   guarded on its own. */
const BOUND = new Map();
export function occursIn(id, text) {
  if (!id || !text) return false;
  let re = BOUND.get(id);
  if (!re) {
    const lead = /^[A-Za-z0-9_]/.test(id) ? '\\b' : '';
    const tail = /[A-Za-z0-9_]$/.test(id) ? '\\b' : '';
    /* The metacharacter class has ONE home (`tools/regex-escape-core.mjs`), and a gate reds a
       second copy of it in this tree. */
    re = new RegExp(`${lead}${escapeRe(id)}${tail}`);
    BOUND.set(id, re);
  }
  return re.test(text);
}

export function judge(cite, fileLines, ids) {
  if (fileLines === null) return { verdict: 'missing-file' };
  if (cite.line < 1 || cite.line > fileLines.length) return { verdict: 'beyond-eof', length: fileLines.length };
  const at = fileLines[cite.line - 1];
  const hit = ids.filter((id) => occursIn(id, at));
  if (hit.length) return { verdict: 'anchored', ids: hit };
  // Only a CODE-SHAPED identifier can testify that the line moved — snake_case, dotted, camelCase or a
  // literal string. A plain word (`ambient`, `reconcile`, `ABSENCE`) occurs in prose and comments all
  // over a file and would report every citation as "moved" to wherever it first appears.
  const specific = ids.filter((id) => /[_.]/.test(id) || /[a-z][A-Z]/.test(id) || /\s/.test(id));
  const now = {};
  for (const id of specific) {
    const where = [];
    for (let i = 0; i < fileLines.length && where.length < 4; i++) if (occursIn(id, fileLines[i])) where.push(i + 1);
    if (where.length) now[id] = where;
  }
  if (Object.keys(now).length) return { verdict: 'moved', now };
  return { verdict: 'unanchored', tried: ids.length, specific: specific.length };
}

/* The ledger cites paths from wherever its author stood: repo root, capture-host/, tools/, briefs/…
   ONE list, read by the resolver AND by the history probe. Two lists would let the probe ask about
   spellings the reader never tried, and a path absent from history under the probe's spellings would
   then score `off-tree` while the reader had looked somewhere else entirely. */
export function trySpellings(relPath) {
  return [
    relPath,
    `capture-host/${relPath}`,
    `tools/${relPath}`,
    `capture-host/tools/${relPath}`,
    `capture-host/tests/${relPath}`,
    `capture-host/deploy/${relPath}`,
    `briefs/${relPath}`,
    `docs/${relPath}`,
    `.claude/hooks/${relPath}`,
    `.github/workflows/${relPath}`
  ];
}

/* A FILE'S LINE COUNT IS NOT ITS SPLIT LENGTH. A text ending in a newline — nearly every tracked
   file — splits into one MORE element than it has lines, and that last element is the empty string
   after the final newline. Both consumers of this array read the count as the file's length: the
   `beyond-eof` bound at `judge`, and the `moved` scan. So a raw split made the bound permissive by
   exactly one phantom line, and made the length this tool PRINTS one too large — the number a
   reader uses to repair the pointer. Measured 2026-11-08 on `oxydex-profile.js`: the report said
   683 where the file holds 682 lines. Exactly ONE trailing empty element is dropped, so a file that
   really ends in a blank line keeps that blank line. The 45 selftest plants never saw this, because
   each builds its `fileLines` array by hand and so never carries the artefact the reader adds. */
export function toLines(text) {
  const parts = text.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function readAt(ref, relPath) {
  const tryPaths = trySpellings(relPath);
  for (const p of tryPaths) {
    try {
      if (ref === 'worktree') {
        const f = path.join(REPO, p);
        if (fs.existsSync(f)) return toLines(fs.readFileSync(f, 'utf8'));
        continue;
      }
      return toLines(execFileSync('git', ['show', `${ref}:${p}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }));
    } catch {
      /* not at this path under this ref — try the next spelling */
    }
  }
  return null;
}

/* A SHORTENED PATH AND A FOREIGN ONE BOTH SHARE A BASENAME, AND ONLY THE TAIL TELLS THEM APART.
   `trySpellings` guesses ten prefixes, so a row citing `tch-pooled-hat-2026-10-03.json` for the
   tracked `analysis/published-numbers/tch-pooled-hat-2026-10-03.json` resolved nowhere. The basename
   arm then read "some tracked file carries this basename" as evidence that THIS repo held the cited
   path, which is the claim `off-tree` was split out to deny. A tracked path that ENDS WITH the cited
   path AT A DIRECTORY BOUNDARY is that same file under a fuller spelling, and the match is decided by
   the tracked set rather than guessed. A path the cited one is NOT a tail of shares only a basename:
   `tmp/mut-<hash>/work/mutants/mutation_diff.py` against `capture-host/mutation_diff.py` names a
   mutmut scratch tree this repo never tracked. The boundary is load-bearing — without the leading
   slash, `diff.py` would match `mutation_diff.py` and resolve a citation onto a file it never named. */
export function suffixCandidates(relPath, candidates) {
  const q = String(relPath || '').replace(/^\.\//, '');
  if (!q) return [];
  return (candidates || []).filter((c) => c === q || c.endsWith(`/${q}`));
}

/* THE READER TRIES THE TAIL AFTER THE TEN SPELLINGS, AND ONLY WHEN IT IS UNIQUE. A row that omits
   the leading directories of a file this repo really tracks names a READABLE file, so the right
   answer is the line judgement and not a report of rot. Two tracked tails are an ambiguity this tool
   must not pick between, so the citation stays unresolved and the bin split decides it. This wrapper
   is exported because the composition is the behaviour: it sat inside `main` for one commit, where no
   selftest could reach it and the only proof it worked was a hand-run report. */
export function tailReader(readOne, trackedList) {
  return (p) => {
    const direct = readOne(p);
    if (direct !== null || !trackedList) return direct;
    const tails = suffixCandidates(p, trackedList);
    return tails.length === 1 ? readOne(tails[0]) : null;
  };
}

/* ONE UNRESOLVED PATH, TWO UNLIKE THINGS, AND THE EVIDENCE DECIDES WHICH. `prov` is what a
   provenance probe returned for this path: `carried` is whether ANY tried spelling appears in this
   repo's history, and `candidates` are tracked files sharing its basename. ∅ `carried === null` is
   the question nobody could ask — no probe, or a shallow clone — and it keeps the citation in
   `missing-file`, the class that decides `--strict`. Only a history that was READ and came back
   empty, with no basename candidate either, may move a citation out of the defect sum. */
export function binMissing(prov, relPath = null) {
  if (!prov || prov.carried === null || prov.carried === undefined) return { verdict: 'missing-file', why: 'the provenance probe did not run, so this path is judged as rot' };
  if (prov.carried) return { verdict: 'missing-file', why: `this repo's history carries ${prov.at || 'this path'}` };
  const candidates = prov.candidates || [];
  if (!candidates.length) return { verdict: 'off-tree', why: 'no spelling of this path is in the history and no tracked file carries its basename' };
  /* ∅ FAIL CLOSED WHEN THE TAIL CANNOT BE TESTED. A caller that passes no path leaves the two unlike
     cases folded, so the citation keeps the defect class rather than being demoted on a basename. */
  if (relPath === null) return { verdict: 'missing-file', why: `a tracked file carries this basename: ${candidates.slice(0, 3).join(', ')}`, candidates };
  const suffix = suffixCandidates(relPath, candidates);
  if (suffix.length) return { verdict: 'missing-file', why: `a tracked file sits at this path under a fuller spelling: ${suffix.slice(0, 3).join(', ')}`, candidates: suffix };
  return {
    verdict: 'off-tree',
    why: `no spelling of this path is in the history, and the tracked file sharing its basename sits where this path is not a tail of it: ${candidates.slice(0, 3).join(', ')}`
  };
}

/* THE EXIT CODE READS THE CLASSES THIS FILE RANKS AS DEFECTS. `--strict` read `r.moved.length`
   alone, which inverted the ordering stated in the header: a moved hint is advisory, and §📌 forbids
   editing a row cell, so nobody may repair one where it sits — the flag's green was unreachable
   while 76 citations in the three actionable classes left it green. `moved` stays out of the sum on
   purpose. (Row 2026-10-26-the-strict-exit-reads-the-one-class-the-tool-calls-benign.) */
export function strictFailures(r) {
  return r.missing.length + r.unanchored.length + r.beyondEof.length;
}

/* THE ROWS A BRANCH ADDED, BY KEY. Rows are append-and-close, so a key the base ledger does not
   carry is a row this branch wrote, and a key both carry is a row whose state cell may have moved —
   which is not this tool's business. Keying on the key rather than on the row TEXT is deliberate: a
   closure edits the state cell, and a text diff would hand every closed row back to the gate. */
export function addedRows(rows, baseRows) {
  const seen = new Set(baseRows.map((r) => r.key));
  return rows.filter((r) => !seen.has(r.key));
}

/* THE CRITERION NAMES ITS OWN SCOPE AND ITS OWN COUNT. Two modes judge two populations, so one
   shared name would have to lie about one of them (the lesson of residue
   `2026-10-31-the-mutation-verdicts-criterion-names-lines-not-functions`): `--base` bounds the
   citations of the ADDED rows and the plain run bounds every row's. Both count the three classes
   this file ranks as defects, never the advisory `moved` or the external `off-tree`. */
export const CRITERION = {
  added: { name: 'defect_class_citations_in_added_rows', threshold: 0, unit: 'citations', direction: 'lte' },
  ledger: { name: 'defect_class_citations_in_every_row', threshold: 0, unit: 'citations', direction: 'lte' },
  /* THE THIRD SCOPE IS A TRANSITION, NOT A LEVEL. The two above count a state of the ledger; this
     one counts citations that STOPPED anchoring between two refs, which is the growth neither of
     them can see. */
  delta: { name: 'defect_class_citations_added_by_code_movement', threshold: 0, unit: 'citations', direction: 'lte' }
};

/* The three classes this file ranks as defects, named once. `strictFailures` sums them over a
   census and `deltaOf` reads them per citation, so the two readings cannot disagree. */
export const DEFECT_CLASSES = new Set(['missing-file', 'unanchored', 'beyond-eof']);

/* THE GROWTH THE CENSUS CANNOT SEE. `--base` judges the citations a branch ADDS, so a citation that
   anchored yesterday and stopped anchoring because the CODE under it moved sits in no population:
   not in the gate's added rows, and not in a standing debt that only ever grew. `deltaOf` is pure —
   two class lists for the SAME rows, read at two refs, and the transition between them.
   ONE VARIABLE MOVES. Both sides are judged from the row text at HEAD, so a state cell that closed
   between the refs cannot change the identifiers, and the tree is the only difference left.
   ∅ A CITATION ON ONE SIDE ONLY IS EXCLUDED, NEVER READ AS A TRANSITION. The cited path is extended
   against each ref's own tracked set, so a file born or deleted between the refs can change what a
   row's text resolves to, and that is not a transition anybody can act on. */
export function deltaOf(baseEntries, headEntries) {
  /* The identity is (row, ordinal, cite): the ordinal keeps a row's repeated citation of one
     path:line as two citations, which is what the census counts. */
  const idOf = (e) => `${e.key}\u0000${e.n ?? 0}\u0000${e.cite}`;
  const bmap = new Map((baseEntries || []).map((e) => [idOf(e), e]));
  const hmap = new Map((headEntries || []).map((e) => [idOf(e), e]));
  const tally = (es) => {
    const o = {};
    for (const e of es || []) o[e.verdict] = (o[e.verdict] || 0) + 1;
    return o;
  };
  const d = {
    baseByVerdict: tally(baseEntries),
    headByVerdict: tally(headEntries),
    newRotSites: [],
    repairedSites: [],
    newRot: 0,
    repaired: 0,
    carriedDefect: 0,
    cleanBoth: 0,
    anchoredToMoved: 0,
    onlyBase: 0,
    onlyHead: 0,
    checked: 0,
    eligible: 0,
    excluded: 0
  };
  const ids = new Set([...bmap.keys(), ...hmap.keys()]);
  d.eligible = ids.size;
  for (const id of ids) {
    const b = bmap.get(id);
    const h = hmap.get(id);
    if (!b || !h) {
      if (!b) d.onlyHead += 1;
      else d.onlyBase += 1;
      continue;
    }
    d.checked += 1;
    const bDef = DEFECT_CLASSES.has(b.verdict);
    const hDef = DEFECT_CLASSES.has(h.verdict);
    const site = { key: h.key, state: h.state, cite: h.cite, from: b.verdict, to: h.verdict };
    if (!bDef && hDef) {
      d.newRot += 1;
      d.newRotSites.push(site);
    } else if (bDef && !hDef) {
      d.repaired += 1;
      d.repairedSites.push(site);
    } else if (bDef && hDef) d.carriedDefect += 1;
    else {
      d.cleanBoth += 1;
      if (b.verdict === 'anchored' && h.verdict === 'moved') d.anchoredToMoved += 1;
    }
  }
  d.excluded = d.onlyBase + d.onlyHead;
  const bySite = (a, z) => (a.cite < z.cite ? -1 : a.cite > z.cite ? 1 : 0);
  d.newRotSites.sort(bySite);
  d.repairedSites.sort(bySite);
  return d;
}

/* ∅ THE DELTA'S VERDICT NEVER SOFTENS ITS MISS TO MATCH ITS EXIT. The caller is advisory by ruling
   (board #5793): §📌 forbids repairing a row cell where it sits, so a branch that moves code under
   someone else's citation has no legal repair, and a blocking form would red an author for work
   nobody may do. The exit is 0; the OBJECT still reads FAIL, because a status bent to fit an exit
   code is this repo's examined-nothing defect wearing a mode name. The whole-ledger census already
   reads FAIL at exit 0, and this mode keeps that register. */
export function verdictForDelta(d, commit, opts = {}) {
  let status = 'PASS';
  let reason = null;
  if (opts.notRun) {
    status = 'NOT_RUN';
    reason = opts.notRun;
  } else if (!d || !d.checked) {
    /* ∅ A FILTER THAT MATCHES NOTHING READS AS A PASS (CLAUDE.md §4b). Two refs may differ on no
       cited file at all, which is the common case on a one-file branch, and that is examined-nothing
       rather than a clean bill. */
    status = 'NOT_APPLICABLE';
    reason = `no citation of a row both ledgers carry was in scope at ${opts.base} and at ${opts.ref}, so no transition binds`;
  } else if (d.newRot) {
    status = 'FAIL';
    reason = `${d.newRot} citation(s) anchored at ${opts.base} and do not anchor at ${opts.ref}: the code under them moved, and the row may not be repaired where it sits`;
  }
  const notMeasured = status === 'NOT_RUN' || status === 'NOT_APPLICABLE';
  return Verdict.make({
    gate: 'residue-cite-drift',
    status,
    scope: 'internal',
    /* `checked + excluded = eligible` AND THE ELIGIBLE SET IS EVERY CITATION OF EVERY COMMON ROW.
       The scope filter reads only the citations whose file the two refs differ on, so the rest must
       be EXCLUDED with a reason, never dropped out of the denominator. A denominator cut to what was
       convenient is the population defect this file's own rows are about. */
    population:
      notMeasured && status === 'NOT_RUN'
        ? { checked: 0, eligible: 0, excluded: 0 }
        : { checked: d.checked, eligible: opts.eligible ?? d.eligible, excluded: (opts.eligible ?? d.eligible) - d.checked },
    criterion: CRITERION.delta,
    result: notMeasured
      ? null
      : {
          base: opts.base || null,
          ref: opts.ref || null,
          rowsBoth: opts.rowsBoth ?? null,
          rowsScoped: opts.rowsScoped ?? null,
          scope: opts.scope ?? null,
          outOfScope: (opts.eligible ?? d.eligible) - d.eligible,
          newRot: d.newRot,
          repaired: d.repaired,
          carriedDefect: d.carriedDefect,
          cleanBoth: d.cleanBoth,
          anchoredToMoved: d.anchoredToMoved,
          onlyBase: d.onlyBase,
          onlyHead: d.onlyHead,
          baseByVerdict: d.baseByVerdict,
          headByVerdict: d.headByVerdict,
          /* A COUNT A CONSUMER CANNOT RESOLVE IS NOT A FINDING (row
             2026-11-08-the-cite-drift-verdict-carries-a-bare-count): every new-rot citation travels
             with its key, its cite and both classes. */
          newRotSites: d.newRotSites
        },
    evidence: [LEDGER, 'tools/residue-cite-drift.mjs'],
    reason,
    producedBy: { tool: 'tools/residue-cite-drift.mjs', commit }
  });
}

export function verdictFor(r, commit, opts = {}) {
  const n = r ? strictFailures(r) : 0;
  const criterion = opts.base ? CRITERION.added : CRITERION.ledger;
  let status = 'PASS';
  let reason = null;
  if (opts.notRun) {
    status = 'NOT_RUN';
    reason = opts.notRun;
  } else if (!r.citations) {
    /* ∅ EXAMINED AND THE RULE DOES NOT BIND — never PASS over a population of nothing. */
    status = 'NOT_APPLICABLE';
    reason = opts.base ? `no row added against ${opts.base} cites a file:line, so the cite-by-identifier rule binds nothing here` : 'no row in the ledger cites a file:line';
  } else if (n) {
    status = 'FAIL';
    reason = `${n} citation(s) in the classes this tool ranks as defects (missing-file ${r.missing.length} · unanchored ${r.unanchored.length} · beyond-eof ${r.beyondEof.length}); cite by identifier, with the line as a dated hint`;
  }
  const notMeasured = status === 'NOT_RUN' || status === 'NOT_APPLICABLE';
  return Verdict.make({
    gate: 'residue-cite-drift',
    status,
    scope: 'internal',
    population: { checked: r ? r.citations : 0, eligible: r ? r.citations : 0, excluded: 0 },
    criterion,
    /* THE CONTRACT REFUSES A RESULT NOBODY MEASURED. `NOT_RUN` examined nothing and
       `NOT_APPLICABLE` examined a population the criterion does not bind, so both carry
       `result: null` rather than a tidy row of zeros that reads like a measurement. */
    result: notMeasured
      ? null
      : {
          rows: r ? r.rows : 0,
          base: opts.base || null,
          ref: opts.ref || null,
          ...(r ? r.byVerdict : {}),
          defectClass: n,
          missingFile: r ? r.missing.length : 0,
          unanchored: r ? r.unanchored.length : 0,
          beyondEof: r ? r.beyondEof.length : 0,
          moved: r ? r.moved.length : 0,
          offTree: r ? r.offTree.length : 0,
          /* A COUNT A CONSUMER CANNOT RESOLVE IS NOT A FINDING. The human report names all three
             defect classes by key and cite, and the verdict published the bare totals beside them, so
             a verdict reader could locate none of the rows it was told to act on (row
             `2026-11-08-the-cite-drift-verdict-carries-a-bare-count`). Every defect-class citation now
             travels here, and `defectSites.length === defectClass` is the identity that keeps the list
             and its denominator from drifting apart. `moved` is advisory and `off-tree` is external, so
             neither belongs in a list of what the gate reds on. */
          defectSites: r
            ? [
                /* `state: null` is load-bearing: the `missing-file` report entry carries `why` and no
                   state, so the field reads null rather than vanishing from one class of entry. */
                ...r.missing.map((e) => ({ class: 'missing-file', key: e.key, state: e.state ?? null, cite: e.cite })),
                ...r.unanchored.map((e) => ({ class: 'unanchored', key: e.key, state: e.state, cite: e.cite })),
                ...r.beyondEof.map((e) => ({ class: 'beyond-eof', key: e.key, state: e.state, cite: e.cite }))
              ]
            : []
        },
    evidence: [LEDGER, 'tools/residue-cite-drift.mjs'],
    reason,
    producedBy: { tool: 'tools/residue-cite-drift.mjs', commit }
  });
}

function commitSha() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/* ∅ THE BASE LEDGER IS A MEASUREMENT AND ITS ABSENCE IS NOT AN EMPTY DIFF. */
export function readLedgerAt(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${LEDGER}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

/* ONE CLASSIFIER, READ TWICE. The delta mode needs the class of EVERY citation at two refs, the
   anchored ones included, and the census only counts those. So the per-citation loop lives here and
   `sweep` aggregates what this yields. A second loop beside it would hold two sources of truth for
   one judgement, which is the drift this file's own rows are about. */
export function* classify(rows, reader, provenance = null, isTracked = null) {
  const cache = new Map();
  const provCache = new Map();
  const prov = (q) => {
    if (!provenance) return null;
    if (!provCache.has(q)) provCache.set(q, provenance(q));
    return provCache.get(q);
  };
  const lines = (p) => {
    if (!cache.has(p)) cache.set(p, reader(p));
    return cache.get(p);
  };
  for (const row of rows) {
    const ids = identifiers(row.text);
    /* `n` IS THE ORDINAL OF THE CITATION WITHIN ITS ROW, AND IT IS THE DELTA'S IDENTITY. 38 of this
       ledger's 919 citations repeat a path:line inside one row, so a (key, cite) pair collapses them
       and the delta's population would read 881 of a census's 919 — a population that silently drops
       a citation it never says it dropped. */
    let n = 0;
    for (const c of citations(row.text, isTracked)) {
      const j0 = judge(c, lines(c.path), ids);
      /* The judgement is pure and reads a file; the SPLIT of its missing bin reads the repo, so it
         happens here, where the probe lives. */
      const j = j0.verdict === 'missing-file' ? { ...j0, ...binMissing(prov(c.path), c.path) } : j0;
      yield { key: row.key, state: row.state, n: n++, cite: `${c.path}:${c.line}`, verdict: j.verdict, j };
    }
  }
}

export function sweep(rows, reader, provenance = null, isTracked = null) {
  /* EVERY NON-ANCHORED CLASS CARRIES KEYS. `unanchored` was an integer and `beyond-eof` had no field
     at all, so the two verdicts a reader must act on were the two the report could not locate (row
     2026-10-26-the-unanchored-class-is-counted-and-never-named). `anchored` stays a count, because a
     pointer that still points names nothing to chase. */
  const report = { rows: rows.length, citations: 0, byVerdict: {}, moved: [], unanchored: [], beyondEof: [], missing: [], offTree: [], provenanceProbe: provenance ? 'read' : 'not-run' };
  /* `byVerdict` counts the final class. */
  for (const e of classify(rows, reader, provenance, isTracked)) {
    const j = e.j;
    report.citations++;
    report.byVerdict[j.verdict] = (report.byVerdict[j.verdict] || 0) + 1;
    if (j.verdict === 'moved') report.moved.push({ key: e.key, state: e.state, cite: e.cite, now: j.now });
    else if (j.verdict === 'missing-file') report.missing.push({ key: e.key, cite: e.cite, why: j.why });
    else if (j.verdict === 'off-tree') report.offTree.push({ key: e.key, state: e.state, cite: e.cite, why: j.why });
    else if (j.verdict === 'beyond-eof') report.beyondEof.push({ key: e.key, state: e.state, cite: e.cite, length: j.length });
    else if (j.verdict === 'unanchored') report.unanchored.push({ key: e.key, state: e.state, cite: e.cite, tried: j.tried, specific: j.specific });
  }
  return report;
}

function selftest() {
  const file = ['import os', 'def alpha():', '    return 1', '', 'def beta(x):', '    return x + 1', 'BETA_CONST = 3', 'import pull_session'];
  const ids = identifiers('cites `beta` and `BETA_CONST` and "pull_session" and `mod.alpha()` here');
  const fails = [];
  let ran = 0;
  const check = (n, c) => {
    ran += 1;
    if (!c) fails.push(n);
  };
  check(
    'identifiers: backticked, quoted, dotted-call last segment',
    ['beta', 'BETA_CONST', 'pull_session', 'mod.alpha', 'alpha'].every((i) => ids.includes(i))
  );
  check(
    'identifiers: a span with SPACES yields its tokens (`import pull_session` → pull_session), never `import`',
    identifiers('cites `import pull_session` at `capture.py:5306`').includes('pull_session') &&
      !identifiers('cites `import pull_session`').includes('import') &&
      !identifiers('`capture.py:5306`').some((x) => /\.py$/.test(x))
  );
  check(
    'citations: backticked path:line and a bare path:line-range',
    JSON.stringify(citations('see `capture.py:5306` and tools/x.mjs:10-12 and prose.')) ===
      JSON.stringify([
        { path: 'capture.py', line: 5306, to: null },
        { path: 'tools/x.mjs', line: 10, to: 12 }
      ])
  );
  /* ════ ONE CONTROL PER FORM THE READER MUST HANDLE ═══════════════════════════════════════════
     An unreadable form yields errors in BOTH directions — a false defect loudly and a false pass
     silently — and the silent half is the one no reconciliation against a count will catch (memory
     `a-reader-that-cannot-read-a-form-owes-that-word`, Osprey #3983). So each form below is a leg,
     the back-compatible no-oracle path is a leg, and the KNOWN LIMIT is a leg rather than a guess. */
  const TRACKED = new Set(['Data Unifier.html', 'OxyDex.html', "wiring/How It's Wired - OxyDex.html", 'tools/x.mjs', 'capture.py']);
  const tr = (q) => TRACKED.has(q);
  check('a space-bearing path inside backticks extends to the tracked whole, not to its tail', citations('see `Data Unifier.html:412` now', tr)[0].path === 'Data Unifier.html');
  check(
    'THE SILENT HALF · the LONGEST tracked candidate wins, so the citation does not land on another real file',
    citations("see `wiring/How It's Wired - OxyDex.html:40`", tr)[0].path === "wiring/How It's Wired - OxyDex.html" &&
      citations("see `wiring/How It's Wired - OxyDex.html:40`")[0].path === 'OxyDex.html'
  );
  check(
    'CONTROL · prose to the left never wins, because prose is not tracked',
    citations('as described in the live Data Unifier.html:412 file', tr)[0].path === 'Data Unifier.html' && citations('the file tools/x.mjs:10 holds it', tr)[0].path === 'tools/x.mjs'
  );
  check(
    'CONTROL · with no tracked oracle the answer is byte-identical to the unextended one',
    JSON.stringify(citations('see `Data Unifier.html:412` and tools/x.mjs:10-12.')) ===
      JSON.stringify([
        { path: 'Unifier.html', line: 412, to: null },
        { path: 'tools/x.mjs', line: 10, to: 12 }
      ])
  );
  check('THE DECLARED LIMIT · a space-bearing path the tree does NOT track still truncates, and is not guessed at', citations('see `Some Deleted File.html:9`', tr)[0].path === 'File.html');
  check('CONTROL · a path with no space is untouched while the oracle is present', citations('see `capture.py:5306`', tr)[0].path === 'capture.py');
  /* The second half uses an ALWAYS-TRACKED oracle, which is the only way to make the window the
     binding constraint: a real oracle stops the walk at the first untracked candidate, so it would
     pass whatever the cap were, and the leg would examine nothing. */
  check(
    'the extension never reaches past its window, so a long prose line cannot be scanned without bound',
    citations('x'.repeat(400) + ' Data Unifier.html:412', tr)[0].path === 'Data Unifier.html' &&
      extendCitedPath('y'.repeat(300) + 'Unifier.html', 300, 'Unifier.html', () => true).length === PATH_EXTEND_WINDOW + 'Unifier.html'.length
  );
  check('anchored: the identifier is on the cited line', judge({ line: 5 }, file, ['beta']).verdict === 'anchored');
  // THE PLANT — the residue's own example: the import cited at one line now lives at another
  const moved = judge({ line: 1 }, file, ['pull_session']);
  check('PLANT moved: `import pull_session` cited at :1 is now at :8 — reported with where it is', moved.verdict === 'moved' && JSON.stringify(moved.now) === JSON.stringify({ pull_session: [8] }));
  check('unanchored: the row names nothing that occurs in the file — not judged as drift', judge({ line: 2 }, file, ['gamma']).verdict === 'unanchored');
  check('beyond-eof', judge({ line: 99 }, file, ['beta']).verdict === 'beyond-eof');

  /* THE PHANTOM LAST LINE. `readAt` used a raw `split('\n')`, so a newline-terminated file — nearly
     every tracked file — produced one element more than it has lines. The legs below pin the reader's
     contract, and the control pins what the defect WAS, because every plant above hand-builds its
     array and so could never observe it. */
  check('toLines: a newline-terminated text yields its lines, not one more', JSON.stringify(toLines('a\nb\n')) === '["a","b"]');
  check('toLines: a text with no final newline is unchanged', JSON.stringify(toLines('a\nb')) === '["a","b"]');
  check('toLines: a file that really ends in a blank line KEEPS it — exactly one empty is dropped', JSON.stringify(toLines('a\nb\n\n')) === '["a","b",""]');
  check('toLines: empty text is zero lines', JSON.stringify(toLines('')) === '[]');
  check('CONTROL · the raw split was long by one, and toLines is not', 'a\nb\n'.split('\n').length === 3 && toLines('a\nb\n').length === 2);
  const eof = judge({ line: 3 }, toLines('a\nb\n'), ['x']);
  check('beyond-eof: the line after the last one cannot resolve, and the REPORTED length is the real one', eof.verdict === 'beyond-eof' && eof.length === 2);
  check('anchored: the real last line of a newline-terminated file still resolves', judge({ line: 2 }, toLines('a\nbeta\n'), ['beta']).verdict === 'anchored');
  check('missing-file', judge({ line: 1 }, null, ['beta']).verdict === 'missing-file');
  check('a row with NO identifiers is unanchored, never anchored by vacuity', judge({ line: 5 }, file, []).verdict === 'unanchored');
  check('a PLAIN-WORD identifier (`alpha`, `beta`) cannot testify to a move — unanchored, not moved', judge({ line: 4 }, file, ['alpha', 'beta']).verdict === 'unanchored');
  check('…but it still anchors when it IS on the cited line', judge({ line: 2 }, file, ['def']).verdict === 'anchored');
  /* ════ AN IDENTIFIER MUST STAND ON ITS OWN ════════════════════════════════════════════════
     Measured 2026-11-08 over 1302 rows: 33 of 249 anchored citations held no standalone occurrence
     on the line they cite, and two more anchored on nothing but a file extension. The legs under
     `occursIn` are the ones that separate this reader from a bare `includes`; the rest pin the
     forms that a boundary test can break — a word character inside an identifier, a non-word
     character beside one, a literal dot, and a tail that is a real name. */
  check('∅ an interior substring is not an occurrence: `file` is not in `fileURLToPath`', !occursIn('file', 'const HERE = dirname(fileURLToPath(import.meta.url));'));
  check(
    '∅ nor is `fixture` in `fixtureNames`, `pat` in `path`, or `dex` in `index`',
    !occursIn('fixture', 'export function embeddedStampCount(fixtureNames, root) {') &&
      !occursIn('pat', 'the corrected path put both accelerometers on the phone stamps') &&
      !occursIn('dex', 'that index also carries the run fragments')
  );
  check('`_` is a word character, so `pull_session` does not occur inside `foo_pull_session`', !occursIn('pull_session', 'await foo_pull_session(db)'));
  check(
    '…and `-`, `.`, `(` and a backtick carry a boundary, so a hyphenated or dotted name still occurs',
    occursIn('trio-batch', 'reads `tools/trio-batch.mjs` as a signalled death') && occursIn('mod.alpha', 'x = mod.alpha();') && occursIn('readFile', 'readFile(u)')
  );
  check("a dotted identifier's dot is a literal, never any character", !occursIn('mod.alpha', 'modxalpha()'));
  check('a quoted-string identifier that ends on a non-word character still occurs', occursIn('--cov-fail-under', 'pytest -q --cov-fail-under=100'));
  check('judge: an interior substring no longer anchors the citation', judge({ line: 1 }, toLines('const HERE = dirname(fileURLToPath(u));\n'), ['file']).verdict !== 'anchored');
  check('judge: a standalone identifier on the cited line still anchors', judge({ line: 1 }, toLines('const HERE = readFile(u);\n'), ['readFile']).verdict === 'anchored');
  check(
    'judge: the MOVED search is bounded too, so an interior match elsewhere is not a move',
    judge({ line: 1 }, toLines('a\nconst x = pull_sessionFactory();\n'), ['pull_session']).verdict === 'unanchored'
  );
  check('∅ the tail of a path-like token is not an identifier: `analysis/a.json` yields no `json`', !identifiers('cites `analysis/a.json#result/count` here').includes('json'));
  check(
    '…and EVERY extension the rejection knows is rejected as a bare tail, because one list feeds both',
    'py js mjs md html json sh yml yaml toml css txt'.split(' ').every((e) => !identifiers(`cites \`a/b.${e}\` here`).includes(e))
  );
  check('…while a tail that is a real name still yields it (`mod.alpha` → `alpha`)', identifiers('cites `mod.alpha()` here').includes('alpha'));
  // the sweep over a synthetic ledger, with a reader that serves one file
  const ledger = [
    '| 2026-09-20-a | 2026-09-20 | `x.py` | cites `beta` at `mod.py:5` and `gamma` at `mod.py:3` | ok | OPEN |',
    '| 2026-09-20-b | 2026-09-20 | `x.py` | cites `pull_session` at `mod.py:1` | ok | OPEN |',
    '| 2026-09-20-c | 2026-09-20 | `x.py` | cites `beta` at `gone.py:1` and `beta` at `mod.py:99` | ok | fixed #1 |',
    '| not a row |',
    '| 2026-09-20-d | 2026-09-20 | `x.py` | no citation at all | ok | OPEN |'
  ].join('\n');
  const rows = parseRows(ledger);
  check('parseRows keeps the four rows and drops the non-row', rows.length === 4 && rows[2].state === 'fixed #1');
  const r = sweep(rows, (p) => (p === 'mod.py' ? file : null));
  check(
    'sweep: 5 citations → 1 each of anchored, moved, missing, unanchored and beyond-eof',
    r.citations === 5 && r.byVerdict.anchored === 1 && r.byVerdict.moved === 1 && r.byVerdict['missing-file'] === 1 && r.byVerdict.unanchored === 1 && r.byVerdict['beyond-eof'] === 1
  );
  check('the moved entry names the row, the citation and the current line', r.moved[0].key === '2026-09-20-b' && r.moved[0].cite === 'mod.py:1' && r.moved[0].now.pull_session[0] === 8);
  /* THE CLASS A READER MUST ACT ON IS THE ONE THE REPORT COULD NOT LOCATE. `unanchored` was an
     integer and `beyond-eof` had no field, so both are pinned as key-bearing lists here. */
  check(
    'the UNANCHORED entry names the row and the citation, not just a count',
    Array.isArray(r.unanchored) && r.unanchored.length === 1 && r.unanchored[0].key === '2026-09-20-a' && r.unanchored[0].cite === 'mod.py:3' && r.unanchored[0].state === 'OPEN'
  );
  check('…and it carries why it could not be judged — identifiers read, and how many were code-shaped', r.unanchored[0].tried === 2 && r.unanchored[0].specific === 0);
  /* THE VERDICT MUST LOCATE WHAT IT COUNTS (row
     `2026-11-08-the-cite-drift-verdict-carries-a-bare-count`). The human report named all three defect
     classes while the verdict published the bare totals, so a verdict reader could chase nothing. */
  const vSites = verdictFor(r, 'deadbeef');
  check('the verdict lists every defect-class citation it counts', Array.isArray(vSites.result.defectSites) && vSites.result.defectSites.length === vSites.result.defectClass);
  check(
    '…by class, key and cite, so a consumer can open the row and the site',
    vSites.result.defectSites.every((d) => d.class && d.key && /:\d+$/.test(d.cite)) && new Set(vSites.result.defectSites.map((d) => d.class)).size === 3
  );
  /* CONTROL · the advisory and external classes stay out of the list the gate reds on. */
  check('…and never the advisory `moved` or the external `off-tree`', !vSites.result.defectSites.some((d) => d.class === 'moved' || d.class === 'off-tree'));
  check(
    'the `missing-file` entry reads a null state rather than dropping the field',
    vSites.result.defectSites.filter((d) => d.class === 'missing-file').every((d) => 'state' in d)
  );
  check(
    'the BEYOND-EOF entry names the row, the citation and the length that refutes it',
    r.beyondEof.length === 1 && r.beyondEof[0].key === '2026-09-20-c' && r.beyondEof[0].cite === 'mod.py:99' && r.beyondEof[0].length === 8
  );
  check('ANTI-VACUITY · anchored stays a count, since a pointer that still points names nothing to chase', r.byVerdict.anchored === 1 && r.anchored === undefined);
  /* THE EXIT CODE'S POPULATION. One of each class is planted above, so the sum is the three
     actionable ones and the moved hint is absent from it. The control below carries a moved citation
     and nothing else: it must read zero, or `--strict` is still gating on the advisory class. */
  check('strictFailures sums the three classes the tool ranks as defects', strictFailures(r) === 3);
  {
    const movedOnly = parseRows('| 2026-09-20-m | 2026-09-20 | `mod.py` | cites `pull_session` at mod.py:1 | ok | OPEN |');
    const rm = sweep(movedOnly, (q) => (q === 'mod.py' ? file : null));
    check('CONTROL · a sweep whose only finding is MOVED decides nothing, so --strict stays green', rm.byVerdict.moved === 1 && strictFailures(rm) === 0);
  }
  check(
    'TRIPWIRE · the flag is wired to that sum and reads `moved` nowhere in its exit',
    (() => {
      const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
      /* MATCH THE STATEMENT, NOT ITS NAME. A first version searched for the exit's own text and
         found THIS leg's string literal instead — the §4 self-match, one layer up. */
      const line = src.split('\n').find((l) => /^\s*process\.exit\(/.test(l) && l.includes('strictN'));
      /* AND THE GATE'S EXIT TAKES NO SECOND FLAG. The pin read `process.exit(has(` until the
         `--base` mode landed; `decides` is that mode OR the flag, so a later edit making the gate
         flag-dependent again reds here under its own name rather than passing silently. */
      const wiring = src.split('\n').find((l) => /^\s*const decides = /.test(l));
      return Boolean(line) && !line.includes('moved') && Boolean(wiring) && wiring.includes('base !== null') && wiring.includes("has('--strict')");
    })()
  );
  /* ── THE MISSING BIN SPLITS BY EVIDENCE (row
     2026-10-26-the-missing-file-bin-counts-paths-this-repo-never-carried) ──────────────────────
     Every leg below is pure: the probe is a literal, so the selftest reads no git and no corpus. */
  check(
    '∅ no probe at all — the citation stays a defect, and the reason says the probe did not run',
    (() => {
      const b = binMissing(null);
      return b.verdict === 'missing-file' && /did not run/.test(b.why);
    })()
  );
  check('∅ a shallow clone answers `null`, which is NOT `false` — the citation stays a defect', binMissing({ carried: null, candidates: [] }).verdict === 'missing-file');
  check(
    'a path this repo once carried is rot, and the reason names where the history saw it',
    (() => {
      const b = binMissing({ carried: true, candidates: [], at: 'Unifier.html (9d93ca3a)' });
      return b.verdict === 'missing-file' && b.why.includes('Unifier.html (9d93ca3a)');
    })()
  );
  /* THIS LEG ONCE READ "a tracked basename makes it a repo file cited under the wrong directory".
     That is the inference the tail rule denies, so the leg now pins what it really covers: a caller
     passing NO path cannot test the tail, and the citation fails closed into the defect class. */
  check(
    '∅ a caller that passes no path cannot test the tail, so the citation stays in the defect class',
    (() => {
      const b = binMissing({ carried: false, candidates: ['analysis/published-numbers/hat.json'] });
      return b.verdict === 'missing-file' && b.why.includes('analysis/published-numbers/hat.json');
    })()
  );
  check('ONLY a history that was read and came back empty, with no candidate, scores off-tree', binMissing({ carried: false, candidates: [] }).verdict === 'off-tree');
  /* ── A SHORTENED PATH IS NOT A FOREIGN ONE (row
     2026-11-08-the-basename-arm-folds-a-scratch-path-and-an-abbreviated-one-into-rot) ────────────
     The two live members of the old basename arm are the two cases below, written as literals. */
  check(
    'a bare basename resolves to the one tracked file it is the tail of',
    JSON.stringify(suffixCandidates('hat.json', ['analysis/published-numbers/hat.json'])) === '["analysis/published-numbers/hat.json"]'
  );
  check(
    'a FOREIGN directory sharing only the basename is no tail, so it resolves to nothing',
    suffixCandidates('tmp/mut-6a9e/work/mutants/mutation_diff.py', ['capture-host/mutation_diff.py']).length === 0
  );
  check(
    'BOUNDARY · the tail must start at a directory separator, or `diff.py` would claim `mutation_diff.py`',
    suffixCandidates('diff.py', ['capture-host/mutation_diff.py']).length === 0 && suffixCandidates('mutation_diff.py', ['capture-host/mutation_diff.py']).length === 1
  );
  check('TWO tracked files sharing the tail are an ambiguity, and both are returned rather than one picked', suffixCandidates('hat.json', ['a/hat.json', 'b/hat.json']).length === 2);
  check(
    'a tail match keeps the citation a defect, and the reason names the fuller spelling, not the basename',
    (() => {
      const b = binMissing({ carried: false, candidates: ['analysis/published-numbers/hat.json'] }, 'hat.json');
      return b.verdict === 'missing-file' && b.why.includes('fuller spelling') && b.why.includes('analysis/published-numbers/hat.json');
    })()
  );
  check(
    'a basename-only match scores off-tree, and the reason says the cited path is no tail of it',
    (() => {
      const b = binMissing({ carried: false, candidates: ['capture-host/mutation_diff.py'] }, 'tmp/mut-6a9e/work/mutants/mutation_diff.py');
      return b.verdict === 'off-tree' && /not a tail/.test(b.why) && b.why.includes('capture-host/mutation_diff.py');
    })()
  );
  check(
    'CONTROL · a history that CARRIED the path is rot whatever the tail says — the tail never overrides it',
    binMissing({ carried: true, candidates: ['capture-host/mutation_diff.py'], at: 'x (abc1234)' }, 'tmp/mut-6a9e/work/mutants/mutation_diff.py').verdict === 'missing-file'
  );
  {
    /* The reader composition, which sat unreachable inside `main` for one commit. */
    const served = ['alpha', 'beta', 'gamma'];
    const one = (q) => (q === 'analysis/published-numbers/hat.json' ? served : null);
    check('tailReader resolves a citation written at the bare basename through the one tracked tail', tailReader(one, ['analysis/published-numbers/hat.json'])('hat.json') === served);
    check('tailReader refuses TWO tracked tails and returns null, so the bin split decides it', tailReader(one, ['a/hat.json', 'b/hat.json'])('hat.json') === null);
    check('tailReader with NO tracked list passes the direct read through unchanged', tailReader(one, null)('analysis/published-numbers/hat.json') === served);
    check(
      'tailReader never reinterprets a path that already read — the direct answer wins',
      tailReader((q) => (q === 'hat.json' ? served : null), ['analysis/published-numbers/hat.json'])('hat.json') === served
    );
    /* END TO END, and the control is the same ledger read WITHOUT the tracked list: one line
       judgement against the real file, against one report of rot. */
    const abbrev = parseRows('| 2026-11-08-tail | 2026-11-08 | `x` | the `beta` at hat.json:2 | ok | OPEN |');
    const probeT = () => ({ carried: false, candidates: ['analysis/published-numbers/hat.json'] });
    const rTail = sweep(abbrev, tailReader(one, ['analysis/published-numbers/hat.json']), probeT);
    check('END TO END · a citation at a shortened path is judged against the file it names', rTail.byVerdict.anchored === 1 && strictFailures(rTail) === 0);
    const rNoList = sweep(abbrev, tailReader(one, null), probeT);
    check('CONTROL · with no tracked list the same citation reads as a defect, so the tail is what moved it', rNoList.byVerdict['missing-file'] === 1 && strictFailures(rNoList) === 1);
    /* THE OTHER MEMBER, END TO END. A foreign directory sharing the basename must LEAVE the defect
       sum as off-tree. Under the pre-fix arm the same plant resolves onto the tracked file and reads
       a line out of it, so this leg is the one that separates a repair from a wrong resolution. */
    const foreign = parseRows('| 2026-11-08-foreign | 2026-11-08 | `x` | the `beta` at tmp/mut-6a9e/work/mutants/hat.json:2 | ok | OPEN |');
    const rF = sweep(foreign, tailReader(one, ['analysis/published-numbers/hat.json']), probeT);
    check('END TO END · a foreign path sharing a basename scores off-tree and leaves the defect sum', rF.citations === 1 && rF.byVerdict['off-tree'] === 1 && strictFailures(rF) === 0);
  }
  {
    /* Two citations, one of each kind, through the whole sweep. */
    const two = parseRows(
      '| 2026-09-05-ext | 2026-09-05 | `mutmut` | the installed `runner` at mutmut/__main__.py:1556 | ok | OPEN |\n' +
        '| 2026-09-20-rot | 2026-09-20 | `gone.py` | the deleted `helper` at gone.py:4 | ok | OPEN |'
    );
    const probe = (q) => (q === 'gone.py' ? { carried: true, candidates: [], at: 'gone.py (abc1234)' } : { carried: false, candidates: [] });
    const r2 = sweep(two, () => null, probe);
    check('a sweep WITH the probe splits the bin and keeps only the repo-related half in the sum', r2.byVerdict['off-tree'] === 1 && r2.byVerdict['missing-file'] === 1 && strictFailures(r2) === 1);
    check('an off-tree citation is NAMED — key and cite, never a bare count', r2.offTree.length === 1 && r2.offTree[0].key === '2026-09-05-ext' && r2.offTree[0].cite === 'mutmut/__main__.py:1556');
    check('the report says whether the probe ran at all', r2.provenanceProbe === 'read');
    /* CONTROL, and it is the whole fail-closed claim: the SAME rows with no probe keep both
       citations in the defect sum. Without this leg the split could pass by emptying the sum. */
    const r3 = sweep(two, () => null);
    check(
      'CONTROL · the same sweep with NO probe leaves both citations as defects',
      r3.byVerdict['missing-file'] === 2 && r3.byVerdict['off-tree'] === undefined && strictFailures(r3) === 2 && r3.provenanceProbe === 'not-run'
    );
  }
  check(
    'ONE list of spellings serves the reader and the probe',
    (() => {
      const sp = trySpellings('x.py');
      const src2 = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
      /* A second hand-written prefix list is the failure this leg exists for: the probe would then
       ask about spellings the reader never tried. Count the CONSTRUCTION, not the mentions. */
      const built = (src2.match(/`capture-host\/\$\{relPath\}`/g) || []).length;
      return sp[0] === 'x.py' && sp.includes('capture-host/x.py') && sp.length === 10 && built === 1;
    })()
  );
  check(
    'each file is read once per sweep (cache)',
    (() => {
      let n = 0;
      sweep(rows, () => {
        n++;
        return file;
      });
      return n === 2;
    })()
  );
  /* ── THE GATE: `--base` judges the ADDED rows, and its exit needs no second flag ─────────── */
  const SYN_B = '2026-09-20-b';
  /* HOISTED, never inlined below: `residue-citations.mjs` reads a key literal as a CITATION once
     the bare word `rows` sits within 40 characters before it (`CITE_WORDS` + `CITE_WINDOW`). An
     inlined key beside `rows.filter` therefore cited a line this selftest alone invents, and reded
     that gate at step 6 of 46. A hoisted name keeps the plant and leaves the scan nothing to read. */
  const baseRows = rows.filter((x) => x.key !== SYN_B);
  check('addedRows keeps the one key the base does not carry', JSON.stringify(addedRows(rows, baseRows).map((x) => x.key)) === JSON.stringify([SYN_B]));
  check('addedRows keeps nothing when the base carries every key', addedRows(rows, rows).length === 0);
  /* A CLOSURE MOVES A STATE CELL, AND THAT IS NOT A ROW THIS BRANCH WROTE. Keying on the row TEXT
     would hand every closed row back to the gate, which is the whole open ledger on a RESIDUE-only
     PR. The base copy here carries the same key with the state it had before the close. */
  const closed = rows.map((x) => (x.key === SYN_B ? { ...x, state: 'fixed #9', text: x.text.replace(/OPEN/, 'fixed #9') } : x));
  check('a row whose state cell moved is NOT an added row', addedRows(closed, rows).length === 0);

  const vAdded = verdictFor(r, '3b32a759', { base: 'origin/main', ref: 'HEAD' });
  check('the gate FAILS on the defect classes with no --strict passed', vAdded.status === 'FAIL');
  check('the failing verdict counts the three classes and not the advisory moved', vAdded.result.defectClass === 3 && vAdded.result.moved === 1);
  check('the criterion names the ADDED-row scope', vAdded.criterion.name === 'defect_class_citations_in_added_rows');
  check('…and never the whole-ledger scope, whose population is every row', verdictFor(r, '3b32a759', {}).criterion.name === 'defect_class_citations_in_every_row');
  check('every non-PASS verdict carries a reason', typeof vAdded.reason === 'string' && vAdded.reason.length > 0);
  check('the emitted verdict validates against the contract', Verdict.validate(vAdded).ok);
  /* ANTI-VACUITY: a gate that reds on everything proves nothing, so the same judge is pointed at a
     citation whose identifier IS on the cited line and must come back green. */
  const anchoredOnly = parseRows(['| 2026-09-20-z | 2026-09-20 | `src` | cites `beta` at `mod.py:5` | ev | OPEN |'].join('\n'));
  const rOk = sweep(anchoredOnly, (q) => (q === 'mod.py' ? file : null));
  const vOk = verdictFor(rOk, '3b32a759', { base: 'origin/main', ref: 'HEAD' });
  check('CONTROL: one anchored citation passes the same gate', rOk.citations === 1 && vOk.status === 'PASS' && vOk.reason === null);
  /* ∅ A POPULATION OF NOTHING IS NOT A PASS, AND AN UNREADABLE BASE IS NOT AN EMPTY DIFF. */
  const vNone = verdictFor(
    sweep([], () => null),
    '3b32a759',
    { base: 'origin/main' }
  );
  check('no added citation reads NOT_APPLICABLE, never PASS over checked 0', vNone.status === 'NOT_APPLICABLE' && vNone.population.checked === 0);
  const vNR = verdictFor(null, '3b32a759', { base: 'origin/main', notRun: 'the ledger could not be read at origin/main' });
  check('an unreadable base reads NOT_RUN with its reason', vNR.status === 'NOT_RUN' && /could not be read/.test(vNR.reason));
  check('both refusal verdicts validate', Verdict.validate(vNone).ok && Verdict.validate(vNR).ok);

  /* ── THE DELTA: A TRANSITION, NOT A LEVEL ───────────────────────────────────────────────────
     Each leg is one cell of the transition table, because a mode that counts `newRot` from the
     HEAD class alone would report this file's own 113 standing defects as growth on every run. */
  const E = (key, n, cite, verdict, state = 'OPEN') => ({ key, n, cite, verdict, state });
  const dRot = deltaOf([E('r1', 0, 'a.js:10', 'anchored')], [E('r1', 0, 'a.js:10', 'unanchored')]);
  check(
    'delta: anchored at the base and unanchored at HEAD is NEW ROT, and the site names its key, cite and both classes',
    dRot.newRot === 1 &&
      dRot.repaired === 0 &&
      dRot.checked === 1 &&
      dRot.newRotSites.length === 1 &&
      dRot.newRotSites[0].key === 'r1' &&
      dRot.newRotSites[0].cite === 'a.js:10' &&
      dRot.newRotSites[0].from === 'anchored' &&
      dRot.newRotSites[0].to === 'unanchored'
  );
  const dRep = deltaOf([E('r1', 0, 'a.js:10', 'beyond-eof')], [E('r1', 0, 'a.js:10', 'moved')]);
  check('delta: a defect class at the base and a sound one at HEAD is REPAIRED, never rot', dRep.repaired === 1 && dRep.newRot === 0 && dRep.repairedSites.length === 1);
  const dCar = deltaOf([E('r1', 0, 'a.js:10', 'unanchored')], [E('r1', 0, 'a.js:10', 'missing-file')]);
  check('delta: a defect on BOTH sides is carried debt, not growth, even when the class itself changed', dCar.carriedDefect === 1 && dCar.newRot === 0 && dCar.repaired === 0);
  const dMov = deltaOf([E('r1', 0, 'a.js:10', 'anchored')], [E('r1', 0, 'a.js:10', 'moved')]);
  check('delta: anchored→moved is sound on both sides and only a DIAGNOSTIC, because `moved` never decides the exit', dMov.cleanBoth === 1 && dMov.anchoredToMoved === 1 && dMov.newRot === 0);
  const dSide = deltaOf([E('r1', 0, 'a.js:10', 'anchored'), E('r1', 1, 'b.js:1', 'anchored')], [E('r1', 0, 'a.js:10', 'unanchored')]);
  check(
    'delta: a citation present on ONE side only is EXCLUDED, never read as a transition, and checked + excluded = eligible',
    dSide.onlyBase === 1 && dSide.onlyHead === 0 && dSide.excluded === 1 && dSide.checked === 1 && dSide.checked + dSide.excluded === dSide.eligible
  );
  const dOrd = deltaOf([E('r1', 0, 'a.js:10', 'anchored'), E('r1', 1, 'a.js:10', 'anchored')], [E('r1', 0, 'a.js:10', 'unanchored'), E('r1', 1, 'a.js:10', 'anchored')]);
  check(
    "delta: THE ORDINAL IS THE IDENTITY — one row citing one path:line twice is two citations, so 38 of this ledger's 919 do not collapse",
    dOrd.checked === 2 && dOrd.newRot === 1 && dOrd.cleanBoth === 1
  );
  const vRot = verdictForDelta(dRot, '3b32a759', { base: 'origin/main', ref: 'HEAD', eligible: 4 });
  check(
    "delta verdict: new rot reads FAIL with the count in its reason, and the caller's eligible set keeps the excluded arithmetic",
    vRot.status === 'FAIL' && /1 citation\(s\) anchored at origin\/main/.test(vRot.reason) && vRot.population.eligible === 4 && vRot.population.excluded === 3
  );
  const vClean = verdictForDelta(dMov, '3b32a759', { base: 'origin/main', ref: 'HEAD' });
  check('delta verdict: a transition table with no rot reads PASS over a non-zero checked', vClean.status === 'PASS' && vClean.population.checked === 1 && vClean.reason === null);
  const vEmpty = verdictForDelta(deltaOf([], []), '3b32a759', { base: 'origin/main', ref: 'HEAD', eligible: 919 });
  check(
    'delta verdict: nothing in scope reads NOT_APPLICABLE over checked 0, never PASS, and still states the eligible set it did not read',
    vEmpty.status === 'NOT_APPLICABLE' && vEmpty.population.checked === 0 && vEmpty.population.eligible === 919 && vEmpty.result === null
  );
  const vDNR = verdictForDelta(null, '3b32a759', { base: 'origin/main', ref: 'HEAD', notRun: 'the tree at origin/main could not be read' });
  check(
    'delta verdict: an unreadable base tree reads NOT_RUN with its reason, because an absent side is not an empty delta',
    vDNR.status === 'NOT_RUN' && /could not be read/.test(vDNR.reason) && vDNR.population.eligible === 0
  );
  check(
    'delta verdict: all four validate',
    [vRot, vClean, vEmpty, vDNR].every((v) => Verdict.validate(v).ok)
  );
  check(
    'delta criterion: pre-stated, and its name is the TRANSITION, not the level the two older scopes bound',
    CRITERION.delta.name === 'defect_class_citations_added_by_code_movement' && CRITERION.delta.threshold === 0
  );

  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`${fails.length} failed of ${ran}`);
    process.exit(1);
  }
  console.log(`all ${ran} selftests passed`);
}

/* THE PROBE, AND IT FAILS CLOSED TWICE. A shallow clone cannot answer "did this repo ever carry
   it", so it returns `carried: null` and every unresolved path stays a defect — the same discipline
   `tools/commit-shape.mjs` applies, and the reason CI's `fetch-depth: 0` is load-bearing. A git
   invocation that throws returns `null` for the same reason. The basenames come from the REF being
   judged, so the two halves of the answer describe one tree. */
function repoProvenance(ref) {
  const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  let shallow = true;
  let tracked = [];
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
    tracked = (ref === 'worktree' ? git(['ls-files']) : git(['ls-tree', '-r', '--name-only', ref])).split('\n').filter(Boolean);
  } catch {
    return { probe: null, trackedSet: null, reason: 'git could not be read' };
  }
  /* The tracked set rides OUT of here because this is the one place that already enumerates the
     judged tree, and it describes the same tree as the basenames below — one answer, one ref. A
     shallow clone still yields it: `ls-files`/`ls-tree` need no history, so the path extension keeps
     working where the provenance probe cannot. */
  const trackedSet = new Set(tracked);
  if (shallow) return { probe: null, trackedSet, reason: 'the clone is shallow, so its history cannot answer whether a path ever existed' };
  const byBase = new Map();
  for (const f of tracked) {
    const b = f.slice(f.lastIndexOf('/') + 1);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  const probe = (relPath) => {
    const specs = trySpellings(relPath);
    const base = relPath.slice(relPath.lastIndexOf('/') + 1);
    const candidates = byBase.get(base) || [];
    let hit = '';
    try {
      hit = git(['log', '--all', '--format=%h', '-1', '--', ...specs]).trim();
    } catch {
      return { carried: null, candidates };
    }
    if (!hit) return { carried: false, candidates };
    /* Name the spelling, not just the commit — a reader who cannot see WHICH of the ten matched
       cannot check the answer. Only a path the history knows pays for this second pass. */
    let at = `a commit (${hit})`;
    for (const sp of specs) {
      try {
        if (git(['log', '--all', '--format=%h', '-1', '--', sp]).trim()) {
          at = `${sp} (${hit})`;
          break;
        }
      } catch {
        /* this spelling could not be asked about — try the next */
      }
    }
    return { carried: true, candidates, at };
  };
  return { probe, trackedSet, reason: null };
}

/* A FLAG WHOSE VALUE MAY BE ABSENT READS THE NEXT FLAG AS ITS REF. `--delta` alone means
   `origin/main`, and `--delta --json` must not resolve to the ref `--json`. */
function refArg(flag, dflt) {
  const v = arg(flag, null);
  return !v || v.startsWith('--') ? dflt : v;
}

function deltaMode(base) {
  const ref = 'HEAD';
  const notRun = (reason) => {
    const v = verdictForDelta(null, commitSha(), { base, ref, notRun: reason });
    console.log(`residue-cite-drift (delta): ⏱ UNEXAMINED — ${reason}`);
    console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
    process.exit(2);
  };
  const baseText = readLedgerAt(base);
  /* ∅ AN UNREADABLE BASE IS NOT AN EMPTY DELTA. Either absence would otherwise print `0 new rot` and
     exit 0, which is CLAUDE.md §4b's examined-nothing wearing this mode's name. */
  if (baseText === null) notRun(`the ledger could not be read at ${base} — an unfetched ref, or a clone that does not carry it`);
  if (readAt(base, 'package.json') === null) notRun(`the tree at ${base} could not be read, so every citation would score as rot rather than as unseen`);
  const rows = parseRows(fs.readFileSync(path.join(REPO, 'briefs', 'RESIDUE.md'), 'utf8'));
  const baseKeys = new Set(parseRows(baseText).map((r) => r.key));
  /* The rows BOTH ledgers carry. A row this branch added belongs to `--base`, which judges it as a
     level and not as a transition, and a row the base carries and HEAD does not cannot exist, since
     rows are append-only. */
  const both = rows.filter((r) => baseKeys.has(r.key));
  /* EVERY CITATION OF EVERY COMMON ROW IS THE DENOMINATOR, counted with no file read. */
  const eligible = both.reduce((n, r) => n + citations(r.text, null).length, 0);
  /* THE SCOPE IS THE DIFF, BECAUSE A FILE THE TWO REFS AGREE ON CANNOT MOVE A CITATION. A row's text
     is identical on both sides by construction here, so a citation can only transition when the
     cited FILE differs between the refs. Judging the other 900 costs two whole-ledger sweeps, 30 s
     measured, for a column of identical classes. `--full` keeps the unfiltered form for an audit.
     THE MATCH IS BY BASENAME AND IT IS DELIBERATELY GENEROUS. A cited path is resolved against each
     ref's own tracked set, and `CITE_RE` truncates a path that carries a space, so the two spellings
     of one file need not be equal. A tail match in either direction keeps the citation in scope: an
     over-inclusive filter costs one file read, and an under-inclusive one drops the finding. */
  const full = has('--full');
  let changed = null;
  try {
    changed = execFileSync('git', ['diff', '--name-only', base, ref], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    changed = null;
  }
  if (!full && changed === null) notRun(`the tree difference between ${base} and ${ref} could not be read, so the scope of the delta is unknown`);
  const changedBases = new Set((changed || []).map((p) => p.split('/').pop()));
  const inScope = (cpath) => {
    const b = cpath.split('/').pop();
    for (const cb of changedBases) if (cb === b || cb.endsWith(b) || b.endsWith(cb)) return true;
    return false;
  };
  const scoped = full ? both : both.filter((r) => citations(r.text, null).some((c) => inScope(c.path)));
  const sideOf = (atRef) => {
    const { probe, trackedSet } = repoProvenance(atRef);
    const reader = tailReader((p) => readAt(atRef, p), trackedSet ? [...trackedSet] : null);
    return [...classify(scoped, reader, probe, trackedSet ? (q) => trackedSet.has(q) : null)];
  };
  const d = deltaOf(sideOf(base), sideOf(ref));
  const v = verdictForDelta(d, commitSha(), {
    base,
    ref,
    rowsBoth: both.length,
    rowsScoped: scoped.length,
    eligible,
    scope: full ? 'every citation of every common row' : `the citations whose file ${base} and ${ref} differ on (${(changed || []).length} changed path(s))`
  });
  const checkedV = Verdict.validate(v);
  if (!checkedV.ok) {
    console.error(`invalid verdict: ${checkedV.errors.join('; ')}`);
    process.exit(2);
  }
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  if (has('--json')) {
    console.log(JSON.stringify({ mode: 'delta', base, ref, rowsBoth: both.length, verdict: v, ...d }, null, 2));
    process.exit(0);
  }
  const line = (label, t) =>
    `  ${label} ${Object.entries(t)
      .sort()
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')}`;
  console.log(
    `residue-cite-drift (delta): ${both.length} row(s) in both ledgers, ${eligible} citation(s) eligible · ${d.checked} judged at ${base} AND at ${ref} · ${eligible - d.checked} excluded (${eligible - d.eligible} out of scope, ${d.excluded} on one side only: ${d.onlyBase} at ${base}, ${d.onlyHead} at ${ref})`
  );
  console.log(`  scope: ${full ? 'every citation of every common row (--full)' : `the ${scoped.length} row(s) citing one of the ${(changed || []).length} path(s) the two refs differ on`}`);
  if (d.checked) {
    console.log(line(`at ${base}:`, d.baseByVerdict));
    console.log(line(`at ${ref}:`, d.headByVerdict));
    console.log(
      `  transitions: new-rot ${d.newRot} · repaired ${d.repaired} · defect on both sides ${d.carriedDefect} · sound on both sides ${d.cleanBoth} (of which anchored→moved ${d.anchoredToMoved})`
    );
  }
  if (d.newRotSites.length) {
    console.log(`\n  NEW ROT — the citation anchored at ${base} and does not anchor at ${ref}, so the code under it moved:`);
    for (const t of d.newRotSites) console.log(`    ${t.cite}  (${t.key}, ${t.state})  →  ${t.from} → ${t.to}`);
  }
  if (d.repairedSites.length) {
    console.log(`\n  REPAIRED — the citation did not anchor at ${base} and anchors at ${ref}:`);
    for (const t of d.repairedSites) console.log(`    ${t.cite}  (${t.key}, ${t.state})  →  ${t.from} → ${t.to}`);
  }
  console.log(`\n  Advisory: this mode exits 0 whatever it finds. §📌 forbids repairing a row cell where it sits, so a blocking form would red an author who has no legal repair (board #5793).`);
  console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
  process.exit(0);
}

function main() {
  if (has('--selftest')) return selftest();
  /* The delta reads its own two refs, so it answers before the census resolves one. */
  if (has('--delta')) return deltaMode(refArg('--delta', 'origin/main'));
  const base = arg('--base', null);
  /* A row this branch ADDS must point into the tree this branch HAS, so the gate reads files at the
     checkout; the census keeps judging the ref, which is what its four refinement rows measured. */
  const ref = arg('--ref', base ? 'HEAD' : 'origin/main');
  const ledger = fs.readFileSync(path.join(REPO, 'briefs', 'RESIDUE.md'), 'utf8');
  let rows = parseRows(ledger);
  if (base) {
    const baseText = readLedgerAt(base);
    if (baseText === null) {
      const v = verdictFor(null, commitSha(), {
        base,
        ref,
        notRun: `the ledger could not be read at ${base}, so the set of added rows is unknown — an unfetched ref, or a clone that does not carry it`
      });
      console.log(`residue-cite-drift: ⏱ UNEXAMINED — ${v.reason}`);
      console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
      process.exit(2);
    }
    rows = addedRows(rows, parseRows(baseText));
  }
  const { probe, trackedSet, reason: probeReason } = repoProvenance(ref);
  const r = sweep(
    rows,
    tailReader((p) => readAt(ref, p), trackedSet ? [...trackedSet] : null),
    probe,
    trackedSet ? (q) => trackedSet.has(q) : null
  );
  const v = verdictFor(r, commitSha(), { base, ref });
  /* `Verdict.validate` answers `{ ok, errors }`. A truth test on `.length` would read `undefined`
     and never fire, which is CLAUDE.md §4b: a check reporting a verdict about what it never read. */
  const checkedV = Verdict.validate(v);
  if (!checkedV.ok) {
    console.error(`invalid verdict: ${checkedV.errors.join('; ')}`);
    process.exit(2);
  }
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  if (has('--json')) {
    console.log(JSON.stringify({ ref, base: base || null, verdict: v, ...r }, null, 2));
  } else {
    console.log(
      base
        ? `residue-cite-drift: ${r.rows} row(s) added against ${base} · ${r.citations} file:line citation(s) judged against ${ref}`
        : `residue-cite-drift: ${r.rows} rows · ${r.citations} file:line citations judged against ${ref}`
    );
    if (r.citations)
      console.log(
        '  ' +
          Object.entries(r.byVerdict)
            .sort()
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')
      );
    if (r.moved.length) {
      console.log(`\n  MOVED — the cited line no longer carries the row's identifier; it is now at:`);
      for (const m of r.moved)
        console.log(
          `    ${m.cite}  (${m.key}, ${m.state})  →  ${Object.entries(m.now)
            .map(([id, ls]) => `${id} @ :${ls.join(',:')}`)
            .join('; ')}`
        );
    }
    if (r.missing.length) {
      console.log(`\n  MISSING FILE — the path resolves nowhere under ${ref}, and this repo can be shown to relate to it:`);
      for (const m of r.missing) console.log(`    ${m.cite}  (${m.key})  →  ${m.why}`);
    }
    if (r.offTree.length) {
      console.log(
        `\n  OFF TREE (${r.offTree.length}) — the path resolves nowhere, no spelling of it appears in this repo's history, and no tracked file sits at a path this one is a tail of. A row may cite the standard library, an installed package or a vendor config; such a pointer is not a defect in THIS repo, and it does not decide --strict:`
      );
      for (const o of r.offTree) console.log(`    ${o.cite}  (${o.key}, ${o.state})`);
    }
    if (probeReason) console.log(`\n  ⚠ provenance probe NOT RUN — ${probeReason}. Every unresolved path is judged as rot, which is the fail-closed reading.`);
    if (r.beyondEof.length) {
      console.log(`\n  BEYOND EOF — the cited line is past the end of the file, so the pointer cannot resolve at all:`);
      for (const b of r.beyondEof) console.log(`    ${b.cite}  (${b.key}, ${b.state})  →  the file is ${b.length} line(s) long`);
    }
    if (r.unanchored.length) {
      console.log(
        `\n  UNANCHORED (${r.unanchored.length}) — the row names no identifier found in the file, so the line cannot be judged. This is the class the residue's rule exists for (cite by identifier):`
      );
      for (const u of r.unanchored) console.log(`    ${u.cite}  (${u.key}, ${u.state})  →  ${u.tried} identifier(s) read from the row, ${u.specific} of them code-shaped`);
    }
    console.log('\n  Advisory: a moved hint is not a defect in the row — grep the identifier; the line was only ever a shortcut.');
  }
  /* THE EXIT IS NOT A SECOND FLAG IN GATE MODE. `--strict` sat latent because no caller passed it,
     and a mode that needed one more flag than its caller passes would be that defect renamed. */
  const strictN = strictFailures(r);
  const decides = base !== null || has('--strict');
  if (!has('--json')) {
    if (decides && strictN)
      console.log(
        `\n  ${base !== null ? `--base ${base}` : '--strict'}: ${strictN} citation(s) in the classes this tool ranks as defects (missing-file ${r.missing.length} · unanchored ${r.unanchored.length} · beyond-eof ${r.beyondEof.length}). The ${r.moved.length} moved hint(s) and the ${r.offTree.length} off-tree citation(s) do not decide this exit.`
      );
    console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
  }
  process.exit(decides && strictN ? 1 : 0);
}
/* `isCliEntry` is the one sanctioned predicate — this file exports its judge, so an importer must
   not pay for the whole census. A raw `process.argv[1]` test breaks through a symlink. */
if (isCliEntry(import.meta.url)) main();
