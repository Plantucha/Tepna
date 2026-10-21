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
import { populationVerdict, snapshotNights } from './corpus-scope.mjs';

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
  /* A RECOVERED block carries the tree identity and no comparable generation (see
     `recoveredBlock`). The data half is the durable one: it survives any merge policy, and it is
     the half a published number rests on. Check it, and say plainly what went unchecked. */
  if (block?.dataDigest && !block.foldGeneration) {
    if (block.dataDigest === identity.dataDigest)
      return {
        state: 'resolves',
        detail: `the exports re-resolve to the recovered cut tree ${block.dataDigest}; the fold generation is not comparable, because ${block.foldGenerationReason ?? 'the record names no nights'}`
      };
    return { state: 'moved', detail: `the exports moved: the recovered cut tree reads ${block.dataDigest} and the corpus now reads ${identity.dataDigest}`, dataMoved: true, genMoved: null };
  }
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

/* 🔴 A `producerCommit` IS NOT A DURABLE REFERENCE HERE. Kodiak squash-merges, so the commit a
   record names is an ancestor of `main` only when it happens to be the squash itself. Measured
   2026-10-21 over the five trio records: three of the five cut commits are NOT ancestors of
   `origin/main`, and they exist in the primary checkout only as unreferenced objects left by the
   branch that wrote them. A fresh clone — CI — has none of the three. So "the exports at the cut"
   is a question this gate can ask here and cannot ask there, and the two answers are not the same
   verdict: a record it CANNOT read is `UNKNOWN`, never a PASS and never a FAIL. */
