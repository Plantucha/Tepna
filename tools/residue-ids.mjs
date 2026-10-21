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
 *   node tools/residue-ids.mjs --open           # the OPEN rows AT THE REF, plus every state the file on disk gets wrong
 *   node tools/residue-ids.mjs --open --verdict-sample   # the pickup verdict alone, for the adoption gate
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';

/* `verdict.js` is CommonJS and sits at the repo root; this is the idiom `tools/mutate.mjs` uses. */
const Verdict = createRequire(import.meta.url)('../verdict.js');

export const LEDGER_PATH = 'briefs/RESIDUE.md';

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
         and that stays a collision (the control below, and the 704-row population measurement in #3815).
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
    if (prior.key !== r.key && !isPointerRepair(prior.key, r.key, (k) => headById.has(k))) mutated.push(`${r.id} — a non-state cell was edited (rows are append-and-close)`);
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
  return { collisions, mutated, added, landed };
}

/* ── THE PICKUP HALF: the list a session sizes work from must come from the REF ───────────────────
   Row 2026-10-20-the-primary-checkouts-ledger-read-is-eleven-commits-stale. A session picks a unit by
   reading `briefs/RESIDUE.md` in the shared primary checkout. That file sits at branch `main`, which
   trails `origin/main` by hours, so a row closed this morning still reads OPEN and NOTHING in the
   output says the file is behind. Measured 2026-10-20 in `/home/michal/Tepna`: 13 commits behind, 86
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
  const v = Verdict.make({
    gate: 'residue-pickup',
    status: stale === 0 ? 'PASS' : 'FAIL',
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
      behindCommits: ctx.behind,
      base: ctx.base
    },
    evidence: [LEDGER_PATH, 'tools/residue-ids.mjs'],
    reason:
      stale === 0
        ? null
        : `the read is stale: ${drift.differs.length} row(s) differ (${drift.staleOpen.length} read OPEN and are closed on ${ctx.base}), and ${drift.onlyRef.length} row(s) exist only on ${ctx.base}`,
    producedBy: { tool: 'tools/residue-ids.mjs', commit: ctx.commit }
  });
  const ck = Verdict.validate(v);
  if (!ck.ok) throw new Error(`pickup verdict invalid: ${ck.errors.join('; ')}`);
  return v;
}

/* ── everything below is I/O; the core above is pure and is what the suite drives ── */

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

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
    const v = pickupVerdict(drift, { behind, base, commit });
    if (sample) {
      process.stdout.write(`${JSON.stringify(v)}\n`);
      process.exit(0);
    }
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ verdict: v, ...drift }, null, 2)}\n`);
      process.exit(v.status === 'PASS' ? 0 : 1);
    }
    process.stdout.write(`residue-pickup: ${drift.openOnRef.length} OPEN row(s) at ${base}${behind === null ? '' : ` (this tree is ${behind} commit(s) behind it)`}\n`);
    for (const k of drift.openOnRef) process.stdout.write(`  ${k}\n`);
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

  const v = verdict(baseText, headText, tipText);
  const problems = [...v.collisions, ...v.mutated];

  if (asJson) {
    process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
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
  } else {
    process.stdout.write(`residue-ids: ok — ${v.added.length} row(s) added, none colliding, none mutated\n`);
  }
  // A landed row is said out loud in both outcomes: it is the reason a count can read 0 added, and a
  // reader who is not told would go looking for the row the branch appears to have lost.
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

  // Phrased so `selftest-all.mjs` can PARSE the count: a tool that silently drops from 8
  // assertions to 1 still exits 0, and only a readable number makes that visible.
  console.log(`selftest: all ${ran} selftests passed`);
  process.exit(0);
}

if (isCliEntry(import.meta.url)) main();
