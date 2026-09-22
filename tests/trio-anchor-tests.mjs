// Tepna — tests/trio-anchor-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* `tools/trio-anchor.mjs` — a session file is keyed by the instant its DATA starts, not by the instant
   its NAME carries (residue 2026-09-22-capture-filename-stamp-disagrees-with-content).

   `trio-batch.mjs` runs its night loop at import, so nothing inside it is callable from a test — the
   same reason `tools/drift-report.js` was extracted. The rule lives in its own module for exactly that
   reason, and these are its plants: the real 2026-08-24 shape (a name 18.7 h early), the `.dat`
   exception, and a correctly-named file that must come out byte-identical. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anchoredRec, startOf, utc } from '../tools/trio-anchor.mjs';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const eq = (got, want, what) => ok(got === want, `${what}: got ${got}, want ${want}`);

const DIR = mkdtempSync(join(tmpdir(), 'trio-anchor-'));
const write = (name, body) => {
  const full = join(DIR, name);
  writeFileSync(full, body);
  return full;
};
const nightKeyOf = (tMs) => new Date(tMs - 12 * 3600e3).toISOString().slice(0, 10); // trio-batch's own key

try {
  /* ── THE 2026-08-24 SHAPE: named 05:23:58, data starts 22:22:32 — 16.98 h later ───────────────
     Measured on the real file (Polar_VeritySense_0C301E3F_20260824052358_PPG.txt, 1,140,789 rows,
     22:22:32 → 04:31:20). Under the name it keys to 2026-08-23 and that night's fold was committed
     with NO PpgDex leg; under its content it keys to 2026-08-24, where it belongs. */
  const named = utc(2026, 8, 24, 5, 23, 58);
  const verity = write(
    'Polar_VeritySense_0C301E3F_20260824052358_PPG.txt',
    '# timebase=host-disciplined\nPhone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient\n' +
      '2026-08-24T22:22:32.113;841906623837465445;350997;300973;417102;-192\n' +
      '2026-08-24T22:22:32.131;841906641837465445;350991;300961;417099;-192\n'
  );
  const rec = anchoredRec({ name: 'v', full: verity, t0: named, bytes: 1, dev: 'Sense', stream: 'PPG' });
  eq(rec.t0, utc(2026, 8, 24, 22, 22, 32), 'the 08-24 Verity is anchored on its first data row');
  eq(rec.named, named, 'the filename stamp is KEPT as `named` — the disagreement stays visible');
  eq(rec.contentT0, true, 'the record says it is keyed on content');
  eq(nightKeyOf(rec.named), '2026-08-23', 'the NAME keys it to the wrong night (the defect)');
  eq(nightKeyOf(rec.t0), '2026-08-24', 'the CONTENT keys it to the night it was recorded on');

  /* ── A CORRECTLY-NAMED FILE IS UNCHANGED — no churn in the plan ─────────────────────────────── */
  const goodT0 = utc(2026, 8, 24, 22, 22, 32);
  const good = anchoredRec({ name: 'g', full: verity, t0: goodT0, bytes: 1, dev: 'Sense', stream: 'PPG' });
  eq(good.t0, goodT0, 'a file whose name agrees with its data keeps that t0');
  eq(good.contentT0, false, 'and is not marked content-keyed');
  eq(nightKeyOf(good.t0), '2026-08-24', 'same night key as before the change');

  /* ── THE .dat EXCEPTION: no per-row stamps, so the NAME is all it has ───────────────────────── */
  const datT0 = utc(2026, 8, 24, 5, 23, 58);
  const dat = write('Wellue_O2Ring-S_S8AW2100_20260824052358_STORED.dat', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 98, 60, 0, 97, 61, 1, 0xff, 0xff]));
  eq(startOf({ full: dat, kind: 'dat' }), null, 'startOf refuses a .dat rather than reading bytes as a stamp');
  const drec = anchoredRec({ name: 'd', full: dat, t0: datT0, bytes: 1, kind: 'dat' });
  eq(drec.t0, datT0, 'a .dat keeps the filename stamp');
  eq(drec.contentT0, false, 'and says so');

  /* ── THE O2Ring TEXT STAMP (Clock Contract rule 4, DMY) ─────────────────────────────────────── */
  const o2 = write('o2.csv', 'Time,SpO2,PR\n21:09:52 03/05/2026,98,61\n');
  eq(startOf({ full: o2 }), utc(2026, 5, 3, 21, 9, 52), 'the O2Ring HH:MM:SS DD/MM/YYYY stamp reads as DMY');

  /* ── ABSENCE IS THE NAME, NEVER A FABRICATED INSTANT (§∅) ───────────────────────────────────── */
  eq(startOf({ full: join(DIR, 'does-not-exist.txt') }), null, 'an unreadable file falls back to the name');
  const headerOnly = write('h.txt', '# timebase=host-disciplined\nPhone timestamp;channel 0\n');
  eq(startOf({ full: headerOnly }), null, 'a file with only comments and a header has no content stamp');
  const noStamp = write('n.txt', 'Phone timestamp;channel 0\n;123\nnot-a-stamp;124\n');
  eq(startOf({ full: noStamp }), null, 'rows whose first column is not a stamp yield null, never a guess');
  const fallback = anchoredRec({ name: 'f', full: noStamp, t0: named, bytes: 1 });
  eq(fallback.t0, named, 'and the record then keeps the filename stamp');

  /* ── COMMENTS AND THE HEADER ARE SKIPPED, NOT COUNTED AS ROWS ───────────────────────────────── */
  const commented = write('c.txt', '# a\n# b\nPhone timestamp;x\n2026-08-24T22:22:32.113;1\n');
  eq(startOf({ full: commented }), utc(2026, 8, 24, 22, 22, 32), 'the first DATA row is found past the comments');

  /* ── A NAME LATER THAN THE DATA IS STILL TAKEN FROM CONTENT ─────────────────────────────────
     Not observed in this corpus (0 of 67 disagreements are negative), so this pins the rule rather
     than a measurement: the rule is "the data says when it started", in both directions. */
  const late = anchoredRec({ name: 'l', full: commented, t0: utc(2026, 8, 25, 12, 0, 0), bytes: 1 });
  eq(late.t0, utc(2026, 8, 24, 22, 22, 32), 'content wins even when the name is later');
} finally {
  rmSync(DIR, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`trio-anchor: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-anchor: ✓ ${pass} assertions — t0 from content, the name as the stated fallback`);
