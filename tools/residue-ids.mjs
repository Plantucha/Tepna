#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * residue-ids.mjs — the CROSS-TREE half of the residue ledger's id contract.
 *
 * WHY THIS EXISTS. `docs-ledger` check8c asserts residue ids are unique — within the file
 * it can see. That is one tree. Measured 2026-09-02, the day the ledger shipped: a session
 * branched when `briefs/RESIDUE.md` ended at R6, `main` advanced to R10 while she worked,
 * and appending "R7" produced a locally consistent file that passed docs-ledger 56/56. The
 * collision is invisible to every local gate by construction, and under a squash merge the
 * second row silently duplicates or overwrites depending on hunk placement.
 *
 * It was caught by a human habit — reading `origin/main`'s last id immediately before
 * pushing — and not by any check. This makes it mechanical, for the same reason
 * `commit-shape.mjs` exists (CLAUDE.md §👥.2b-bis): PREVENTION is agent-coupled and cannot
 * be made neutral, but DETECTION reads a property of the branch and CI applies to whoever
 * opened the PR.
 *
 * ⚠️ WHY THIS IS NOT A `dex-tests` ASSERTION. The test lane reads ONE tree off the
 * filesystem — that is precisely the blindness being fixed. This tool needs a second
 * population (`origin/main`'s ledger), so it must read git, which is what `commit-shape`
 * does and what `verify:*` scripts are for.
 *
 * WHAT IT ASSERTS, against the merge-base of `origin/main`:
 *   1. no id added on this branch already exists on main            (the collision)
 *   2. ids added on this branch extend main's maximum, monotonically — never re-used, never
 *      back-filled into a gap. ⚠️ A GAP IS NOT A DELETED ROW: measured 2026-09-02, R7 is a gap
 *      nobody ever committed (`git log -S"| R7 |"` returns nothing). It was announced in a
 *      cross-session message, other sessions minted R8+ around it, and the row it was reserved
 *      for was never written. Ids are burned by ANNOUNCEMENT, not only by use — so an id that
 *      was quoted somewhere must never come back meaning something else. A gap is permanent,
 *      and that is cheap; ambiguity is not.
 *   3. no row that exists on main was REMOVED or had a non-state cell edited
 *      (two exemptions: a retired `R<n>` pointer repair, and a `/home/<user>/` → `~/` redaction)
 *      (rows are appended and closed; a wrong row gets a new row saying so)
 *
 * ⚠️ FAIL CLOSED. A missing ref, an unreadable ledger, or a shallow clone REFUSES (exit 2)
 * rather than reporting green. A check that cannot see the other population must not report
 * on it — that is the defect this tool exists to close, one layer up.
 *
 * USAGE
 *   node tools/residue-ids.mjs                  # this branch vs origin/main
 *   node tools/residue-ids.mjs --base <ref>
 *   node tools/residue-ids.mjs --json
 *   node tools/residue-ids.mjs --full-tree      # every merged commit's `Closes residue <key>` claim vs that row's state
 *   node tools/residue-ids.mjs --open           # the OPEN rows AT THE REF, plus every state the file on disk gets wrong,
 *                                                 # plus each OPEN row a later code commit names (a lead, never a close)
 *   node tools/residue-ids.mjs --open --verdict-sample   # the pickup verdict alone, for the adoption gate
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';
/* THE POINTER JUDGE HAS ONE HOME. `tools/residue-cite-drift.mjs` classifies a citation, and this
   reader borrows that judgement rather than keeping a second copy, so the two tools can never
   disagree about what `moved` means. */
import { citations, identifiers, judge, suffixCandidates, toLines, trySpellings } from './residue-cite-drift.mjs';

/* `verdict.js` is CommonJS and sits at the repo root; this is the idiom `tools/mutate.mjs` uses. */
const Verdict = createRequire(import.meta.url)('../verdict.js');

export const LEDGER_PATH = 'briefs/RESIDUE.md';

/* 🔴 A LEAD SAYS "THE FIX MAY HAVE LANDED". For a row below it never can: another tool's check HOLDS
   the row open, so a picker who closes it reds a gate in code the row itself never names. Measured
   2026-11-03 over the 18 OPEN rows a later commit names — 17 say in their own PR's words that they
   stay open, and these two are pinned. `tools/tch-reference-record.mjs` declares a
   `PUBLISHED_FIELD_GAP` entry per provenance field its published records still lack, and its legs
   assert that every held-back field names a row that is still OPEN, since a settled row tracks
   nothing. So the pin is a property of the OTHER tool, and the list is DECLARED rather than swept:
   a sweep would have to decide what a `row:` property means in code it does not own, which is the
   reason that tool gives for keeping its own legs local. The drift guard sits there too — its
   selftest asserts every gap row appears below, so a gap entry that goes away takes its pin with
   it. A pin is not a reason to leave a defect unfixed: it says the REMEDY is not a state change.

   🔴 THE LIST IS EMPTY, AND EMPTY IS THE SUCCESS STATE. It held two rows while the published TCH
   reference record lacked five provenance fields the producer writes. Re-publishing the record wrote
   all five, so both `PUBLISHED_FIELD_GAP` entries closed and both pins went with them in the same
   diff. A pin kept past its gap is a line nobody reads that makes the list look considered, which is
   the failure mode of every allowlist in this repo. So nothing here is a floor on the list's SIZE:
   the selftest plants a pin map to prove the counting code can still see one, and holds the shipped
   list to shape at whatever size it has. An empty list means no check holds a row open today. */
export const PINNED_OPEN = [];
const PINNED_BY_ROW = new Map(PINNED_OPEN.map((e) => [e.row, e]));

/**
 * Pure core. Parses ledger rows into `{ id, n, key }`, where `key` is every cell EXCEPT the
 * state — the part the contract freezes once written.
 *
 * Deliberately permissive about cell CONTENT: shape is `docs-ledger` check8b's job and
 * duplicating it here would mean two definitions of a well-formed row. This reads identity.
 *
 * @param {string} text
 * `state` is the last cell (OPEN · `→ brief` · `fixed #N` · `withdrawn <key>`), read for the full-tree claim
 * check; it is NOT part of `key`, which stays frozen-cells-only so closing a row is still not a mutation.
 *
 * @returns {Array<{id: string, key: string, state: string}>}
 */
/**
 * ⚠️ SPLIT ON UNESCAPED PIPES ONLY. A bare `line.split('|')` is escape-BLIND, and the residue-row
 * contract MANDATES the escape — a literal `|` breaks the table, so a cell quoting a regex, a shell
 * alternation or any prose with a pipe writes `\|`. Under the blind split that escape read as a cell
 * boundary, which slid the row's real evidence past field 6 and OUT of the frozen identity. An edit
 * to that evidence then changed nothing this tool compares, so it answered `none mutated` about a row
 * it had just mutated: 44 of the ledger's 698 rows on 2026-10-20, row
 * `2026-10-20-append-and-close-is-blind-to-an-escaped-pipe`.
 *
 * Scanning, never a lookbehind. `\X` is consumed as a unit, so `\|` stays inside its cell while a
 * doubled backslash is a literal backslash followed by a LIVE separator; `(?<!\\)\|` gets that second
 * case wrong. The suite reads the same ledger the same way (`splitLedgerCells` in `residueRows`,
 * `tests/dex-tests.js`), where row `2026-09-03-escape-blind-pipe-split` proved the reader under #2165.
 * This widens no check: shape stays `docs-ledger` check8b's job. It only stops counting a character
 * the row escaped on purpose.
 *
 * @param {string} line
 * @returns {string[]} cells, including the empty leading and trailing ones of a table row
 */
export function splitRowCells(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === '|') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\s*\|/);
    if (!m) continue;
    const cells = splitRowCells(line);
    // leading '' + 6 cells + trailing '' — a malformed row is check8b's finding, not ours;
    // take what identity we can and let the other gate speak to its shape.
    const key = cells.slice(1, 6).join('|').trim();
    const state = cells.length >= 2 ? cells[cells.length - 2].trim() : '';
    rows.push({ id: m[1], key, state });
  }
  return rows;
}

/* ── A ROW THE PARSER CANNOT READ MUST RED, NEVER VANISH ─────────────────────────────────────────
   Row 2026-11-02-a-residue-key-with-an-underscore-is-dropped-by-every-ledger-gate. `parseRows` keys a
   row on `\d{4}-\d{2}-\d{2}-[a-z0-9-]+` and `continue`s on anything else, so a key carrying an
   underscore, an uppercase letter or an internal space stays in the file, reads correctly to a human,
   and is invisible to `--open`, to the collision check and to the mutation check for its whole life.

   ⚠️ THE FAILURE MODE IS A REPORTED PASS, NOT A SKIP (§4b). Measured 2026-11-02: the tool printed
   `ok — 0 row(s) added, none colliding, none mutated` and exited 0 over a commit that added exactly
   one row. A session reading that line learns its row is fine. Silence is the one answer that must
   not be available, so an unreadable row reds here instead of leaving the parser.

   The signal that a line INTENDS to be a row is therefore wider than the signal that it parses as
   one: a first cell of a date, a dash, and any content at all is a key attempt. A line that attempts
   a key and fails the parse is returned here, and both halves of the tool red on it.

   ⚠️ `residue-cite-drift.mjs` keeps its OWN reader, and that one takes the first cell VERBATIM, so it
   never dropped these rows. Measured 2026-11-02 against its `parseRows` at `tools/residue-cite-drift.mjs:156`,
   which gates on `line.startsWith('| 20')` and splits on `' | '`. So the row's own claim that every
   ledger gate drops the key is too wide: the two readers DISAGREED about which rows exist, and only
   this one was silent about the disagreement. */
const KEY_ATTEMPT = /^\d{4}-\d{2}-\d{2}-.+$/;
const KEY_PARSES = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

/**
 * Pure. Every line that attempts a residue key and fails `parseRows`'s pattern.
 * @param {string} text
 * @returns {Array<{line: number, cell: string, text: string}>} 1-indexed line numbers, file order
 */
export function unparsedRows(text) {
  const out = [];
  for (const [i, line] of String(text ?? '')
    .split('\n')
    .entries()) {
    if (!line.startsWith('|')) continue;
    const cell = (splitRowCells(line)[1] ?? '').trim();
    if (!KEY_ATTEMPT.test(cell) || KEY_PARSES.test(cell)) continue;
    out.push({ line: i + 1, cell, text: line });
  }
  return out;
}

/* ── THE FULL-TREE HALF: a close CLAIM against the row's state cell ───────────────────────────────
   Row 2026-10-10-a-closes-residue-claim-is-never-checked-against-the-row. The ledger closes a row by
   editing only its state cell, in the session that fixes it — so the commit message that SAYS
   `Closes residue <key>` and the cell that must read `fixed #N` are written together, and nothing failed
   when only one of them was. Measured by the sweep that found it: 2 of 161 OPEN rows carried a landed
   claim. The diff gates cannot see this (they judge a branch against a base; the claim is in history), so
   this reads the whole log once and the ledger once. */
const KEY = '\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+';
// a claim may name several keys: `Closes residue `a` and `b`` / `a, b`. A key after `;` or a full stop is
// NOT chained — `Closes residue a; also appends b` closes a and merely mentions b.
const CLAIM_RE = new RegExp(`\\bclos(?:es|ed|e)\\s+residue[:\\s]+\\**\`?${KEY}\`?\\**(?:\\s*(?:,|&|\\band\\b)\\s*(?:and\\s+)?\\**\`?${KEY}\`?\\**)*`, 'gi');
const KEY_RE = new RegExp(KEY, 'g');

/**
 * Pure. `logText` is `git log --format=%x1e%H%x1f%B` — records split on U+001E, hash and body on U+001F.
 * @returns {Array<{commit: string, key: string}>} one entry per (commit, key), in log order
 */
export function closeClaims(logText) {
  const out = [];
  for (const rec of String(logText ?? '')
    .split('\x1e')
    .slice(1)) {
    const at = rec.indexOf('\x1f');
    if (at < 0) continue;
    const commit = rec.slice(0, at).trim();
    const seen = new Set();
    for (const m of rec.slice(at + 1).matchAll(CLAIM_RE)) {
      for (const k of m[0].match(KEY_RE) || []) {
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ commit, key: k });
      }
    }
  }
  return out;
}

/**
 * Pure. A claim is UNCLOSED when its row still reads `OPEN`, and DANGLING when it names no row at all —
 * a typo'd key closes nothing either. Any other state (`fixed #N`, `→ brief`, `withdrawn <key>`) satisfies it.
 * @param {Array<{commit: string, key: string}>} claims
 * @param {Array<{id: string, state: string}>} rows  parseRows output for the ledger at HEAD
 */
export function unclosedClaims(claims, rows) {
  const stateOf = new Map(rows.map((r) => [r.id, r.state]));
  const problems = [];
  for (const c of claims) {
    if (!stateOf.has(c.key)) problems.push(`${c.commit.slice(0, 8)} claims to close ${c.key} — the ledger has no such row`);
    else if (stateOf.get(c.key) === 'OPEN') problems.push(`${c.commit.slice(0, 8)} claims to close ${c.key} — the row still reads OPEN`);
  }
  return problems;
}

/**
 * Is this cell change a POINTER REPAIR rather than a claim edit?
 *
 * The ledger's rule is that a row's non-state cells are never edited, and it exists so a row's CLAIM —
 * its defect, its evidence, its source — cannot be quietly altered after the fact. A reference to
 * ANOTHER ROW's identity is not a claim about the world, it is a pointer; and the 2026-09-02 date-slug
 * migration renamed every key without renaming those, so `Blocks R17` survived pointing at an id that
 * no longer exists. Repairing such a pointer PRESERVES the claim. Leaving it dangling alters it,
 * because the row now points nowhere.
 *
 * ⚠️ THE EXEMPTION IS SELF-LIMITING BY CONSTRUCTION, which is what stops it becoming a licence to edit
 * rows. It permits exactly one substitution — a RETIRED `R<n>` id replaced by a key that resolves to a
 * real row — so once no `R<n>` survives anywhere in the ledger it can never fire again. It needs no
 * rename map, no trusted list and no author's assurance: both halves are checkable from the two
 * versions of the file alone. Any other difference, in any cell, is still a mutation.
 *
 * @param {string} before  the row's non-state cells as they stand on the base
 * @param {string} after   the same cells on this branch
 * @param {(k: string) => boolean} isRow  does this key name a row that exists?
 */
export function isPointerRepair(before, after, isRow) {
  const a = String(before).trim().split(/\s+/);
  const b = String(after).trim().split(/\s+/);
  if (a.length !== b.length) return false; // a repair substitutes one token for one token
  let substitutions = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    // old side: a retired id, optionally backticked, optionally with trailing punctuation
    if (!/^`?R\d+`?[,.;:—-]?$/.test(a[i])) return false;
    // new side: a backticked key that names a row which actually exists
    const m = b[i].match(/^`(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)`([,.;:—-]?)$/);
    if (!m || !isRow(m[1])) return false;
    substitutions++;
  }
  return substitutions > 0;
}

/**
 * Is this cell change a HOME-PATH REDACTION rather than a claim edit?
 *
 * The secret scan (`.gitleaks.toml` rule `home-path`) reports an absolute path under one user's home
 * directory, and it reads every changed line. Closing a row changes its state cell, so the whole line
 * enters the diff, and a home path written into the row's evidence earlier blocks the close (#4028;
 * 25 such paths in 20 rows on main). The scanner says do not allowlist, so the row must lose the path.
 *
 * ⚠️ ONE SUBSTITUTION, NOTHING ELSE. Map every `/home/<user>` in the base cells to `~`; the result must
 * equal the branch cells exactly. The user name is the scanner's own pattern, and the name must end
 * there, so `/home/<user>/x` becomes `~/x` and a bare `cd /home/<user>` becomes `cd ~`. The bare form is
 * one the scanner misses (it needs the trailing slash) but the owner's ruling at board #649 does not.
 * Any other difference, in any cell, is still a mutation.
 *
 * @param {string} before  the row's non-state cells as they stand on the base
 * @param {string} after   the same cells on this branch
 */
export function isHomeRedaction(before, after) {
  const mapped = String(before).replace(/\/home\/[a-z_][a-z0-9_-]{0,31}(?![a-z0-9_-])/g, '~');
  return mapped !== String(before) && mapped === String(after);
}

/**
 * Pure core. Compares this branch's ledger against the base's.
 *
 * ⚠️ TWO POPULATIONS, DELIBERATELY, and conflating them makes the tool wrong in a way that
 * looks right. `baseText` is the MERGE BASE — what this branch actually started from — and it
 * is the only honest reference for "was a row removed or edited", because a branch that is
 * merely BEHIND has not removed anything. `tipText` is `origin/main` NOW, and it is the only
 * honest reference for "does this id collide", because that is where concurrent mints land.
 * Measured on this tool's own branch: comparing removals against the tip reported R11 as
 * deleted when the branch simply predated it. Behind is not deleted.
 *
 * @param {string} baseText  ledger at the merge base (removals / edits)
 * @param {string} headText  ledger on this branch
 * @param {string} [tipText] ledger at origin/main now (collisions / high-water); defaults to baseText
 * @returns {{collisions: string[], mutated: string[], added: string[], landed: string[]}}
 */
