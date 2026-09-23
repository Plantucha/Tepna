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
    nights: nights.map((n) => ({ key: n.key, inputsDigest: n.inputsDigest ?? null, nodes: n.nodes ?? null, ok: n.ok === true })).sort((a, b) => a.key.localeCompare(b.key)),
    nightCount: nights.length
  };
}
