#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// fold-generation.mjs — re-resolve the corpus identity a published number was cut from.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: A PUBLISHED NUMBER RECORDS WHICH FILES IT READ AND NOT WHICH FOLD PRODUCED THEM.
// Residue `2026-09-22-corpus-consumers-have-no-staleness-stamp`: the 2026-09-22 whole-corpus re-fold
// changed 288 of 288 comparable exports, so every cross-night statistic over `uploads/trio` has a
// stale ancestor, and nothing in `analysis/published-numbers/*.json` tells a number cut before that
// re-fold from one cut after. The per-night `.trio-stamp` carries `codeDigest`, which names the
// pipeline version that folded THAT night. No consumer records it.
//
// 🔴 A DIGEST OVER EVERY TRACKED FILE MIXES DATA WITH PROVENANCE, so writing provenance invalidates
// the number. Measured 2026-10-21: `tch-pooled-hat-2026-10-12.json` carries `inputs.digest`
// `5390791458eb` over all 658 tracked files under `uploads/trio`; today the same formula reads
// `660ca80e6ab3`, and the whole difference is ONE added file, `uploads/trio/2026-08-15/.trio-stamp`.
// Over the 569 DATA files alone both commits read `f291c3a6dc99`, so the measurement inputs never
// moved. A staleness check built on the all-files digest reds on its own provenance machinery.
// This tool therefore answers two questions separately and never merges them:
//   dataDigest      did the EXPORTS move?            (the number's inputs)
//   foldGeneration  which pipeline folded them?      (the stamps, plus the nights that carry none)
//
// ∅ A NIGHT WITH NO STAMP IS NOT A NIGHT OF GENERATION "none". 57 of the 147 night folders carry no
// `.trio-stamp` at all, so a generation computed over the stamped 90 would describe a subset while
// reading like the whole. `foldGeneration` counts the unstamped nights, names them, and the digest
// covers the night set itself, so stamping a night MOVES the generation — which is the truth: the
// corpus now says something it did not say before.
//
// Usage:
//   node tools/fold-generation.mjs                       # the corpus identity, here and now
//   node tools/fold-generation.mjs --all [--json]        # re-resolve every published-number record
//   node tools/fold-generation.mjs --record <path.json>
//   node tools/fold-generation.mjs --selftest
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const TRIO = 'uploads/trio';
export const STAMP = '.trio-stamp';
export const RECORD_DIR = 'analysis/published-numbers';
export const SELF = 'tools/fold-generation.mjs';

export const sha12 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);

/* The files git tracks under a root. A path is data unless its basename is the stamp — the split the
   header is about. Returns null, never [], when the tree cannot be listed (§∅). */
export function trackedFiles(root = TRIO, { cwd = ROOT, commit = null } = {}) {
  let out;
  try {
    out = commit ? execFileSync('git', ['ls-tree', '-r', '--name-only', commit, root], { cwd, maxBuffer: 1 << 28 }) : execFileSync('git', ['ls-files', root], { cwd, maxBuffer: 1 << 28 });
  } catch {
    return null;
  }
  const all = out.toString().split('\n').filter(Boolean).sort();
  return { all, data: all.filter((f) => !f.endsWith(`/${STAMP}`)), stamps: all.filter((f) => f.endsWith(`/${STAMP}`)) };
}

/* `path\0sha12(bytes)` per file, newline-joined, sha12 of the whole — the spelling the published
   records document and the one this tool reproduced from `tch-pooled-hat-2026-10-12.json`. */
export function digestOf(files, readBytes) {
  if (files == null) return null;
  const parts = files.map((f) => `${f}\0${sha12(readBytes(f))}`);
  return sha12(parts.join('\n'));
}

export function readerFor({ cwd = ROOT, commit = null } = {}) {
  return (f) => (commit ? execFileSync('git', ['show', `${commit}:${f}`], { cwd, maxBuffer: 1 << 28 }) : readFileSync(join(cwd, f)));
}

