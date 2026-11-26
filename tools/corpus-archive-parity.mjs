#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Michal Planicka — Tepna
/**
 * corpus-archive-parity.mjs — is every archived capture whole in the live corpus? READ-ONLY.
 *
 * The vigil archive (`captures/<date>/<file>`) holds the bytes the capture host wrote. The live corpus
 * holds a copy of some of them under its own tree (`smoketest-captures/<date>/…`, `uploads/…`). A corpus
 * copy that is SHORTER than its archive twin lost bytes on the way (measured 2026-11-26: nine O2Ring files
 * of the 2026-10-14 night, written 0 bytes or short and never refreshed). This tool pairs the two trees by
 * `<date>/<file>` path and compares sizes. It reads `stat` only — no file content, no writes.
 *
 *   node tools/corpus-archive-parity.mjs [--corpus <dir>] [--archive <dir>] [--json]
 *   node tools/corpus-archive-parity.mjs --selftest
 *   node tools/corpus-archive-parity.mjs --verdict-sample   # the object alone, for the adoption gate
 *
 * Criterion (pre-stated): the count of paired corpus files shorter than their archive twin is 0.
 * Population: archive STREAM files (under `<YYYY-MM-DD>/`, 14-digit stamp in the name) with a corpus twin, paired by the
 * `<date>/<file>` path suffix. A night file with no twin is not judged (the corpus holds a selection by
 * design) and is counted in `result.unpaired`. Host-state files outside a dated directory grow in
 * place, so they are counted in `result.hostStateExcluded` and never judged.
 * A corpus copy LONGER than its archive twin is reported in `result.longer` but does not fail: a
 * corpus file can be a later, fuller export under one name. Status FAIL names every short file.
 * Exit: 0 PASS · 1 FAIL · 2 could not look (a tree is absent → NOT_RUN).
 */
import { readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { makeVerdict } from './verdict-emit.mjs';
import { isCliEntry } from './argv-guard.mjs';

const TOOL = 'tools/corpus-archive-parity.mjs';
const GATE = 'corpus-archive-parity';
const DEFAULT_CORPUS = '/srv/data/tepna-corpus';
const DEFAULT_ARCHIVE = '/mnt/nas/vigil-archive/captures';
const CRITERION = { name: 'corpus_files_shorter_than_archive', threshold: 0, unit: 'files', direction: 'lte' };

/* Walk a tree and yield { rel, size } for each regular file. Iterative, so a deep tree costs no stack;
   an unreadable directory is counted, never fatal — the caller reports it beside the verdict. */
export function walk(root) {
  const files = [];
  const denied = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      denied.push(relative(root, dir) || '.');
      continue;
    }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          files.push({ rel: relative(root, p), size: statSync(p).size });
        } catch {
          denied.push(relative(root, p));
        }
      }
    }
  }
  return { files, denied };
}

/* A NIGHT FILE is one under a dated top directory (`<YYYY-MM-DD>/…`): bytes a capture wrote once.
   Everything else in the archive (`status.json`, `watchdog.log`, `stored/`, the device mirrors) is host
   state that grows or is rewritten in place, so an older corpus copy is shorter by design. Those are
   counted as `excluded`, never judged. */
const NIGHT = /^\d{4}-\d{2}-\d{2}\//;
/* A STREAM file carries the 14-digit start stamp in its name (`<Device>_<YYYYMMDDHHMMSS>_<STREAM>`,
   `Tepna_<stamp>_LINK.csv`). Its bytes are what a capture recorded, so a short copy loses signal.
   An unstamped night file is a host sidecar (`LOSS-VERDICT.json`, `SOLID-VERDICT-WITHDRAWN.jsonl`,
   `WORN.csv`): the host rewrites or extends it after the night, so a short copy is reported in
   `result.sidecarShorter` and never judged. */
const STREAM = /_\d{14}_[^/]+$/;

/* Pair by the archive's own relative path as a SUFFIX of the corpus path (`…/2026-10-14/<file>`).
   A basename alone is not an identity: generic device names (`ACC.REC`) repeat across sessions.
   A night file the corpus holds more than once is compared against EVERY copy: one short copy is
   enough to lose bytes for a reader who opens it. */
