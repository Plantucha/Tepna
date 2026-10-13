// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// Run-level provenance for a trio fold: WHICH nights, from WHICH files, on WHICH volumes.
//
// The per-night `.trio-stamp` already records that night's `inputsDigest` + `codeDigest`. What it
// cannot record is a property of the RUN: which source trees were walked and what they were mounted
// on. That gap is not theoretical — the 2026-09-22 re-fold ingested one ACC file six times because
// `--src` walked hidden staging directories, and nothing in the output said which tree anything came
// from. A night that folds identically from two different volumes is a different fact from a night
// that folds identically twice from one.

import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/* The mount a path actually lives on — LONGEST-PREFIX match over /proc/self/mountinfo.
   ⚠ NOT `mountpoint <dir>` on the parent. On 2026-09-22 that test on `/mnt/nas` returned "not a
   mountpoint" and was nearly logged as a finding; `/mnt/nas/tepna-corpus` IS an nfs4 mount. The
   CHILD was the mount, so a prefix test on the parent answers a different question than the one
   being asked. The `/mnt/nas -> ext4 on /` case is pinned as a test rather than a comment, because
   it is the row that looks like an answer and is not.
   Returns null — never a guess — where the path or mountinfo cannot be read (§∅). */
export function mountOf(path, mountinfo = null) {
  let real;
  try {
    real = mountinfo ? path : realpathSync(path);
  } catch {
    return null;
  }
  let raw = mountinfo;
  if (raw == null) {
    try {
      raw = readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      return null;
    }
  }
  let best = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const sep = line.indexOf(' - ');
    if (sep < 0) continue;
    const target = line.slice(0, sep).split(' ')[4];
    if (!target) continue;
    if (!(real === target || real.startsWith(target === '/' ? '/' : `${target}/`))) continue;
    if (best && best.target.length >= target.length) continue;
    const [fstype, source] = line.slice(sep + 3).split(' ');
    best = { target, fstype, source };
  }
  return best;
}

/* A digest over the INGESTED file set — name, size and mtime of every file the run actually read,
   sorted. Keyed on the resolved path so two copies of one basename under different roots are two
   entries: the duplicate ingest this exists to make visible would otherwise collapse to one. */
export function fileSetDigest(files) {
  const rows = files.map((f) => `${f.full}\0${f.bytes}\0${f.mtimeMs ?? 0}`).sort();
  return { digest: sha16(rows.join('\n')), files: rows.length };
}