/* A consumer names its corpus with whatever `--dir` it was given, which may be an absolute path, a
   path outside the checkout, or a tree git does not track. Return the repo-relative root or null —
   never a guess, so a corpus this tool cannot read reports that it cannot read it (§∅). */
export function repoRelative(dir, { cwd = ROOT } = {}) {
  const rel = relative(resolve(cwd), resolve(dir)).split('\\').join('/');
  if (!rel || rel.startsWith('..')) return null;
  return rel;
}

/** Both digests over one root, plus the fold generation. Absent tree → every field null + a reason. */
export function corpusIdentity(root = TRIO, { cwd = ROOT, commit = null, nights: only = null } = {}) {
  let files = trackedFiles(root, { cwd, commit });
  /* `only` scopes the identity to the nights a consumer actually READ. 🔴 A number that used 90 of
     147 folders is not described by a generation over all 147: the 57 it never opened would mask a
     hole among the 90. Scoping is the caller's claim about its own population, so it is recorded. */
  if (files != null && only != null) {
    const want = new Set(only);
    const keep = (f) => want.has(f.slice(root.length + 1).split('/')[0]);
    files = { all: files.all.filter(keep), data: files.data.filter(keep), stamps: files.stamps.filter(keep) };
  }
  if (files == null || files.all.length === 0) {
    return {
      root,
      commit,
      scopedTo: only == null ? null : only.length,
      ok: false,
      reason: files == null ? `git could not list ${root}` : only == null ? `${root} holds no tracked file` : `none of the ${only.length} named night(s) is tracked under ${root}`,
      dataDigest: null,
      allFilesDigest: null,
      dataFiles: 0,
      allFiles: 0,
      generation: null,
      nights: null,
      stamped: null,
      unstamped: null,
      unstampedNights: null,
      codeDigests: null
    };
  }
  const read = readerFor({ cwd, commit });
  /* 🔴 A NIGHT IS A DIRECTORY, AND A ROOT-LEVEL FILE IS NOT ONE. Measured 2026-10-21: the first
     spelling split every tracked path on `/` and took segment 0, which read
     `uploads/trio/trio-batch-verdicts.json` as a 148th night and reported it UNSTAMPED. The corpus
     holds 147 night folders. Require a segment BELOW the first one. */
  const nightsSet = new Set(
    files.all
      .map((f) => f.slice(root.length + 1).split('/'))
      .filter((p) => p.length > 1)
      .map((p) => p[0])
  );
  const nights = [...nightsSet].sort();
  const rootFiles = files.all.filter((f) => !f.slice(root.length + 1).includes('/'));
  const stampOf = new Map();
  for (const s of files.stamps) {
    const night = s.slice(root.length + 1).split('/')[0];
    let digest = null;
    try {
      digest = JSON.parse(read(s).toString()).codeDigest ?? null;
    } catch {
      digest = null; // an unreadable stamp is an UNSTAMPED night, never a generation of its own
    }
    if (digest) stampOf.set(night, digest);
  }
  const unstampedNights = nights.filter((n) => !stampOf.has(n));
  const generation = sha12(nights.map((n) => `${n}\0${stampOf.get(n) ?? ''}`).join('\n'));
  return {
    root,
    commit,
    scopedTo: only == null ? null : only.length,
    ok: true,
    reason: null,
    dataDigest: digestOf(files.data, read),
    allFilesDigest: digestOf(files.all, read),
    dataFiles: files.data.length,
    allFiles: files.all.length,
    generation,
    nights: nights.length,
    stamped: stampOf.size,
    unstamped: unstampedNights.length,
    unstampedNights,
    nightNames: nights,
    rootFiles: rootFiles.length,
    codeDigests: [...new Set(stampOf.values())].sort()
  };
}