export function verdict(baseText, headText, tipText) {
  const base = parseRows(baseText);
  const head = parseRows(headText);
  const tip = parseRows(tipText == null ? baseText : tipText);
  const baseById = new Map(base.map((r) => [r.id, r]));
  const tipById = new Map(tip.map((r) => [r.id, r]));
  const headById = new Map(head.map((r) => [r.id, r]));
  const collisions = [];
  const mutated = [];
  const added = [];
  const landed = [];

  /* DUPLICATE IDS IN THE HEAD FILE ITSELF — checked FIRST, and independently of base/added.
     Measured 2026-09-14 (Osprey, #2506): `briefs/RESIDUE.md` carries `merge=union`, and a union
     driver cannot represent an EDIT — it keeps both sides' lines. Closing a row IS an edit (the
     contract closes a row by changing only its state cell), so a rebase over a concurrently-closed
     row yields the SAME key twice, once `OPEN` and once `fixed #NNNN`, contradicting each other
     about whether the defect is live.

     This tool reported `ok — 0 row(s) added, none colliding, none mutated` against exactly that
     tree, and the reason is structural rather than an oversight: `added` is empty when both copies
     already exist on the base, and the only uniqueness assertion below ran over `added` alone. The
     `Map(head.map(...))` lookups compound it — a Map silently keeps the last of a duplicated key,
     so every by-id comparison sees one row where the file has two.

     `docs-ledger` check8c does catch it, so it cannot LAND unnoticed. But this tool is the
     pre-push check whose name most suggests it would, and a checker that is blind exactly where a
     merge puts the damage is the failure class it exists to prevent. Scope: this detects the
     duplicate. Whether `merge=union` should stay is a real tradeoff (dropping it restores the
     per-PR conflicts it was added to kill) and is deliberately NOT decided here — #2506. */
  {
    const seenHead = new Set();
    for (const r of head) {
      if (seenHead.has(r.id)) collisions.push(`${r.id} — appears MORE THAN ONCE in the ledger (a union merge cannot represent a close; see #2506)`);
      seenHead.add(r.id);
    }
  }

  for (const r of head) {
    const prior = baseById.get(r.id);
    if (!prior) {
      /* 🔴 A GATE WHOSE BASE IS `origin/main` INVERTS WHEN YOUR OWN BRANCH MERGES. Present on the
         tip and absent from the merge base used to mean one thing — a concurrent mint — and it means
         two. The second is your own row, landed: Kodiak squashes, so the merge rewrites nothing you
         can recognise by commit. Measured 2026-10-21 on the two branches it fired on, four minutes
         and three minutes after their own merges (#3811 at ec13038d9, #3813 at 2425021d7): each run
         named the author's own key as "already used by another branch" and exited 1 at step 4 of 40,
         so 36 steps never ran and the top line named the wrong cause.

         The discriminator is the ROW, not the commit. `git merge-base --is-ancestor HEAD origin/main`
         answers NO for both measured cases — a squash merge leaves the branch head unreachable — so
         the obvious test would have changed neither. What does hold is that the tip's row and ours are
         the same row: identical in every non-state cell, which is the frozen identity this tool already
         compares for an edit. Two authors contending for one key write DIFFERENT defects and evidence,
         and that stays a collision (the control below, and the 704-row population measurement in #3814).
         A landed row is reported, never counted as a problem — the branch has nothing to rename. */
      if (tipById.has(r.id)) {
        if (tipById.get(r.id).key === r.key) {
          landed.push(`${r.id} — the identical row is already on origin/main (this branch’s own work has LANDED; nothing to rename)`);
          continue;
        }
        collisions.push(`${r.id} — already used on origin/main by another branch`);
        continue;
      }
      added.push(r.id);
      continue;
    }
    if (prior.key !== r.key && !isPointerRepair(prior.key, r.key, (k) => headById.has(k)) && !isHomeRedaction(prior.key, r.key))
      mutated.push(`${r.id} — a non-state cell was edited (rows are append-and-close)`);
  }
  for (const r of base) {
    if (!head.some((h) => h.id === r.id)) mutated.push(`${r.id} — removed from the ledger (rows are never deleted)`);
  }
  // added ids must be unique among themselves. There is deliberately NO ordering check: a date-slug
  // key carries no sequence, which is the whole reason it replaced the counter.
  const seen = new Set();
  for (const id of added) {
    if (seen.has(id)) collisions.push(`${id} — added twice on this branch`);
    seen.add(id);
  }
  /* Read over HEAD, not over `added`: a row the parser cannot see is absent from `added` by
     construction, which is exactly how the measured commit reported 0 rows added. */
  return { collisions, mutated, added, landed, unparsed: unparsedRows(headText) };
}

/* ── THE PICKUP HALF: the list a session sizes work from must come from the REF ───────────────────
   Row 2026-10-20-the-primary-checkouts-ledger-read-is-eleven-commits-stale. A session picks a unit by
   reading `briefs/RESIDUE.md` in the shared primary checkout. That file sits at branch `main`, which
   trails `origin/main` by hours, so a row closed this morning still reads OPEN and NOTHING in the
   output says the file is behind. Measured 2026-10-20 in `~/Tepna`: 13 commits behind, 86
   OPEN rows on disk against 79 on the ref, and 11 of those 86 were already closed.
   ⚠️ THE STALENESS IS IN THE FILE, NOT ONLY IN THE REF. `git rev-list --count main..origin/main` = 0
   does not mean the tree is current (CLAUDE.md §👥.2), and the reverse also holds: a non-zero count
   means the READ is stale, not merely the ref. So this half compares the ref against the bytes ON
   DISK, which is what a session actually read. */

/**
 * Pure. The OPEN rows of a ledger text, in file order.
 * @param {string} text
 * @returns {string[]} keys
 */
export function openKeys(text) {
  return parseRows(text)
    .filter((r) => r.state === 'OPEN')
    .map((r) => r.id);
}

/**
 * Pure. What a session reading the file on disk would get wrong about the ref.
 *
 * `differs` is the finding that matters: the same row, two states. `staleOpen` is the subset that
 * misleads a PICKUP — OPEN on disk, closed on the ref — because that is the one that costs a
 * claim on work someone already did. The other direction (`earlyClosed`) is rarer and matters
 * too: a session would skip a row that is still open.
 *
 * `onlyRef` are rows the disk copy cannot see at all, which is how a duplicate row gets logged
 * for a defect the ledger already tracks.
 *
 * @param {string} refText   ledger at the ref (authoritative)
 * @param {string} diskText  ledger as the session read it
 * @returns {{openOnRef: string[], openOnDisk: string[], differs: Array<{key: string, disk: string, ref: string}>,
 *            staleOpen: string[], earlyClosed: string[], onlyRef: string[], onlyDisk: string[], checked: number}}
 */
export function pickupDrift(refText, diskText) {
  const ref = parseRows(refText);
  const disk = parseRows(diskText);
  const diskById = new Map(disk.map((r) => [r.id, r]));
  const refById = new Map(ref.map((r) => [r.id, r]));
  const differs = [];
  const staleOpen = [];
  const earlyClosed = [];
  const onlyRef = [];
  for (const r of ref) {
    const d = diskById.get(r.id);
    if (!d) {
      onlyRef.push(r.id);
      continue;
    }
    if (d.state === r.state) continue;
    differs.push({ key: r.id, disk: d.state, ref: r.state });
    if (d.state === 'OPEN') staleOpen.push(r.id);
    else if (r.state === 'OPEN') earlyClosed.push(r.id);
  }
  /* A row only on DISK is not symmetric with one only on the ref: it is this branch's own
     unpushed work, which is normal. It is reported, never counted as drift. */
  const onlyDisk = disk.filter((r) => !refById.has(r.id)).map((r) => r.id);
  return {
    /* The pickup list comes from the REF, so an unreadable row THERE makes the list incomplete and
       nothing else in this object can say so. A malformed row on DISK is the branch's own and the
       diff half above reds it. */
    unparsed: unparsedRows(refText),
    checked: ref.length - onlyRef.length,
    openOnRef: ref.filter((r) => r.state === 'OPEN').map((r) => r.id),
    openOnDisk: disk.filter((r) => r.state === 'OPEN').map((r) => r.id),
    differs,
    staleOpen,
    earlyClosed,
    onlyRef,
    onlyDisk
  };
}

/* ── THE CODE READ ────────────────────────────────────────────────────────────────────────────────
   Row 2026-10-20-no-instrument-compares-a-residue-row-against-the-code-that-closes-it. `pickupDrift`
   compares the disk against the ref and never against the code, so a row whose fix has landed stays on
   the pickup list. `2026-10-06-zero-on-empty-dsp-helpers` read OPEN five hours after #3754 landed its
   last half, while the verdict read `staleOpen: 0`. A closure names a PR and stays a human act, so this
   read is a LEAD for a picker, never a close.

   The signal is the one a fixing PR leaves by convention: its message names the row's key. A commit
   counts when (1) its message names the key as a whole token, (2) it changed at least one path outside
   `briefs/` and `changes/`, because a ledger or changeset edit logs or annotates a row and is not code,
   and (3) it is not the commit that added the row, because a code PR that logs its own remainder row
   names that key without fixing it. Measured 2026-10-21 at origin/main: 26 of the 73 OPEN rows carry a
   lead. At ec918e9e3 the read names #3754 for the zero-on-empty row. */

/** The `git log` format `parseLog` reads: record separator, then sha, subject, full message, names. */
export const LOG_FORMAT = '%x1e%H%x1f%s%x1f%B%x1f';

/**
 * Pure. Parses `git log --format=LOG_FORMAT --name-only` output.
 * @param {string} text
 * @returns {Array<{sha: string, subject: string, message: string, files: string[]}>}
 */
export function parseLog(text) {
  const out = [];
  for (const rec of String(text || '')
    .split('\x1e')
    .slice(1)) {
    const parts = rec.split('\x1f');
    if (parts.length < 4) continue;
    const [sha, subject, message, names] = parts;
    out.push({
      sha: sha.trim(),
      subject,
      message,
      files: names
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean)
    });
  }
  return out;
}

/**
 * Pure. Maps each row key to the commit that ADDED its row, from `git log --format=%x1e%H -p
 * --unified=0 -- briefs/RESIDUE.md`. The log runs newest first, so a later record overwrites an
 * earlier one and the map ends at the OLDEST add. A row re-added by a revert keeps its first author.
 * @param {string} patchText
 * @returns {Map<string, string>}
 */
export function rowAddedBy(patchText) {
  const out = new Map();
  for (const rec of String(patchText || '')
    .split('\x1e')
    .slice(1)) {
    const sha = rec.slice(0, 40);
    for (const m of rec.matchAll(/^\+\| (\d{4}-\d\d-\d\d-[a-z0-9-]+) \|/gm)) out.set(m[1], sha);
  }
  return out;
}

/** Pure. True when the path is code and not a ledger, brief or changeset edit. */
export function isCodePath(f) {
  return !f.startsWith('briefs/') && !f.startsWith('changes/');
}

/**
 * Pure. True when `text` names `key` as a whole token. A bare `includes` would let
 * `2026-10-20-foo` match inside `2026-10-20-foo-bar`, which is a different row.
 */
export function namesKey(text, key) {
  const t = String(text || '');
  const tok = /[a-z0-9-]/;
  for (let i = t.indexOf(key); i >= 0; i = t.indexOf(key, i + 1)) {
    const before = i === 0 ? '' : t[i - 1];
    const after = t[i + key.length] || '';
    if (!tok.test(before) && !tok.test(after)) return true;
  }
  return false;
}

/** Pure. `#N` from a squash subject's `(#N)` suffix, else the short sha. */
export function prOf(subject, sha) {
  const m = /\(#(\d+)\)\s*$/.exec(String(subject || ''));
  return m ? `#${m[1]}` : String(sha).slice(0, 9);
}

/**
 * Pure. Every residue key a row's cells NAME, less the row's own id and less a changeset filename.
 *
 * `changes/<key>.md` is a key-shaped slug, not a pointer to a row: measured 2026-10-26 over the ref,
 * 6 such tokens across 2 rows, and NEITHER slug names a row at all, because a release consumes the
 * changeset. The suite's check8h already excludes that shape, so this read now agrees with it.
 *
 * @param {string} text  the row's cells, joined
 * @param {string} selfId  the row's own key
 * @returns {Set<string>} the distinct keys the row names
 */
export function namedKeys(text, selfId) {
  const src = String(text ?? '');
  const out = new Set();
  const re = new RegExp(KEY, 'g');
  for (let m; (m = re.exec(src)); ) {
    // the row's own id opens its first cell, and a row does not cite itself
    if (m[0] === selfId) continue;
    // `changes/<key>.md` is a key-shaped FILENAME; the suite's check8h excludes the same shape
    if (src.slice(m.index + m[0].length, m.index + m[0].length + 3) === '.md') continue;
    out.add(m[0]);
  }
  return out;
}

/**
 * The correction verbs, stated here because the ledger states them NOWHERE — the convention lives in
 * how sessions write a correcting row, so this set is a floor on the corrections and never a census
 * (row 2026-10-26-a-correcting-row-leaves-no-mark-on-the-row-it-corrects says so in its own cells).
 * `withdrawn` is in the set although the state vocabulary carries it too: a row may withdraw another
 * in its prose without the target's state cell naming it back, which is exactly the one-sided form.
 */
export const CORRECTION_VERBS = /\b(CORRECTS|corrects|correcting|corrected|withdraws|withdrawn|supersedes|replaces)\b/;

/**
 * Pure. THE LEDGER-INTERNAL READ: which rows CITE an open key inside their own cells.
 *
 * `namedByCode` reads the log, so it finds a row whose answer landed as CODE. It cannot see the
 * other half, measured 2026-10-25 over the 17 OPEN `capture-host`-sourced rows: four of them keep
 * their box measurement inside `2026-10-12-six-undecidable-rows-get-their-box-measurement`, a row
 * that itself reads `answered #3466`, so a picker scanning for OPEN rows never reaches it. The
 * mechanism is the ledger's own rule — a measurement may enter the row it is about only when it
 * moves that row's state, and every other measurement becomes a NEW row.
 *
 * Each entry carries the citing row's FAN-OUT, the number of rows it names in all, because breadth
 * predicts whether the citation carries anything: measured 2026-10-26 over the ref, a one-to-one
 * citer carried something 9 times in 9, and a citer naming three or more carried something once in 5
 * (that arm rests on one distinct carrier, so it orders a read and settles nothing).
 *
 * A citing row's STATE says nothing about whether it holds the answer, so both states are reported
 * and neither is a verdict. This is a reading order, exactly like a code lead.
 *
 * Each entry also carries its KIND, because a correction and a mention read the same way otherwise
 * (row 2026-10-26-a-correcting-row-leaves-no-mark-on-the-row-it-corrects). `kind` is one of:
 *
 *   `citation`                   — the citing row carries no correction verb.
 *   `correction`                 — a verb, and the citing row names exactly ONE existing row, so the
 *                                  verb can only be about that row.
 *   `correction-unattributable`  — a verb, and the citing row names SEVERAL existing rows, so which
 *                                  one the verb is about is not decidable from the cells. §∅: an
 *                                  unattributable kind is reported as unattributable, never promoted
 *                                  to `correction` and never silently dropped to `citation`.
 *
 * The split is not a nicety. Measured 2026-10-26 over the ref at 854 rows: 260 rows name another
 * existing row, 37 of those carry a verb, giving 40 one-sided pairs over 34 distinct targets — and
 * 16 of those 40 come from 7 citers that name several rows each. Over the OPEN targets the ratio
 * inverts: 1 pair is attributable and 4 are not, and 3 of those 4 come from the asking row itself,
 * which names four rows as INSTANCES of the pattern rather than as corrections. A row-level verb
 * test would have published that row as the corrector of three rows it only cites.
 *
 * Attribution counts the existing ROWS a citer names, while `fanOut` counts every key-shaped token
 * it names. The two differ on a dangling key: naming one real row beside a key that resolves to no
 * row leaves the verb attributable, because there is still only one row it can be about.
 *
 * @param {string[]} keys  the OPEN keys to look up
 * @param {ReturnType<typeof parseRows>} rows  every row at the ref
 * @returns {Map<string, Array<{id: string, state: string, fanOut: number, kind: string}>>}
 */
export function citedBy(keys, rows) {
  const want = new Set(keys);
  const ids = new Set(rows.map((r) => r.id));
  /** @type {Map<string, Array<{id: string, state: string, fanOut: number, kind: string}>>} */
  const out = new Map();
  for (const r of rows) {
    // fan-out belongs to the CITING row, so it counts every key that row names, not the asked-for ones
    const named = namedKeys(r.key, r.id);
    // attribution needs the rows a citer names; a key that resolves to no row cannot take a verb
    let namedRows = 0;
    for (const k of named) if (ids.has(k)) namedRows++;
    const kind = !CORRECTION_VERBS.test(r.key) ? 'citation' : namedRows === 1 ? 'correction' : 'correction-unattributable';
    for (const k of named) {
      if (!want.has(k)) continue;
      if (!out.has(k)) out.set(k, []);
      const list = out.get(k);
      if (!list.some((e) => e.id === r.id)) list.push({ id: r.id, state: r.state, fanOut: named.size, kind });
    }
  }
  return out;
}

/**
 * Pure. Counts the asked-for keys whose citation list holds at least one entry of `kind`.
 * @param {ReturnType<typeof citedBy>} cites
 * @param {string} kind
 */
export function keysWithKind(cites, kind) {
  let n = 0;
  for (const list of cites.values()) if (list.some((e) => e.kind === kind)) n++;
  return n;
}

/**
 * Pure. The leads: each key a later code commit names, with the PRs that name it.
 * @param {string[]} keys      the OPEN rows at the ref
 * @param {ReturnType<typeof parseLog>} commits
 * @param {Map<string, string>} addedBy
 * @returns {Map<string, string[]>} key → PR numbers (or short shas), newest first; keys with no lead are absent
 */
export function namedByCode(keys, commits, addedBy) {
  const out = new Map();
  for (const k of keys) {
    const hits = commits.filter((c) => c.sha !== addedBy.get(k) && c.files.some(isCodePath) && namesKey(c.message, k)).map((c) => prOf(c.subject, c.sha));
    if (hits.length) out.set(k, hits);
  }
  return out;
}

/**
 * The `withdrawn <key>` STATE cell. It is the ledger's only CORROBORATED backward pointer: the
 * suite's check8i holds a withdrawal valid only while the row it names says so in its own cells.
 */
export const WITHDRAWAL_STATE = /^withdrawn\s+(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)$/;

/**
 * Pure. THE MIRROR OF THE CITING READ: which OPEN keys are the ARGUMENT of a `withdrawn <key>`
 * state, which means the row's own withdrawal has already LANDED.
 *
 * Row 2026-09-11-withdrawn-rows-cannot-close bought a terminal state for the row that GETS
 * withdrawn, and row 2026-10-26-a-correcting-row-leaves-no-mark-on-the-row-it-corrects bought the
 * corrected row a `CORRECTION` mark. Both read in one direction. The CORRECTOR got neither. It
 * states a defect that is not a defect, so no fix can ever close it, and the pickup list offers it
 * with the same blank line as a row nobody has touched.
 *
 * Measured 2026-11-11 at `origin/main` `d6ee5bc70`: 3 of the 33 OPEN rows are the argument of a
 * `withdrawn` state, over 32 rows carrying that state, and `--open` marked none of the three.
 *
 * THIS IS THE ONE CORRECTION READ THAT NEEDS NO JUDGMENT. A verb in prose is a convention, which
 * is why `citedBy` publishes an unattributable verb as unattributable. A state cell is written to
 * a closed vocabulary and held by a gate, so a mark here is a fact about the ledger.
 *
 * ⚠️ IT IS STILL NOT A CLOSE. The vocabulary holds no state for a discharged corrector, so the row
 * stays OPEN until a RESIDUE-only PR gives it one. The mark tells a picker not to size it.
 *
 * @param {string[]} keys  the OPEN keys to look up
 * @param {ReturnType<typeof parseRows>} rows  every row at the ref
 * @returns {Map<string, string[]>}  an open key, and the ids of the rows whose state withdraws to it
 */
export function withdrawalLanded(keys, rows) {
  const want = new Set(keys);
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const r of rows) {
    const m = WITHDRAWAL_STATE.exec(String(r.state ?? '').trim());
    if (!m || !want.has(m[1])) continue;
    if (!out.has(m[1])) out.set(m[1], []);
    const list = out.get(m[1]);
    if (!list.includes(r.id)) list.push(r.id);
  }
  return out;
}

