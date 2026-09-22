// Tepna — tools/trio-anchor.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import { closeSync, openSync, readSync, statSync } from 'node:fs';

/* ── t0 COMES FROM THE FILE'S FIRST DATA ROW, NOT ITS NAME (residue 2026-09-22-capture-filename-stamp-
   disagrees-with-content) ──────────────────────────────────────────────────────────────────────────
   The filename stamp is the capture SESSION's start (`capture.py` takes `started = _now()` before the
   connect and every stream of the session shares it). It is honest about the session and is NOT the
   start of the data: a Polar connection can stream HR from the morning while its PMD streams (PPG /
   ACC / PPI) only begin that night. Measured 2026-09-22 over 5660 ingestable box files: 67 disagree by
   more than 5 min, ZERO in the other direction (the name is never later than the data — so this is not
   a clock error), and 10 files across 4 sessions land in the WRONG NIGHT under `nightKeyOf`, which
   shifts by 12 h. One of those is a whole night: 2026-08-24's Verity session is named 05:23 and holds
   6.1 h of PPG from 22:22 — the fold for that night was committed with no PpgDex leg at all, because
   its only wrist recording was filed under 08-23.

   This tool was already ASYMMETRIC about it: `t0` came from the name while `endOf` reads the file's
   TAIL. So it opens the file anyway and the fix costs one head read — the mirror of `endOf`.

   ⚠️ THE `.dat` EXCEPTION IS NOT AN OVERSIGHT. The O2Ring's onboard binary carries NO per-row stamps:
   `endOf` derives its end as `t0 + n × 1000` FROM the name, so the name is the only time that file has.
   A `.dat` therefore keeps the filename stamp, and so does any file whose head cannot be read or whose
   rows carry no parsable stamp — the name is the fallback, never a fabricated instant (§∅).
   Captured bytes stay immutable: nothing here renames a file. */
export const startOf = (rec) => {
  if (rec.kind === 'dat') return null; // no per-row stamps: the name is all this format has
  let fd;
  try {
    fd = openSync(rec.full, 'r');
    const size = statSync(rec.full).size;
    const n = Math.min(65536, size);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, 0); // the HEAD — endOf reads the same window at the tail
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (const line of lines) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue; // `# timebase=…` and the column header are not rows
      const first = l.split(/[;,]/)[0].trim();
      // the same two stamp shapes `endOf` reads, in the same order (Clock Contract rules 3 and 4)
      let m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(first);
      if (m) return utc(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
      m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(first);
      if (m) return utc(+m[6], +m[5], +m[4], +m[1], +m[2], +m[3]);
    }
  } catch {
    /* unreadable head → the filename stamp stands */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
};

/* The record's t0 and its night key, from content where the format has it. `named` is kept so a
   consumer can see the disagreement rather than having it silently resolved (§∅ P5 clause 2 — a
   disagreement is itself a finding), and `contentT0` says which of the two this record is keyed on. */
export const anchoredRec = (rec) => {
  const content = startOf(rec);
  if (content == null || Math.abs(content - rec.t0) <= 0) return { ...rec, named: rec.t0, contentT0: false };
  return { ...rec, t0: content, named: rec.t0, contentT0: true };
};
/* The Clock Contract instant for the components AS WRITTEN — the same floating-UTC rule trio-batch's
   own `utc` applies (§1: a no-zone vendor stamp is encoded with Date.UTC, never a local Date). */
export function utc(y, mo, d, h, mi, s) {
  return Date.UTC(y, mo - 1, d, h, mi, s);
}
