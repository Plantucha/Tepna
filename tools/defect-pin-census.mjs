// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/* ════════════════════════════════════════════════════════════════════════
   tools/defect-pin-census.mjs — the enumeration gate for tests that once
   asserted the defect they were written for

       node tools/defect-pin-census.mjs                 # census + gate (exit 1 unenumerated)
       node tools/defect-pin-census.mjs --json          # the verdict alone
       node tools/defect-pin-census.mjs --emit-missing  # the entries to paste

   Residue 2026-09-23-tests-that-assert-the-defect-they-were-written-for: a
   test can assert something other than the contract its own docstring states,
   and it then PROTECTS the defect — it passes before and after. Three landed in
   one night, each drifting at the FIXTURE rather than the assertion, which is
   why review does not catch them. The row's finding was that the class was
   already HALF-RECORDED and never counted: every session annotated its own
   instance in-tree and moved on.

   ⚠️ WHAT THIS GATE DOES AND DOES NOT SEE.

   It reads the ANNOTATIONS, not the tests. A session that re-aims a test writes
   "used to assert", "pinned the defect" or "encoded the defect" beside it; this
   tool finds those, and `tests/defect-pin-inventory.json` must carry one entry
   per annotation with the mechanism and one line of why. An instance nobody
   annotated is INVISIBLE here. So the counts BOUND the class; they do not count
   it, and a green run is never evidence that no test pins a defect.

   ⚠️ IT MUST NOT PUNISH THE ANNOTATION. Annotating a re-aimed test is the
   behaviour that made this class visible at all, so the gate's remedy is one
   pasteable line (`--emit-missing`), never a demand to delete the comment.

   ⚠️ A STALE ENTRY REDS TOO. An entry whose quote no longer appears in its file
   means the annotation moved, changed or went away, so the enumeration stopped
   describing the tree. That direction is the one a census loses first.

   Measured 2026-10-18 on `07d743710`: 23 annotations over 12 files, against the
   row's 20 over 10 on 2026-09-23 — the class grew by three while nothing
   watched it. `reaimed` is `null` wherever the annotation itself states no date
   or number (§∅: absence is not a guess).
   ════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const Verdict = createRequire(import.meta.url)('../verdict.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = 'tests/defect-pin-inventory.json';

/** The row's own grep, kept verbatim so the population is the one it measured. */
export const PHRASES = /used to assert|pinned the defect|encoded the defect/i;

/** The two test trees the row enumerated. */
export const TREES = ['capture-host/tests', 'tests'];

export function trackedTestFiles(root = ROOT, trees = TREES) {
  return execFileSync('git', ['ls-files', '-z', '--', ...trees], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .filter((f) => f !== INVENTORY);
}

/** Returns [{ file, line, text }] — one per annotated line. */
export function scan(files, root = ROOT, re = PHRASES) {
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue; // unreadable or binary: nothing to assert about it
    }
    if (!re.test(text)) continue; // cheap reject before splitting a large file
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push({ file: f, line: i + 1, text: lines[i] });
  }
  return hits;
}

/* ── The matcher. A pin names a FILE and a verbatim QUOTE from the annotation,
      never a line number: every annotation here sits in a file thousands of
      lines long that other sessions edit daily, so a line number would red on
      an unrelated insertion. ─────────────────────────────────────────────── */
export function reconcile(hits, inventory) {
  const pins = inventory.pins || [];
  const mechanisms = Object.keys(inventory.mechanisms || {});
  const matchedPin = new Set();
  const unenumerated = [];
  for (const h of hits) {
    const i = pins.findIndex((p) => p.file === h.file && h.text.includes(p.quote));
    if (i < 0) unenumerated.push(h);
    else matchedPin.add(i);
  }
  const stale = pins.filter((_, i) => !matchedPin.has(i));
  const malformed = [];
  for (const p of pins) {
    if (!mechanisms.includes(p.mechanism)) malformed.push({ pin: p, why: 'mechanism outside the inventory’s own set' });
    else if (!(p.reaimed === null || (typeof p.reaimed === 'string' && p.reaimed.trim()))) malformed.push({ pin: p, why: 'reaimed must be a string or null, never an empty guess' });
    else if (!(typeof p.why === 'string' && p.why.trim())) malformed.push({ pin: p, why: 'why must say what the test asserted instead' });
  }
  return { unenumerated, stale, malformed, ok: !unenumerated.length && !stale.length && !malformed.length };
}