/**
 * THE PHRASES A ROW USES TO SAY THE REMEDY IS NOT A CODER'S TO TAKE. Each entry carries its own
 * `sample`, so a phrase cannot be declared without a witness and a regex that stops matching reds
 * in the selftest rather than quietly reading 0.
 *
 * ⚠️ THIS IS A CONVENTION IN PROSE, NEVER A STATE. `withdrawalLanded` above reads a cell written to
 * a closed vocabulary and held by a gate, so its mark is a fact about the ledger. A sentence is a
 * habit: a row may reserve the remedy in words nobody has used yet, and another may name the owner
 * about something else. So this mark publishes itself as a LEAD, and its cost is asymmetric in the
 * right direction — a wrong mark costs a picker one read of the cell, while an absent mark costs the
 * whole search that sizes a row no coder can discharge.
 */
export const OWNER_RESERVED_PHRASES = [
  { name: 'remedy-is-the-owners', re: /\bremedy is the owner'?s\b/i, sample: "the remedy is the owner's: he must enable the unit" },
  { name: 'the-owners-call', re: /\bthe owner'?s call\b/i, sample: "re-enabling it is the owner's call" },
  { name: 'choice-is-the-owners', re: /\bchoice is the owner'?s\b/i, sample: "that choice is the owner's" },
  { name: 'owner-authorized', re: /\bowner[- ]authoriz(?:ed|ation)\b/i, sample: 'a manual deploy is owner-authorized only' },
  { name: 'the-owner-holds', re: /\bthe owner holds\b/i, sample: 'the owner holds the term list' },
  { name: 'reserves-for-the-owner', re: /\breserv(?:es|ed)\b[^.|]{0,40}\bfor the owner\b/i, sample: 'this reserves the install for the owner' },
  { name: 'needs-the-owner', re: /\bneeds? the owner'?s\b/i, sample: "it needs the owner's word before anything runs" },
  { name: 'only-the-owner', re: /\bonly the owner\b/i, sample: 'only the owner can add a required context' }
];

/**
 * Pure. Which OPEN keys say in their OWN cells that the remedy belongs to the owner.
 *
 * A coder who picks such a row pays the whole sizing cost — the search, the cell reads, the lead
 * PRs — and then stops, because the step that would discharge it is a deploy, a daemon restart, a
 * timer install, a branch-protection change or a secret list. Measured 2026-11-11 at `origin/main`
 * `d968f6660`: 33 of the 1387 rows carry one of these phrases and 5 of the 36 OPEN rows do, and
 * `--open` marked none of the five. I had read three of those five by hand the same hour.
 *
 * THE TEXT READ IS THE FROZEN IDENTITY (`parseRows` builds it), which is the key, logged, source,
 * defect and evidence cells. CONTROL, same measurement: reading the two prose cells alone through
 * `splitRowCells` returns the SAME 33 rows and the SAME 5 OPEN ids, so the three leading cells add
 * no hit today. A phrase anywhere in a row's identity reserves that row, and that is deliberate.
 *
 * ⚠️ IT IS A LEAD AND NEVER A CLOSE. The row keeps its work; the remedy sits with one person. So the
 * count is PUBLISHED beside the open list and never subtracted from it.
 *
 * @param {string[]} keys  the OPEN keys to look up
 * @param {ReturnType<typeof parseRows>} rows  every row at the ref
 * @returns {Map<string, string[]>}  an open key, and the names of the phrases its own cells carry
 */
export function ownerReserved(keys, rows) {
  const want = new Set(keys);
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const r of rows) {
    if (!want.has(r.id)) continue;
    const hits = OWNER_RESERVED_PHRASES.filter((p) => p.re.test(r.key)).map((p) => p.name);
    if (hits.length) out.set(r.id, hits);
  }
  return out;
}

/**
 * Pure. The `tepna.verdict/1` for a pickup read. The criterion is pre-stated in the brief-free
 * form the row asked for: a read a session may size work from carries ZERO rows whose state
 * differs from the ref, and zero rows the ref holds and the read does not.
 *
 * `eligible` is the ref's row count — the population the ref enumerates. `checked` are the rows
 * present in BOTH, which is the only set a comparison can speak about; `excluded` are the rows
 * the read cannot see (`onlyRef`), and they are named in the reason rather than silently dropped.
 *
 * @param {ReturnType<typeof pickupDrift>} drift
 * @param {{behind: number|null, base: string, commit: string|null}} ctx
 */
export function pickupVerdict(drift, ctx) {
  const stale = drift.differs.length + drift.onlyRef.length;
  /* A row the reader cannot parse is not drift, and it fails the gate all the same: the list this
     verdict vouches for does not contain it. */
  const unreadable = (drift.unparsed || []).length;
  const v = Verdict.make({
    gate: 'residue-pickup',
    status: stale === 0 && unreadable === 0 ? 'PASS' : 'FAIL',
    population: { checked: drift.checked, eligible: drift.checked + drift.onlyRef.length, excluded: drift.onlyRef.length },
    criterion: { name: 'stale_row_states', threshold: 0, unit: 'rows', direction: 'lte' },
    result: {
      differs: drift.differs.length,
      staleOpen: drift.staleOpen.length,
      earlyClosed: drift.earlyClosed.length,
      onlyRef: drift.onlyRef.length,
      onlyDisk: drift.onlyDisk.length,
      openOnRef: drift.openOnRef.length,
      openOnDisk: drift.openOnDisk.length,
      /* Informational, never part of the status: a lead is not a close. `null` when the code read
         did not run (the verdict sample, or a git log this tree could not read). */
      openNamedByCode: Number.isInteger(ctx.namedByCode) ? ctx.namedByCode : null,
      /* Informational in the same way, and NOT gated on git: the citing read is pure, so this
         counts OPEN rows that another ROW names, whatever that row's own state says. */
      openCitedByRow: Number.isInteger(ctx.citedBy) ? ctx.citedBy : null,
      /* The KIND split, informational on the same terms. A correction is a citation whose verb is
         attributable to one row; the unattributable arm is published rather than folded into either
         side, because which row the verb was about is not decidable from the cells. */
      /* These two OVERLAP by construction — a row cited by several others can hold an attributable
         correction and an unattributable one at once — so they never sum to `openCitedByRow`. */
      openCorrectedByRow: Number.isInteger(ctx.correctedBy) ? ctx.correctedBy : null,
      openCorrectionUnattributable: Number.isInteger(ctx.correctionUnattributable) ? ctx.correctionUnattributable : null,
      /* Informational, and NOT gated on git or on a citing read: the pin is read from this tool's
         own declared list, so it counts whatever the open set holds. A pinned row cannot be closed
         without reding the check that names it, which is the one lead a picker must not chase. */
      /* `ctx.pins` OVERRIDES THE SHIPPED MAP, for the selftest only. The pinned list empties the day
         the last `PUBLISHED_FIELD_GAP` entry closes, and a leg that can only count a SHIPPED pin
         stops examining anything at that moment while printing the same green. The legs plant a map
         here; the default stays this tool's own declared list. */
      openPinnedByCheck: drift.openOnRef.filter((k) => (ctx.pins instanceof Map ? ctx.pins : PINNED_BY_ROW).has(k)).length,
      /* Informational on the same terms, and pure like the citing read. An OPEN row named by a
         `withdrawn <key>` state has had its correction discharged, so it holds no work — and it has
         no reachable closing state either, which is why the count is PUBLISHED here rather than
         subtracted from `openOnRef`. A reader that quietly shortened the open list would hide a row
         the ledger still carries. */
      openWithdrawalLanded: Number.isInteger(ctx.withdrawalLanded) ? ctx.withdrawalLanded : null,
      /* Informational on the same terms, and the ONLY one of these counts read from PROSE. It names
         the rows whose own cells reserve the remedy for the owner, so a picker spends no search on
         them. A convention cannot gate anything, which is why it is published and never subtracted
         from `openOnRef`. */
      openOwnerReserved: Number.isInteger(ctx.ownerReserved) ? ctx.ownerReserved : null,
      /* Part of the status, unlike every informational count above it. */
      unparsed: unreadable,
      behindCommits: ctx.behind,
      base: ctx.base
    },
    evidence: [LEDGER_PATH, 'tools/residue-ids.mjs'],
    reason:
      [
        stale === 0
          ? null
          : `the read is stale: ${drift.differs.length} row(s) differ (${drift.staleOpen.length} read OPEN and are closed on ${ctx.base}), and ${drift.onlyRef.length} row(s) exist only on ${ctx.base}`,
        unreadable === 0 ? null : `${unreadable} row(s) on ${ctx.base} attempt a key this reader cannot parse, so the list above does not contain them`
      ]
        .filter(Boolean)
        .join('; ') || null,
    producedBy: { tool: 'tools/residue-ids.mjs', commit: ctx.commit }
  });
  const ck = Verdict.validate(v);
  if (!ck.ok) throw new Error(`pickup verdict invalid: ${ck.errors.join('; ')}`);
  return v;
}

/* ── WHAT A RUN ACTUALLY COMPARED ────────────────────────────────────────────────────────────────
   Both texts the default mode reads come from `git show`, so a run made BEFORE the commit compares
   two COMMITTED copies and says nothing about the rows sitting in the working copy. It then prints
   `ok — 0 row(s) added` in the vocabulary of a pass. Measured 2026-11-09 (row
   2026-11-09-a-bare-residue-ids-run-before-the-commit-examines-nothing, #4719): one branch printed
   `ok — 0 row(s) added` before its commit and `ok — 1 row(s) added` at that commit, and neither
   line named a commit, so the empty comparison stayed invisible to its reader.

   This is the pure half. It takes the two texts and says what the comparison left out; the git half
   is `describeComparison` below. A state cell edited in the working copy is NOT a new key, so the
   two populations are counted apart — a reader who saw only a key count would read an uncommitted
   CLOSE as nothing at all. An unread working copy reports that it was unread, never agreement. */
export function worktreeFacts(headText, diskText) {
  const none = { read: false, differs: false, newKeys: [], changedKeys: [], removedKeys: [] };
  if (diskText == null || headText == null) return none;
  if (diskText === headText) return { ...none, read: true };
  const ident = (r) => `${r.key}\u0000${r.state}`;
  const head = new Map(parseRows(headText).map((r) => [r.id, ident(r)]));
  const disk = new Map(parseRows(diskText).map((r) => [r.id, ident(r)]));
  return {
    read: true,
    differs: true,
    newKeys: [...disk.keys()].filter((id) => !head.has(id)),
    changedKeys: [...disk.keys()].filter((id) => head.has(id) && head.get(id) !== disk.get(id)),
    removedKeys: [...head.keys()].filter((id) => !disk.has(id))
  };
}

/* ── THE POINTER READ ───────────────────────────────────────────────────────────────────────────
   Row 2026-11-08-a-residue-pointer-outlived-the-file-it-cites. A row's evidence cell points at
   `path:line`, the file moves, and the pointer keeps its old number. Measured 2026-11-11 over
   `origin/main`: 33 citations on the 50 OPEN rows, of which 18 still sit on the cited line, 10
   moved, 3 anchor nothing, 1 points past the end of its file and 1 names no tracked path. So a
   session picking a row up reads a wrong line in 15 of 33 cases, and nothing in the list said so.
   Over the WHOLE ledger the census reads 901 citations with 560 moved, which is the same defect at
   the scale no pickup reader pays for.

   ⚠️ THIS READ ASKS THE CHEAP QUESTIONS ONLY, AND IT NAMES THE ONE IT SKIPPED. A cited path that no
   tracked file carries scores `unresolved` here. The census splits that case into `missing-file` and
   `off-tree`, and the split costs a `git log --all` per path. It also changes nothing a session does
   next, because both answers say "read the row, not the pointer". So this reader states the question
   it did not ask instead of borrowing a class it never earned.

   A verdict this reader cannot place lands in `unclassified` and is PRINTED. A fifth class folded
   into one of the four would read as a measurement of something nobody judged. */
export function rowPointerState(rowText, reader, isTracked = null) {
  const ids = identifiers(rowText);
  const st = { cites: 0, anchored: 0, moved: 0, unanchored: 0, beyondEof: 0, unresolved: 0, unclassified: 0, detail: [] };
  for (const c of citations(rowText, isTracked)) {
    st.cites += 1;
    const lines = reader(c.path);
    if (lines === null) {
      st.unresolved += 1;
      st.detail.push({ path: c.path, line: c.line, verdict: 'unresolved' });
      continue;
    }
    const j = judge(c, lines, ids);
    if (j.verdict === 'anchored') {
      st.anchored += 1;
    } else if (j.verdict === 'moved') {
      /* The hint is the FIRST line carrying one of the row's own identifiers, which is a lead and
         never a proof that the cited line is the one that moved there. */
      const first = Object.values(j.now || {})[0];
      st.moved += 1;
      st.detail.push({ path: c.path, line: c.line, verdict: 'moved', now: Array.isArray(first) ? first[0] : null });
    } else if (j.verdict === 'beyond-eof') {
      st.beyondEof += 1;
      st.detail.push({ path: c.path, line: c.line, verdict: 'beyond-eof', length: j.length ?? null });
    } else if (j.verdict === 'unanchored') {
      st.unanchored += 1;
      st.detail.push({ path: c.path, line: c.line, verdict: 'unanchored' });
    } else {
      st.unclassified += 1;
      st.detail.push({ path: c.path, line: c.line, verdict: String(j.verdict) });
    }
  }
  return st;
}

/* The row's own annotation. A row whose every pointer still anchors gets NO note, so the list stays
   readable, and the summary states what that silence covers. */
export function pointerNote(st) {
  if (!st || st.cites === 0) return '';
  const drifted = st.moved + st.unanchored + st.beyondEof + st.unresolved + st.unclassified;
  if (drifted === 0) return '';
  const parts = [];
  if (st.moved) parts.push(`${st.moved} moved`);
  if (st.unanchored) parts.push(`${st.unanchored} anchoring nothing`);
  if (st.beyondEof) parts.push(`${st.beyondEof} past end of file`);
  if (st.unresolved) parts.push(`${st.unresolved} at no tracked path`);
  if (st.unclassified) parts.push(`${st.unclassified} unclassified`);
  const hint = st.detail.find((d) => d.verdict === 'moved' && d.now);
  const eg = hint ? ` (e.g. ${hint.path}:${hint.line} — an identifier of this row now sits at :${hint.now})` : '';
  return `  ← pointer: ${drifted} of ${st.cites} cite(s) drifted — ${parts.join(', ')}${eg}`;
}

/* The compact form, for a row named INSIDE another row's lead. It states the count and nothing else,
   because the lead already carries that row's key and a reader opens it next. */
export function pointerTag(st) {
  if (!st || st.cites === 0) return '';
  const drifted = st.moved + st.unanchored + st.beyondEof + st.unresolved + st.unclassified;
  return drifted === 0 ? '' : `, pointer: ${drifted} of ${st.cites} drifted`;
}

/* The population. A count of drifted rows means nothing without the rows that cite nothing at all:
   those carry no annotation for a reason no reader can see from a blank line. */
export function pointerTotals(states) {
  const t = { rows: 0, citing: 0, drifted: 0, cites: 0, anchored: 0, moved: 0, unanchored: 0, beyondEof: 0, unresolved: 0, unclassified: 0 };
  for (const st of states instanceof Map ? states.values() : states || []) {
    t.rows += 1;
    if (!st || st.cites === 0) continue;
    t.citing += 1;
    for (const f of ['cites', 'anchored', 'moved', 'unanchored', 'beyondEof', 'unresolved', 'unclassified']) t[f] += st[f];
    if (st.cites > st.anchored) t.drifted += 1;
  }
  return t;
}

/* ── everything below is I/O; the core above is pure and is what the suite drives ── */

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/* THE CHEAP RESOLVER. The judged tree's tracked set is read ONCE, so a path no spelling matches
   costs no git call at all. `trySpellings` is the census's own list and the unique-tail arm is its
   `tailReader` rule — the same two steps, in memory. Measured 2026-11-11 over the 50 OPEN rows at
   `origin/main`: 33 citations, 20 distinct resolved paths, 21 git calls and 11 MB of text held. */
function pointerReader(ref) {
  const tracked = git(['ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean);
  const trackedSet = new Set(tracked);
  const lines = new Map();
  const resolve = (p) => {
    for (const cand of trySpellings(p)) if (trackedSet.has(cand)) return cand;
    const tails = suffixCandidates(p, tracked);
    return tails.length === 1 ? tails[0] : null;
  };
  const reader = (p) => {
    if (!lines.has(p)) {
      const at = resolve(p);
      let got = null;
      if (at !== null) {
        try {
          got = toLines(git(['show', `${ref}:${at}`]));
        } catch {
          got = null;
        }
      }
      lines.set(p, got);
    }
    return lines.get(p);
  };
  return { reader, isTracked: (p) => trackedSet.has(p) };
}

function refuse(msg, detail) {
  process.stderr.write(`residue-ids: REFUSING — ${msg}\n`);
  for (const d of detail) process.stderr.write(`  ${d}\n`);
  process.exit(2);
}

function readAt(ref) {
  try {
    return git(['show', `${ref}:${LEDGER_PATH}`]);
  } catch {
    return null;
  }
}

function shortSha(ref) {
  try {
    return git(['rev-parse', '--short=9', ref]).trim();
  } catch {
    return null;
  }
}

/* The git half of `worktreeFacts`: it names the two commits this run compared, and reads the ledger
   on disk so the run can say what it left out. */
function describeComparison(baseRef, mergeBase, headText) {
  let diskText = null;
  try {
    diskText = readFileSync(path.join(git(['rev-parse', '--show-toplevel']).trim(), LEDGER_PATH), 'utf8');
  } catch {
    diskText = null;
  }
  return { baseRef, baseCommit: shortSha(mergeBase), headCommit: shortSha('HEAD'), worktree: worktreeFacts(headText, diskText) };
}

/* Printed in BOTH outcomes, like a landed row: the reason a count can read 0 is the one thing its
   reader cannot otherwise see. */
function reportComparison(c) {
  const head = c.headCommit ? `${c.headCommit} (HEAD)` : 'HEAD (unresolved)';
  const base = c.baseCommit ? `${c.baseCommit} (merge-base with ${c.baseRef})` : `${c.baseRef} (unresolved)`;
  process.stderr.write(`  · compared ${LEDGER_PATH} at ${base} against ${head}\n`);
  const w = c.worktree;
  if (!w.read) {
    process.stderr.write(`  ⚠ this run could not read ${LEDGER_PATH} on disk, so it cannot say what your working copy holds\n`);
    return;
  }
  if (!w.differs) return;
  process.stderr.write(
    `  ⚠ the working copy differs from ${head}: ${w.newKeys.length} new key(s), ${w.changedKeys.length} changed row(s) and ${w.removedKeys.length} removed row(s) sit OUTSIDE this comparison\n`
  );
  for (const k of [...w.newKeys, ...w.changedKeys].slice(0, 5)) process.stderr.write(`      ${k}\n`);
  process.stderr.write('    This run read two commits. Commit the ledger and run it again — the count above is about HEAD, never about an uncommitted edit.\n');
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const bi = argv.indexOf('--base');
  const base = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : 'origin/main';

  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    refuse('shallow clone, the base ledger is not present.', [
      'A comparison against a base it cannot read would report 0 collisions because it sees 0 rows —',
      'the exact blindness this guard exists to close. Set `fetch-depth: 0` on actions/checkout.'
    ]);
  }

  /* ── THE PICKUP READ ───────────────────────────────────────────────────────────────────────────
     The list comes from the REF, always, so the output cannot be stale. The drift block says what
     the file on disk would have told you instead. */
  if (argv.includes('--open')) {
    const sample = argv.includes('--verdict-sample');
    const refText = readAt(base);
    if (refText === null) {
      /* `--verdict-sample` is the adoption gate's shape probe and must print a valid object even
         where the ref is absent. NOT_RUN examined nothing, so its result is null. An operator run
         still REFUSES: a pickup list it cannot vouch for is the defect this mode closes. */
      if (sample) {
        const v = Verdict.make({
          gate: 'residue-pickup',
          status: 'NOT_RUN',
          population: { checked: 0, eligible: 0, excluded: 0 },
          criterion: { name: 'stale_row_states', threshold: 0, unit: 'rows', direction: 'lte' },
          result: null,
          evidence: [LEDGER_PATH, 'tools/residue-ids.mjs'],
          reason: `\`${LEDGER_PATH}\` is not readable at \`${base}\`, so no read was compared`,
          producedBy: { tool: 'tools/residue-ids.mjs', commit: null, commitReason: 'no ref to resolve' }
        });
        process.stdout.write(`${JSON.stringify(v)}\n`);
        process.exit(0);
      }
      refuse(`\`${LEDGER_PATH}\` is not readable at \`${base}\`.`, ['The pickup list must come from the ref. Fetch it (`git fetch origin main`) or pass --base <ref>.']);
    }
    let diskText = '';
    let top = '';
    try {
      top = git(['rev-parse', '--show-toplevel']).trim();
      diskText = readFileSync(`${top}/${LEDGER_PATH}`, 'utf8');
    } catch {
      refuse(`\`${LEDGER_PATH}\` is not readable on disk under \`${top || 'the working tree'}\`.`, ['This mode reports what a session READ, so it needs the bytes on disk, not a commit.']);
    }
    let behind = null;
    try {
      behind = Number(git(['rev-list', '--count', `HEAD..${base}`]).trim());
      if (!Number.isFinite(behind)) behind = null;
    } catch {
      behind = null;
    }
    let commit = null;
    try {
      commit = git(['rev-parse', '--short=9', 'HEAD']).trim() || null;
    } catch {
      commit = null;
    }
    const drift = pickupDrift(refText, diskText);
    /* THE LEDGER-INTERNAL READ. Pure, so it runs in every mode: a row's answer may sit in another
       row, and that row's own state cell may already read closed. */
    const refRows = parseRows(refText);
    const cites = citedBy(drift.openOnRef, refRows);
    /* Pure in the same way, so it runs in every mode: the state cell sits in the text already read. */
    const landed = withdrawalLanded(drift.openOnRef, refRows);
    const reserved = ownerReserved(drift.openOnRef, refRows);
    /* THE CODE READ. Bounded by the oldest OPEN key's date, less one day for the zone: a commit cannot
       name a key before the day it was coined. A git failure leaves `leads` null and says so. */
    let leads = null;
    if (!sample) {
      try {
        const dates = drift.openOnRef.map((k) => k.slice(0, 10)).sort();
        if (dates.length === 0) leads = new Map();
        else {
          const since = `--since=${new Date(Date.parse(dates[0]) - 86400000).toISOString().slice(0, 10)}`;
          const big = { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 };
          const commits = parseLog(execFileSync('git', ['log', base, `--format=${LOG_FORMAT}`, '--name-only', since], big));
          const addedBy = rowAddedBy(execFileSync('git', ['log', base, '--format=%x1e%H', '-p', '--unified=0', since, '--', LEDGER_PATH], big));
          leads = namedByCode(drift.openOnRef, commits, addedBy);
        }
      } catch {
        leads = null;
      }
    }
    /* THE POINTER READ. Off under `--verdict-sample`, which is the shape probe, and null on a git
       failure so the output says the read did not run rather than reporting clean pointers. */
    let pointers = null;
    if (!sample) {
      try {
        const pr = pointerReader(base);
        const textOf = new Map(refRows.map((r) => [r.id, r.key]));
        pointers = new Map();
        for (const k of drift.openOnRef) {
          const text = textOf.get(k);
          if (text === undefined) continue;
          pointers.set(k, rowPointerState(text, pr.reader, pr.isTracked));
        }
        /* THE ROWS A LEAD SENDS A READER TO ARE JUDGED TOO. The paragraph below tells a session to
           open every citing row, including the ones that already read closed — and the defect this
           read answers was FOUND as a pointer inside a closed row (`oxydex-profile.js:694` in row
           2026-10-12-cohort-worker-oxy-realm-lacks-the-escaper). An OPEN-only read would skip that
           whole class.
           ⚠️ IT STILL REACHES ONLY THE ROWS THIS READER PRINTS. Measured 2026-11-11 at `origin/main`:
           50 open rows plus 15 lead rows, which is 65 of 1380. The escaper row above is neither, so
           the whole-ledger answer stays with `tools/residue-cite-drift.mjs --strict`. */
        for (const e of [...cites.values()].flat()) {
          if (pointers.has(e.id)) continue;
          const text = textOf.get(e.id);
          if (text !== undefined) pointers.set(e.id, rowPointerState(text, pr.reader, pr.isTracked));
        }
      } catch {
        pointers = null;
      }
    }
    /* TWO POPULATIONS, NEVER ONE SUM. The OPEN rows are the pickup list; the lead rows are rows a
       reader opens next and are mostly closed, so a single total would report the list as longer than
       it is. */
    const openSet = new Set(drift.openOnRef);
    const leadIds = pointers === null ? [] : [...new Set([...cites.values()].flat().map((e) => e.id))].filter((id) => !openSet.has(id) && pointers.has(id));
    const openTotals = pointers === null ? null : pointerTotals(drift.openOnRef.map((k) => pointers.get(k)).filter(Boolean));
    const leadTotals = pointers === null ? null : pointerTotals(leadIds.map((id) => pointers.get(id)));
    const corrected = keysWithKind(cites, 'correction');
    const unattributable = keysWithKind(cites, 'correction-unattributable');
    const v = pickupVerdict(drift, {
      behind,
      base,
      commit,
      namedByCode: leads === null ? null : leads.size,
      citedBy: cites.size,
      correctedBy: corrected,
      correctionUnattributable: unattributable,
      withdrawalLanded: landed.size,
      ownerReserved: reserved.size
    });
    if (sample) {
      process.stdout.write(`${JSON.stringify(v)}\n`);
      process.exit(0);
    }
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            verdict: v,
            ...drift,
            namedByCode: leads === null ? null : Object.fromEntries(leads),
            citedBy: Object.fromEntries(cites),
            withdrawalLanded: Object.fromEntries(landed),
            ownerReserved: Object.fromEntries(reserved),
            pointerState: pointers === null ? null : Object.fromEntries(pointers),
            pointerTotals: pointers === null ? null : { open: openTotals, cited: leadTotals }
          },
          null,
          2
        )}\n`
      );
      process.exit(v.status === 'PASS' ? 0 : 1);
    }
    /* FIRST, and on stderr: the count on the next line is a count of rows the reader could read, so
       a row it could not read has to be said before the number, not after it. */
    for (const u of drift.unparsed)
      process.stderr.write(`residue-pickup: ✗ ${LEDGER_PATH}:${u.line} at ${base} — \`${u.cell}\` attempts a residue key this reader cannot parse, so the list below LEAVES IT OUT\n`);
    process.stdout.write(`residue-pickup: ${drift.openOnRef.length} OPEN row(s) at ${base}${behind === null ? '' : ` (this tree is ${behind} commit(s) behind it)`}\n`);
    for (const k of drift.openOnRef)
      process.stdout.write(
        `  ${k}${leads?.has(k) ? `  ← named by code: ${leads.get(k).join(', ')}` : ''}` +
          `${PINNED_BY_ROW.has(k) ? `  ← PINNED OPEN by ${PINNED_BY_ROW.get(k).by}: ${PINNED_BY_ROW.get(k).why}` : ''}` +
          `${landed.has(k) ? `  ← WITHDRAWAL LANDED: ${landed.get(k).join(', ')} reads \`withdrawn ${k}\`, so this row's correction is discharged and holds no work` : ''}` +
          `${reserved.has(k) ? `  ← OWNER-RESERVED (prose): ${reserved.get(k).join(', ')} — this row's own cells reserve the remedy for the owner, so no coder can discharge it` : ''}` +
          `${
            cites.has(k)
              ? `  ← cited by row: ${cites
                  .get(k)
                  .map((e) => `${e.id} [${e.state}, cites ${e.fanOut}${e.kind === 'citation' ? '' : `, ${e.kind.toUpperCase()}`}${pointers?.has(e.id) ? pointerTag(pointers.get(e.id)) : ''}]`)
                  .join(', ')}`
              : ''
          }${pointers?.has(k) ? pointerNote(pointers.get(k)) : ''}\n`
      );
    if (leads === null) process.stdout.write('\nresidue-pickup: the code read did not run (git log was not readable), so no row carries a lead\n');
    else
      process.stdout.write(
        `\nresidue-pickup: ${leads.size} of the ${drift.openOnRef.length} OPEN row(s) are named by a later commit that changed code. ` +
          'Read those PRs before you size the row: the fix may have landed. A lead is not a close.\n'
      );
    {
      const pinned = drift.openOnRef.filter((k) => PINNED_BY_ROW.has(k));
      process.stdout.write(
        `residue-pickup: ${pinned.length} of the ${drift.openOnRef.length} OPEN row(s) are PINNED OPEN by a check in ` +
          'another tool, which holds the row to an OPEN state because something it excuses still points at it. ' +
          'Closing one reds that check. Read the pin beside the row: the remedy there is never a state change.\n'
      );
    }
    process.stdout.write(
      `residue-pickup: ${cites.size} of the ${drift.openOnRef.length} OPEN row(s) are named by ANOTHER ROW. ` +
        'Read those rows too, including the ones that already read closed: a measurement that does not move a ' +
        "row's state becomes a new row, so a row's answer often sits outside it. " +
        "`cites N` is that row's fan-out, the number of rows it names in all. Read a `cites 1` first: measured " +
        '2026-10-26 over the ref, a one-to-one citer carried something 9 times in 9, and a citer naming three or ' +
        'more rows carried something once in 5.\n'
    );
    process.stdout.write(
      `residue-pickup: of those, ${corrected} row(s) carry a CORRECTION — a citing row whose correction verb can ` +
        `only be about them — and ${unattributable} carry a verb this read cannot attribute, because the citing row ` +
        'names several rows at once. The two counts OVERLAP, because one row can carry both kinds, so they do ' +
        'not sum to the cited total. An unattributable mark is a reading order and nothing more: read the citing ' +
        'row and decide for yourself which row its verb was about. A correction never moves the corrected ' +
        "row's state, since rows are append-and-close.\n"
    );
    process.stdout.write(
      `residue-pickup: ${landed.size} of the ${drift.openOnRef.length} OPEN row(s) are the ARGUMENT of another ` +
        "row's `withdrawn <key>` state. That row's own cells corroborate the withdrawal, so the correction " +
        'already landed and the row holds no work. It stays OPEN because the vocabulary buys a terminal state ' +
        'for the row that GETS withdrawn and none for the row that withdraws it, so a close needs a ' +
        'RESIDUE-only PR and never a fix. This read is a state cell and never a verb in prose, so it asks for ' +
        'no judgment, unlike the CORRECTION mark above it.\n'
    );
    process.stdout.write(
      `residue-pickup: ${reserved.size} of the ${drift.openOnRef.length} OPEN row(s) RESERVE the remedy for the OWNER in ` +
        'their own cells. The step that would discharge one is a deploy, a daemon restart, a timer install, a ' +
        'branch-protection change or a secret list, so a coder who picks it pays the whole sizing cost and then ' +
        'stops. Read the named phrase in the cell and decide: this read is prose and never a state, unlike the ' +
        'withdrawal mark above it. The phrase list is declared in this tool and every phrase carries a fixture, ' +
        'so a phrase that stops matching reds instead of reading zero.\n'
    );
    if (pointers === null) process.stdout.write('residue-pickup: the pointer read did not run (git was not readable), so no row says where its own evidence now sits\n');
    else {
      const t = openTotals;
      process.stdout.write(
        `residue-pickup: ${t.drifted} of the ${t.rows} OPEN row(s) carry a pointer that no longer reaches the line it cites. ` +
          `${t.citing} row(s) cite a \`path:line\` at all, over ${t.cites} citation(s): ${t.anchored} anchored, ${t.moved} moved, ` +
          `${t.unanchored} anchoring nothing, ${t.beyondEof} past end of file, ${t.unresolved} at no tracked path, ` +
          `${t.unclassified} unclassified. A row with NO pointer note either cites nothing or still anchors, so read these ` +
          'counts before you read a blank line as a sound pointer. A `moved` hint names the first line carrying one of the ' +
          "row's own identifiers, which is a lead and never a proof. This read asks the cheap questions only: a citation at " +
          'no tracked path is NOT split into rot and off-tree, because that split costs a history probe per path. Run ' +
          '`node tools/residue-cite-drift.mjs` for the whole ledger and that split.\n'
      );
      process.stdout.write(
        `residue-pickup: the ${leadTotals.rows} row(s) named as a lead above, and not open themselves, carry ` +
          `${leadTotals.drifted} drifted pointer set(s) over ${leadTotals.cites} citation(s). A lead row is usually CLOSED, ` +
          'and a closed row keeps its pointers for as long as a reader is told to open it, so this read judges it beside ' +
          `the open ones. This read judges those ${t.rows + leadTotals.rows} row(s) and no others — for every row in the ` +
          'ledger run `node tools/residue-cite-drift.mjs --strict`.\n'
      );
    }
    if (v.status === 'PASS') {
      process.stdout.write(`\nresidue-pickup: the file on disk agrees with ${base} on all ${drift.checked} shared row(s)\n`);
    } else {
      process.stdout.write(`\nresidue-pickup: THE FILE ON DISK DISAGREES — do not size work from it\n`);
      for (const d of drift.differs) process.stdout.write(`  ✗ ${d.key}: on disk ${d.disk} · at ${base} ${d.ref}\n`);
      for (const k of drift.onlyRef) process.stdout.write(`  ✗ ${k}: at ${base} only — a read of the disk copy cannot see this row at all\n`);
      process.stdout.write(
        `\n  ${drift.staleOpen.length} row(s) read OPEN and are already closed, which is a claim on work someone else finished.\n` +
          `  ${drift.earlyClosed.length} row(s) read closed and are still OPEN, which is work a read would skip.\n` +
          '  The list above this block came from the ref, so it is safe to pick from. Advancing the shared\n' +
          "  checkout's ref is NOT the remedy: it changes tracked files under every other session using it.\n"
      );
    }
    if (drift.onlyDisk.length) {
      process.stdout.write(`\n  ${drift.onlyDisk.length} row(s) exist on disk only — this branch's own unpushed rows, not drift:\n`);
      for (const k of drift.onlyDisk) process.stdout.write(`    ${k}\n`);
    }
    process.stdout.write(`\n${JSON.stringify(v)}\n`);
    process.exit(v.status === 'PASS' ? 0 : 1);
  }

  if (argv.includes('--full-tree')) {
    const ledger = readAt('HEAD');
    if (ledger === null) refuse(`\`${LEDGER_PATH}\` does not exist at HEAD.`, ['A claim cannot be checked against a ledger that is not there.']);
    const claims = closeClaims(git(['log', '--format=%x1e%H%x1f%B']));
    const problems = unclosedClaims(claims, parseRows(ledger));
    if (asJson) process.stdout.write(`${JSON.stringify({ claims: claims.length, problems }, null, 2)}\n`);
    else if (problems.length) {
      process.stderr.write(`residue-ids --full-tree: ${problems.length} of ${claims.length} close claim(s) not reflected in the ledger\n`);
      for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
      process.stderr.write(
        '\n  A row is closed by editing ONLY its state cell (`fixed #N`) — verify the fix in code first,\n  then close it; a claim whose fix did not land is a NEW row, not an edit.\n'
      );
    } else process.stdout.write(`residue-ids --full-tree: ok — ${claims.length} close claim(s), every row closed\n`);
    process.exit(problems.length ? 1 : 0);
  }

  let baseText;
  let tipText;
  let mergeBase = base;
  try {
    git(['rev-parse', '--verify', base]);
    // Removals/edits are judged against the MERGE BASE (what this branch started from); a branch
    // that is merely BEHIND has removed nothing. Collisions are judged against the tip.
    try {
      mergeBase = git(['merge-base', 'HEAD', base]).trim() || base;
    } catch {
      mergeBase = base;
    }
    baseText = readAt(mergeBase);
    tipText = readAt(base);
  } catch {
    refuse(`cannot resolve base ref \`${base}\`.`, ['Fetch it (`git fetch origin main`) or pass --base <ref>.']);
  }
  if (baseText === null) {
    refuse(`\`${LEDGER_PATH}\` does not exist at \`${base}\`.`, ['If the ledger is genuinely new, say so explicitly with --base <the commit that introduced it>.']);
  }

  const headText = readAt('HEAD');
  if (headText === null) {
    refuse(`\`${LEDGER_PATH}\` does not exist at HEAD.`, ['The ledger is committed on main; a branch must not delete it.']);
  }

  const comparison = describeComparison(base, mergeBase, headText);
  const v = verdict(baseText, headText, tipText);
  const problems = [
    ...v.collisions,
    ...v.mutated,
    ...v.unparsed.map((u) => `${LEDGER_PATH}:${u.line} — \`${u.cell}\` attempts a residue key this reader cannot parse, so every check below would have SKIPPED the row`)
  ];

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ...v, comparison }, null, 2)}\n`);
  } else if (problems.length) {
    process.stderr.write(`residue-ids: ${problems.length} problem(s) against ${base}\n`);
    for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
    // Say what to DO, and only the remedy that fits what actually fired — a renumber hint on a
    // mutated row would send the reader to the wrong repair.
    if (v.collisions.length) {
      process.stderr.write(`\n  That key already exists on ${base}. A residue key is a DATE PLUS A SLUG and is\n`);
      process.stderr.write('  unique by construction — pick a slug that says what the defect is, and update the\n');
      process.stderr.write('  source brief’s **Residue:** back-reference to match.\n');
    }
    if (v.mutated.length) {
      process.stderr.write('\n  Rows are appended and CLOSED, never edited or deleted: only the state cell may\n');
      process.stderr.write('  change (OPEN → `→ `<brief>`` | `fixed #N`). A wrong row gets a NEW row saying so.\n');
    }
    if (v.unparsed.length) {
      process.stderr.write('\n  A residue key is a DATE PLUS A SLUG of lowercase letters, digits and hyphens —\n');
      process.stderr.write('  nothing else. An underscore, a capital or a space puts the row outside the pattern,\n');
      process.stderr.write('  and the row then stays in the file while every check here skips it silently. Rename\n');
      process.stderr.write('  the key. This gate used to print `ok` over exactly that commit.\n');
    }
  } else {
    process.stdout.write(`residue-ids: ok — ${v.added.length} row(s) added, none colliding, none mutated\n`);
  }
  // A landed row is said out loud in both outcomes: it is the reason a count can read 0 added, and a
  // reader who is not told would go looking for the row the branch appears to have lost.
  if (!asJson) reportComparison(comparison);
  if (!asJson) for (const l of v.landed) process.stderr.write(`  · ${l}\n`);
  process.exit(problems.length ? 1 : 0);
}

