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
 *   2. ids added on this branch extend main's maximum, monotonically (never reused, never
 *      backfilled into a gap — a gap means a row was deleted, which the contract forbids)
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
    const m = line.match(/^\|\s*(R(\d+))\s*\|/);
    if (!m) continue;
    const cells = line.split('|');
    // leading '' + 6 cells + trailing '' — a malformed row is check8b's finding, not ours;
    // take what identity we can and let the other gate speak to its shape.
    const key = cells.slice(1, 6).join('|').trim();
    rows.push({ id: m[1], n: Number(m[2]), key });
  }
  return rows;
}

/**
 * Pure core. Compares this branch's ledger against the base's.
 *
 * @param {string} baseText  ledger as of the merge base / origin/main
 * @param {string} headText  ledger on this branch
 * @returns {{collisions: string[], nonMonotonic: string[], mutated: string[], added: string[], baseMax: number}}
 */
export function verdict(baseText, headText) {
  const base = parseRows(baseText);
  const head = parseRows(headText);
  const baseById = new Map(base.map((r) => [r.id, r]));
  const collisions = [];
  const nonMonotonic = [];
  const mutated = [];
  const added = [];
  const baseMax = base.reduce((a, r) => Math.max(a, r.n), 0);

  for (const r of head) {
    const prior = baseById.get(r.id);
    if (!prior) {
      added.push(r.id);
      // An id at or below main's high-water mark is a collision even when main has no such
      // row today: ids are never reused, so a gap is a deleted row, not a free slot.
      if (r.n <= baseMax) collisions.push(`${r.id} — main's ledger already reaches R${baseMax}`);
      continue;
    }
    if (prior.key !== r.key) mutated.push(`${r.id} — a non-state cell was edited (rows are append-and-close)`);
  }
  for (const r of base) {
    if (!head.some((h) => h.id === r.id)) mutated.push(`${r.id} — removed from the ledger (rows are never deleted)`);
  }
  // added ids must themselves be unique and ascending
  const seen = new Set();
  let last = baseMax;
  for (const id of added) {
    if (seen.has(id)) collisions.push(`${id} — added twice on this branch`);
    seen.add(id);
    const n = Number(id.slice(1));
    if (n <= last && n > baseMax) nonMonotonic.push(`${id} — not ascending (previous added id was R${last})`);
    if (n > last) last = n;
  }
  return { collisions, nonMonotonic, mutated, added, baseMax };
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
  try {
    git(['rev-parse', '--verify', base]);
    baseText = readAt(base);
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

  const v = verdict(baseText, headText);
  const problems = [...v.collisions, ...v.nonMonotonic, ...v.mutated];

  if (asJson) {
    process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  } else if (problems.length) {
    process.stderr.write(`residue-ids: ${problems.length} problem(s) against ${base}\n`);
    for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
    // Say what to DO, and only the remedy that fits what actually fired — a renumber hint on a
    // mutated row would send the reader to the wrong repair.
    if (v.collisions.length || v.nonMonotonic.length) {
      process.stderr.write(`\n  ${base}'s ledger reaches R${v.baseMax}. Renumber your new rows above it and update\n`);
      process.stderr.write('  each source brief’s **Residue:** back-reference to match.\n');
    }
    if (v.mutated.length) {
      process.stderr.write('\n  Rows are appended and CLOSED, never edited or deleted: only the state cell may\n');
      process.stderr.write('  change (OPEN → `→ `<brief>`` | `fixed #N`). A wrong row gets a NEW row saying so.\n');
    }
  } else {
    process.stdout.write(`residue-ids: ok — ${v.added.length} row(s) added above R${v.baseMax}, none colliding, none mutated\n`);
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
  const BASE = [row('R1'), row('R2')].join('\n');

  // 1 — the measured failure: main reached R2 while the branch still ended at R1, so R2 is a collision
  //     even though the branch's own file is internally consistent (this is what docs-ledger cannot see)
  let v = verdict(BASE, [row('R1'), row('R2', 'different defect')].join('\n'));
  assert(v.mutated.length === 1 && v.collisions.length === 0, 'an id present on main with edited cells is a MUTATION, not a collision');
  v = verdict([row('R1')].join('\n'), [row('R1'), row('R2')].join('\n'));
  assert(v.collisions.length === 0 && v.added.join() === 'R2', 'appending the next id above the base max is clean');

  // 2 — an id at or below main's high-water mark, with no such row on main: a deleted-row gap is not a free slot
  v = verdict([row('R1'), row('R3')].join('\n'), [row('R1'), row('R2'), row('R3')].join('\n'));
  assert(v.collisions.length === 1 && v.collisions[0].startsWith('R2'), 'backfilling a gap below main’s max FIRES');

  // 3 — rows are append-and-close: a removal and a non-state edit both fire; a STATE change does not
  v = verdict(BASE, [row('R1')].join('\n'));
  assert(v.mutated.length === 1 && v.mutated[0].startsWith('R2'), 'removing a row that exists on main FIRES');
  v = verdict(BASE, [row('R1'), row('R2', 'd', 'fixed #2114')].join('\n'));
  assert(v.mutated.length === 0 && v.collisions.length === 0, 'closing a row by its STATE cell alone is clean');

  // 4 — two rows added with the same id on one branch (docs-ledger check8c catches this one too;
  //     asserted here so the two gates are known to agree rather than assumed to)
  v = verdict(BASE, [row('R1'), row('R2'), row('R3'), row('R3', 'other')].join('\n'));
  assert(
    v.collisions.some((c) => c.includes('added twice')),
    'an id added twice on the branch FIRES'
  );

  // 5 — non-vacuous: the parser must actually see rows, or every assertion above passes on empty input
  assert(parseRows(BASE).length === 2 && parseRows('').length === 0, 'parseRows reads rows (and only rows)');
  assert(parseRows('| R7 | d |').length === 1, 'a malformed row still yields its identity — shape is check8b’s job');

  // Phrased so `selftest-all.mjs` can PARSE the count: a tool that silently drops from 8
  // assertions to 1 still exits 0, and only a readable number makes that visible.
  console.log('selftest: all 8 selftests passed');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
