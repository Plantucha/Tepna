#!/usr/bin/env node
/* Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
 *
 * mutate-ledger-merge — a git merge driver for the mutation ledgers. It unions ENTRIES the way
 * `merge=union` unions lines, and it REFUSES a duplicated entry id.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * `capture-host/tools/mutate-equivalence.json`, `tools/mutate-equivalence.json` and
 * `mutation-survivors.json` are append-heavy ledgers. Several sessions write them in parallel. None of
 * the three had a merge driver, so every concurrent PR owed a hand three-way merge over JSON text
 * (residue `2026-09-29-equivalence-and-survivor-ledgers-have-no-merge-driver`).
 *
 * The obvious hand resolution is silently destructive. Measured on #3237: main and the branch had both
 * appended, git produced one ~300-line text conflict, and resolving it as "first occurrence wins in
 * base -> ours -> theirs order" REVERTED five in-place edits main had made to existing `nights_index.py`
 * entries. The key was the same on both sides and only `probe`/`why` had moved. Nothing conflicted and
 * nothing failed, so the class produces no symptom.
 *
 * ── THE RULE, PER ENTRY ──────────────────────────────────────────────────────────────────────────
 *   an addition on either side            -> kept
 *   a deletion on either side             -> honoured
 *   an entry changed on exactly one side  -> that side wins
 *   an entry changed on BOTH sides        -> a real conflict, and this driver stops
 *
 * Three post-conditions ride with it, and `--selftest` asserts each one. Every entry either side has
 * is present, except the ones a side deliberately deleted. Every edit made since the merge base
 * survives. The file round-trips byte-identically, so a merge never reformats a ledger.
 *
 * ── THE IDENTITY IS NOT THE MATCHING KEY THE READERS USE ─────────────────────────────────────────
 * `tools/mutate.mjs` matches an equivalence entry on (line, op, before) and records `after` for a
 * reader. That tuple is NOT unique in either equivalence ledger: 30 groups collide in each, because one
 * line and one operator carry several operands. Measured 2026-10-13 — 722 entries over 686 such tuples
 * in the capture-host ledger, 427 over 391 in the JS one. So this driver adds `after` to the identity
 * and both ledgers come out 1:1. The Python side keys on `key` with an optional `function`, which is
 * already unique (0 collisions). `mutation-survivors.json` keys on lane, module, function, key and
 * `mutant`; `mutant` alone is unique over its 128 rows, and the other four are not (126 of 128).
 *
 * ── ⚠️ IT IS INSTALL-COUPLED, AND THE UNINSTALLED STATE IS THE SAFE ONE ──────────────────────────
 * A custom driver needs `git config merge.mutateledger.driver` per clone (CLAUDE.md §👥.2b-bis). A
 * clone without it falls back to git's built-in three-way merge, which CONFLICTS on two appends and
 * leaves the markers for a human. That is today's behaviour, so the attribute is safe to ship ahead of
 * anyone installing it, and installing it replaces a hand merge with a structural one.
 *
 * Install:  node tools/mutate-ledger-merge.mjs --install     (writes the two `git config` keys)
 * Selftest: node tools/mutate-ledger-merge.mjs --selftest    (no git, no network, touches nothing)
 * Verify:   node tools/mutate-ledger-merge.mjs --verify [paths…]   (one tepna.verdict/1 object)
 * Driver:   node tools/mutate-ledger-merge.mjs %O %A %B      (git calls this; the result goes to %A)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NUL = '\u0000';

/** The three ledgers this driver is registered for in `.gitattributes`. */
export const LEDGERS = ['capture-host/tools/mutate-equivalence.json', 'tools/mutate-equivalence.json', 'mutation-survivors.json'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** The identity of one entry inside `group`, or null when the entry carries none this driver reads. */
export function identity(group, e) {
  if (!isObj(e)) return null;
  if (group === 'entries') {
    for (const f of ['lane', 'module', 'function', 'key', 'mutant']) if (e[f] == null) return null;
    return ['S', e.lane, e.module, e.function, e.key, e.mutant].join(NUL);
  }
  /* The JS lane: (line, op, before) is what `mutate.mjs` matches on, plus `after` for uniqueness. */
  if (e.line != null && e.op != null) return ['L', group, e.line, e.op, e.before ?? '', e.after ?? ''].join(NUL);
  /* The Python lane: the mutant's changed diff lines, and the enclosing function when it is named. */
  if (e.key != null) return ['K', group, e.function ?? '', e.key].join(NUL);
  return null;
}

/* A top-level value is a GROUP of entries when it is an array of objects. An empty array is a group
   with no entries. `_README` is an array of STRINGS in the equivalence ledgers and a string in the
   survivor ledger, so it stays a literal in both and is carried verbatim. */
const isGroup = (v) => Array.isArray(v) && v.every(isObj);

/**
 * Read a ledger into entries, groups and literals. Returns `{ bad }` when the text is not a ledger
 * this driver can rewrite, and `{ dup }` when one side already carries a duplicated id.
 */
export function parse(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    return { bad: `it is not JSON (${err.message})` };
  }
  if (!isObj(obj)) return { bad: 'the top level of a ledger is a JSON object' };
  const nl = text.endsWith('\n');
  let indent = null;
  for (const n of [1, 2, 3, 4]) {
    if (JSON.stringify(obj, null, n) + (nl ? '\n' : '') === text) {
      indent = n;
      break;
    }
  }
  /* THE BYTE ROUND-TRIP IS A PRE-CONDITION, not a hope. The three ledgers do not share a format:
     measured 2026-10-13, the capture-host ledger and the survivor ledger are 2-space with a trailing
     newline, and the JS ledger is 1-space with none. A file this driver cannot reproduce byte for byte
     would be REFORMATTED by a merge, so it refuses instead. */
  if (indent == null) return { bad: 'it does not round-trip under any indent from 1 to 4 spaces, so a merge would reformat it' };

  const keys = [];
  const byId = new Map();
  for (const [k, v] of Object.entries(obj)) {
    if (!isGroup(v)) {
      keys.push({ key: k, kind: 'lit', value: v });
      continue;
    }
    const name = k === 'entries' ? 'entries' : k;
    const ids = [];
    for (const e of v) {
      const id = identity(name, e);
      if (id == null) return { bad: `an entry under "${k}" carries no identity — ${JSON.stringify(e).slice(0, 72)}…` };
      const full = k + NUL + id;
      if (byId.has(full)) return { dup: label(full) };
      byId.set(full, e);
      ids.push(full);
    }
    keys.push({ key: k, kind: 'group', ids });
  }
  return { indent, nl, keys, byId };
}