export function census(hits, inventory) {
  const byMechanism = {};
  for (const m of Object.keys(inventory.mechanisms || {})) byMechanism[m] = 0;
  for (const p of inventory.pins || []) if (p.mechanism in byMechanism) byMechanism[p.mechanism]++;
  const byTree = {};
  for (const h of hits) {
    const t = h.file.startsWith('capture-host/') ? 'capture-host/tests' : 'tests';
    byTree[t] = (byTree[t] || 0) + 1;
  }
  return { annotations: hits.length, files: new Set(hits.map((h) => h.file)).size, byTree, byMechanism };
}

function gitCommit(root = ROOT) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function entryFor(h) {
  const m = PHRASES.exec(h.text);
  const start = Math.max(0, m.index - 24);
  return {
    file: h.file,
    quote: h.text.slice(start, m.index + m[0].length + 44).trim(),
    mechanism: '<expected-value|fixture-shape|predicate-strength>',
    reaimed: null,
    why: '<what it asserts instead, in one line>'
  };
}

function main() {
  const jsonOnly = process.argv.includes('--json');
  const files = trackedTestFiles();
  const hits = scan(files);
  const inventory = JSON.parse(readFileSync(join(ROOT, INVENTORY), 'utf8'));
  const r = reconcile(hits, inventory);
  const c = census(hits, inventory);
  const parts = [];
  if (r.unenumerated.length) parts.push(r.unenumerated.length + ' annotation(s) carry no inventory entry');
  if (r.stale.length) parts.push(r.stale.length + ' inventory entr(ies) match no annotation');
  if (r.malformed.length) parts.push(r.malformed.length + ' entr(ies) are malformed');
  const v = Verdict.make({
    gate: 'defect-pin-census',
    status: r.ok ? 'PASS' : 'FAIL',
    population: { checked: hits.length, eligible: hits.length, excluded: 0 },
    criterion: { name: 'unenumerated_defect_pins', threshold: 0, unit: 'annotations', direction: 'lte' },
    result: c,
    evidence: ['tools/defect-pin-census.mjs', INVENTORY],
    reason: r.ok ? null : parts.join('; '),
    producedBy: { tool: 'tools/defect-pin-census.mjs', commit: gitCommit() }
  });
  console.log(JSON.stringify(v));
  if (process.argv.includes('--emit-missing')) {
    console.log(JSON.stringify(r.unenumerated.map(entryFor), null, 2));
    process.exit(0);
  }
  if (!jsonOnly) {
    console.log('▸ defect-pin census over ' + files.length + ' tracked test file(s): ' + c.annotations + ' annotation(s) in ' + c.files + ' file(s)');
    for (const [t, n] of Object.entries(c.byTree)) console.log('    ' + t + ': ' + n);
    for (const [m, n] of Object.entries(c.byMechanism)) console.log('    ' + m + ': ' + n);
    console.log('    the phrase set BOUNDS the class — an unannotated instance is invisible here');
  }
  if (!r.ok) {
    console.error(v.reason);
    for (const h of r.unenumerated) console.error('   · unenumerated: ' + h.file + ':' + h.line);
    for (const p of r.stale) console.error('   · stale entry: ' + p.file + ' — ' + JSON.stringify(p.quote.slice(0, 48)));
    for (const m of r.malformed) console.error('   · malformed: ' + m.pin.file + ' — ' + m.why);
    if (r.unenumerated.length) console.error('Add the entr(ies): node tools/defect-pin-census.mjs --emit-missing');
    if (r.stale.length) console.error('A stale entry means the annotation moved or changed — re-quote it from the file, never delete the row to go green.');
  } else console.log('✓ every annotation is enumerated and every entry resolves');
  process.exit(r.ok ? 0 : 1);
}