export function allVerdict(rows, identity, { commit = null } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const judged = rows.filter((r) => r.judged);
  const resolving = judged.filter((r) => r.state === 'resolves');
  const undecidable = judged.filter((r) => r.state === 'unresolvable');
  const failing = judged.filter((r) => r.state !== 'resolves' && r.state !== 'unresolvable');
  const nameList = (xs) => xs.map((r) => `${r.name} (${r.detail})`).join('; ');
  let status;
  let reason = null;
  if (!identity.ok) {
    status = 'NOT_RUN';
    reason = identity.reason;
  } else if (judged.length === 0) {
    status = 'NOT_RUN';
    reason = `no live record names ${identity.root}, so nothing was re-resolved`;
  } else if (failing.length > 0) {
    status = 'SHORTFALL';
    reason = `${failing.length} live record(s) no longer re-resolve: ${nameList(failing)}`;
  } else if (undecidable.length > 0) {
    status = 'UNKNOWN';
    reason = `${undecidable.length} live record(s) cannot be decided in this clone: ${nameList(undecidable)}`;
  } else {
    status = 'PASS';
  }
  const v = Verdict.make({
    gate: 'published-number-corpus',
    status,
    scope: 'internal',
    population: { checked: judged.length, eligible: rows.length, excluded: rows.length - judged.length },
    criterion: { name: 'records_reresolving', threshold: 0, unit: 'records', direction: 'lte' },
    result: status === 'NOT_RUN' ? null : { resolving: resolving.length, undecidable: undecidable.length, failing: failing.length, rows, identity },
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

/* ── RECOVERY ────────────────────────────────────────────────────────────────────────────────
   🔴 A `producerCommit` IS A WEAK POINTER TWO WAYS. Kodiak squash-merges, so the commit a record
   names survives in the clone that wrote it and nowhere else (measured 2026-10-21: 5 of 13 cut
   commits are not ancestors of `origin/main`). And a record can simply name the WRONG commit —
   `tch-pooled-hat-2026-09-29.json` names `f131fe57`, a residue-docs commit whose tree holds 609
   tracked files, while the record documents 658. A TREE identity has neither failure mode: it is
   computed from content, so it survives any merge policy and cannot point at the wrong tree.

   Recovery reads the objects this checkout still holds and writes that identity into the record.
   It is self-verifying: a record gets a block only when ITS OWN documented `inputs.digest`
   reproduces over the candidate tree. ∅ No reproduction, no block — the reason is recorded and
   nothing is guessed. */

/** Commits that touched `root`, newest first, cheaply prefiltered by tracked-file COUNT.
    `git ls-tree | wc -l` answers the count without reading one byte of the 430 MB corpus. */
export function cutCandidates(root = TRIO, { cwd = ROOT, files = null, limit = 40 } = {}) {
  let log;
  try {
    log = execFileSync('git', ['log', '--format=%H', `-${limit}`, '--', root], { cwd, maxBuffer: 1 << 26 });
  } catch {
    return [];
  }
  const out = [];
  for (const sha of log.toString().split('\n').filter(Boolean)) {
    if (files != null) {
      const listed = trackedFiles(root, { cwd, commit: sha });
      if (listed == null || listed.all.length !== files) continue;
    }
    out.push(sha.slice(0, 10));
  }
  return out;
}

/** The tree a record's own digest identifies, found and PROVEN rather than assumed. */
export function recoverCut(record, { cwd = ROOT, root = TRIO, limit = 40 } = {}) {
  const want = record?.inputs?.digest ?? null;
  const named = typeof record?.producerCommit === 'string' ? record.producerCommit.split(/[\s+]/)[0] : null;
  const path = String(record?.inputs?.path ?? '');
  if (path !== root) return { ok: false, reason: `the record names ${path || 'no corpus'}, not ${root}`, named, commit: null, matchedNamed: null, tried: [] };
  if (!want) return { ok: false, reason: 'the record carries no inputs.digest, so no tree can prove itself the cut', named, commit: null, matchedNamed: null, tried: [] };
  const tried = [];
  const attempt = (commit) => {
    tried.push(commit);
    const identity = corpusIdentity(root, { cwd, commit });
    return identity.ok && identity.allFilesDigest === want ? identity : null;
  };
  if (named) {
    const hit = attempt(named);
    if (hit) return { ok: true, reason: null, named, commit: named, matchedNamed: true, identity: hit, tried };
  }
  /* The named commit did not hold the tree. Search the commits that touched the corpus, with the
     file count as the prefilter, so a wrong name costs one cheap listing per candidate. */
  for (const sha of cutCandidates(root, { cwd, files: record?.inputs?.files ?? null, limit })) {
    if (sha === named) continue;
    const hit = attempt(sha);
    if (hit) return { ok: true, reason: null, named, commit: sha, matchedNamed: false, identity: hit, tried };
  }
  return {
    ok: false,
    reason: named
      ? `the record's digest ${want} reproduces at no commit this clone holds, including the ${named} it names (${tried.length} tried)`
      : `the record's digest ${want} reproduces at no commit this clone holds (${tried.length} tried)`,
    named,
    commit: null,
    matchedNamed: named ? false : null,
    tried
  };
}

/** The block a recovery writes into a record: the cut's tree identity, plus how it proved itself. */
export function recoveredBlock(rec, { at = null, by = SELF } = {}) {
  if (!rec.ok) return null;
  const block = corpusBlock(rec.identity);
  /* ∅ THE GENERATION HALF CANNOT BE RECOVERED, AND A NUMBER IS NOT A REASON TO INVENT IT. A
     producer writes `foldGeneration` scoped to the nights it READ. A legacy record states a night
     COUNT and no names, so the only generation recoverable here covers the whole root — which
     describes a population the number never opened, and would read MOVED the moment any other
     night gains a stamp. The whole-root value is kept as a fact under its own name, and the
     comparable field is null with the reason beside it. */
  return {
    ...block,
    foldGeneration: null,
    foldGenerationAtCut: block.foldGeneration,
    foldGenerationReason: `the record names no nights, so no generation describes the population it read; foldGenerationAtCut covers all ${rec.identity.nights} night(s) under ${rec.identity.root} at the cut`,
    recovered: {
      commit: rec.commit,
      namedCommit: rec.named,
      matchedNamedCommit: rec.matchedNamed,
      verifiedBy: `the record's own inputs.digest reproduces over this tree: sha256[0:12] over path\\0sha12(bytes) of all ${rec.identity.allFiles} tracked file(s) under ${rec.identity.root} reads ${rec.identity.allFilesDigest}`,
      note:
        rec.matchedNamed === false
          ? `the record names ${rec.named}, whose tree does NOT carry this digest; the identity above comes from the commit that does. Nothing in the record was edited`
          : 'the identity above comes from the commit the record names',
      by,
      at
    }
  };
}

/** Every record under `dir`, with the block recovery would write and the reason when it writes none. */
export function recoverRecords({ cwd = ROOT, root = TRIO, dir = RECORD_DIR, at = null } = {}) {
  return readRecords(dir, { cwd }).map(({ name, record }) => {
    const already = record?.corpus?.dataDigest ? record.corpus : null;
    const rec = already ? null : recoverCut(record, { cwd, root });
    return {
      name,
      record,
      already: Boolean(already),
      recovery: rec,
      block: rec ? recoveredBlock(rec, { at }) : null,
      reason: already ? 'the record already carries a corpus block' : rec.ok ? null : rec.reason
    };
  });
}

/** The verdict over a recovery sweep: every in-root record either carries a block or states why. */
export function recoverVerdict(rows, { commit = null, root = TRIO } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const inRoot = rows.filter((r) => String(r.record?.inputs?.path ?? '') === root);
  const covered = inRoot.filter((r) => r.already || r.block);
  const bare = inRoot.filter((r) => !r.already && !r.block);
  return Verdict.make({
    gate: 'published-number-cut-tree',
    status: inRoot.length === 0 ? 'NOT_RUN' : bare.length === 0 ? 'PASS' : 'SHORTFALL',
    population: { checked: inRoot.length, eligible: rows.length, excluded: rows.length - inRoot.length },
    criterion: { name: 'records_without_a_tree_identity', threshold: 0, unit: 'records', direction: 'lte' },
    result: inRoot.length === 0 ? null : { covered: covered.length, bare: bare.length, renamedCut: inRoot.filter((r) => r.recovery?.matchedNamed === false && r.recovery?.ok).length },
    evidence: [SELF, RECORD_DIR],
    reason:
      inRoot.length === 0
        ? `no record under ${RECORD_DIR} names ${root}`
        : bare.length
          ? `${bare.length} record(s) carry no tree identity: ${bare.map((r) => `${r.name} (${r.reason})`).join('; ')}`
          : null,
    producedBy: { tool: SELF, commit },
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  });
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
    const unk = allVerdict([{ name: 'a.json', judged: true, state: 'unresolvable', detail: "the record's producerCommit deadbee is not in this clone" }], stamped, { commit: 'abcd1234' });
    ok('a record this clone cannot decide reads UNKNOWN, never PASS and never FAIL', unk.status === 'UNKNOWN' && unk.reason.includes('a.json'), unk.status);
    ok('the UNKNOWN verdict validates and still counts the record as checked', V.validate(unk).ok && unk.population.checked === 1);
    const mixed = allVerdict(
      [
        { name: 'a.json', judged: true, state: 'unresolvable', detail: 'gone' },
        { name: 'b.json', judged: true, state: 'moved', detail: 'the exports moved' }
      ],
      stamped,
      { commit: 'abcd1234' }
    );
    ok('a real movement outranks an undecidable one', mixed.status === 'SHORTFALL' && mixed.reason.includes('b.json') && !mixed.reason.includes('a.json'));

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

    /* ══ CUT-TREE RECOVERY ══ a record cut before the block existed, proven against its own digest.
       The planted truth is the same four-commit history above: commit 1 carries 3 tracked files
       under the root, the later ones carry 4, 4 and 5. */
    {
      const shaOf = (rev) => execFileSync('git', ['rev-parse', '--short=10', rev], { cwd }).toString().trim();
      const cut = corpusIdentity(TRIO, { cwd, commit: 'HEAD~3' });
      const head = corpusIdentity(TRIO, { cwd });
      const mkRec = (over = {}) => ({ inputs: { path: TRIO, digest: cut.allFilesDigest, files: cut.allFiles }, producerCommit: shaOf('HEAD~3'), ...over });

      const named = recoverCut(mkRec(), { cwd });
      ok('the cut tree is found at the commit the record names', named.ok && named.matchedNamed === true && named.commit === shaOf('HEAD~3'), named.reason ?? named.commit);
      ok('the recovery PROVES itself: the identity it returns carries the record’s own digest', named.identity?.allFilesDigest === cut.allFilesDigest);

      /* THE MEASURED DEFECT · a producerCommit can name a tree it never held. */
      const wrong = recoverCut(mkRec({ producerCommit: shaOf('HEAD') }), { cwd });
      ok(
        'A RECORD CAN NAME THE WRONG COMMIT · the digest still finds the tree that holds it',
        wrong.ok && wrong.matchedNamed === false && wrong.commit === shaOf('HEAD~3'),
        wrong.reason ?? wrong.commit
      );
      ok('the wrong name is kept beside the proven one, never overwritten', wrong.named === shaOf('HEAD'));

      ok(
        '∅ a digest that reproduces nowhere yields NO commit and a reason',
        (() => {
          const r = recoverCut(mkRec({ inputs: { path: TRIO, digest: 'deadbeef0000' } }), { cwd });
          return r.ok === false && r.commit === null && typeof r.reason === 'string';
        })()
      );
      ok('∅ a record with no digest cannot be proven, and is refused rather than guessed', recoverCut({ inputs: { path: TRIO }, producerCommit: shaOf('HEAD') }, { cwd }).ok === false);
      ok('∅ a record naming another corpus is refused by the recovery too', recoverCut(mkRec({ inputs: { path: 'uploads/other', digest: cut.allFilesDigest } }), { cwd }).ok === false);

      ok(
        'the file COUNT prefilters the candidates, so a wrong name costs one listing each',
        cutCandidates(TRIO, { cwd, files: cut.allFiles }).length === 1 && cutCandidates(TRIO, { cwd }).length === 4
      );
      ok('∅ a file count no commit carries leaves no candidate, rather than falling back to HEAD', cutCandidates(TRIO, { cwd, files: 999 }).length === 0);

      const block = recoveredBlock(named, { at: '2026-10-21' });
      ok('the recovered block carries the cut’s DATA identity', block.dataDigest === cut.dataDigest && block.dataFiles === cut.dataFiles);
      ok('∅ THE GENERATION HALF IS NULL, because the record names no nights', block.foldGeneration === null && typeof block.foldGenerationReason === 'string');
      ok('the whole-root generation is kept under its OWN name, never as the comparable one', block.foldGenerationAtCut === cut.generation);
      ok('the block says how it proved itself, by quoting the digest it reproduced', block.recovered.verifiedBy.includes(cut.allFilesDigest));
      ok('∅ a refused recovery yields no block at all', recoveredBlock({ ok: false }) === null);

      /* A record carrying a recovered block is judged on the data half ALONE. */
      const atCutRec = { inputs: { path: TRIO }, corpus: block };
      const cmp = compareRecord(atCutRec, cut);
      ok('a recovered record re-resolves against the tree it was cut from', cmp.state === 'resolves' && cmp.detail.includes(cut.dataDigest), cmp.detail ?? cmp.state);
      const movedCmp = compareRecord(atCutRec, head);
      ok('the data half still reads MOVED when the exports move under it', movedCmp.state === 'moved' && movedCmp.dataMoved === true && movedCmp.genMoved === null, movedCmp.detail ?? movedCmp.state);

      const rowOk = { name: 'a.json', record: { inputs: { path: TRIO } }, already: false, recovery: named, block, reason: null };
      const rowBare = { name: 'b.json', record: { inputs: { path: TRIO } }, already: false, recovery: { ok: false }, block: null, reason: 'the record carries no inputs.digest' };
      const rowOut = { name: 'c.json', record: { inputs: { path: 'uploads/other' } }, already: false, recovery: null, block: null, reason: null };
      const vOk = recoverVerdict([rowOk, rowOut], { commit: 'abcd1234' });
      ok('a sweep where every in-root record carries an identity is PASS', vOk.status === 'PASS' && vOk.population.checked === 1 && vOk.population.excluded === 1);
      ok(
        'the recovery verdict validates',
        createRequire(import.meta.url)(join(ROOT, 'verdict.js')).validate(vOk).ok,
        createRequire(import.meta.url)(join(ROOT, 'verdict.js'))
          .validate(vOk)
          .errors.join(' | ')
      );
      const vBare = recoverVerdict([rowOk, rowBare], { commit: 'abcd1234' });
      ok('∅ a record with no identity reads SHORTFALL and is NAMED', vBare.status === 'SHORTFALL' && vBare.reason.includes('b.json'), vBare.status);
      ok('checked + excluded = eligible in the recovery verdict', vBare.population.checked + vBare.population.excluded === vBare.population.eligible);
      ok('∅ a sweep with no in-root record is NOT_RUN, never a PASS over nothing', recoverVerdict([rowOut], { commit: 'abcd1234' }).status === 'NOT_RUN');
      ok('a cut recovered at an unnamed commit is COUNTED, not hidden', vOk.result.renamedCut === 0 && recoverVerdict([{ ...rowOk, recovery: wrong }], { commit: 'abcd1234' }).result.renamedCut === 1);

      /* THE WRITER · a record is rewritten in its OWN layout, or the added block is buried. */
      ok('a one-space record keeps one space', recordIndent('{\n "a": 1\n}\n') === 1);
      ok('a two-space record keeps two', recordIndent('{\n  "a": 1\n}\n') === 2);
      ok('an unrecognised layout falls back to two, the JSON default', recordIndent('{}') === 2 && recordIndent(null) === 2);
    }

    const missing = corpusIdentity('uploads/absent', { cwd });
    ok('∅ an absent root is NOT_RUN with a reason, never a clean zero', missing.ok === false && typeof missing.reason === 'string' && missing.dataDigest === null);
    ok('an absent root makes the run NOT_RUN', allVerdict([{ name: 'a.json', judged: true, state: 'resolves', detail: null }], missing, { commit: 'abcd1234' }).status === 'NOT_RUN');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(fail ? `\n${fail} FAILURE(S)` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}

/* THE POPULATION THIS RUN READ, and whether it held still while the run read it. The corpus is a
   live tree: a capture host writes nights into it, so a run that opens 147 nights and closes over
   148 has described neither. `populationVerdict` makes that an emitted statement rather than a
   silent average — the rule `tools/corpus-reads.mjs` enforces over every corpus enumerator. */
function withPopulation(root, fn) {
  const abs = join(ROOT, root);
  const before = snapshotNights(abs);
  const value = fn();
  const after = snapshotNights(abs);
  return { value, population: populationVerdict(before, after, { commit: gitCommitShort(), tool: SELF, evidence: [SELF] }) };
}

/** A record's own indent width, so a rewrite adds a key without reformatting the file. */
export function recordIndent(text) {
  const m = /^\{\r?\n( +)"/.exec(String(text));
  return m ? m[1].length : 2;
}

/* `--recover` reports what a tree identity would be, and `--write` puts it in the record. The two
   are separate because the recovery reads a past tree per record and a reader deserves to see the
   evidence before a file changes. */
function recoverMain(argv, commit) {
  const at = new Date().toISOString().slice(0, 10);
  const rows = recoverRecords({ at });
  const v = recoverVerdict(rows, { commit });
  const written = [];
  if (argv.includes('--write')) {
    for (const r of rows) {
      if (!r.block) continue;
      const file = join(ROOT, RECORD_DIR, r.name);
      const text = readFileSync(file, 'utf8');
      const doc = JSON.parse(text);
      /* ADDITIVE ONLY. No claim, result, digest, commit or note in the record is touched: the
         block sits beside them and says how it proved itself. 🔴 And the file is rewritten in ITS
         OWN layout — these records are hand-cut and three of the five indent with ONE space, so a
         fixed `JSON.stringify(doc, null, 2)` reformats 174 lines to add 29 and buries the change
         a reviewer is meant to read. */
      doc.corpus = r.block;
      writeFileSync(file, JSON.stringify(doc, null, recordIndent(text)) + (text.endsWith('\n') ? '\n' : ''));
      written.push(r.name);
    }
  }
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          verdict: v,
          written,
          rows: rows.map((r) => ({
            name: r.name,
            already: r.already,
            commit: r.recovery?.commit ?? null,
            named: r.recovery?.named ?? null,
            matchedNamed: r.recovery?.matchedNamed ?? null,
            reason: r.reason
          }))
        },
        null,
        2
      )
    );
    return v.status === 'PASS' || v.status === 'NOT_RUN' ? 0 : 1;
  }
  console.log(`cut-tree recovery · ${RECORD_DIR}\n`);
  for (const r of rows) {
    if (String(r.record?.inputs?.path ?? '') !== TRIO) continue;
    if (r.already) {
      console.log(`  carries     ${r.name}`);
      continue;
    }
    if (!r.block) {
      console.log(`  ∅ none      ${r.name}   (${r.reason})`);
      continue;
    }
    const tag = r.recovery.matchedNamed ? `at the named ${r.recovery.commit}` : `at ${r.recovery.commit}, NOT the named ${r.recovery.named}`;
    console.log(`  recovered   ${r.name}   data ${r.block.dataDigest} over ${r.block.dataFiles} file(s) · fold-at-cut ${r.block.foldGenerationAtCut} · ${tag}`);
  }
  console.log(
    `\n  ${v.status} — ${v.result?.covered ?? 0} of ${v.population.checked} record(s) carry a tree identity${v.result?.renamedCut ? `; ${v.result.renamedCut} record(s) prove themselves at a commit they do not name` : ''}.`
  );
  if (v.reason) console.log(`  ${v.reason}`);
  console.log(written.length ? `  wrote ${written.length} record(s): ${written.join(', ')}` : '  nothing written (pass --write to apply)');
  return v.status === 'PASS' || v.status === 'NOT_RUN' ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--json', '--all', '--recover', '--write'], string: ['--record'], positional: false }, { tool: 'fold-generation' });
  if (argv.includes('--selftest')) process.exit(selftest());
  const commit = gitCommitShort();
  if (argv.includes('--recover')) process.exit(recoverMain(argv, commit));
  if (argv.includes('--all') || argv.includes('--record')) {
    const run = withPopulation(TRIO, () => auditRecords({ commit: null }));
    const { identity, rows } = run.value;
    const want = argv.includes('--record') ? argv[argv.indexOf('--record') + 1]?.split('/').pop() : null;
    const picked = want ? rows.filter((r) => r.name === want) : rows;
    const v = allVerdict(picked, identity, { commit });
    if (argv.includes('--json')) {
      console.log(JSON.stringify({ verdict: v, population: run.population }, null, 2));
      return;
    }
    console.log(`published-number corpus identity · ${identity.root} at the working tree\n`);
    for (const r of picked) console.log(`  ${(r.judged ? r.state : 'not judged').padEnd(12)}  ${r.name}${r.judged ? (r.detail ? `   (${r.detail})` : '') : `   (${r.why})`}`);
    console.log(`\n  ${v.status} — ${v.result?.resolving ?? 0} of ${v.population.checked} live record(s) re-resolve; ${v.population.excluded} of ${v.population.eligible} are out of scope.`);
    if (v.reason) console.log(`  ${v.reason}`);
    console.log(`  corpus-population ${run.population.status} over ${run.population.population.checked} night(s)${run.population.reason ? ` — ${run.population.reason}` : ''}`);
    return;
  }
  const run = withPopulation(TRIO, () => corpusIdentity(TRIO, { commit: null }));
  const identity = run.value;
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ corpus: corpusBlock(identity), population: run.population }, null, 2));
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
  console.log(`  corpus-population ${run.population.status} over ${run.population.population.checked} night(s)${run.population.reason ? ` — ${run.population.reason}` : ''}`);
}

if (isCliEntry(import.meta.url)) main();
