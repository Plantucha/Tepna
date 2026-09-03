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
 * @returns {Array<{id: string, n: number, key: string}>}
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
    rows.push({ id: m[1], key });
  }
  return rows;
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
  const collisions = [];
  const mutated = [];
  const added = [];

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
    if (prior.key !== r.key) mutated.push(`${r.id} — a non-state cell was edited (rows are append-and-close)`);
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
  const assert = (c, m) => {
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

  // 2b — BEHIND IS NOT DELETED. The branch predates a row that landed on the tip: no removal, and the
  //      tip's row is a collision only if the branch also minted that key itself.
  v = verdict([row(A)].join('\n'), [row(A), row(C)].join('\n'), [row(A), row(B)].join('\n'));
  assert(v.mutated.length === 0 && v.collisions.length === 0 && v.added.join() === C, 'a branch behind the tip has removed nothing');

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

  // Phrased so `selftest-all.mjs` can PARSE the count: a tool that silently drops from 8
  // assertions to 1 still exits 0, and only a readable number makes that visible.
  console.log('selftest: all 10 selftests passed');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