/** A reader's name for an entry id: the group, then the identity fields. */
export function label(full) {
  const parts = full.split(NUL);
  return `${parts[0]} · ${parts.slice(2).join(' · ')}`;
}

export function serialize(indent, nl, obj) {
  return JSON.stringify(obj, null, indent) + (nl ? '\n' : '');
}

/**
 * Three-way merge over entry IDS rather than over bytes. Returns `{ text }` or `{ conflict }`.
 * OURS carries the document: its key order and its entry order. Theirs-only keys and entries append.
 */
export function merge3(oText, aText, bText) {
  const read = [
    ['ancestor', parse(oText)],
    ['ours', parse(aText)],
    ['theirs', parse(bText)]
  ];
  for (const [side, p] of read) {
    if (p.bad) return { conflict: `the ${side} side is not a ledger this driver can rewrite: ${p.bad}` };
    /* An input that ALREADY carries a duplicate is the damage. Collapsing it here would hide it. */
    if (p.dup) return { conflict: `the ${side} side already carries a duplicated entry id — ${p.dup}` };
  }
  const [O, A, B] = read.map(([, p]) => p);
  /* A format divergence between the two sides cannot be merged without reformatting one of them. */
  if (A.indent !== B.indent || A.nl !== B.nl) return { conflict: `the two sides disagree on the file format (ours ${A.indent}-space, theirs ${B.indent}-space) — a merge would reformat one of them` };

  const conflicts = [];
  const pick = (name, o, a, b) => {
    if (a !== undefined && b !== undefined) {
      if (eq(a, b)) return { value: a };
      if (o !== undefined && eq(a, o)) return { value: b };
      if (o !== undefined && eq(b, o)) return { value: a };
      /* Both sides changed one entry differently. Inventing a winner here is the silent resolution
         this driver exists to stop. */
      conflicts.push(`${name} — changed on BOTH sides, differently`);
      return { value: a };
    }
    if (a !== undefined) {
      if (o === undefined) return { value: a };
      if (eq(a, o)) return { drop: true };
      conflicts.push(`${name} — we changed it and the other side deleted it`);
      return { value: a };
    }
    if (b !== undefined) {
      if (o === undefined) return { value: b };
      if (eq(b, o)) return { drop: true };
      conflicts.push(`${name} — the other side changed it and we deleted it`);
      return { value: b };
    }
    return { drop: true };
  };
  const kindOf = (p, k) => {
    const row = p.keys.find((r) => r.key === k);
    return row ? row.kind : null;
  };
  const litOf = (p, k) => {
    const row = p.keys.find((r) => r.key === k);
    return row && row.kind === 'lit' ? row.value : undefined;
  };
  const idsOf = (p, k) => {
    const row = p.keys.find((r) => r.key === k);
    return row && row.kind === 'group' ? row.ids : null;
  };

  const out = {};
  const order = [...A.keys.map((r) => r.key), ...B.keys.map((r) => r.key).filter((k) => kindOf(A, k) == null)];
  for (const k of order) {
    const kinds = [O, A, B].map((p) => kindOf(p, k)).filter(Boolean);
    if (kinds.includes('group') && kinds.includes('lit')) {
      conflicts.push(`"${k}" — a list of entries on one side and a plain value on the other`);
      continue;
    }
    if (kinds[0] === 'lit') {
      const r = pick(`"${k}"`, litOf(O, k), litOf(A, k), litOf(B, k));
      if (!r.drop) out[k] = r.value;
      continue;
    }
    const aIds = idsOf(A, k);
    const bIds = idsOf(B, k);
    if (aIds == null && bIds == null) continue; // deleted on both sides, or on one with no edit
    const ids = [...(aIds ?? []), ...(bIds ?? []).filter((id) => !(aIds ?? []).includes(id))];
    const list = [];
    for (const id of ids) {
      const r = pick(label(id), O.byId.get(id), A.byId.get(id), B.byId.get(id));
      if (!r.drop) list.push(r.value);
    }
    /* A group both sides emptied is still a group: keep the key with its empty list rather than
       deleting a module name neither side deleted. */
    if (aIds != null || bIds != null) out[k] = list;
  }
  if (conflicts.length) return { conflict: conflicts.join('\n') };
  return { text: serialize(A.indent, A.nl, out) };
}

