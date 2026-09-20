#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * new-changeset.mjs — write a changeset whose `brief:` RESOLVES, at write time.
 *
 * WHY THIS EXISTS. `brief:` took a hand-typed filename and the only thing that said it was
 * wrong was a CI lap. Measured 2026-09-19: it caught three sessions in one night — Wren
 * twice, Osprey once — each learning it from a red `check5` minutes after pushing.
 *
 * ⚠️ AND THE VALIDATION WAS NEVER THE MISSING PART, which is why this is a writer and not a
 * second checker. `check5` is correct and already fast: on this tree
 * `node tests/run-tests.mjs --group=release-ledger` rejects a bad brief in **4.2 s** against a
 * ~6-minute CI lap — measured, with a planted `TOTALLY-MADE-UP-…-BRIEF.md` to prove the local
 * run actually resolves briefs rather than skipping when the set is absent. The gap was that
 * nobody knew to run it, and that the authoring path is "copy a template out of the README and
 * type the filename from memory". Adding a third validator would be answering a real finding by
 * building a layer next to it; this removes the hand-typing instead.
 *
 * SO THE INVALID VALUE CANNOT BE PRODUCED THROUGH THIS PATH. `--brief` takes a FRAGMENT and is
 * resolved against the real `briefs/` set: exactly one match writes it, several refuse and list
 * them, none refuses and shows the nearest names. There is no spelling for "a brief that does
 * not exist" — the tool declines rather than emitting it.
 *
 * ⚠️ `none` IS A FIRST-CLASS ANSWER AND IS THE DEFAULT. Omitting `--brief` writes `brief: none`.
 * That is deliberate: naming a plausible-but-wrong brief PASSES the gate while sending the next
 * reader somewhere the defect never was — the residue ledger's own source-cell trap, one
 * artifact over. A tool that made `none` harder than a guess would manufacture bad citations.
 *
 *   node tools/new-changeset.mjs --slug=spool-cursor --bump=patch --type=fixed \
 *        --brief=CPAP-ACQ-P4 --body="Follow the device's pointer instead of stopping."
 *   node tools/new-changeset.mjs --slug=docs-tidy --bump=patch --type=changed   # → brief: none
 * ════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUMPS = ['patch', 'minor', 'major'];
// Keep a Changelog's set, which is what `check5` accepts — restated nowhere else in this file.
const TYPES = ['added', 'changed', 'fixed', 'removed', 'deprecated', 'security'];

const arg = (k, d = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

/** Every brief filename on disk. The POPULATION, read fresh — never a cached or hand-kept list. */
export function briefSet(root = ROOT) {
  return fs.readdirSync(path.join(root, 'briefs')).filter((f) => f.endsWith('-BRIEF.md'));
}

/** Resolve a fragment to exactly one brief, or explain why not. Case-insensitive substring.
 *  Returns {ok:true, brief} | {ok:false, reason, candidates} — never a guess: an ambiguous
 *  fragment is a REFUSAL, because picking the first match is how a citation ends up pointing at
 *  a brief that never held the defect. */
export function resolveBrief(fragment, briefs) {
  if (!fragment || fragment === 'none') return { ok: true, brief: 'none' };
  const f = fragment.toLowerCase();
  const exact = briefs.filter((b) => b.toLowerCase() === f);
  const hits = exact.length ? exact : briefs.filter((b) => b.toLowerCase().includes(f));
  if (hits.length === 1) return { ok: true, brief: hits[0] };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous', candidates: hits.slice(0, 8) };
  // No substring hit: offer the nearest by shared token, so the refusal is actionable.
  const toks = f.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const near = briefs
    .map((b) => [toks.filter((t) => b.toLowerCase().includes(t)).length, b])
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 8)
    .map(([, b]) => b);
  return { ok: false, reason: 'no-match', candidates: near };
}

export function changesetText({ bump, type, brief, body }) {
  return `---\nbump: ${bump}\ntype: ${type}\nbrief: ${brief}\n---\n\n${body}\n`;
}