if (process.argv.includes('--verdict-sample')) {
  const v = Verdict.make({
    gate: 'defect-pin-census',
    status: 'NOT_RUN',
    population: { checked: 0, eligible: 0, excluded: 0 },
    criterion: { name: 'unenumerated_defect_pins', threshold: 0, unit: 'annotations', direction: 'lte' },
    result: null,
    evidence: ['tools/defect-pin-census.mjs', INVENTORY],
    reason: 'sample only — this invocation scanned no files',
    producedBy: { tool: 'tools/defect-pin-census.mjs', commit: gitCommit() }
  });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

if (process.argv.includes('--selftest')) {
  let bad = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      bad++;
      console.log('  ✕ ' + n + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
    } else console.log('  ✓ ' + n);
  };
  const INV = {
    mechanisms: { 'expected-value': 'x', 'fixture-shape': 'y', 'predicate-strength': 'z' },
    pins: [{ file: 'tests/a.js', quote: 'USED TO ASSERT the moon', mechanism: 'expected-value', reaimed: null, why: 'it asserts the sun now' }]
  };
  const hit = (file, text, line = 1) => ({ file, line, text });
  ck(
    'the phrase set matches all three wordings',
    ['this used to assert x', 'it PINNED THE DEFECT', 'that Encoded The Defect'].map((s) => PHRASES.test(s)),
    [true, true, true]
  );
  ck('an ordinary assertion line is not an annotation', PHRASES.test('assert rows == []'), false);
  ck('a pin matches its annotation by file and quote', reconcile([hit('tests/a.js', '  /* THIS USED TO ASSERT the moon, now the sun */')], INV).ok, true);
  ck('the same quote in another file does not match', reconcile([hit('tests/b.js', '  /* THIS USED TO ASSERT the moon */')], INV).unenumerated.length, 1);
  /* The direction a census loses first: the tree moved on and the enumeration did not. */
  ck('an entry matching no annotation is STALE', reconcile([], INV).stale.length, 1);
  ck('a malformed mechanism reds', reconcile([hit('tests/a.js', 'x USED TO ASSERT the moon y')], { ...INV, pins: [{ ...INV.pins[0], mechanism: 'vibes' }] }).malformed.length, 1);
  ck(
    'an empty reaimed string reds, while null passes',
    [
      reconcile([hit('tests/a.js', 'x USED TO ASSERT the moon y')], { ...INV, pins: [{ ...INV.pins[0], reaimed: '  ' }] }).malformed.length,
      reconcile([hit('tests/a.js', 'x USED TO ASSERT the moon y')], INV).malformed.length
    ],
    [1, 0]
  );
  ck('a missing why reds', reconcile([hit('tests/a.js', 'x USED TO ASSERT the moon y')], { ...INV, pins: [{ ...INV.pins[0], why: '' }] }).malformed.length, 1);
  /* A second annotation in an already-enumerated file is a NEW instance, not a duplicate. */
  ck('two annotations in one file need two entries', reconcile([hit('tests/a.js', 'x USED TO ASSERT the moon y'), hit('tests/a.js', 'x USED TO ASSERT the stars y', 9)], INV).unenumerated.length, 1);
  ck('the remedy entry names the file and quotes the annotation', Object.keys(entryFor(hit('tests/a.js', 'x USED TO ASSERT the stars y'))).sort(), ['file', 'mechanism', 'quote', 'reaimed', 'why']);
  /* The real inventory, read from disk: the gate's own claim about this tree. */
  const real = JSON.parse(readFileSync(join(ROOT, INVENTORY), 'utf8'));
  ck('the committed inventory reconciles with the committed tree', reconcile(scan(trackedTestFiles()), real).ok, true);
  ck(
    'every committed entry carries a mechanism the inventory defines',
    real.pins.every((p) => p.mechanism in real.mechanisms),
    true
  );
  ck('the inventory states that the phrase set BOUNDS the class', /BOUND/i.test(real.bounds || ''), true);
  console.log(bad ? '  ✗ ' + bad + ' of ' + ran + ' selftests failed' : '  all ' + ran + ' selftests passed');
  process.exit(bad ? 1 : 0);
}
if (!process.argv.includes('--selftest') && !process.argv.includes('--verdict-sample')) main();