export function compare(archiveFiles, corpusFiles) {
  const key = (rel) => rel.split('/').slice(-2).join('/');
  const byKey = new Map();
  for (const c of corpusFiles) {
    const k = key(c.rel);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  const shorter = [];
  const longer = [];
  let paired = 0;
  let unpaired = 0;
  let pairs = 0;
  let excluded = 0;
  const sidecarShorter = [];
  let sidecars = 0;
  for (const a of archiveFiles) {
    if (!NIGHT.test(a.rel)) {
      excluded++;
      continue;
    }
    const isStream = STREAM.test(a.rel);
    const twins = (byKey.get(key(a.rel)) || []).filter((c) => c.rel === a.rel || c.rel.endsWith(`/${a.rel}`));
    if (!twins.length) {
      unpaired++;
      continue;
    }
    if (!isStream) {
      sidecars++;
      for (const c of twins) if (c.size < a.size) sidecarShorter.push({ archive: a.rel, corpus: c.rel, archiveBytes: a.size, corpusBytes: c.size });
      continue;
    }
    paired++;
    for (const c of twins) {
      pairs++;
      if (c.size < a.size) shorter.push({ archive: a.rel, corpus: c.rel, archiveBytes: a.size, corpusBytes: c.size });
      else if (c.size > a.size) longer.push({ archive: a.rel, corpus: c.rel, archiveBytes: a.size, corpusBytes: c.size });
    }
  }
  return { paired, unpaired, pairs, excluded, sidecars, sidecarShorter, shorter, longer };
}

export function verdictOf(cmp, { archive, corpus, denied = { archive: 0, corpus: 0 }, commit, commitReason } = {}) {
  const base = {
    gate: GATE,
    criterion: CRITERION,
    evidence: [TOOL, archive, corpus].filter(Boolean),
    tool: TOOL,
    ...(commit === undefined ? {} : { commit, commitReason })
  };
  if (!cmp) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: 'a tree is absent, so no file was compared'
    });
  }
  const n = cmp.shorter.length;
  const result = {
    shorter: n,
    shorterFiles: cmp.shorter,
    longer: cmp.longer.length,
    longerFiles: cmp.longer.slice(0, 50),
    pairs: cmp.pairs,
    unpaired: cmp.unpaired,
    hostStateExcluded: cmp.excluded,
    sidecarsPaired: cmp.sidecars,
    sidecarShorter: cmp.sidecarShorter.length,
    deniedDirs: denied
  };
  const population = { checked: cmp.paired, eligible: cmp.paired, excluded: 0 };
  if (cmp.paired === 0) {
    return makeVerdict({
      ...base,
      status: 'NOT_APPLICABLE',
      population,
      result: null,
      reason: `no night file in the archive has a corpus twin (${cmp.unpaired} unpaired, ${cmp.excluded} host-state files excluded), so the rule does not bind`
    });
  }
  return makeVerdict({
    ...base,
    status: n === 0 ? 'PASS' : 'FAIL',
    population,
    result,
    reason: n === 0 ? null : `${n} corpus file(s) are shorter than their archive twin; the archive holds the full bytes`
  });
}

export function run(archive, corpus) {
  if (!existsSync(archive) || !existsSync(corpus)) return { v: verdictOf(null, { archive, corpus }), cmp: null };
  const A = walk(archive);
  const C = walk(corpus);
  const cmp = compare(A.files, C.files);
  return { v: verdictOf(cmp, { archive, corpus, denied: { archive: A.denied.length, corpus: C.denied.length } }), cmp, A, C };
}