function main() {
  const slug = arg('slug');
  const bump = arg('bump', 'patch');
  const type = arg('type');
  const body = arg('body', 'TODO: one imperative sentence — this becomes the changelog bullet.');
  const date = arg('date') || new Date().toISOString().slice(0, 10);

  const die = (msg) => {
    console.error(`new-changeset: ${msg}`);
    process.exit(2);
  };
  if (!slug) die('--slug=<short-slug> is required (the filename is <date>-<slug>.md)');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die(`--slug must be lowercase kebab-case; got ${JSON.stringify(slug)}`);
  if (!BUMPS.includes(bump)) die(`--bump must be one of ${BUMPS.join(' | ')}; got ${JSON.stringify(bump)}`);
  if (!type || !TYPES.includes(type)) die(`--type must be one of ${TYPES.join(' | ')}; got ${JSON.stringify(type)}`);

  const r = resolveBrief(arg('brief'), briefSet());
  if (!r.ok) {
    console.error(
      `new-changeset: --brief=${JSON.stringify(arg('brief'))} ${r.reason === 'ambiguous' ? `matches ${r.candidates.length}+ briefs — narrow it:` : 'matches no brief. Nearest by shared words:'}`
    );
    for (const c of r.candidates) console.error(`  ${c}`);
    if (!r.candidates.length) console.error('  (none — if this work executed no brief, omit --brief)');
    console.error(
      '\nIf this work-unit executed no brief, OMIT --brief entirely: `brief: none` is correct\nand is better than a plausible guess, which passes the gate and misdirects the next reader.'
    );
    process.exit(2);
  }

  const file = path.join(ROOT, 'changes', `${date}-${slug}.md`);
  if (fs.existsSync(file)) die(`${path.relative(ROOT, file)} already exists — pick another slug`);
  fs.writeFileSync(file, changesetText({ bump, type, brief: r.brief, body }), 'utf8');
  console.log(`wrote ${path.relative(ROOT, file)}  (brief: ${r.brief})`);
  console.log('verify in ~4 s:  node tests/run-tests.mjs --group=release-ledger');
}

const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('new-changeset.mjs');

if (IS_MAIN && process.argv.includes('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  — ' + d : '')));
  };
  const BS = ['ALPHA-THING-2026-01-01-BRIEF.md', 'BETA-THING-2026-02-02-BRIEF.md', 'BETA-OTHER-2026-03-03-BRIEF.md'];

  // The POSITIVE CONTROL first: a resolver that refused everything would pass every test below.
  ok('a unique fragment resolves to the full filename', resolveBrief('alpha', BS).brief === 'ALPHA-THING-2026-01-01-BRIEF.md');
  ok('an exact filename resolves to itself', resolveBrief(BS[1], BS).brief === BS[1]);
  ok('case is ignored', resolveBrief('AlPhA', BS).brief === BS[0]);

  // REFUSALS. An ambiguous fragment must not pick one: guessing here is how a changeset ends up
  // citing a brief that never held the defect, which PASSES check5 and misdirects the next reader.
  const amb = resolveBrief('beta', BS);
  ok('an ambiguous fragment REFUSES rather than picking the first', !amb.ok && amb.reason === 'ambiguous');
  ok('...and lists what it matched', amb.candidates.length === 2);
  const no = resolveBrief('nonexistent-xyz', BS);
  ok('an unknown fragment refuses', !no.ok && no.reason === 'no-match');
  ok('a near miss offers candidates by shared word', resolveBrief('thing', BS).candidates === undefined ? false : resolveBrief('nope-thing-nope', BS).candidates.length > 0);

  // `none` is FIRST-CLASS and is what omitting the flag produces.
  ok('omitting the brief yields none', resolveBrief(undefined, BS).brief === 'none');
  ok('an explicit none is accepted', resolveBrief('none', BS).brief === 'none');

  // The emitted text must be exactly what check5 parses: `^brief:\s*(\S+)\s*$`.
  const t = changesetText({ bump: 'patch', type: 'fixed', brief: 'none', body: 'x' });
  ok("emitted frontmatter matches check5's own brief regex", /^brief:\s*(\S+)\s*$/m.test(t));
  ok('emitted bump/type are on their own lines', /^bump: patch$/m.test(t) && /^type: fixed$/m.test(t));

  console.log(fail ? '\n✗ ' + fail + ' failed, ' + pass + ' passed' : '\n✓ all ' + pass + ' selftests passed');
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--selftest')) main();
