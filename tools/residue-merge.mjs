#!/usr/bin/env node
/* Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * residue-merge — a git merge driver for `briefs/RESIDUE.md` that APPENDS like `union` and REFUSES to
 * duplicate a row id.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * `merge=union` was set on the ledger (2026-09-13) because two PRs each filing a row conflict on the
 * same tail bytes by construction, and every resolution was "keep both sides' rows" with no
 * judgement. That is exactly what union does, and for APPENDS it is right.
 *
 * The ledger has one legal EDIT — closing a row by rewriting its state cell — and a union driver
 * cannot represent an edit. It keeps both sides' lines, so closing a row NEAR THE TAIL (the usual
 * case: recent rows get closed) while another PR appends yields the same id twice, once `OPEN` and
 * once `fixed #N`, with NO conflict raised. Measured on live PRs 2026-09-15: `git merge --no-commit`
 * exits 0, `git merge-tree` emits zero conflict markers, and the tree comes out 160 rows against 158
 * unique keys. It is not a merge you resolve; it is a merge that looks like it worked.
 *
 * ── WHY A DRIVER RATHER THAN DROPPING union ──────────────────────────────────────────────────────
 * Dropping the attribute restores the per-PR conflicts it was added to kill one day earlier (19 of 32
 * commits to main touched this file on the measured day). The driver is the only option that keeps
 * the conflict-free append AND refuses the duplicate.
 *
 * ── ⚠️ IT IS INSTALL-COUPLED, AND THE UNINSTALLED STATE IS THE SAFE ONE ──────────────────────────
 * A custom driver needs `git config merge.residue.driver` per clone, so CLAUDE.md §👥.2b-bis applies:
 * a mechanism that exists in-repo and runs for nobody. What makes it worth building anyway is the
 * FALLBACK, verified in a synthetic repo before a line of this was written:
 *
 *   merge=union,   driver n/a  → exit 0, 0 markers, id duplicated      ← today, SILENT
 *   merge=residue, NOT installed → exit 1, conflict markers, resolve   ← safe
 *   merge=residue, installed     → exit 0, correct merge               ← this file
 *
 * An unconfigured driver name makes git fall back to the built-in 3-way merge, which CONFLICTS on
 * exactly the shape union silently duplicates. So a clone without the driver is noisier than today
 * and strictly safer; a clone with it is both quiet and correct. That asymmetry is the whole argument.
 *
 * Install:  node tools/residue-merge.mjs --install     (writes the two `git config` keys)
 * Selftest: node tools/residue-merge.mjs --selftest    (no git, no network, touches nothing)
 * Driver:   node tools/residue-merge.mjs %O %A %B      (git calls this; result written to %A)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/* A residue row is `| <id> | ... | <state> |` on ONE line. The id is the key; everything else is the
   row's content. Non-row lines (the header, the contract table, prose) are carried verbatim and are
   NOT reordered — a driver that rewrote them would be editing a document it does not understand. */