/** The corpus block a consumer writes into its record at cut time. */
export function corpusBlock(identity) {
  if (!identity.ok) return { root: identity.root, resolvable: false, reason: identity.reason, dataDigest: null, foldGeneration: null };
  return {
    root: identity.root,
    resolvable: true,
    dataDigest: identity.dataDigest,
    dataFiles: identity.dataFiles,
    foldGeneration: identity.generation,
    scopedToNightsRead: identity.scopedTo,
    nights: identity.nights,
    stamped: identity.stamped,
    unstamped: identity.unstamped,
    codeDigests: identity.codeDigests,
    note: `dataDigest = sha256[0:12] over path\\0sha12(bytes) of every git-tracked file under ${identity.root} that is not a ${STAMP}; foldGeneration covers the night set and each night's ${STAMP} codeDigest, so an unstamped night contributes its name and no generation. Re-resolve both with ${SELF}`
  };
}

/* Which records this tool judges, and why the others are out. A record that names another corpus
   cannot be checked here, and a SUPERSEDED record is a historical cut whose corpus is expected to
   have moved — reporting either as a failure would bury the one live answer. */
export function classifyRecord(record, { supersededBy = null, root = TRIO } = {}) {
  const path = String(record?.inputs?.path ?? '');
  if (path !== root) return { judged: false, why: 'names another corpus', corpusPath: path || null };
  if (supersededBy) return { judged: false, why: `superseded by ${supersededBy}`, corpusPath: path };
  return { judged: true, why: null, corpusPath: path };
}

/* name → the record that supersedes it, read from each record's own `supersedes` field.
   🔴 THE FIELD IS A PATH FOLLOWED BY PROSE, not a path. Every live `supersedes` in
   `analysis/published-numbers/` reads
   `analysis/published-numbers/<name>.json (inputs <digest>, <n> files, <n> nights — …)`,
   so a bare `.split('/').pop()` returns the name WITH the whole sentence attached and every lookup
   misses. Measured 2026-10-21: the first spelling judged all five `tch-pooled-hat-*` records live
   when four are superseded. Take the first whitespace-delimited token, then the basename. */
export function supersededName(field) {
  if (typeof field !== 'string') return null;
  const token = field.trim().split(/\s+/)[0];
  const name = token.split('/').pop();
  return name && name.endsWith('.json') ? name : null;
}

export function supersessionMap(records) {
  const m = new Map();
  for (const r of records)
    for (const old of [].concat(r.record?.supersedes ?? [])) {
      const name = supersededName(old);
      if (name) m.set(name, r.name);
    }
  return m;
}

/* path → blob oid for the EXPORT files at one commit. Identical content gives an identical oid, so
   comparing two of these answers "did the measurement inputs move?" exactly, without reading 430 MB
   of bytes through this process. Returns null when the commit is not in this clone. */
export function dataOids(root = TRIO, { cwd = ROOT, commit = 'HEAD' } = {}) {
  let out;
  try {
    out = execFileSync('git', ['ls-tree', '-r', commit, '--', root], { cwd, maxBuffer: 1 << 26 });
  } catch {
    return null;
  }
  const m = new Map();
  for (const line of out.toString().split('\n')) {
    if (!line) continue;
    const [meta, path] = line.split('\t');
    if (!path || path.endsWith(`/${STAMP}`)) continue;
    m.set(path, meta.trim().split(/\s+/)[2]);
  }
  return m.size ? m : null;
}

export function oidDelta(before, after) {
  if (!before || !after) return null;
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [path, oid] of after) {
    if (!before.has(path)) added++;
    else if (before.get(path) !== oid) changed++;
  }
  for (const path of before.keys()) if (!after.has(path)) removed++;
  return { added, removed, changed, moved: added + removed + changed };
}

/* One record against one measured identity. The record may carry the NEW block, the legacy
   `inputs.digest`, or neither — each is a different sentence about what can be known. */
