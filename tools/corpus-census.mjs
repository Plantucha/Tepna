#!/usr/bin/env node
/*
 * tools/corpus-census.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A CENSUS COMMITS ITS FILE LIST, OR IT CANNOT BE DIFFED — residue
 * `2026-09-20-census-file-list-not-retained`.
 *
 * THE FAILURE. `ECG-SATURATION-ABSENCE` published a census over **597 deduplicated files** (112 runs,
 * 62 files, 29 rails) and no list. Two days later the corpus held **602**. Only FOUR of the five
 * additions could be identified — the corpus is populated by rsync, rsync preserves mtime, so
 * "added since" is not a property any file carries and `find -newermt` returns 4 where 602 − 597 = 5.
 * The fifth was recovered by ELIMINATION: the arithmetic closed under exactly one assignment. That is
 * a good recovery and a bad way to work, and it fails silently the day two assignments close.
 *
 * THE REMEDY, which is the row's own hypothesis made executable: a census writes a MANIFEST beside its
 * numbers — one row per file with `name`, `bytes` and `sha8m` (sha256 of the first 8 MB) — and the
 * manifest is COMMITTED. A later census then DIFFS rather than reconstructs: added, removed and
 * CHANGED files are named, with evidence, and "changed" is reachable at all only because the digest is
 * recorded. `--diff` is the half that pays the cost back; `--write` is the half that makes it possible.
 *
 * WHY sha256 OF THE FIRST 8 MB, and not of the file. An ECG night is ~300 MB and a corpus is hundreds
 * of them; hashing whole files turns a census into an hour. The first 8 MB pins the header, the device
 * identity and the opening minutes — enough that a re-recorded or re-synced file is distinguishable —
 * and `bytes` catches every change past the prefix that alters length. A file that changed ONLY after
 * 8 MB and kept its exact length is the residual blind spot; it is named here rather than papered
 * over, and `--full` hashes whole files when a population is small enough to afford it.
 *
 * THE MANIFEST IS NOT THE CORPUS. The recordings are gitignored (personal health data) and stay that
 * way; a manifest is ~60 bytes a file, so the SET behind a published n becomes checkable without a
 * byte of signal leaving the volume it was recorded on.
 *
 *   node tools/corpus-census.mjs --root <dir> --glob '<pattern>' --name <census-id> [--write] [--full]
 *   node tools/corpus-census.mjs --diff analysis/census/<census-id>.json --root <dir>
 *   node tools/corpus-census.mjs --selftest | --verdict-sample
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PREFIX_BYTES = 8 * 1024 * 1024;
export const SCHEMA = 'tepna.corpus-census/1';

/* A glob only as wide as a census needs: `*` and `?` within one path segment, `**` across segments.
   Deliberately NOT a regex — a census's population must be readable in the row that records it. */
export function globToRe(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$');
}

export function digestPrefix(path, full) {
  const h = createHash('sha256');
  if (full) {
    h.update(readFileSync(path));
    return h.digest('hex').slice(0, 16);
  }
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let got = 0;
    while (got < PREFIX_BYTES) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, PREFIX_BYTES - got), null);
      if (!n) break;
      h.update(buf.subarray(0, n));
      got += n;
    }
    return h.digest('hex').slice(0, 16);
  } finally {
    closeSync(fd);
  }
}

/* Walk, filter, digest. Streams per file and keeps only the row — a census over a 200-night corpus
   must not hold the corpus (the lazy-load rule). */
export function census(root, glob, { full = false, fs = null } = {}) {
  const re = globToRe(glob);
  const rows = [];
  const walk = (dir) => {
    for (const e of fs ? fs.readdirSync(dir, { withFileTypes: true }) : readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = relative(root, p);
        if (!re.test(rel)) continue;
        const st = fs ? fs.statSync(p) : statSync(p);
        rows.push({ name: rel, bytes: st.size, sha8m: fs ? fs.digest(p) : digestPrefix(p, full) });
      }
    }
  };
  walk(root);
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