const ROW = /^\| ([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+) \|/;

export function parse(text) {
  const lines = text.split('\n');
  const rows = new Map(); // id -> line
  const order = []; // entries: {kind:'row', id} | {kind:'lit', text}
  for (const ln of lines) {
    const m = ROW.exec(ln);
    if (m) {
      /* A file that ALREADY contains a duplicate is not something this driver should silently
         collapse — it is the damage, and collapsing it would hide that it happened. Report it. */
      if (rows.has(m[1])) return { dup: m[1] };
      rows.set(m[1], ln);
      order.push({ kind: 'row', id: m[1] });
    } else {
      order.push({ kind: 'lit', text: ln });
    }
  }
  return { rows, order };
}

/* Three-way merge over ROW IDS rather than over lines. That is the whole trick: a state-cell close and
   a tail append are disjoint at the level of rows and overlapping at the level of bytes, which is why
   a byte-oriented driver (union, or plain 3-way) cannot get both right at once. */
export function merge3(oText, aText, bText) {
  const O = parse(oText),
    A = parse(aText),
    B = parse(bText);
  for (const [side, p] of [
    ['ancestor', O],
    ['ours', A],
    ['theirs', B]
  ])
    if (p.dup) return { conflict: `the ${side} side already contains a duplicated id: ${p.dup}` };

  const out = [];
  const emitted = new Set();
  const conflicts = [];

  const pick = (id) => {
    const o = O.rows.get(id),
      a = A.rows.get(id),
      b = B.rows.get(id);
    if (a != null && b != null) {
      if (a === b) return a; // both sides agree
      if (o != null && a === o) return b; // only THEY edited it
      if (o != null && b === o) return a; // only WE edited it
      /* Both sides changed the same row differently. That is a real editorial disagreement — two
         sessions closing one row with different PR numbers, say — and inventing a winner here is
         exactly the silent resolution this driver exists to stop. */
      conflicts.push(`${id} — changed on BOTH sides (ours: ${cell(a)} · theirs: ${cell(b)})`);
      return a;
    }
    if (a != null) {
      /* Present for us, absent for them. If it was in the ancestor, THEY deleted it — and rows are
         never deleted by the contract, so that is a conflict rather than an append we can drop. */
      if (o != null) conflicts.push(`${id} — deleted on the other side; ledger rows are never deleted`);
      return a;
    }
    if (o != null) conflicts.push(`${id} — deleted on our side; ledger rows are never deleted`);
    return b;
  };

  // OUR structure carries the document: header, contract table, prose, and our rows in our order.
  for (const e of A.order) {
    if (e.kind === 'lit') {
      out.push(e.text);
      continue;
    }
    if (emitted.has(e.id)) continue;
    emitted.add(e.id);
    out.push(pick(e.id));
  }
  /* Then rows only THEY have, in THEIR order, appended at the end — which is where the ledger grows.
     `order` is walked rather than `rows` so a future row-reordering on their side is preserved. */
  for (const e of B.order) {
    if (e.kind !== 'row' || emitted.has(e.id)) continue;
    emitted.add(e.id);
    // a trailing blank line is normal at EOF; insert before it so the file keeps its shape
    const tail = out.length && out[out.length - 1] === '' ? out.pop() : null;
    out.push(pick(e.id));
    if (tail != null) out.push(tail);
  }
  return conflicts.length ? { conflict: conflicts.join('\n') } : { text: out.join('\n') };
}

const cell = (line) => {
  const m = /\|\s*([^|]*?)\s*\|\s*$/.exec(line);
  return m ? m[1] : '?';
};

function install() {
  const cmd = 'node tools/residue-merge.mjs %O %A %B';
  execFileSync('git', ['config', 'merge.residue.name', 'residue-ledger: append like union, refuse a duplicated id']);
  execFileSync('git', ['config', 'merge.residue.driver', cmd]);
  console.log('✓ installed for THIS clone:\n    merge.residue.driver = ' + cmd);
  console.log('  ⚠️ per-clone by design (CLAUDE.md §👥.2b-bis). A clone WITHOUT it falls back to the');
  console.log('     built-in 3-way merge, which CONFLICTS on the shape union silently duplicates —');
  console.log('     noisier than today and strictly safer, which is why the attribute is safe to ship.');
  return 0;
}

function selftest() {
  let bad = 0;
  const A = (name, cond, detail) => {
    if (cond) console.log('  ✓ ' + name);
    else {
      bad++;
      console.log('  ✗ ' + name + (detail ? '  — ' + detail : ''));
    }
  };
  const L = (...r) => r.join('\n') + '\n';
  const o = L('| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | OPEN |');

  // THE CASE THAT MOTIVATES THE WHOLE FILE: close the tail row while the other side appends.
  const ours = L('| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | fixed #1 |');
  const theirs = L('| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | OPEN |', '| 2026-01-03-c | z | OPEN |');
  const r = merge3(o, ours, theirs);
  A('tail close + concurrent append merges without conflict', !r.conflict, r.conflict);
  const ids = (r.text || '').split('\n').filter((l) => ROW.test(l));
  A('…and the closed id appears EXACTLY ONCE', ids.filter((l) => l.includes('2026-01-02-b')).length === 1, JSON.stringify(ids));
  A('…keeping the CLOSE, not the stale OPEN', /2026-01-02-b \| y \| fixed #1 \|/.test(r.text));
  A('…and their appended row survives', /2026-01-03-c/.test(r.text));
  A('…with all three rows present', ids.length === 3, String(ids.length));

  // The mirror: they close, we append. Must be symmetric.
  const r2 = merge3(o, theirs, ours);
  A('symmetric — they close, we append', !r2.conflict && /fixed #1/.test(r2.text) && /2026-01-03-c/.test(r2.text));

  // A REAL disagreement must NOT be resolved silently.
  const mine = L('| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | fixed #1 |');
  const yours = L('| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | fixed #99 |');
  const r3 = merge3(o, mine, yours);
  A('both sides closing one row DIFFERENTLY is a conflict, not a coin flip', !!r3.conflict, r3.text);
  A('…and the conflict names the id and both states', /2026-01-02-b/.test(r3.conflict) && /fixed #1/.test(r3.conflict) && /fixed #99/.test(r3.conflict), r3.conflict);

  // Deletion is never legal in this ledger.
  const del = L('| 2026-01-01-a | x | OPEN |');
  A('a row deleted on one side is a conflict', !!merge3(o, o, del).conflict);

  // Non-row content is carried, not reordered or dropped.
  const withHdr = L('# Residue', '', '| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | OPEN |');
  const withHdrClose = L('# Residue', '', '| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | fixed #2 |');
  const r4 = merge3(withHdr, withHdrClose, L('# Residue', '', '| 2026-01-01-a | x | OPEN |', '| 2026-01-02-b | y | OPEN |', '| 2026-01-03-c | z | OPEN |'));
  A('the header and blank line are preserved verbatim', (r4.text || '').startsWith('# Residue\n\n'), JSON.stringify((r4.text || '').slice(0, 20)));

  // An ALREADY-damaged input must be reported, never silently collapsed — the damage is the finding.
  const dupd = L('| 2026-01-01-a | x | OPEN |', '| 2026-01-01-a | x | fixed #3 |');
  A('an already-duplicated input is REFUSED, not quietly deduped', !!merge3(o, dupd, o).conflict, JSON.stringify(merge3(o, dupd, o)));

  // Identical edits on both sides are agreement, not conflict.
  A('the same close on both sides is agreement', !merge3(o, mine, mine).conflict);

  console.log(bad ? `\nselftest: ${bad} FAILED` : '\nselftest: all green');
  return bad ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--install')) return install();
  const [O, Aa, B] = argv;
  if (!O || !Aa || !B) {
    console.error('usage: residue-merge.mjs %O %A %B   |   --install   |   --selftest');
    return 2;
  }
  const r = merge3(readFileSync(O, 'utf8'), readFileSync(Aa, 'utf8'), readFileSync(B, 'utf8'));
  if (r.conflict) {
    console.error('residue-merge: REFUSING to merge — this needs a human:\n' + r.conflict);
    return 1; // git marks the path conflicted and leaves %A for the user
  }
  writeFileSync(Aa, r.text);
  return 0;
}

process.exit(main(process.argv.slice(2)));