export function compareRecord(record, identity, cut = null) {
  const block = record?.corpus ?? null;
  const legacy = record?.inputs?.digest ?? null;
  if (!identity.ok) return { state: 'unresolvable', detail: identity.reason };
  if (block?.foldGeneration) {
    const dataMoved = block.dataDigest !== identity.dataDigest;
    const genMoved = block.foldGeneration !== identity.generation;
    if (!dataMoved && !genMoved) return { state: 'resolves', detail: null };
    return {
      state: 'moved',
      detail: dataMoved && genMoved ? 'the exports and the fold generation both moved' : dataMoved ? 'the exports moved' : 'the fold generation moved while the exports did not',
      dataMoved,
      genMoved
    };
  }
  if (legacy) {
    if (legacy === identity.allFilesDigest) return { state: 'resolves', detail: 'the legacy all-files digest still resolves' };
    /* The legacy digest covers the stamps, so a provenance write moves it while the measurement
       inputs sit still. Only the exports AT THE RECORD'S OWN CUT can tell those two apart. */
    if (!cut?.commit)
      return {
        state: 'moved',
        detail: 'the legacy all-files digest no longer resolves and the record names no producerCommit, so nothing distinguishes an export change from a provenance write',
        legacy: true
      };
    if (cut.delta == null) return { state: 'unresolvable', detail: `the record's producerCommit ${cut.commit} is not in this clone, so the exports at its cut cannot be read`, legacy: true };
    if (cut.delta.moved === 0)
      return { state: 'resolves', detail: `the exports are byte-identical to the cut at ${cut.commit}; the legacy digest moved only because it also covers ${STAMP} files`, legacy: true };
    return { state: 'moved', detail: `${cut.delta.moved} export file(s) moved since ${cut.commit} (+${cut.delta.added} / −${cut.delta.removed} / ~${cut.delta.changed})`, legacy: true };
  }
  return { state: 'unstamped', detail: 'the record carries no corpus identity at all' };
}