/* self-test: node tools/residue-ids.mjs --selftest (pure core only — no git, no refs).
   Every assertion below is a PLANT: the collision this tool was written for went green on a full
   docs-ledger run, so a selftest that only checks the happy path would reproduce that blindness. */
/* `process.argv` BELONGS TO WHOEVER IS RUNNING (row 2026-10-20-sixty-nine-argv-tools-stay-undecided,
   #3804). This block used to read a bare `--selftest` at module scope, and it ends in `process.exit(0)`.
   Measured 2026-10-20: `node tools/rebase-safe.mjs --selftest` — rebase-safe imports `parseRows` from
   here and has no selftest of its own — printed THIS file's selftest line and exited 0 from the import,
   so rebase-safe's own run never happened and the pass it reported was ours. The guard makes importing
   this module safe, which is what lets a second ledger reader single-source the scanner above. */
const IS_CLI = isCliEntry(import.meta.url);

if (IS_CLI && process.argv.includes('--selftest')) {
  let ran = 0; // incremented by the assertion helper itself — a count is computed, never typed
  const assert = (c, m) => {
    ran++;
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      process.exit(1);
    }
  };
  const row = (id, key = 'd', state = 'OPEN') => `| ${id} | 2026-09-02 | \`X-BRIEF.md\` | ${key} | e | ${state} |`;
  const A = '2026-09-02-alpha';
  const B = '2026-09-02-bravo';
  const C = '2026-09-02-charlie';
  const BASE = [row(A), row(B)].join('\n');

  // 1 — an id present on the base with edited cells is a MUTATION, not a collision
  let v = verdict(BASE, [row(A), row(B, 'different defect')].join('\n'));
  assert(v.mutated.length === 1 && v.collisions.length === 0, 'an edited non-state cell is a mutation');
  v = verdict([row(A)].join('\n'), [row(A), row(B)].join('\n'));
  assert(v.collisions.length === 0 && v.added.join() === B, 'appending a new key is clean');

  // 2 — THE MEASURED FAILURE, and why the counter was abandoned. Under `R<n>` this case needed a
  //     high-water rule, a gap rule, and a monotonic rule, and it still could not see a key claimed
  //     in an open branch. A date-slug key needs none of them: two authors do not collide unless they
  //     independently choose the same words on the same day, and then it is a real duplicate.
  v = verdict([row(A)].join('\n'), [row(A), row(B)].join('\n'), [row(A), row(B, 'someone else’s row')].join('\n'));
  assert(v.collisions.length === 1 && v.collisions[0].includes('another branch'), 'a key minted concurrently on the tip FIRES');

  /* 2e — THE POST-MERGE INVERSION, and its control. The plants are the two shapes that reach the
     branch with one id on the tip and none on the base: the SAME row (this branch's work, merged) and
     a DIFFERENT row under the same key (two authors contending). The first must not be a problem, the
     second must stay one — and the pair is the whole discriminator, so both halves are asserted here
     rather than left to the population run. The third plant is the one that matters least and breaks
     most easily: a landed row that the tip has since CLOSED still matches, because the state cell is
     not part of the identity. */
  const tipSame = [row(A), row(B)].join('\n');
  v = verdict([row(A)].join('\n'), [row(A), row(B)].join('\n'), tipSame);
  assert(v.collisions.length === 0 && v.mutated.length === 0, 'this branch’s own landed row is NOT a collision');
  assert(v.landed.length === 1 && v.landed[0].includes('LANDED') && v.added.length === 0, 'the landed row is reported, and is not counted as added');
  v = verdict([row(A)].join('\n'), [row(A), row(B)].join('\n'), [row(A), row(B, 'd', 'fixed #3813')].join('\n'));
  assert(v.landed.length === 1 && v.collisions.length === 0, 'a landed row closed on the tip still matches — the state cell is not the identity');
  v = verdict([row(A)].join('\n'), [row(A), row(B)].join('\n'), [row(A), row(B, 'a different defect under the same slug')].join('\n'));
  assert(v.collisions.length === 1 && v.landed.length === 0, 'the CONTROL: one key, two different rows, is still a collision');

  /* 2b — THE UNION-MERGE DUPLICATE (#2506, measured 2026-09-14). A row closed on one branch while
     the same row sits OPEN on main comes back from a `merge=union` rebase as TWO rows with one key,
     contradicting each other. This tool reported `ok — none colliding, none mutated` against that
     tree: `added` was empty because both copies already existed on the base, and the only uniqueness
     assertion ran over `added`. The plant is the exact observed shape, not a synthetic one. */
  v = verdict([row(A)].join('\n'), [row(A), row(A, 'd', 'fixed #2498')].join('\n'));
  assert(v.collisions.length === 1 && v.collisions[0].includes('MORE THAN ONCE'), 'a duplicated id inside the head file FIRES');
  /* …and the anti-vacuity half: an UNduplicated close must stay silent, or the check is just noise. */
  v = verdict([row(A)].join('\n'), [row(A, 'd', 'fixed #2498')].join('\n'));
  assert(v.collisions.length === 0 && v.mutated.length === 0, 'a plain close is not a duplicate');

  /* 2d — THE ESCAPE-BLIND SPLIT (row 2026-10-20-append-and-close-is-blind-to-an-escaped-pipe,
     measured over 44 of the ledger's 698 rows). The reader used to split on EVERY pipe, so a cell
     carrying the escape the row contract mandates read as a cell boundary and the row's real evidence
     sat outside the frozen identity. Editing that evidence then moved nothing this tool compares.
     Three plants, two of them edges: the hidden edit must FIRE, a plain close of such a row must stay
     silent, and a DOUBLED backslash must leave the next pipe live (the case a lookbehind gets wrong). */
  const esc = (ev, state = 'OPEN') => `| ${A} | 2026-09-02 | \`X-BRIEF.md\` | d | ${ev} | ${state} |`;
  v = verdict(esc('quotes a \\| b'), esc('quotes a \\| c'));
  assert(v.mutated.length === 1, 'an edit BEHIND an escaped pipe is a mutation');
  v = verdict(esc('quotes a \\| b'), esc('quotes a \\| b', 'fixed #3804'));
  assert(v.mutated.length === 0 && v.collisions.length === 0, 'closing a row that carries an escaped pipe is not a mutation');
  assert(splitRowCells('|a|b|').length === 4, 'a live pipe separates cells');
  assert(splitRowCells('|a \\| b|').length === 3, 'an escaped pipe stays inside its cell');
  assert(splitRowCells('|a \\\\|b|').length === 4, 'a doubled backslash leaves the next pipe LIVE');

  // 2b — BEHIND IS NOT DELETED. The branch predates a row that landed on the tip: no removal, and the
  //      tip's row is a collision only if the branch also minted that key itself.
  v = verdict([row(A)].join('\n'), [row(A), row(C)].join('\n'), [row(A), row(B)].join('\n'));
  assert(v.mutated.length === 0 && v.collisions.length === 0 && v.added.join() === C, 'a branch behind the tip has removed nothing');

  // 2c — POINTER REPAIR vs CLAIM EDIT. The exemption permits exactly one substitution — a retired
  //      `R<n>` replaced by a backticked key naming a real row — and nothing else. Every assertion here
  //      is a plant: the one that matters is that a substantive edit still fires, because an exemption
  //      that swallowed those would silently reopen the rule it is carved out of.
  const rows = (k) => k === '2026-09-02-alpha' || k === '2026-09-02-bravo';
  assert(isPointerRepair('see R17 for why', 'see `2026-09-02-alpha` for why', rows), 'a pointer repair is permitted');
  assert(isPointerRepair('blocks R17, and R9', 'blocks `2026-09-02-alpha`, and `2026-09-02-bravo`', rows), 'two pointers in one cell');
  assert(!isPointerRepair('see R17 for why', 'see R17 for reasons', rows), 'a word change is a claim edit and FIRES');
  assert(!isPointerRepair('see R17 for why', 'see `2026-09-02-nope` for why', rows), 'a key that names no row FIRES');
  assert(!isPointerRepair('see R17 for why', 'see `2026-09-02-alpha` for why now', rows), 'an added token FIRES');
  assert(!isPointerRepair('the defect is real', 'the defect is fixed', rows), 'a pure claim edit FIRES');
  assert(!isPointerRepair('see R17', 'see R18', rows), 'an R-id swapped for another R-id FIRES — the scheme is retired');
  // ⚠️ THE CLAUSE THIS PINS WAS UNTESTED AND A MUTANT SURVIVED: without it the exemption permits ANY
  //    token becoming a key, so a claim word could be rewritten as a reference and pass as a "repair".
  assert(!isPointerRepair('see note 4 here', 'see `2026-09-02-alpha` here', rows), 'only a RETIRED R-id may be replaced');
  assert(!isPointerRepair('the defect is real', 'the `2026-09-02-alpha` is real', rows), 'a claim word is not a pointer');
  assert(!isPointerRepair('same text', 'same text', rows), 'no substitution is not a repair');

  // 2f — HOME-PATH REDACTION vs CLAIM EDIT (#4028). The one permitted change maps `/home/<user>/` to
  //      `~/`. Each refusal below is a plant: an exemption that swallowed any of them would reopen the rule.
  // built by join so this file carries no literal home path for the secret scan to report
  const H = ['', 'home', 'someuser', ''].join('/');
  assert(isHomeRedaction(`ran ${H}repo/.venv/bin/pip`, 'ran ~/repo/.venv/bin/pip'), 'a home-path redaction is permitted');
  assert(isHomeRedaction(`${H}a and ${H}b`, '~/a and ~/b'), 'two home paths in one cell');
  assert(!isHomeRedaction(`ran ${H}repo/x`, 'ran ~/repo/y'), 'a redaction plus another edit FIRES');
  assert(!isHomeRedaction(`ran ${H}repo/x`, 'ran /root/repo/x'), 'a different prefix FIRES');
  assert(!isHomeRedaction('the defect is real', 'the defect is fixed'), 'a claim edit with no home path FIRES');
  assert(!isHomeRedaction('same ~/text', 'same ~/text'), 'no substitution is not a redaction');
  assert(!isHomeRedaction(`${H}a and ${H}b`, `~/a and ${H}b`), 'a partial redaction FIRES');
  const HB = H.slice(0, -1); // the bare home directory, no trailing slash
  assert(isHomeRedaction(`cd ${HB} && run`, 'cd ~ && run'), 'a bare home directory maps to ~');
  assert(!isHomeRedaction(`cd ${HB}x && run`, 'cd ~x && run'), 'a longer user name is not cut short');
  assert(!isHomeRedaction(`cd ${HB} && run`, 'cd ~/ && run'), 'a bare home directory does not gain a slash');
  const hrow = (ev, state = 'OPEN') => `| ${A} | 2026-09-02 | \`X-BRIEF.md\` | d | ${ev} | ${state} |`;
  v = verdict(hrow(`venv at ${H}repo`), hrow('venv at ~/repo', 'fixed #4028'));
  assert(v.mutated.length === 0 && v.collisions.length === 0, 'closing a row with a redacted home path is clean');
  v = verdict(hrow(`venv at ${H}repo`), hrow('venv at ~/other', 'fixed #4028'));
  assert(v.mutated.length === 1, 'a redacted close that also edits the claim is a mutation');

  // 3 — rows are append-and-close: a removal and a non-state edit both fire; a STATE change does not
  v = verdict(BASE, [row(A)].join('\n'));
  assert(v.mutated.length === 1 && v.mutated[0].startsWith(B), 'removing a row that exists on the base FIRES');
  v = verdict(BASE, [row(A), row(B, 'd', 'fixed #2114')].join('\n'));
  assert(v.mutated.length === 0 && v.collisions.length === 0, 'closing a row by its STATE cell alone is clean');

  // 4 — two rows added with the same id on one branch (docs-ledger check8c catches this one too;
  //     asserted here so the two gates are known to agree rather than assumed to)
  v = verdict(BASE, [row(A), row(B), row(C), row(C, 'other')].join('\n'));
  assert(
    v.collisions.some((c) => c.includes('added twice')),
    'an id added twice on the branch FIRES'
  );

  // 5 — non-vacuous: the parser must actually see rows, or every assertion above passes on empty input
  assert(parseRows(BASE).length === 2 && parseRows('').length === 0, 'parseRows reads rows (and only rows)');
  assert(parseRows('| 2026-09-02-alpha | d |').length === 1, 'a malformed row still yields its identity — shape is check8b’s job');

  /* ── A ROW THE PARSER CANNOT READ REDS — row 2026-11-02-a-residue-key-with-an-underscore… ───── */
  {
    const bad = '| 2026-11-02-a_key | 2026-11-02 | `x` | d | e | OPEN |';
    const good = '| 2026-11-02-a-key | 2026-11-02 | `x` | d | e | OPEN |';
    /* CONTROL on the premise, not on the fix: the parser really does drop it, and silently. */
    assert(parseRows(bad).length === 0 && parseRows(good).length === 1, 'an underscored key is invisible to parseRows — the premise of the row');
    assert(unparsedRows(bad).length === 1, 'an underscored key is REPORTED instead of skipped');
    assert(unparsedRows(bad)[0].cell === '2026-11-02-a_key' && unparsedRows(bad)[0].line === 1, 'the report names the cell and its 1-indexed line');
    assert(unparsedRows(good).length === 0, 'a well-formed key is not reported');
    /* Every other way to leave the character class. An internal space is the one a human cannot
       see in rendered markdown, so it is the one worth naming. */
    assert(unparsedRows('| 2026-11-02-A-key | d |').length === 1, 'an uppercase letter reds');
    assert(unparsedRows('| 2026-11-02-a key | d |').length === 1, 'an internal space reds');
    assert(unparsedRows('| 2026-11-02-a.key | d |').length === 1, 'a full stop reds');
    /* NOT a key attempt, so NOT this gate's finding: the header, the separator, prose, and a bare
       date with no slug. A gate that reds the table header would red every run. */
    assert(unparsedRows('| <key> | logged | source | defect | evidence | state |').length === 0, 'the table header is not a key attempt');
    assert(unparsedRows('|---|---|---|---|---|---|').length === 0, 'the separator row is not a key attempt');
    assert(unparsedRows('see 2026-11-02-a_key for the trap').length === 0, 'a key inside prose is not a table row');
    assert(unparsedRows('| 2026-11-02 | logged |').length === 0, 'a bare date with no slug is not a key attempt');
    assert(unparsedRows('').length === 0 && unparsedRows(null).length === 0, 'no text reads as no finding');
    /* THE WHOLE POINT (§4b): the diff verdict reported a PASS over exactly this commit, because a
       row the parser cannot see is absent from `added`. */
    const vb = verdict('', bad, '');
    assert(vb.added.length === 0, 'the dropped row is absent from `added` — how the pass was reported');
    assert(vb.unparsed.length === 1 && vb.collisions.length === 0 && vb.mutated.length === 0, 'the diff verdict carries the unreadable row where nothing else could');
    assert(verdict('', good, '').unparsed.length === 0, 'a clean ledger carries no finding');
    /* And the pickup half fails over a ref whose list it cannot vouch for. */
    const dr = pickupDrift(bad, bad);
    assert(dr.unparsed.length === 1 && dr.differs.length === 0, 'the pickup read carries it, and it is not drift');
    const pv = pickupVerdict(dr, { behind: 0, base: 'origin/main', commit: 'c0ffee00', namedByCode: null, citedBy: 0, correctedBy: 0, correctionUnattributable: 0 });
    assert(pv.status === 'FAIL' && pv.result.unparsed === 1, 'an unreadable row on the ref FAILS the pickup verdict');
    assert(/cannot parse/.test(pv.reason || ''), 'and the reason says why, with no stale rows to blame');
    const pvOk = pickupVerdict(pickupDrift(good, good), { behind: 0, base: 'origin/main', commit: 'c0ffee00', namedByCode: null, citedBy: 0, correctedBy: 0, correctionUnattributable: 0 });
    assert(pvOk.status === 'PASS' && pvOk.reason === null, 'a clean ref still passes with a null reason');
  }

  // 6 — THE FULL-TREE CLAIM CHECK (row 2026-10-10-a-closes-residue-claim-is-never-checked-against-the-row).
  //     A claim whose row still reads OPEN FIRES; a closed one, a promoted one and a withdrawn one are
  //     silent; a claim naming no row FIRES; two keys in one claim are BOTH read; a key after `;` is not.
  const log = (...msgs) => msgs.map((m, i) => `\x1e${'c0ffee0'}${i}\x1f${m}\n`).join('');
  const led = parseRows([row(A, 'd', 'OPEN'), row(B, 'd', 'fixed #1'), row(C, 'd', '→ `X-BRIEF.md`'), row('2026-09-02-delta', 'd', 'withdrawn 2026-09-02-alpha')].join('\n'));
  assert(led.map((r) => r.state).join('~') === 'OPEN~fixed #1~→ `X-BRIEF.md`~withdrawn 2026-09-02-alpha', 'parseRows reads the state cell');
  let cl = closeClaims(log(`fix: x\n\nCloses residue \`${A}\`.`));
  assert(cl.length === 1 && cl[0].key === A && cl[0].commit === 'c0ffee00', 'a close claim is read with its commit');
  assert(unclosedClaims(cl, led).length === 1 && /still reads OPEN/.test(unclosedClaims(cl, led)[0]), 'a claim over an OPEN row FIRES');
  assert(
    unclosedClaims(closeClaims(log(`Closes residue \`${B}\``, `closes residue ${C}`, `Closes residue **\`2026-09-02-delta\`**`)), led).length === 0,
    'fixed / promoted / withdrawn rows satisfy a claim, in any markup'
  );
  assert(/no such row/.test(unclosedClaims(closeClaims(log('Closes residue `2026-09-02-nope`')), led)[0] || ''), 'a claim naming no row FIRES');
  assert(
    closeClaims(log(`Closes residue \`${A}\` and \`${B}\`, \`${C}\``))
      .map((c) => c.key)
      .join() === [A, B, C].join(),
    'a chained claim names every key'
  );
  assert(
    closeClaims(log(`Closes residue \`${A}\`; also appends \`${B}\``))
      .map((c) => c.key)
      .join() === A,
    'a key after a semicolon is mentioned, not closed'
  );
  assert(closeClaims(log('A commit can say `Closes residue <key>` and nothing follows')).length === 0, 'the placeholder is not a claim');
  assert(closeClaims(log(`Closes residue \`${A}\` ... Closes residue \`${A}\``)).length === 1, 'one claim per (commit, key)');
  assert(closeClaims('').length === 0 && closeClaims(undefined).length === 0, 'an empty log has no claims');

  /* ── THE PICKUP HALF — every assertion is a PLANT, because the real defect was a read that
     looked perfectly ordinary. The drift must be found by COMPARISON, never by a row's own text. */
  const stale = [row(A), row(B), row(C)].join('\n'); // the disk copy: all three OPEN
  const current = [row(A, 'd', 'fixed #1'), row(B), row(C, 'd', 'answered #2')].join('\n');
  let d = pickupDrift(current, stale);
  assert(d.differs.length === 2, 'two states differ between the ref and the disk copy');
  assert(d.staleOpen.join() === [A, C].join(), 'staleOpen names the rows a pickup would wrongly claim');
  assert(d.earlyClosed.length === 0, 'nothing reads closed-but-open in this direction');
  assert(d.openOnRef.join() === B && d.openOnDisk.join() === [A, B, C].join(), 'the OPEN list comes from the ref, not from disk');
  assert(d.checked === 3 && d.onlyRef.length === 0, 'all three rows are comparable');

  // the OTHER direction: a disk copy that closed a row the ref still holds OPEN
  d = pickupDrift([row(A)].join('\n'), [row(A, 'd', 'fixed #1')].join('\n'));
  assert(d.earlyClosed.join() === A && d.staleOpen.length === 0, 'a row closed on disk and OPEN at the ref is work a read would skip');

  // a row the disk copy cannot see at all — how a duplicate row gets logged
  d = pickupDrift([row(A), row(B)].join('\n'), [row(A)].join('\n'));
  assert(d.onlyRef.join() === B && d.checked === 1, 'a row only at the ref is excluded from the comparison and named');
  // ⚠️ and the asymmetry: a row only on DISK is this branch's own work, never drift
  d = pickupDrift([row(A)].join('\n'), [row(A), row(B)].join('\n'));
  assert(d.onlyDisk.join() === B && d.differs.length === 0 && d.onlyRef.length === 0, 'an unpushed local row is not drift');

  // openKeys reads the STATE cell, and a closed row is not open
  assert(openKeys(current).join() === B, 'openKeys returns only the OPEN rows');
  assert(openKeys('').length === 0 && openKeys(undefined).length === 0, 'an empty ledger has no open rows');

  /* THE VERDICT. `checked + excluded = eligible` is an equality, so the ref's row count is the
     population and a row the read cannot see is an EXCLUSION, never a silent drop. */
  d = pickupDrift(current, stale);
  let pv = pickupVerdict(d, { behind: 13, base: 'origin/main', commit: 'abc1234' });
  assert(pv.status === 'FAIL' && pv.result.differs === 2 && pv.reason !== null, 'drift is a FAIL carrying a reason');
  assert(pv.population.checked + pv.population.excluded === pv.population.eligible, 'the population balances');
  assert(pv.criterion.threshold === 0 && pv.criterion.direction === 'lte', 'the criterion is the pre-stated one');
  pv = pickupVerdict(pickupDrift(current, current), { behind: 0, base: 'origin/main', commit: 'abc1234' });
  assert(pv.status === 'PASS' && pv.reason === null && pv.population.checked === 3, 'an identical read passes over the rows it compared');
  pv = pickupVerdict(pickupDrift([row(A), row(B)].join('\n'), [row(A)].join('\n')), { behind: 2, base: 'origin/main', commit: 'abc1234' });
  assert(pv.status === 'FAIL' && pv.population.excluded === 1, 'a row the read cannot see fails the pickup on its own');

  /* THE CODE READ — each assertion is a plant for one of the three conditions. */
  {
    const K = '2026-10-20-foo';
    const K2 = '2026-10-20-foo-bar';
    const rec = (sha, subject, message, files) => `\x1e${sha}\x1f${subject}\x1f${message}\x1f\n${files.join('\n')}\n`;
    const s40 = (c) => c.repeat(40);
    const logText =
      rec(s40('a'), 'fix(x): the fix (#30)', `closes ${K}.`, ['x-dsp.js', 'briefs/RESIDUE.md']) +
      rec(s40('b'), 'docs(residue): annotate (#20)', `about ${K}`, ['briefs/RESIDUE.md', 'changes/a.md']) +
      rec(s40('c'), 'fix(y): logs its remainder (#10)', `new row ${K}`, ['y.js', 'briefs/RESIDUE.md']) +
      rec(s40('d'), 'fix(z): another row (#5)', `row ${K2}`, ['z.js']);
    const commits = parseLog(logText);
    assert(commits.length === 4 && commits[0].files.join() === 'x-dsp.js,briefs/RESIDUE.md' && commits[2].message === `new row ${K}`, 'parseLog reads sha, subject, message and files');
    assert(parseLog('').length === 0 && parseLog(undefined).length === 0, 'an empty log has no commits');
    const patch = `\x1e${s40('e')}\n+| ${K} | x |\n\x1e${s40('c')}\n+| ${K} | x |\n+| ${K2} | y |\n`;
    const added = rowAddedBy(patch);
    assert(added.get(K) === s40('c') && added.get(K2) === s40('c'), 'rowAddedBy keeps the OLDEST add (the last record of a newest-first log)');
    let leads = namedByCode([K, K2], commits, added);
    assert(leads.get(K)?.join() === '#30', 'a code commit naming the key is a lead; a docs-only commit and the adding commit are not');
    assert(leads.get(K2)?.join() === '#5', 'a commit naming the longer key leads to that key only');
    assert(namesKey(`row ${K2}`, K) === false && namesKey(`(${K})`, K) === true && namesKey(`x${K}`, K) === false, 'namesKey matches a whole token only');
    leads = namedByCode([K], commits, new Map());
    assert(leads.get(K)?.join() === '#30,#10', 'without the add map, the remainder-logging commit would read as a lead');
    assert(namedByCode([K], [], added).size === 0, 'no commits, no leads');
    assert(isCodePath('tools/a.mjs') && !isCodePath('briefs/RESIDUE.md') && !isCodePath('changes/x.md'), 'isCodePath splits code from ledger and changeset edits');
    assert(prOf('fix: x (#3754)', s40('a')) === '#3754' && prOf('local commit', s40('a')) === 'aaaaaaaaa', 'prOf reads the squash suffix, else the short sha');
    const d0 = pickupDrift([row(A)].join('\n'), [row(A)].join('\n'));
    assert(pickupVerdict(d0, { behind: 0, base: 'b', commit: 'abc1234', namedByCode: 3 }).result.openNamedByCode === 3, 'the verdict carries the lead count');
    const pv0 = pickupVerdict(d0, { behind: 0, base: 'b', commit: 'abc1234' });
    assert(pv0.result.openNamedByCode === null && pv0.status === 'PASS', 'no code read is null, never 0, and a lead never moves the status');
    /* 🔴 THE FLOOR CANNOT BE THE LIST'S SIZE, BECAUSE AN EMPTY PIN LIST IS THE SUCCESS STATE.
       Every pin here was held by a `PUBLISHED_FIELD_GAP` entry in `tools/tch-reference-record.mjs`,
       and that gap closes the moment the record is re-published. A `>= 2` floor would then force a
       session to keep a spent pin alive to stay green, and a spent allowlist entry is the failure
       mode of every allowlist in this repo. So the counting legs read a PLANTED map through
       `ctx.pins`, the shape legs read the SHIPPED list at whatever size it has, and one leg per
       shipped member keeps the original claim while there is a member to claim it over. */
    const PIN_SHAPE = (e) => KEY_PARSES.test(e.row) && /^tools\/.+\.mjs$/.test(e.by) && e.why.length > 20;
    assert(PINNED_OPEN.every(PIN_SHAPE), 'every pin names a parseable row, the tool whose check holds it, and a why');
    assert(new Set(PINNED_OPEN.map((e) => e.row)).size === PINNED_OPEN.length, 'no row is pinned twice');
    assert(
      PIN_SHAPE({ row: '1970-01-01-a-planted-pin-row', by: 'tools/tch-reference-record.mjs', why: 'CONTROL · a planted pin the shape test must accept' }),
      'ANTI-VACUITY · the shape test ACCEPTS a well-formed pin, so the leg over the shipped list can fail'
    );
    assert(!PIN_SHAPE({ row: 'not-a-residue-key', by: 'tools/x.mjs', why: 'too short' }), 'CONTROL · the shape test REJECTS a malformed pin');
    const PIN = '1970-01-01-a-planted-pin-row';
    const PIN_PLANT = new Map([[PIN, { row: PIN, by: 'tools/tch-reference-record.mjs', why: 'CONTROL · a planted pin, so the counting legs hold at any size of the shipped list' }]]);
    const dPin = pickupDrift([row(PIN), row(A)].join('\n'), [row(PIN), row(A)].join('\n'));
    assert(pickupVerdict(dPin, { behind: 0, base: 'b', commit: 'abc1234', pins: PIN_PLANT }).result.openPinnedByCheck === 1, 'the verdict counts a pinned row in the open set');
    assert(
      pickupVerdict(d0, { behind: 0, base: 'b', commit: 'abc1234', pins: PIN_PLANT }).result.openPinnedByCheck === 0,
      'CONTROL · an open set holding no pinned row counts none, so the count reads the list and not the size'
    );
    assert(
      pickupVerdict(dPin, { behind: 0, base: 'b', commit: 'abc1234' }).result.openPinnedByCheck === (PINNED_BY_ROW.has(PIN) ? 1 : 0),
      'the DEFAULT read is the shipped list, so the plant above never becomes the claim'
    );
    for (const e of PINNED_OPEN) {
      const dShipped = pickupDrift([row(e.row), row(A)].join('\n'), [row(e.row), row(A)].join('\n'));
      assert(pickupVerdict(dShipped, { behind: 0, base: 'b', commit: 'abc1234' }).result.openPinnedByCheck === 1, `the verdict counts the SHIPPED pin ${e.row} in the open set`);
    }
    assert(
      pickupDrift([row(PIN, 'd', 'fixed #1')].join('\n'), [row(PIN, 'd', 'fixed #1')].join('\n')).openOnRef.length === 0 &&
        pickupVerdict(pickupDrift([row(PIN, 'd', 'fixed #1')].join('\n'), [row(PIN, 'd', 'fixed #1')].join('\n')), {
          behind: 0,
          base: 'b',
          commit: 'abc1234',
          pins: PIN_PLANT
        }).result.openPinnedByCheck === 0,
      'a pinned row that is NOT open counts none here — this tool reports the pin, it does not enforce it'
    );
  }

  /* THE LEDGER-INTERNAL READ — one plant per condition, and a control for each way it could
     over-report: a row citing nobody, a row citing itself, and a longer key sharing a prefix. */
  {
    const OPEN_KEY = '2026-10-20-bar';
    const LONGER = '2026-10-20-bar-baz';
    const text = [
      row(OPEN_KEY, 'the defect', 'OPEN'),
      row(LONGER, 'a different defect', 'OPEN'),
      row('2026-10-21-citer-open', `this measures ${OPEN_KEY}`, 'OPEN'),
      row('2026-10-21-citer-closed', `this answers ${OPEN_KEY}`, 'answered #3466'),
      row('2026-10-21-citer-of-the-longer', `this measures ${LONGER}`, 'fixed #1'),
      row('2026-10-21-cites-nobody', 'an unrelated defect', 'OPEN')
    ].join('\n');
    const rowSet = parseRows(text);
    const c = citedBy([OPEN_KEY, LONGER], rowSet);
    assert(
      c
        .get(OPEN_KEY)
        ?.map((e) => `${e.id}=${e.state}`)
        .join(',') === '2026-10-21-citer-open=OPEN,2026-10-21-citer-closed=answered #3466',
      'a citing row is reported with its own state, closed or not, in ledger order'
    );
    assert(
      c
        .get(LONGER)
        ?.map((e) => e.id)
        .join() === '2026-10-21-citer-of-the-longer',
      'a key sharing a prefix takes only the rows that name it in full'
    );
    assert(!c.has('2026-10-21-cites-nobody') && !c.has('2026-10-21-citer-open'), 'only the keys asked for are reported, and a row citing nobody appears nowhere');
    assert(citedBy([OPEN_KEY], [rowSet[0]]).size === 0, 'a row does not cite itself through its own id cell');
    assert(citedBy([], rowSet).size === 0, 'no keys asked, nothing reported');
    const pvc = pickupVerdict(pickupDrift(text, text), { behind: 0, base: 'b', commit: 'abc1234', citedBy: 2 });
    assert(pvc.result.openCitedByRow === 2 && pvc.status === 'PASS', 'the verdict carries the citing count, which never moves the status');
    assert(pickupVerdict(pickupDrift(text, text), { behind: 0, base: 'b', commit: 'abc1234' }).result.openCitedByRow === null, 'an absent citing read is null, never 0');
  }

  /* FAN-OUT — the citing row's own breadth, with a control for each way it could inflate: a key named
     twice, the row naming its own id again, and a changeset filename that is key-shaped and names no row. */
  {
    const A = '2026-10-24-alpha';
    const B = '2026-10-24-beta';
    const ftext = [
      row(A, 'the defect', 'OPEN'),
      row(B, 'another defect', 'OPEN'),
      row('2026-10-25-narrow', `this measures ${A}`, 'OPEN'),
      row('2026-10-25-carrier', `this carries ${A} and ${B} and 2026-10-24-gamma`, 'answered #1'),
      row('2026-10-25-twice', `${A} again, and ${A}`, 'OPEN'),
      row('2026-10-25-changeset-only', `the changeset changes/${B}.md`, 'fixed #2')
    ].join('\n');
    const frows = parseRows(ftext);
    const fc = citedBy([A, B], frows);
    assert(
      fc
        .get(A)
        ?.map((e) => `${e.id}:${e.fanOut}`)
        .join(',') === '2026-10-25-narrow:1,2026-10-25-carrier:3,2026-10-25-twice:1',
      'fan-out counts the DISTINCT rows a citing row names, so a key named twice still reads 1'
    );
    assert(
      fc
        .get(B)
        ?.map((e) => e.id)
        .join() === '2026-10-25-carrier',
      'a changeset filename is a key-shaped slug, not a citation, so the row naming only one cites nobody'
    );
    assert(namedKeys(row(A, `this measures ${A}`), A).size === 0, 'a row naming its own key in prose does not cite itself');
    assert(namedKeys(`changes/${A}.md and ${B}`, 'x').size === 1, 'the changeset exclusion drops the .md token and keeps its neighbour');
  }

  /* THE KIND SPLIT — a correction and a mention read the same way without it, and a row-level verb
     test would publish a multi-row citer as the corrector of every row it names. Each arm carries
     its own control: the SAME citer without a verb must read `citation`, or the verb is doing
     nothing. (Row 2026-10-26-a-correcting-row-leaves-no-mark-on-the-row-it-corrects.) The synthetic
     keys are dated BEFORE the ledger floor on purpose: `residue-citations.mjs` scans this file, the
     `row(` call is itself a citation word, and a key below the floor names no row and never could, so
     the fixtures cost the citation baseline no declared debt. Keep them pre-floor. */
  {
    const T1 = '2026-08-30-target-one';
    const T2 = '2026-08-30-target-two';
    const ktext = [
      row(T1, 'the defect', 'OPEN'),
      row(T2, 'another defect', 'OPEN'),
      row('2026-08-30-narrow-corrector', `this CORRECTS ${T1}`, 'OPEN'),
      row('2026-08-30-narrow-mention', `this measures ${T1} without a verb`, 'OPEN'),
      row('2026-08-30-broad-corrector', `this corrects ${T1} and also names ${T2}`, 'OPEN'),
      row('2026-08-30-dangling-corrector', `this supersedes ${T2} and names 2026-08-30-no-such-row`, 'OPEN')
    ].join('\n');
    const krows = parseRows(ktext);
    const kc = citedBy([T1, T2], krows);
    const kindOf = (k, id) => kc.get(k)?.find((e) => e.id === id)?.kind;
    assert(kindOf(T1, '2026-08-30-narrow-corrector') === 'correction', 'a verb-carrying citer that names ONE row is attributable');
    assert(kindOf(T1, '2026-08-30-narrow-mention') === 'citation', 'CONTROL · the same shape without a verb is a plain citation');
    assert(kindOf(T1, '2026-08-30-broad-corrector') === 'correction-unattributable', 'a verb-carrying citer that names SEVERAL rows is not attributed to either');
    assert(kindOf(T2, '2026-08-30-broad-corrector') === 'correction-unattributable', 'and the other row it names reads the same, since the read cannot choose between them');
    assert(kindOf(T2, '2026-08-30-dangling-corrector') === 'correction', 'a key that resolves to NO row cannot take the verb, so naming it beside one real row leaves the verb attributable');
    assert(keysWithKind(kc, 'correction') === 2 && keysWithKind(kc, 'correction-unattributable') === 2, 'the counts are over KEYS, and a key holding both kinds is counted under both');
    assert(keysWithKind(kc, 'citation') === 1, 'and a key cited without a verb is counted under the plain kind alone');
    const kv = pickupVerdict(pickupDrift(ktext, ktext), { behind: 0, base: 'b', commit: 'abc1234', citedBy: 2, correctedBy: 2, correctionUnattributable: 2 });
    assert(kv.result.openCorrectedByRow === 2 && kv.result.openCorrectionUnattributable === 2 && kv.status === 'PASS', 'the verdict carries both kind counts, and neither moves the status');
    const kvAbsent = pickupVerdict(pickupDrift(ktext, ktext), { behind: 0, base: 'b', commit: 'abc1234', citedBy: 2 });
    assert(kvAbsent.result.openCorrectedByRow === null && kvAbsent.result.openCorrectionUnattributable === null, 'an absent kind read is null, never 0 — §∅');
    assert(
      CORRECTION_VERBS.test('corrected') && CORRECTION_VERBS.test('CORRECTS') && !CORRECTION_VERBS.test('correctness'),
      'the verb set matches whole words, so a longer word carrying one is not a verb'
    );
  }

  /* ── THE DISCHARGED CORRECTOR ─────────────────────────────────────────────────────────────────
     A row whose key is the ARGUMENT of another row's `withdrawn <key>` state has had its withdrawal
     land, so it states a defect that is not a defect and no fix can close it. The read is a STATE
     cell, so every plant below is a state the closed vocabulary allows, and every control is a shape
     that must NOT count. Pre-floor keys, for the reason the block above states. */
  {
    const W = '2026-08-30-discharged-corrector';
    const U = '2026-08-30-untouched-row';
    const Z = '2026-08-30-corrector-that-closed';
    const wtext = [
      row(W, 'this withdraws the row below', 'OPEN'),
      row('2026-08-30-the-withdrawn-row', 'the defect that was not one', `withdrawn ${W}`),
      row(U, 'a defect nobody has touched', 'OPEN'),
      row(Z, 'this withdrew something too', 'fixed #1'),
      row('2026-08-30-the-second-withdrawn-row', 'another non-defect', `withdrawn ${Z}`),
      row('2026-08-30-a-bare-state', 'a state carrying no key', 'withdrawn'),
      row('2026-08-30-a-dangling-state', 'a state naming no row', 'withdrawn 2026-08-30-no-such-row')
    ].join('\n');
    const wrows = parseRows(wtext);
    const wopen = pickupDrift(wtext, wtext).openOnRef;
    const wl = withdrawalLanded(wopen, wrows);
    assert(wl.get(W)?.join() === '2026-08-30-the-withdrawn-row', 'an OPEN row named by a `withdrawn` state is marked, and the mark names the row that withdraws to it');
    assert(!wl.has(U), 'CONTROL · an OPEN row that no state names carries no mark');
    assert(!wl.has(Z), 'CONTROL · the read asks about the OPEN keys alone, so a corrector that already closed is not marked again');
    assert(wl.size === 1, 'and nothing else in the plant counts: a bare `withdrawn`, and one naming no row, each give no mark');
    assert(
      !WITHDRAWAL_STATE.test('withdrawn') && !WITHDRAWAL_STATE.test('fixed #1') && !WITHDRAWAL_STATE.test(`withdrawn ${W} and ${U}`) && !WITHDRAWAL_STATE.test(`see withdrawn ${W}`),
      'the state pattern takes exactly one key, anchored at both ends — a second key, a prefix and another state all fail it'
    );
    const wv = pickupVerdict(pickupDrift(wtext, wtext), { behind: 0, base: 'b', commit: 'abc1234', withdrawalLanded: wl.size });
    assert(wv.result.openWithdrawalLanded === 1 && wv.status === 'PASS', 'the verdict carries the count, and it does not move the status');
    const wvAbsent = pickupVerdict(pickupDrift(wtext, wtext), { behind: 0, base: 'b', commit: 'abc1234' });
    assert(wvAbsent.result.openWithdrawalLanded === null, 'CONTROL · an absent read is null, never 0 — §∅');
    /* ∅ ANTI-VACUITY, AND IT MUST NOT BLOCK ITS OWN FIX. A floor on the DISCHARGED count falls to 0
       the day a RESIDUE-only PR closes the three live rows, which is the outcome this mark exists to
       produce — the shape I measured on 2026-11-11 in `residue-citations.mjs`. So the floor sits on
       the `withdrawn` STATE rows instead, a count an append-only ledger only ever gains. It proves
       the pattern reads the live markup without pinning today's debt.
       ⚠️ A read this leg cannot make is a FAILURE, never a skip: the pattern would then be held
       against a plant alone, and the live count could read 0 forever in the same green. */
    const liveLedger = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', LEDGER_PATH);
    let liveText = null;
    try {
      liveText = readFileSync(liveLedger, 'utf8');
    } catch (err) {
      liveText = null;
      assert(false, `the live ledger was not readable at ${liveLedger} (${err.code || 'EREAD'}), so the state pattern was held against plants alone`);
    }
    const liveStates = parseRows(liveText).filter((r) => WITHDRAWAL_STATE.test(String(r.state ?? '').trim())).length;
    assert(liveStates >= 1, `the pattern reads the live ledger's own markup (${liveStates} row(s) carry a \`withdrawn <key>\` state)`);
  }

  /* ── THE OWNER-RESERVED READ ───────────────────────────────────────────────────────────────────
     A fixture per DECLARED phrase, so a regex that stops matching reds here rather than reading 0 over
     a live ledger that still carries the phrase. Then the two controls a prose read needs: a row with
     no such phrase, and a CLOSED row that carries one. The read is a function over rows, so these legs
     need no git and no tree.
     ⚠️ EVERY PLANT KEY IS DATED BEFORE 2026-09-02, the citation floor in `residue-citations.mjs`. A
     synthetic key dated inside the live range reds that gate as a citation resolving to no row, and
     the cure is the date and never a baseline line: measured here, two in-range plants redded step 6
     of 67 and left 61 steps un-run. */
  {
    const owned = OWNER_RESERVED_PHRASES.map((p, i) => [`2026-08-30-owner-phrase-${i}`, p]);
    const otext = [
      ...owned.map(([id, p]) => row(id, `a defect, and ${p.sample}`)),
      row('2026-08-30-no-owner-phrase', 'a defect the fleet can fix itself'),
      row('2026-08-30-a-closed-owner-row', "the remedy is the owner's", 'fixed #1')
    ].join('\n');
    const orows = parseRows(otext);
    const oopen = pickupDrift(otext, otext).openOnRef;
    const res = ownerReserved(oopen, orows);
    for (const [id, p] of owned) {
      assert(p.re.test(p.sample), `the declared phrase \`${p.name}\` matches its own sample, so the regex is alive`);
      assert(res.get(id)?.includes(p.name), `and the read marks the row carrying it, naming \`${p.name}\``);
    }
    assert(res.size === OWNER_RESERVED_PHRASES.length, `every declared phrase marks its own row and nothing else does (${res.size} of ${OWNER_RESERVED_PHRASES.length})`);
    assert(!res.has('2026-08-30-no-owner-phrase'), 'CONTROL · an OPEN row whose cells reserve nothing carries no mark');
    assert(!res.has('2026-08-30-a-closed-owner-row'), 'CONTROL · the read asks about the OPEN keys alone, so a CLOSED row carrying the phrase is not marked');
    assert(ownerReserved([], orows).size === 0 && ownerReserved(oopen, []).size === 0, 'CONTROL · no keys and no rows each mark nothing, and neither throws');
    const ov = pickupVerdict(pickupDrift(otext, otext), { behind: 0, base: 'b', commit: 'abc1234', ownerReserved: res.size });
    assert(ov.result.openOwnerReserved === res.size && ov.status === 'PASS', 'the verdict carries the count, and a convention does not move the status');
    assert(pickupVerdict(pickupDrift(otext, otext), { behind: 0, base: 'b', commit: 'abc1234' }).result.openOwnerReserved === null, 'CONTROL · an absent read is null, never 0 — §∅');
    /* ∅ ANTI-VACUITY OVER A MONOTONE POPULATION. The floor counts the phrase over EVERY row, which an
       append-only ledger only ever gains. A floor on the OPEN hits would fall to 0 the day the owner
       discharges the five live rows, which is the outcome this mark exists to produce.
       ⚠️ A read this leg cannot make is a FAILURE, never a skip. */
    const liveOwnerLedger = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', LEDGER_PATH);
    let liveOwnerText = null;
    try {
      liveOwnerText = readFileSync(liveOwnerLedger, 'utf8');
    } catch (err) {
      liveOwnerText = null;
      assert(false, `the live ledger was not readable at ${liveOwnerLedger} (${err.code || 'EREAD'}), so the phrase list was held against plants alone`);
    }
    const liveRows = parseRows(liveOwnerText);
    const liveHits = ownerReserved(
      liveRows.map((r) => r.id),
      liveRows
    );
    assert(liveHits.size >= 33, `the phrase list reads the live ledger's own prose (${liveHits.size} row(s) of ${liveRows.length} reserve a remedy, floor 33 measured 2026-11-11)`);
  }

  /* ── THE POINTER READ ──  /* ── THE POINTER READ ─────────────────────────────────────────────────────────────────────────
     One plant per class, a control for each way the annotation could over-report, and the formatter
     held against a state the plants cannot produce. The reader is a function over a table, so these
     legs need no git and no tree. */
  {
    const serve = (table) => (q) => (q in table ? table[q] : null);
    const txt = (defect) => parseRows(row('2026-11-01-a-pointer-row', defect))[0].key;

    let st = rowPointerState(txt('the `beta` at a.js:2'), serve({ 'a.js': ['x', 'the `beta` here', 'y'] }));
    assert(st.cites === 1 && st.anchored === 1 && st.detail.length === 0, 'a citation whose cited line still carries a row identifier is anchored');
    assert(pointerNote(st) === '', 'CONTROL · an anchored row prints NO note, so a note always means drift');

    st = rowPointerState(txt('the `beta_gamma` at a.js:2'), serve({ 'a.js': ['x', 'y', 'z', 'w', 'the `beta_gamma` here'] }));
    assert(st.moved === 1 && st.detail[0].now === 5, 'a citation whose identifier sits elsewhere is moved, and the hint names that line');
    assert(/1 of 1 cite\(s\) drifted — 1 moved/.test(pointerNote(st)) && /now sits at :5/.test(pointerNote(st)), 'the moved note names the count and the lead');

    st = rowPointerState(txt('the `beta_gamma` at a.js:2'), serve({ 'a.js': ['x', 'y', 'z'] }));
    assert(st.unanchored === 1 && st.moved === 0, 'a citation whose identifier sits nowhere in the file anchors nothing');
    assert(/anchoring nothing/.test(pointerNote(st)), 'the note says the citation anchors nothing');

    st = rowPointerState(txt('the `beta_gamma` at a.js:99'), serve({ 'a.js': ['x', 'y', 'z'] }));
    assert(st.beyondEof === 1 && st.detail[0].length === 3, 'a citation past the last line is beyond-eof, and the note carries the real length');
    assert(/past end of file/.test(pointerNote(st)), 'the note says the pointer sits past the end of its file');

    st = rowPointerState(txt('the `beta_gamma` at b.js:2'), serve({ 'a.js': ['x', 'y'] }));
    assert(st.unresolved === 1 && st.cites === 1, 'a citation at a path the reader cannot resolve is unresolved, NEVER rot');
    assert(/at no tracked path/.test(pointerNote(st)), 'the note states the class this read did not split');

    st = rowPointerState(txt('prose with no pointer in it at all'), serve({}));
    assert(st.cites === 0 && pointerNote(st) === '', 'CONTROL · a row citing no path is counted as citing nothing and prints no note');

    st = rowPointerState(txt('the `beta_gamma` at a.js:2 and again at a.js:1'), serve({ 'a.js': ['the `beta_gamma` here', 'y'] }));
    assert(st.cites === 2 && st.anchored === 1 && st.moved === 1, 'one row holding two citations is judged per citation, not per row');

    /* THE FORMATTER OVER A STATE THE PLANTS CANNOT REACH: a verdict this reader does not place must
       be PRINTED, because a fifth class folded into one of the four reads as a measurement. */
    const odd = { cites: 1, anchored: 0, moved: 0, unanchored: 0, beyondEof: 0, unresolved: 0, unclassified: 1, detail: [{ path: 'a.js', line: 1, verdict: 'weird' }] };
    assert(/1 unclassified/.test(pointerNote(odd)), 'an unplaced verdict is named in the note');
    const noLead = { cites: 1, anchored: 0, moved: 1, unanchored: 0, beyondEof: 0, unresolved: 0, unclassified: 0, detail: [{ path: 'a.js', line: 1, verdict: 'moved', now: null }] };
    assert(/1 moved/.test(pointerNote(noLead)) && !/e\.g\./.test(pointerNote(noLead)), 'a moved citation with no lead line prints the count and no example');

    const clean = rowPointerState(txt('the `beta` at a.js:2'), serve({ 'a.js': ['x', 'the `beta` here'] }));
    const drift2 = rowPointerState(txt('the `beta_gamma` at a.js:2'), serve({ 'a.js': ['x', 'y', 'z'] }));
    const bare = rowPointerState(txt('prose only'), serve({}));
    const t = pointerTotals(
      new Map([
        ['k1', clean],
        ['k2', drift2],
        ['k3', bare]
      ])
    );
    assert(t.rows === 3 && t.citing === 2 && t.drifted === 1, 'the totals separate the rows that cite nothing from the rows whose pointers hold');
    assert(t.cites === 2 && t.anchored === 1 && t.unanchored === 1, 'the totals sum the citation classes over the citing rows only');
    assert(pointerTotals(new Map()).rows === 0 && pointerTotals(null).rows === 0, 'CONTROL · an empty or absent state map totals zero and throws nothing');

    assert(pointerTag(drift2) === ', pointer: 1 of 1 drifted', 'the lead tag states the count alone, because the lead already names the row');
    assert(pointerTag(clean) === '' && pointerTag(bare) === '' && pointerTag(null) === '', 'CONTROL · a sound pointer, a row citing nothing and an absent state all tag nothing');
  }

  /* BLACK BOX: the CLI in a scratch repo. Commit 1 adds the row in a code commit that names it (a
     remainder row); commit 2 is a code fix that names it; commit 3 only annotates the ledger. The
     listing must name commit 2 alone. */
  {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'residue-ids-code-'));
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      mkdirSync(path.join(scratch, 'tools'));
      mkdirSync(path.join(scratch, 'briefs'));
      for (const f of ['residue-ids.mjs', 'argv-guard.mjs', 'residue-cite-drift.mjs', 'regex-escape-core.mjs']) copyFileSync(path.join(here, f), path.join(scratch, 'tools', f));
      copyFileSync(path.join(here, '..', 'verdict.js'), path.join(scratch, 'verdict.js'));
      const K = '2026-10-20-a-scratch-row';
      const g = (...a) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=selftest', ...a], { cwd: scratch, encoding: 'utf8' });
      const put = (f, t) => writeFileSync(path.join(scratch, f), t);
      g('init', '-q');
      put('briefs/RESIDUE.md', `${row(K)}\n`);
      put('a.js', '1\n');
      g('add', '-A');
      g('commit', '-qm', `fix(a): a change that logs its remainder ${K}`);
      put('a.js', '2\n');
      g('add', 'a.js');
      g('commit', '-qm', `fix(a): the fix for ${K}`);
      const fix = g('rev-parse', '--short=9', 'HEAD').trim();
      /* The third row's STATE withdraws to the second, so the second is a DISCHARGED CORRECTOR and
         the listing must mark it. It leaves the open count at 2, so the lead assertions above hold. */
      put(
        'briefs/RESIDUE.md',
        `${row(K)}\n${row('2026-10-20-another-row', "a defect whose remedy is the owner's")}\n${row('2026-08-30-a-withdrawn-scratch-row', 'd', 'withdrawn 2026-10-20-another-row')}\n`
      );
      g('add', 'briefs/RESIDUE.md');
      g('commit', '-qm', `docs(residue): a note about ${K}`);
      const run = spawnSync(process.execPath, [path.join(scratch, 'tools', 'residue-ids.mjs'), '--open', '--base', 'HEAD'], { cwd: scratch, encoding: 'utf8' });
      assert(run.status === 0, `BLACK BOX: --open exits 0 on an agreeing read (exit ${run.status}: ${run.stderr})`);
      assert(run.stdout.includes(`  ${K}  ← named by code: ${fix}\n`), 'BLACK BOX: the listing names the fixing commit, and only it');
      assert(/1 of the 2 OPEN row\(s\) are named by a later commit/.test(run.stdout), 'BLACK BOX: the summary counts the one lead');
      assert(/"openNamedByCode":1/.test(run.stdout), 'BLACK BOX: the verdict carries the lead count');
      assert(
        run.stdout.includes('  2026-10-20-another-row  ← WITHDRAWAL LANDED: 2026-08-30-a-withdrawn-scratch-row reads `withdrawn 2026-10-20-another-row`'),
        'BLACK BOX: the listing marks the discharged corrector beside its own row, and names the row that withdraws to it'
      );
      assert(!run.stdout.includes(`  ${K}  ← WITHDRAWAL LANDED`), 'BLACK BOX · CONTROL: the other OPEN row carries no mark');
      assert(/1 of the 2 OPEN row\(s\) are the ARGUMENT of another/.test(run.stdout), 'BLACK BOX: the summary counts the one discharged corrector');
      assert(/"openWithdrawalLanded":1/.test(run.stdout), 'BLACK BOX: the verdict carries that count too');
      assert(
        run.stdout.includes("  ← OWNER-RESERVED (prose): remedy-is-the-owners — this row's own cells reserve the remedy for the owner"),
        'BLACK BOX: the listing marks the owner-reserved row and names the phrase it read'
      );
      assert(run.stdout.split('← OWNER-RESERVED').length - 1 === 1, 'BLACK BOX · CONTROL: exactly one of the 2 OPEN rows is marked, so the other reserves nothing');
      assert(/1 of the 2 OPEN row\(s\) RESERVE the remedy for the OWNER/.test(run.stdout), 'BLACK BOX: the summary counts the one owner-reserved row');
      assert(/"openOwnerReserved":1/.test(run.stdout), 'BLACK BOX: the verdict carries that count too');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  /* THE EMPTY COMPARISON. Both texts the default mode reads are committed, so a run made before the
     commit compares HEAD with itself and prints an honest zero about the wrong population. These
     plants hold the pure half against the four shapes a working copy can be in, and the CLOSE plant
     is the one a key count alone would miss. */
  {
    const HEAD_TEXT = [row(A), row(B)].join('\n');
    let w = worktreeFacts(HEAD_TEXT, HEAD_TEXT);
    assert(w.read && !w.differs && w.newKeys.length === 0, 'a working copy equal to HEAD reports no difference');
    w = worktreeFacts(HEAD_TEXT, [row(A), row(B), row(C)].join('\n'));
    assert(w.differs && w.newKeys.join() === C && w.changedKeys.length === 0, 'an uncommitted new row is named as a new key');
    w = worktreeFacts(HEAD_TEXT, [row(A), row(B, 'd', 'fixed #4719')].join('\n'));
    assert(w.differs && w.newKeys.length === 0 && w.changedKeys.join() === B, 'an uncommitted CLOSE is a changed row, and no key count would see it');
    w = worktreeFacts(HEAD_TEXT, [row(A)].join('\n'));
    assert(w.differs && w.removedKeys.join() === B, 'a row deleted in the working copy is named as removed');
    w = worktreeFacts(HEAD_TEXT, null);
    assert(!w.read && !w.differs, 'an unread working copy says it was unread, never that it agrees');
  }

  /* BLACK BOX: the default mode over an UNCOMMITTED row. The run keeps its exit code and its honest
     zero, and it must still name the commit it compared and the row it never looked at. The exit
     code stays 0 by decision: CI runs this mode on a clean checkout, and what it judges is a commit
     (board #5098). The remedy here is that a reader can no longer mistake the two. */
  {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'residue-ids-uncommitted-'));
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      mkdirSync(path.join(scratch, 'tools'));
      mkdirSync(path.join(scratch, 'briefs'));
      for (const f of ['residue-ids.mjs', 'argv-guard.mjs', 'residue-cite-drift.mjs', 'regex-escape-core.mjs']) copyFileSync(path.join(here, f), path.join(scratch, 'tools', f));
      copyFileSync(path.join(here, '..', 'verdict.js'), path.join(scratch, 'verdict.js'));
      const g = (...a) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=selftest', ...a], { cwd: scratch, encoding: 'utf8' });
      const ledger = path.join(scratch, 'briefs', 'RESIDUE.md');
      writeFileSync(ledger, `${row(A)}\n`);
      g('init', '-q');
      g('add', 'briefs/RESIDUE.md');
      g('commit', '-qm', 'the committed ledger');
      const head = g('rev-parse', '--short=9', 'HEAD').trim();
      writeFileSync(ledger, `${row(A)}\n${row(C)}\n`);
      const run = spawnSync(process.execPath, [path.join(scratch, 'tools', 'residue-ids.mjs'), '--base', 'HEAD'], { cwd: scratch, encoding: 'utf8' });
      assert(run.status === 0, `BLACK BOX: a pre-commit run keeps exit 0 (exit ${run.status}: ${run.stderr})`);
      assert(/ok — 0 row\(s\) added/.test(run.stdout), 'BLACK BOX: the honest zero still prints');
      assert(run.stderr.includes(head), 'BLACK BOX: the run names the commit it compared');
      assert(/1 new key\(s\)/.test(run.stderr) && run.stderr.includes(C), 'BLACK BOX: the uncommitted row is named as outside the comparison');
      const json = spawnSync(process.execPath, [path.join(scratch, 'tools', 'residue-ids.mjs'), '--base', 'HEAD', '--json'], { cwd: scratch, encoding: 'utf8' });
      const parsed = JSON.parse(json.stdout);
      assert(parsed.comparison.headCommit === head && parsed.comparison.worktree.newKeys.join() === C, 'BLACK BOX: the JSON carries the comparison and the skipped key');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  // Phrased so `selftest-all.mjs` can PARSE the count: a tool that silently drops from 8
  // assertions to 1 still exits 0, and only a readable number makes that visible.
  console.log(`selftest: all ${ran} selftests passed`);
  process.exit(0);
}

if (isCliEntry(import.meta.url)) main();