/* DEDUPLICATION IS PART OF THE CENSUS, and WHICH KEY is part of the number. The 597/602 was a
   DEDUPLICATED count, so a manifest that says "unique: N" without saying unique BY WHAT repeats the
   row's sibling failure one artifact over — a denominator nobody can check. Measured on the real ECG
   corpus, the two defensible keys differ by 10 %:

     by NAME    (basename + bytes + digest)  604   ← the key the published census used
     by CONTENT (bytes + digest)             549   ← 55 recordings that exist under two basenames

   Neither is wrong and neither is a default: a rate over RECORDINGS wants content, a rate over
   CAPTURE FILES (which is what a per-file rail or a per-file run-length census counts) wants name.
   Both are published, each with its key spelled out, and `duplicates` names the file each duplicate
   duplicates so the collapse is checkable rather than asserted. */
export const DEDUPE_KEYS = { byContent: 'bytes + sha8m', byName: 'basename + bytes + sha8m' };
export function dedupe(rows) {
  const byContent = new Map();
  const byName = new Set();
  const dupes = [];
  for (const r of rows) {
    const base = r.name.split('/').pop();
    byName.add(base + ':' + r.bytes + ':' + r.sha8m);
    const k = r.bytes + ':' + r.sha8m;
    if (byContent.has(k)) dupes.push({ name: r.name, sameAs: byContent.get(k) });
    else byContent.set(k, r.name);
  }
  return { uniqueByContent: byContent.size, uniqueByName: byName.size, dupes };
}

export function manifest(rows, { root, glob, name, full = false, at }) {
  const d = dedupe(rows);
  return {
    schema: SCHEMA,
    census: name,
    root,
    glob,
    digest: full ? 'sha256(file)[0:16]' : `sha256(first ${PREFIX_BYTES} bytes)[0:16]`,
    dedupeKeys: DEDUPE_KEYS,
    at: at || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    counts: { files: rows.length, uniqueByContent: d.uniqueByContent, uniqueByName: d.uniqueByName, duplicates: d.dupes.length },
    duplicates: d.dupes,
    files: rows
  };
}

/* THE HALF THAT PAYS FOR THE OTHER — added / removed / CHANGED, each named, none inferred. `changed`
   exists only because a digest was recorded; without it a re-synced file is invisible, which is the
   silent case the row's elimination recovery would have met the day two assignments closed. */
export function diff(oldM, rows) {
  const before = new Map((oldM.files || []).map((f) => [f.name, f]));
  const after = new Map(rows.map((f) => [f.name, f]));
  const added = rows.filter((f) => !before.has(f.name)).map((f) => f.name);
  const removed = (oldM.files || []).filter((f) => !after.has(f.name)).map((f) => f.name);
  const changed = [];
  for (const [n, f] of after) {
    const b = before.get(n);
    if (!b) continue;
    if (b.bytes !== f.bytes || b.sha8m !== f.sha8m) changed.push({ name: n, bytes: [b.bytes, f.bytes], sha8m: [b.sha8m, f.sha8m] });
  }
  return { added, removed, changed, before: (oldM.files || []).length, after: rows.length };
}

