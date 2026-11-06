// Tepna — tests/read-lines-bounded-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* `tools/read-lines-bounded.mjs` — one bounded line reader for every tool that hands a raw stream to
   a DSP (residue 2026-11-06-the-sigma-window-ecg-leg-duplicates-the-dsp-parser).

   The reader was private to `tools/trio-batch.mjs`, which runs its night loop at import, so no test
   could call it and no second tool could use it: `tools/derive-sigma-window.mjs` read its 150 to
   350 MB parts with `readFileSync` plus a split instead. These are the moved reader's plants, and
   they are written against a SMALL `chunkBytes` so the chunk boundary falls inside the data — the
   case a 16 MB default never reaches on a test fixture. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as R from '../tools/read-lines-bounded.mjs';
import { readLinesBounded } from '../tools/read-lines-bounded.mjs';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const same = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

ok(typeof R.readLinesBounded === 'function', 'the module exports readLinesBounded');
ok(Number.isFinite(R.LINE_CHUNK_BYTES) && R.LINE_CHUNK_BYTES > 0, 'and the chunk bound it reads by');

const dir = mkdtempSync(join(tmpdir(), 'tepna-rlb-'));
const plant = (name, bytes) => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
const read = (p, chunk) => [...readLinesBounded(p, chunk)];

try {
  same(read(plant('lf.txt', 'a\nbb\nccc\n'), 4), ['a', 'bb', 'ccc'], 'LF lines, read in 4-byte chunks');
  same(read(plant('crlf.txt', 'a\r\nbb\r\n'), 3), ['a', 'bb'], 'a CRLF file yields the lines without their CR');
  same(read(plant('tail.txt', 'a\nbb'), 2), ['a', 'bb'], 'a final line with no trailing newline is still a row');
  same(read(plant('empty.txt', ''), 8), [], 'an empty file yields no line, rather than one empty one');
  same(read(plant('blank.txt', 'a\n\nb\n'), 2), ['a', '', 'b'], 'a blank line is a line');

  /* THE CASE THE DEFAULT CHUNK NEVER REACHES. A multi-byte character split across a chunk boundary
     must not be mangled: a silently corrupted row is worse than a failure, because the parse still
     succeeds and the number it produces looks ordinary. The reader decodes with `stream: true`, and
     this plant puts the split INSIDE the two bytes of `µ` — the character the ECG column header
     carries, so this is the real file's own case. */
  const uvRow = 'ecg [µV]\n42\n';
  for (let chunk = 1; chunk <= 12; chunk++) same(read(plant(`uv${chunk}.txt`, uvRow), chunk), ['ecg [µV]', '42'], `a 2-byte character split at chunk=${chunk} survives`);

  // 4-byte characters too, at every boundary inside them.
  for (let chunk = 1; chunk <= 8; chunk++) same(read(plant(`emo${chunk}.txt`, 'a\u{1F600}b\nc\n'), chunk), ['a\u{1F600}b', 'c'], `a 4-byte character split at chunk=${chunk} survives`);

  // The bound is a READ bound, not a line-length bound: one line longer than the chunk still arrives whole.
  const long = 'x'.repeat(5000);
  same(read(plant('long.txt', long + '\n'), 64), [long], 'a line longer than the chunk arrives whole');

  same(read(plant('nonl.txt', 'µ'), 1), ['µ'], 'a one-character file with no newline, split mid-character');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`read-lines-bounded: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`read-lines-bounded: ✓ ${pass} assertions — bounded reads, lines whole, no character mangled at a boundary`);