function selftest() {
  let n = 0;
  let fail = 0;
  const ok = (name, cond, detail = '') => {
    n++;
    if (!cond) fail++;
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
  };
  const tmp = mkdtempSync(join(tmpdir(), 'cap-parity-'));
  try {
    const arc = join(tmp, 'archive');
    const cor = join(tmp, 'corpus');
    mkdirSync(join(arc, '2026-10-14'), { recursive: true });
    mkdirSync(join(cor, 'smoketest-captures', '2026-10-14'), { recursive: true });
    mkdirSync(join(cor, 'uploads'), { recursive: true });
    writeFileSync(join(arc, '2026-10-14', 'D_20261014063118_SPO2.csv'), 'x'.repeat(100));
    writeFileSync(join(arc, '2026-10-14', 'D_20261014063118_PPG.txt'), 'x'.repeat(50));
    writeFileSync(join(arc, '2026-10-14', 'D_20261014063118_ONLY.txt'), 'x');
    writeFileSync(join(cor, 'smoketest-captures', '2026-10-14', 'D_20261014063118_SPO2.csv'), 'x'.repeat(100));
    writeFileSync(join(cor, 'smoketest-captures', '2026-10-14', 'D_20261014063118_PPG.txt'), 'x'.repeat(50));
    mkdirSync(join(cor, 'uploads', '2026-10-14'), { recursive: true });
    writeFileSync(join(cor, 'uploads', '2026-10-14', 'D_20261014063118_PPG.txt'), 'x'.repeat(60));
    writeFileSync(join(arc, '2026-10-14', 'LOSS-VERDICT.json'), 'x'.repeat(30));
    writeFileSync(join(cor, 'smoketest-captures', '2026-10-14', 'LOSS-VERDICT.json'), 'x'.repeat(20));
    writeFileSync(join(arc, 'status.json'), 'x'.repeat(30));
    writeFileSync(join(cor, 'status.json'), 'x'.repeat(10));
    mkdirSync(join(cor, 'other', '2026-10-15'), { recursive: true });
    writeFileSync(join(cor, 'other', '2026-10-15', 'D_20261014063118_ONLY.txt'), '');

    let r = run(arc, cor);
    ok('whole copies PASS', r.v.status === 'PASS', JSON.stringify(r.v.result));
    ok('the population is the paired archive files, not every file', r.v.population.checked === 2, JSON.stringify(r.v.population));
    ok('an archive file with no twin is counted unpaired, not judged', r.v.result.unpaired === 1);
    ok('a longer corpus copy is reported and does not fail', r.v.result.longer === 1 && r.v.status === 'PASS');
    ok('a duplicate night file is compared against every copy', r.v.result.pairs === 3, `pairs=${r.v.result.pairs}`);
    ok('a shorter host-state file outside a dated directory is excluded, not failed', r.v.result.hostStateExcluded === 1 && r.v.status === 'PASS');
    ok('the same basename under another date is not a twin', r.v.result.unpaired === 1);
    ok('a shorter unstamped night sidecar is reported, not failed', r.v.result.sidecarShorter === 1 && r.v.status === 'PASS');

    writeFileSync(join(cor, 'smoketest-captures', '2026-10-14', 'D_20261014063118_SPO2.csv'), '');
    r = run(arc, cor);
    ok('a zero-byte corpus copy FAILS', r.v.status === 'FAIL');
    ok('the FAIL names the short file and both sizes', r.v.result.shorterFiles[0]?.corpusBytes === 0 && r.v.result.shorterFiles[0]?.archiveBytes === 100);
    ok('a FAIL carries a reason', typeof r.v.reason === 'string' && r.v.reason.length > 0);

    writeFileSync(join(cor, 'smoketest-captures', '2026-10-14', 'D_20261014063118_SPO2.csv'), 'x'.repeat(99));
    ok('one byte short FAILS (no tolerance)', run(arc, cor).v.status === 'FAIL');

    ok('an absent tree is NOT_RUN, never PASS', run(join(tmp, 'nope'), cor).v.status === 'NOT_RUN');
    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    ok('no pairs at all is NOT_APPLICABLE, never PASS over zero', run(arc, empty).v.status === 'NOT_APPLICABLE');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const s = verdictSample();
  ok('the sample is a valid verdict', s.schema === 'tepna.verdict/1' && s.status === 'FAIL');
  console.log(fail ? `FAIL — ${fail} of ${n} selftests failed` : `all ${n} selftests passed`);
  return fail ? 1 : 0;
}

/* A synthetic shape for the adoption gate: one short file over two pairs. No disk, no git. */
export function verdictSample() {
  const cmp = compare(
    [
      { rel: '2026-10-14/D_20261014063118_SPO2.csv', size: 100 },
      { rel: '2026-10-14/D_20261014063118_PPG.txt', size: 50 }
    ],
    [
      { rel: 'smoketest-captures/2026-10-14/D_20261014063118_SPO2.csv', size: 0 },
      { rel: 'smoketest-captures/2026-10-14/D_20261014063118_PPG.txt', size: 50 }
    ]
  );
  return verdictOf(cmp, { archive: 'sample:archive', corpus: 'sample:corpus', commit: null, commitReason: 'a synthetic --verdict-sample' });
}

if (isCliEntry(import.meta.url)) {
  const argv = process.argv.slice(2);
  const known = new Set(['--selftest', '--verdict-sample', '--json', '--corpus', '--archive']);
  for (let i = 0; i < argv.length; i++) {
    if (!known.has(argv[i])) {
      console.error(`corpus-archive-parity: unknown argument ${argv[i]}`);
      process.exit(2);
    }
    if (argv[i] === '--corpus' || argv[i] === '--archive') i++;
  }
  const av = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  if (argv.includes('--selftest')) process.exit(selftest());
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 2));
    process.exit(0);
  }
  const archive = av('--archive', DEFAULT_ARCHIVE);
  const corpus = av('--corpus', DEFAULT_CORPUS);
  const { v, cmp, A, C } = run(archive, corpus);
  if (argv.includes('--json')) console.log(JSON.stringify(v, null, 2));
  else {
    if (cmp) {
      console.log(`archive ${A.files.length} files · corpus ${C.files.length} files · paired ${cmp.paired} · pairs ${cmp.pairs} · unpaired ${cmp.unpaired}`);
      console.log(`unreadable: archive ${A.denied.length} · corpus ${C.denied.length} (a denied directory is not compared)`);
      for (const s of cmp.shorter) console.log(`SHORT ${s.corpus}  ${s.corpusBytes} < ${s.archiveBytes}  (archive ${s.archive})`);
      if (cmp.sidecarShorter.length) console.log(`shorter host sidecars: ${cmp.sidecarShorter.length} of ${cmp.sidecars} paired (rewritten after the night; reported, not failed)`);
      if (cmp.longer.length) console.log(`longer corpus copies: ${cmp.longer.length} (reported, not failed)`);
    }
    console.log(`${v.status}${v.reason ? ` — ${v.reason}` : ''}`);
    console.log(JSON.stringify(v));
  }
  process.exit(v.status === 'PASS' ? 0 : v.status === 'FAIL' ? 1 : 2);
}