function install() {
  const cmd = 'node tools/mutate-ledger-merge.mjs %O %A %B';
  execFileSync('git', ['config', 'merge.mutateledger.name', 'mutation ledgers: union the entries, refuse a duplicated id']);
  execFileSync('git', ['config', 'merge.mutateledger.driver', cmd]);
  console.log('✓ installed for THIS clone:\n    merge.mutateledger.driver = ' + cmd);
  console.log('  ⚠️ per-clone by design (CLAUDE.md §👥.2b-bis). A clone WITHOUT it falls back to the');
  console.log('     built-in three-way merge, which conflicts on two appends and leaves the markers.');
  return 0;
}

/** Judge the named ledgers: every entry identifiable, every id unique, every file byte-stable. */
export function verifyLedgers(paths, read) {
  const rows = [];
  for (const p of paths) {
    let text;
    try {
      text = read(p);
    } catch (err) {
      rows.push({ path: p, ok: false, why: `cannot read it (${err.message})` });
      continue;
    }
    const q = parse(text);
    if (q.bad) {
      rows.push({ path: p, ok: false, why: q.bad });
      continue;
    }
    if (q.dup) {
      rows.push({ path: p, ok: false, why: `a duplicated entry id — ${q.dup}` });
      continue;
    }
    /* The merge of a file with itself must give back the same bytes. That is post-condition 3, run
       against the real ledger rather than a synthetic one. */
    const self = merge3(text, text, text);
    const stable = !self.conflict && self.text === text;
    rows.push({ path: p, ok: stable, entries: q.byId.size, indent: q.indent, why: stable ? null : 'a merge with itself does not reproduce its bytes' });
  }
  return rows;
}