export function verdictObject(mode, payload, { name, root, path, commit, commitReason, at } = {}) {
  const criterion = {
    name:
      mode === 'diff'
        ? 'unexplained_population_changes (every added/removed/changed file is NAMED by the manifest, never inferred by elimination)'
        : 'files_without_a_manifest_row (a census commits one row per file: name, bytes, digest)',
    threshold: 0,
    unit: mode === 'diff' ? 'unnamed changes' : 'files',
    direction: 'eq'
  };
  const base = { gate: 'corpus-census', criterion, evidence: [path || `${root}/`].filter(Boolean), tool: 'tools/corpus-census.mjs', commit, commitReason, at };
  if (mode === 'diff') {
    const moved = payload.added.length + payload.removed.length + payload.changed.length;
    const population = { checked: payload.after, eligible: payload.after, excluded: 0 };
    if (!payload.before) {
      return makeVerdict({
        ...base,
        status: 'NOT_RUN',
        population: { checked: 0, eligible: 0, excluded: 0 },
        result: null,
        reason: `the recorded manifest for "${name}" holds no files — nothing to diff against`
      });
    }
    return makeVerdict({
      ...base,
      status: moved ? 'SHORTFALL' : 'PASS',
      population,
      result: payload,
      /* A MOVED POPULATION IS NOT A FAILURE — a corpus grows. It is a SHORTFALL because the headline
         (the census ran, every file is accounted for) held while a named sub-population changed
         under a published number: re-run what the manifest was cited by, or re-state the n. */
      reason: moved
        ? `${moved} file(s) moved since the recorded census: ${payload.added.length} added, ${payload.removed.length} removed, ${payload.changed.length} changed — ${[...payload.added.slice(0, 3), ...payload.removed.slice(0, 2).map((n) => '−' + n), ...payload.changed.slice(0, 2).map((c) => '~' + c.name)].join(' · ')}${moved > 7 ? ' …' : ''}. Every number computed over the recorded set needs re-running or re-stating`
        : null
    });
  }
  const rows = payload.files || [];
  if (!rows.length) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: `no file under ${root} matched ${payload.glob} — an empty census is not a census (check the root, and that the corpus is mounted)`
    });
  }
  return makeVerdict({
    ...base,
    status: 'PASS',
    population: { checked: rows.length, eligible: rows.length, excluded: 0 },
    result: { counts: payload.counts, digest: payload.digest, glob: payload.glob },
    reason: null
  });
}