export function allVerdict(rows, identity, { commit = null } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const judged = rows.filter((r) => r.judged);
  const resolving = judged.filter((r) => r.state === 'resolves');
  const failing = judged.filter((r) => r.state !== 'resolves');
  let status;
  let reason = null;
  if (!identity.ok) {
    status = 'NOT_RUN';
    reason = identity.reason;
  } else if (judged.length === 0) {
    status = 'NOT_RUN';
    reason = `no live record names ${identity.root}, so nothing was re-resolved`;
  } else if (failing.length === 0) {
    status = 'PASS';
  } else {
    status = 'SHORTFALL';
    reason = `${failing.length} live record(s) no longer re-resolve: ${failing.map((r) => `${r.name} (${r.detail})`).join('; ')}`;
  }
  const v = Verdict.make({
    gate: 'published-number-corpus',
    status,
    scope: 'internal',
    population: { checked: judged.length, eligible: rows.length, excluded: rows.length - judged.length },
    criterion: { name: 'records_reresolving', threshold: 0, unit: 'records', direction: 'lte' },
    result: status === 'NOT_RUN' ? null : { resolving: resolving.length, failing: failing.length, rows, identity },
    evidence: [SELF, RECORD_DIR],
    reason,
    producedBy: { tool: SELF, commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`fold-generation: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

export function readRecords(dir = RECORD_DIR, { cwd = ROOT } = {}) {
  const abs = join(cwd, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => {
      try {
        return { name, record: JSON.parse(readFileSync(join(abs, name), 'utf8')) };
      } catch {
        return { name, record: null };
      }
    });
}

export function auditRecords({ cwd = ROOT, commit = null, root = TRIO } = {}) {
  const identity = corpusIdentity(root, { cwd, commit });
  const records = readRecords(RECORD_DIR, { cwd });
  const superseded = supersessionMap(records);
  const now = dataOids(root, { cwd, commit: commit ?? 'HEAD' });
  const rows = records.map(({ name, record }) => {
    const cls = classifyRecord(record, { supersededBy: superseded.get(name) ?? null, root });
    if (!cls.judged) return { name, judged: false, why: cls.why, state: null, detail: null };
    const cutCommit = typeof record?.producerCommit === 'string' ? record.producerCommit : null;
    const cut = cutCommit ? { commit: cutCommit, delta: oidDelta(dataOids(root, { cwd, commit: cutCommit }), now) } : null;
    const cmp = compareRecord(record, identity, cut);
    return { name, judged: true, why: null, state: cmp.state, detail: cmp.detail };
  });
  return { identity, rows };
}

function gitCommitShort(cwd = ROOT) {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd }).toString().trim();
  } catch {
    return null;
  }
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
    }
  };
  const tmp = mkdtempSync(join(tmpdir(), 'foldgen-'));
  try {
    const cwd = join(tmp, 'repo');
    const mk = (rel, text) => {
      mkdirSync(join(cwd, dirname(rel)), { recursive: true });
      writeFileSync(join(cwd, rel), text);
    };
    mkdirSync(cwd, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['config', 'user.email', 'selftest@example.invalid'], { cwd });
    execFileSync('git', ['config', 'user.name', 'selftest'], { cwd });
    mk(`${TRIO}/2026-06-10/OxyDex.node-export.json`, '{"a":1}');
    mk(`${TRIO}/2026-06-11/OxyDex.node-export.json`, '{"a":2}');
    mk(`${TRIO}/2026-06-10/${STAMP}`, JSON.stringify({ codeDigest: 'aaaa1111' }));
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-qm', 'corpus'], { cwd });

    const base = corpusIdentity(TRIO, { cwd });
    ok('the identity resolves over a tracked corpus', base.ok, base.reason ?? '');
    ok('two nights, one stamped and one not', base.nights === 2 && base.stamped === 1 && base.unstamped === 1, `${base.nights}/${base.stamped}/${base.unstamped}`);
    ok('∅ the unstamped night is NAMED, not counted away', base.unstampedNights.join() === '2026-06-11');
    ok('the data digest ignores the stamp file', base.dataFiles === 2 && base.allFiles === 3);

    /* THE MEASURED DEFECT, as a test: writing provenance must not move the data digest. */
    mk(`${TRIO}/2026-06-11/${STAMP}`, JSON.stringify({ codeDigest: 'aaaa1111' }));
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-qm', 'stamp the second night'], { cwd });
    const stamped = corpusIdentity(TRIO, { cwd });
    ok('PROVENANCE ONLY · the data digest holds when a stamp is added', stamped.dataDigest === base.dataDigest, `${base.dataDigest} → ${stamped.dataDigest}`);
    ok('PROVENANCE ONLY · the all-files digest moves, which is why no number may rest on it', stamped.allFilesDigest !== base.allFilesDigest);
    ok('the fold generation moves, because the corpus now attributes a night it could not before', stamped.generation !== base.generation);

    /* A record carrying the new block. */
    const rec = { inputs: { path: TRIO }, corpus: corpusBlock(stamped) };
    ok('a record cut now re-resolves', compareRecord(rec, stamped).state === 'resolves');
    const older = { inputs: { path: TRIO }, corpus: corpusBlock(base) };
    const moved = compareRecord(older, stamped);
    ok('a record cut before the stamp reads MOVED and names which half moved', moved.state === 'moved' && moved.genMoved === true && moved.dataMoved === false, moved.detail ?? '');
    ok('a record naming another corpus is not judged', classifyRecord({ inputs: { path: 'uploads/other' } }).judged === false);
    ok('a superseded record is not judged', classifyRecord({ inputs: { path: TRIO } }, { supersededBy: 'newer.json' }).judged === false);
    ok(
      'THE REAL SHAPE · a `supersedes` path followed by prose still yields the bare name',
      supersededName('analysis/published-numbers/tch-pooled-hat-2026-09-21.json (inputs 19c31a194ec7, 441 files, 63 nights — the whole-corpus re-fold moved the tree under it)') ===
        'tch-pooled-hat-2026-09-21.json'
    );
    ok('a `supersedes` field that names no record yields null', supersededName('nothing here') === null && supersededName(undefined) === null);
    ok('the oid map skips the stamps', dataOids(TRIO, { cwd }).size === 2 && ![...dataOids(TRIO, { cwd }).keys()].some((k) => k.endsWith(STAMP)));
    ok('an unknown commit gives no oid map, so the comparison refuses rather than passing', dataOids(TRIO, { cwd, commit: 'deadbee' }) === null);
    ok('oidDelta over a null side is null, never a zero delta', oidDelta(null, dataOids(TRIO, { cwd })) === null);
    {
      const headOids = dataOids(TRIO, { cwd });
      const atCut = dataOids(TRIO, { cwd, commit: 'HEAD~1' });
      ok('PROVENANCE ONLY · the exports did not move across the stamp commit', oidDelta(atCut, headOids)?.moved === 0, JSON.stringify(oidDelta(atCut, headOids)));
      const legacyRec = { inputs: { path: TRIO, digest: 'deadbeef0000' }, producerCommit: 'HEAD~1' };
      const noMove = compareRecord(legacyRec, stamped, { commit: 'HEAD~1', delta: { added: 0, removed: 0, changed: 0, moved: 0 } });
      ok('a legacy record whose exports held reads RESOLVES and names the stamp as the cause', noMove.state === 'resolves' && noMove.detail.includes(STAMP), noMove.detail ?? '');
      const didMove = compareRecord(legacyRec, stamped, { commit: 'HEAD~1', delta: { added: 1, removed: 0, changed: 2, moved: 3 } });
      ok('a legacy record whose exports moved reads MOVED with the counts', didMove.state === 'moved' && didMove.detail.includes('3 export file(s) moved'));
      ok('a legacy record with no producerCommit cannot tell the two apart, and says so', compareRecord({ inputs: { path: TRIO, digest: 'deadbeef0000' } }, stamped, null).state === 'moved');
      ok('a legacy record whose cut commit is gone reads UNRESOLVABLE, never a pass', compareRecord(legacyRec, stamped, { commit: 'deadbee', delta: null }).state === 'unresolvable');
    }
    ok('supersession is read from the records themselves', supersessionMap([{ name: 'new.json', record: { supersedes: 'analysis/published-numbers/old.json' } }]).get('old.json') === 'new.json');
    ok('a record with no corpus identity is UNSTAMPED, never a pass', compareRecord({ inputs: { path: TRIO } }, stamped).state === 'unstamped');

    /* An unreadable stamp is an unstamped night, not a generation of its own. */
    mk(`${TRIO}/2026-06-11/${STAMP}`, 'not json');
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-qm', 'corrupt a stamp'], { cwd });
    const broken = corpusIdentity(TRIO, { cwd });
    ok('∅ an unreadable stamp leaves its night UNSTAMPED', broken.unstamped === 1 && broken.unstampedNights.join() === '2026-06-11');

    const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
    const good = allVerdict([{ name: 'a.json', judged: true, state: 'resolves', detail: null }], stamped, { commit: 'abcd1234' });
    ok('the PASS verdict validates', V.validate(good).ok, V.validate(good).errors.join(' | '));
    ok('the PASS verdict counts one checked record', good.population.checked === 1 && good.population.excluded === 0);
    const bad = allVerdict(
      [
        { name: 'a.json', judged: true, state: 'moved', detail: 'the fold generation moved while the exports did not' },
        { name: 'b.json', judged: false, why: 'names another corpus', state: null, detail: null }
      ],
      stamped,
      { commit: 'abcd1234' }
    );
    ok('a moved record reads SHORTFALL with a reason', bad.status === 'SHORTFALL' && typeof bad.reason === 'string' && bad.reason.includes('a.json'));
    ok('checked + excluded = eligible', bad.population.checked + bad.population.excluded === bad.population.eligible);
    ok('the SHORTFALL verdict validates', V.validate(bad).ok, V.validate(bad).errors.join(' | '));
    const none = allVerdict([{ name: 'b.json', judged: false, why: 'names another corpus', state: null, detail: null }], stamped, { commit: 'abcd1234' });
    ok('NOT_RUN when no live record names the corpus', none.status === 'NOT_RUN' && none.result === null);
    /* THE DEFECT MY OWN FIRST SPELLING CARRIED: a file beside the night folders is not a night. */
    mk(`${TRIO}/trio-batch-verdicts.json`, '{"v":1}');
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-qm', 'a root-level artifact beside the nights'], { cwd });
    const withRootFile = corpusIdentity(TRIO, { cwd });
    ok('a root-level file is NOT a night', withRootFile.nights === 2 && withRootFile.rootFiles === 1, `${withRootFile.nights} night(s)`);
    ok('a root-level file still counts as data', withRootFile.dataFiles === 3 && withRootFile.dataDigest !== broken.dataDigest);

    /* SCOPING · the generation over the nights a consumer READ, not over every folder. */
    const scoped = corpusIdentity(TRIO, { cwd, nights: ['2026-06-10'] });
    ok('a scoped identity covers only the named night', scoped.nights === 1 && scoped.scopedTo === 1 && scoped.unstamped === 0);
    ok('scoping changes the generation, because it answers a different question', scoped.generation !== withRootFile.generation);
    ok('a scoped identity carries its own data digest', scoped.dataDigest !== withRootFile.dataDigest && scoped.dataFiles === 1);
    ok('∅ scoping to a night that is not there is NOT_RUN with a reason', corpusIdentity(TRIO, { cwd, nights: ['1999-01-01'] }).ok === false);
    ok('an unscoped identity says so, rather than claiming a scope of zero', withRootFile.scopedTo === null);
    ok('repoRelative returns the relative root', repoRelative(join(cwd, TRIO), { cwd }) === TRIO);
    ok('∅ repoRelative refuses a path outside the checkout', repoRelative('/etc', { cwd }) === null);

    const missing = corpusIdentity('uploads/absent', { cwd });
    ok('∅ an absent root is NOT_RUN with a reason, never a clean zero', missing.ok === false && typeof missing.reason === 'string' && missing.dataDigest === null);
    ok('an absent root makes the run NOT_RUN', allVerdict([{ name: 'a.json', judged: true, state: 'resolves', detail: null }], missing, { commit: 'abcd1234' }).status === 'NOT_RUN');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fail ? `\n${fail} FAILURE(S)` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--json', '--all'], string: ['--record'], positional: false }, { tool: 'fold-generation' });
  if (argv.includes('--selftest')) process.exit(selftest());
  const commit = gitCommitShort();
  if (argv.includes('--all') || argv.includes('--record')) {
    const { identity, rows } = auditRecords({ commit: null });
    const want = argv.includes('--record') ? argv[argv.indexOf('--record') + 1]?.split('/').pop() : null;
    const picked = want ? rows.filter((r) => r.name === want) : rows;
    const v = allVerdict(picked, identity, { commit });
    if (argv.includes('--json')) {
      console.log(JSON.stringify(v, null, 2));
      return;
    }
    console.log(`published-number corpus identity · ${identity.root} at the working tree\n`);
    for (const r of picked) console.log(`  ${(r.judged ? r.state : 'not judged').padEnd(12)}  ${r.name}${r.judged ? (r.detail ? `   (${r.detail})` : '') : `   (${r.why})`}`);
    console.log(`\n  ${v.status} — ${v.result?.resolving ?? 0} of ${v.population.checked} live record(s) re-resolve; ${v.population.excluded} of ${v.population.eligible} are out of scope.`);
    if (v.reason) console.log(`  ${v.reason}`);
    return;
  }
  const identity = corpusIdentity(TRIO, { commit: null });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(corpusBlock(identity), null, 2));
    return;
  }
  if (!identity.ok) {
    console.error(`✗ ${SELF}: ${identity.reason}`);
    process.exit(2);
  }
  console.log(`corpus identity · ${identity.root}\n`);
  console.log(`  dataDigest      ${identity.dataDigest}   over ${identity.dataFiles} export file(s)`);
  console.log(`  allFilesDigest  ${identity.allFilesDigest}   over ${identity.allFiles} tracked file(s) — moves when provenance is written`);
  console.log(
    `  foldGeneration  ${identity.generation}   ${identity.nights} night(s): ${identity.stamped} stamped under ${identity.codeDigests.length} code digest(s), ${identity.unstamped} unstamped`
  );
  console.log(`\n  Unstamped nights carry no generation and are named, never counted as one: ${identity.unstamped ? `${identity.unstampedNights.slice(0, 3).join(', ')}…` : 'none'}`);
}

if (isCliEntry(import.meta.url)) main();
