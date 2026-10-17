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
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';

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
export function parseRows(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\s*\|/);
    if (!m) continue;
    const cells = line.split('|');
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
 * @returns {{collisions: string[], mutated: string[], added: string[]}}
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
      // present on the tip but not on the base ⇒ someone else minted it concurrently
      if (tipById.has(r.id)) {
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
  return { collisions, mutated, added };
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
  process.exit(problems.length ? 1 : 0);
}

/* self-test: node tools/residue-ids.mjs --selftest (pure core only — no git, no refs).
   Every assertion below is a PLANT: the collision this tool was written for went green on a full
   docs-ledger run, so a selftest that only checks the happy path would reproduce that blindness. */
if (process.argv.includes('--selftest')) {
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

  // Phrased so `selftest-all.mjs` can PARSE the count: a tool that silently drops from 8
  // assertions to 1 still exits 0, and only a readable number makes that visible.
  console.log(`selftest: all ${ran} selftests passed`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