export function buildRecord({ at, codeDigest, srcRoots, nights, files, mountinfo = null }) {
  const set = fileSetDigest(files);
  return {
    schema: 'tepna.fold-provenance/1',
    at,
    codeDigest,
    fileSetDigest: set.digest,
    fileCount: set.files,
    srcRoots: srcRoots.map((root) => ({ root, mount: mountOf(root, mountinfo) })),
    /* A night carries the code digest its OWN stamp records, beside the run's: a fold that skipped an
       already-current night and a fold that recomputed it are the same tree but not the same fact, and
       a record claiming one digest for a tree folded under two would be the stale-stamp bug written down. */
    nights: nights
      .map((n) => ({ key: n.key, inputsDigest: n.inputsDigest ?? null, codeDigest: n.codeDigest ?? null, nodes: n.nodes ?? null, ok: n.ok === true }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    nightCount: nights.length
  };
}

/* ── THE RUN LEDGER ──────────────────────────────────────────────────────────────────────────────
   A fold is a RUN, not a bundle, so its provenance gets its own fragment — `provenance/trio-fold.json`,
   declared in `provenance/index.json` under `runs` and checked by `tests/verify-manifest.mjs` P3. It
   does NOT go in a corner of an app's fragment: those carry GATE-A `manifestHash` + GATE-B fixtures
   for ONE bundle, and a fold crosses three of them (ECGDex · PpgDex · OxyDex) while shipping in none.
   An undeclared `*.json` in `provenance/` still reds P3, so the declaration is what makes this
   fragment gated rather than merely present.

   Records are APPENDED, never edited — the `RELEASE-MANIFEST.json` habit. Two folds of one corpus are
   two facts, and the second does not correct the first: it says the corpus folded again, under the
   code digest of that day. */
export const LEDGER_NAME = 'trio-fold';
export const LEDGER_SCHEMA = 'tepna.fold-ledger/1';
export const RECORD_SCHEMA = 'tepna.fold-provenance/1';
const LEDGER_DOC =
  'Run-level provenance for every trio fold, appended never edited: which nights, from which files, on which volumes, under which code digest. Written by tools/trio-batch.mjs; shape gated by tests/verify-manifest.mjs P3.';

/* Pure: returns a NEW ledger with `record` appended. It cannot edit or drop an existing record,
   which is the whole point of its being a function rather than an in-place write. A ledger of
   another schema, or a record that is not a fold record, REFUSES — an append that silently reshaped
   the file would lose the history it exists to keep. */
export function appendFold(ledger, record) {
  if (ledger != null && (typeof ledger !== 'object' || Array.isArray(ledger))) throw new Error('fold-provenance: the ledger is not an object');
  if (ledger && ledger.schema != null && ledger.schema !== LEDGER_SCHEMA) throw new Error('fold-provenance: ledger schema is "' + ledger.schema + '", not ' + LEDGER_SCHEMA);
  if (!record || typeof record !== 'object' || record.schema !== RECORD_SCHEMA) throw new Error('fold-provenance: a ledger record must carry schema ' + RECORD_SCHEMA);
  const prior = ledger && Array.isArray(ledger.folds) ? ledger.folds : [];
  if (ledger && ledger.folds != null && !Array.isArray(ledger.folds)) throw new Error('fold-provenance: ledger.folds is not an array');
  return { schema: LEDGER_SCHEMA, _doc: (ledger && ledger._doc) || LEDGER_DOC, folds: prior.concat([record]) };
}

/* What is WRONG with this ledger, by name — `[]` means well-formed. A findings list rather than a
   boolean so the gate can print the reason it refused (§∅: "it failed" and "it was never examined"
   must not print the same). */
export function ledgerFindings(ledger) {
  const out = [];
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return ['the ledger is not an object'];
  if (ledger.schema !== LEDGER_SCHEMA) out.push('schema is ' + JSON.stringify(ledger.schema) + ', expected ' + LEDGER_SCHEMA);
  if (!Array.isArray(ledger.folds)) return out.concat(['folds is not an array']);
  if (!ledger.folds.length) out.push('folds is empty — a ledger that recorded nothing');
  ledger.folds.forEach((r, i) => {
    const at = 'folds[' + i + ']';
    if (!r || typeof r !== 'object') return out.push(at + ' is not an object');
    if (r.schema !== RECORD_SCHEMA) out.push(at + '.schema is ' + JSON.stringify(r.schema) + ', expected ' + RECORD_SCHEMA);
    if (!/^[0-9a-f]{16}$/.test(String(r.codeDigest))) out.push(at + '.codeDigest is not a 16-hex digest');
    if (!/^[0-9a-f]{16}$/.test(String(r.fileSetDigest))) out.push(at + '.fileSetDigest is not a 16-hex digest');
    if (!Number.isFinite(r.fileCount) || r.fileCount < 0) out.push(at + '.fileCount is not a count');
    if (!Array.isArray(r.srcRoots) || !r.srcRoots.length) out.push(at + '.srcRoots is empty — a fold with no source tree');
    if (!Array.isArray(r.nights)) return out.push(at + '.nights is not an array');
    if (r.nightCount !== r.nights.length) out.push(at + '.nightCount ' + r.nightCount + ' != nights.length ' + r.nights.length);
    const keys = r.nights.map((n) => n && n.key);
    if (new Set(keys).size !== keys.length) out.push(at + ' lists one night twice');
    if (!Number.isFinite(Date.parse(r.at))) out.push(at + '.at is not a parseable timestamp');
  });
  return out;
}