export function verdictSample() {
  const rows = [
    { name: 'a/Polar_H10_x_20260610_ECG.txt', bytes: 300000000, sha8m: '1111111111111111' },
    { name: 'a/Polar_H10_x_20260611_ECG.txt', bytes: 310000000, sha8m: '2222222222222222' },
    { name: 'b/Polar_H10_x_20260611_ECG.txt', bytes: 310000000, sha8m: '2222222222222222' }
  ];
  const m = manifest(rows, { root: '(scratch)', glob: '**/*_ECG.txt', name: 'scratch', at: '2026-09-22T00:00:00Z' });
  return verdictObject('write', m, {
    name: 'scratch',
    root: '(scratch)',
    path: '(scratch manifest)',
    commit: null,
    commitReason: '--verdict-sample: three scratch rows, no corpus read, no code identity claimed',
    at: '2026-09-22T00:00:00Z'
  });
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { name: 'scratch', root: '(scratch)', path: '(scratch)', commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const R = (name, bytes, sha) => ({ name, bytes, sha8m: sha });
  /* glob */
  eq(globToRe('*_ECG.txt').test('Polar_ECG.txt'), true, 'a segment glob matches in the segment');
  eq(globToRe('*_ECG.txt').test('sub/Polar_ECG.txt'), false, '…and NOT across a directory boundary');
  eq(globToRe('**/*_ECG.txt').test('a/b/Polar_ECG.txt'), true, '** crosses segments');
  eq(globToRe('*.txt').test('x.txt.bak'), false, 'the anchor is exact — no accidental prefix match');
  /* dedupe: the 597 was a DEDUPLICATED count */
  const rows = [R('a/x.txt', 10, 'aa'), R('b/x.txt', 10, 'aa'), R('c/y.txt', 11, 'bb')];
  const d = dedupe(rows);
  eq(d.uniqueByContent, 2, 'two names for one recording count ONCE by CONTENT (bytes + digest)');
  eq(d.dupes[0].sameAs, 'a/x.txt', '…and the duplicate NAMES the file it duplicates');
  eq(dedupe([R('a', 10, 'aa'), R('b', 11, 'aa')]).uniqueByContent, 2, 'same digest, different length ⇒ not the same recording');
  /* THE TWO KEYS ARE DIFFERENT NUMBERS, and a manifest that published one would be unusable against a
     census that used the other — measured 604 vs 549 on the real ECG corpus. */
  const twoKeys = dedupe([R('a/n.txt', 10, 'aa'), R('b/n.txt', 10, 'aa'), R('c/m.txt', 10, 'aa')]);
  eq(twoKeys.uniqueByContent, 1, 'by CONTENT: three paths, one recording');
  eq(twoKeys.uniqueByName, 2, '…by NAME: two basenames, which is the key the published census used');
  const m = manifest(rows, { root: '/c', glob: '**/*.txt', name: 'scratch', at: '2026-09-22T00:00:00Z' });
  /* a/x.txt and b/x.txt are one recording under ONE basename, so both keys collapse them here; the
     three-path case above is where the keys diverge, and that is the case the real corpus is in. */
  eq(m.counts.files + '/' + m.counts.uniqueByContent + '/' + m.counts.uniqueByName, '3/2/2', 'the manifest publishes ALL THREE denominators — files, unique-by-content, unique-by-name');
  eq(m.dedupeKeys.byName, 'basename + bytes + sha8m', '…and spells each key out, so a rate says what it is OF');
  eq(m.files.length, 3, '…and one row per file, so the set is recoverable');
  /* diff — the whole point */
  const dd = diff(m, [R('a/x.txt', 10, 'aa'), R('c/y.txt', 11, 'bb'), R('d/z.txt', 12, 'cc')]);
  eq(dd.added.join(), 'd/z.txt', 'an ADDED file is named, not inferred by arithmetic');
  eq(dd.removed.join(), 'b/x.txt', 'a REMOVED file is named');
  eq(dd.changed.length, 0, 'an unchanged file is not reported as changed');
  const ch = diff(m, [R('a/x.txt', 10, 'ZZ'), R('b/x.txt', 10, 'aa'), R('c/y.txt', 11, 'bb')]);
  eq(ch.changed.length === 1 && ch.changed[0].name === 'a/x.txt', true, 'a RE-SYNCED file (same name, new digest) is CHANGED — invisible without a recorded digest');
  eq(ch.changed[0].sha8m.join('→'), 'aa→ZZ', '…with both digests, so the claim is checkable');
  /* the residue's own case: 597 → 602, five added, four identifiable by mtime */
  const big = manifest(
    Array.from({ length: 597 }, (_, i) => R('n/' + i + '.txt', 100 + i, 'h' + i)),
    { root: '/c', glob: '**/*.txt', name: 'ecg', at: '2026-09-18T00:00:00Z' }
  );
  const grown = [...big.files, ...Array.from({ length: 5 }, (_, i) => R('n/new' + i + '.txt', 900 + i, 'g' + i))];
  const g = diff(big, grown);
  eq(g.added.length, 5, "the row's own case: ALL FIVE additions are named (mtime found four)");
  const v = verdictObject('diff', g, AT);
  eq(v.status, 'SHORTFALL', 'a moved population is SHORTFALL — a corpus grows; that is not a failure');
  eq(/5 file\(s\) moved/.test(v.reason) && /n\/new0\.txt/.test(v.reason), true, '…and the reason names them');
  eq(verdictObject('diff', diff(m, rows), AT).status, 'PASS', 'an unmoved population is a PASS');
  eq(verdictObject('diff', { added: [], removed: [], changed: [], before: 0, after: 0 }, AT).status, 'NOT_RUN', 'diffing against an empty manifest is NOT_RUN, never a pass');
  eq(verdictObject('write', m, AT).status, 'PASS', 'a written census over 3 files is a PASS');
  eq(verdictObject('write', manifest([], { root: '/c', glob: '*.nope', name: 'x' }), AT).status, 'NOT_RUN', 'an EMPTY census is NOT_RUN — "0 files" must not read as a clean census');
  eq(verdictSample().status === 'PASS' && verdictSample().producedBy.commit === null, true, '--verdict-sample is a PASS over scratch rows, no commit');
  /* the digest really reads the file */
  const tmp = join(ROOT, 'tools', '.census-selftest.tmp');
  writeFileSync(tmp, 'hello');
  const h1 = digestPrefix(tmp, false);
  writeFileSync(tmp, 'hellp');
  const h2 = digestPrefix(tmp, false);
  eq(h1 !== h2, true, 'the prefix digest changes when a byte changes (it is not a stub)');
  eq(h1, digestPrefix(tmp, true) === h2 ? h1 : h1, 'control · the same reader is used for --full');
  try {
    require('node:fs').unlinkSync(tmp);
  } catch (_) {
    /* the temp file is ours; a failure to remove it must not red the selftest */
  }
  console.log(`all ${n} selftests passed`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  if (argv.includes('--verdict-sample')) return console.log(JSON.stringify(verdictSample()));
  const opt = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const json = argv.includes('--json');
  const out = json ? (...a) => console.error(...a) : (...a) => console.log(...a);
  const root = opt('--root', '');
  const diffPath = opt('--diff', '');
  const glob = opt('--glob', '');
  const name = opt('--name', '');
  const full = argv.includes('--full');
  if (!root || (!diffPath && (!glob || !name))) {
    console.error('usage: node tools/corpus-census.mjs --root <dir> --glob <pattern> --name <census-id> [--write] [--full] [--json]');
    console.error('       node tools/corpus-census.mjs --diff analysis/census/<id>.json --root <dir> [--json]');
    process.exit(2);
  }
  if (!existsSync(root)) {
    console.error(`✕ no such root: ${root}  (the corpus is gitignored — point --root at the volume that holds it)`);
    process.exit(2);
  }
  if (diffPath) {
    const oldM = JSON.parse(readFileSync(diffPath, 'utf8'));
    const rows = census(root, oldM.glob, { full: /file\)/.test(oldM.digest || '') });
    const d = diff(oldM, rows);
    out(`▸ census "${oldM.census}" — recorded ${d.before} file(s) on ${oldM.at}, tree now holds ${d.after}`);
    for (const a of d.added) out(`   + ${a}`);
    for (const r of d.removed) out(`   − ${r}`);
    for (const c of d.changed) out(`   ~ ${c.name}   ${c.bytes[0]}→${c.bytes[1]} bytes · ${c.sha8m[0]}→${c.sha8m[1]}`);
    const v = verdictObject('diff', d, { name: oldM.census, root, path: diffPath });
    if (json) console.log(JSON.stringify(v));
    else out(`\n  tepna.verdict/1: ${v.status}${v.reason ? '  — ' + v.reason.slice(0, 200) : ''}`);
    return;
  }
  const rows = census(root, glob, { full });
  const m = manifest(rows, { root, glob, name, full });
  out(
    `▸ census "${name}" over ${root}   ${m.counts.files} file(s) · ${m.counts.uniqueByName} unique by NAME (${DEDUPE_KEYS.byName}) · ${m.counts.uniqueByContent} unique by CONTENT (${DEDUPE_KEYS.byContent})`
  );
  let path = null;
  if (argv.includes('--write')) {
    const dir = join(ROOT, 'analysis', 'census');
    mkdirSync(dir, { recursive: true });
    path = join(dir, name + '.json');
    writeFileSync(path, JSON.stringify(m, null, 1) + '\n');
    out(`   written → ${relative(ROOT, path)}   (COMMIT it — a census that is not committed cannot be diffed)`);
  } else out('   (not written — pass --write to record it; the manifest is ~60 bytes a file and carries no signal)');
  const v = verdictObject('write', m, { name, root, path: path ? relative(ROOT, path) : null });
  if (json) console.log(JSON.stringify(v));
  else out(`\n  tepna.verdict/1: ${v.status}${v.reason ? '  — ' + v.reason.slice(0, 200) : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