function verify(paths) {
  const rows = verifyLedgers(paths, (p) => readFileSync(join(ROOT, p), 'utf8'));
  const bad = rows.filter((r) => !r.ok);
  const v = makeVerdict({
    gate: 'mutate-ledger-merge',
    status: bad.length ? 'FAIL' : 'PASS',
    population: { checked: rows.length, eligible: rows.length, excluded: 0 },
    criterion: { name: 'ledgers_with_an_unmergeable_shape', threshold: 0, unit: 'ledgers', direction: 'lte' },
    result: { ledgers: rows, offending: bad.length },
    evidence: ['tools/mutate-ledger-merge.mjs', ...paths],
    reason: bad.length ? bad.map((r) => `${r.path}: ${r.why}`).join('; ') : null,
    tool: 'tools/mutate-ledger-merge.mjs'
  });
  for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.path} — ${r.ok ? `${r.entries} entries, ${r.indent}-space, byte-stable` : r.why}`);
  console.log(JSON.stringify(v));
  return bad.length ? 1 : 0;
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
  /* Two shapes, one driver. `J` writes the equivalence shape; `S` writes the survivor shape. */
  const ent = (line, after, cls) => ({ line, op: 'cmp > → >=', before: 'if (a > b) {', after, class: cls });
  const J = (mod, entries, readme = ['a readme line']) => JSON.stringify({ _README: readme, [mod]: entries }, null, 2) + '\n';
  const srow = (mutant, state) => ({ lane: 'py', module: 'capture-host/x.py', function: 'f', key: '- a | + b', mutant, state });
  const S = (entries) => JSON.stringify({ _README: 'the survivors', entries }, null, 2) + '\n';

  const base = J('a-dsp.js', [ent(10, 'if (a >= b) {', 'no-distinguishing-input')]);

  // THE CASE THAT MOTIVATES THE FILE: both sides append a different entry to one module.
  const oursAdd = J('a-dsp.js', [ent(10, 'if (a >= b) {', 'no-distinguishing-input'), ent(20, 'if (c >= d) {', 'real-gap')]);
  const theirsAdd = J('a-dsp.js', [ent(10, 'if (a >= b) {', 'no-distinguishing-input'), ent(30, 'if (e >= f) {', 'real-gap')]);
  const r = merge3(base, oursAdd, theirsAdd);
  A('two appends to one module union without conflict', !r.conflict, r.conflict);
  const got = r.text ? JSON.parse(r.text)['a-dsp.js'] : [];
  A('…and all three entries are present', got.length === 3, String(got.length));
  A('…in ours-then-theirs order', got.map((e) => e.line).join(',') === '10,20,30', got.map((e) => e.line).join(','));

  // An entry edited on exactly one side takes that side, beside the other side's append.
  const oursEdit = J('a-dsp.js', [ent(10, 'if (a >= b) {', 'real-gap')]);
  const r2 = merge3(base, oursEdit, theirsAdd);
  A('an edit on one side survives the other side append', !r2.conflict && JSON.parse(r2.text)['a-dsp.js'][0].class === 'real-gap', r2.conflict);
  const r2b = merge3(base, theirsAdd, oursEdit);
  A('…and the mirror is symmetric', !r2b.conflict && JSON.parse(r2b.text)['a-dsp.js'].some((e) => e.class === 'real-gap'), r2b.conflict);

  // Two sides changing ONE entry differently must stop.
  const theirsEdit = J('a-dsp.js', [ent(10, 'if (a >= b) {', 'needs-a-probe')]);
  const r3 = merge3(base, oursEdit, theirsEdit);
  A('both sides changing one entry differently is a conflict', !!r3.conflict, r3.text);
  A('…and the conflict names the entry', /a-dsp\.js/.test(r3.conflict || ''), r3.conflict);
  A('the same edit on both sides is agreement', !merge3(base, oursEdit, oursEdit).conflict);

  // THE DUPLICATE TEST: a side that already carries one id twice is refused, never deduped.
  const dupd = J('a-dsp.js', [ent(10, 'if (a >= b) {', 'real-gap'), ent(10, 'if (a >= b) {', 'needs-a-probe')]);
  const r4 = merge3(base, dupd, base);
  A('a duplicated entry id inside one side is REFUSED', !!r4.conflict, r4.text);
  A('…and the refusal says which side carries it', /ours side already carries a duplicated/.test(r4.conflict || ''), r4.conflict);
  A(
    '…and the operand is what separates two entries on one line',
    !merge3(base, oursAdd, J('a-dsp.js', [ent(10, 'if (a >= b) {', 'no-distinguishing-input'), ent(10, 'if (a > 0) {', 'real-gap')])).conflict
  );

  // A deletion is honoured. An edit against a deletion is not.
  const empty = J('a-dsp.js', []);
  const r5 = merge3(base, base, empty);
  A('a deletion on one side is honoured', !r5.conflict && JSON.parse(r5.text)['a-dsp.js'].length === 0, r5.conflict);
  const r6 = merge3(base, oursEdit, empty);
  A('an edit against a deletion is a conflict', !!r6.conflict, r6.text);

  // Literals: carried, and taken from the side that changed them.
  const r7 = merge3(base, J('a-dsp.js', [ent(10, 'if (a >= b) {', 'no-distinguishing-input')], ['a readme line', 'and one more']), theirsAdd);
  A('a one-sided readme edit is taken', !r7.conflict && JSON.parse(r7.text)._README.length === 2, r7.conflict);
  const r8 = merge3(base, J('b-dsp.js', [ent(40, 'if (g >= h) {', 'real-gap')]), theirsAdd);
  A('a module key added on one side survives', !r8.conflict && 'b-dsp.js' in JSON.parse(r8.text), r8.conflict);

  // The survivor shape keys on the mutant name.
  const sBase = S([srow('x__f__mutmut_1', 'open')]);
  const sOurs = S([srow('x__f__mutmut_1', 'open'), srow('x__f__mutmut_2', 'open')]);
  const sTheirs = S([srow('x__f__mutmut_1', 'closed'), srow('x__f__mutmut_3', 'open')]);
  const r9 = merge3(sBase, sOurs, sTheirs);
  A('the survivor shape unions over the mutant name', !r9.conflict && JSON.parse(r9.text).entries.length === 3, r9.conflict);
  A('…and their edit to the shared row survives', !r9.conflict && JSON.parse(r9.text).entries[0].state === 'closed', r9.text);

  // POST-CONDITION 3: a merge never reformats a ledger.
  const oneSpace = JSON.stringify(JSON.parse(base), null, 1);
  A('a merge with itself reproduces the bytes', merge3(base, base, base).text === base);
  A('…at the file own indent, with no trailing newline', merge3(oneSpace, oneSpace, oneSpace).text === oneSpace);
  A('two sides in different formats refuse', !!merge3(base, base, oneSpace).conflict);

  // Shapes this driver must not rewrite.
  A('a file that is not JSON refuses', !!merge3('{', base, base).conflict);
  A('an entry with no identity refuses', !!merge3(base, JSON.stringify({ _README: ['x'], 'a-dsp.js': [{ note: 'no key' }] }, null, 2) + '\n', base).conflict);

  // The real ledgers, read through an injected reader so the selftest stays pure.
  const rows = verifyLedgers(LEDGERS, (p) => readFileSync(join(ROOT, p), 'utf8'));
  A(
    'every registered ledger parses, is 1:1 and is byte-stable',
    rows.every((x) => x.ok),
    JSON.stringify(rows.filter((x) => !x.ok))
  );

  console.log(bad ? `\nselftest: ${bad} assertion(s) did not hold` : '\nselftest: all green');
  return bad ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--install')) return install();
  if (argv.includes('--verify')) {
    const paths = argv.filter((a) => !a.startsWith('--'));
    return verify(paths.length ? paths : LEDGERS);
  }
  const [O, Aa, B] = argv;
  if (!O || !Aa || !B) {
    console.error('usage: mutate-ledger-merge.mjs %O %A %B   |   --install   |   --selftest   |   --verify [paths…]');
    return 2;
  }
  const r = merge3(readFileSync(O, 'utf8'), readFileSync(Aa, 'utf8'), readFileSync(B, 'utf8'));
  if (r.conflict) {
    console.error('mutate-ledger-merge: REFUSING to merge — this needs a human:\n' + r.conflict);
    return 1; // git marks the path conflicted and leaves %A for the user
  }
  writeFileSync(Aa, r.text);
  return 0;
}

process.exit(main(process.argv.slice(2)));
