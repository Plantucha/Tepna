// Tepna — tools/read-lines-bounded.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0

/* ── ONE BOUNDED LINE READER, FOR EVERY TOOL THAT HANDS A RAW STREAM TO A DSP ──────────────────────
   Residue 2026-11-06-the-sigma-window-ecg-leg-duplicates-the-dsp-parser.

   `tools/trio-batch.mjs` held this reader privately, so the one other tool that parses raw Polar ECG
   — `tools/derive-sigma-window.mjs` — could not reach it and read its parts with `readFileSync` plus
   `split(/\r?\n/)` instead. Those parts run 150 to 350 MB each, and a night of them exceeds V8's
   maximum string, so the private reader was the difference between a bounded working set and a tool
   that dies on the nights carrying the most data.

   The reader lives in its own module because `trio-batch.mjs` runs its night loop at import, so a
   caller cannot import anything declared inside it — the reason `tools/trio-fold-clock.mjs` and
   `tools/trio-fold-validity.mjs` exist. The body below is that reader, moved unchanged. */

import { closeSync, openSync, readSync } from 'node:fs';

// ── BOUNDED LAZY LINE READER ──────────────────────────────────────────────────────────────────
// The fold's dominant allocation was `readFileSync(f, 'utf8')` handed to a parser that then did
// `split(/\r?\n/)`. For the H10 ECG files in this corpus (up to 260 MB) that is the whole file as one
// string PLUS ~3.4 M line objects, both live at once, per file.
//
// This reads the file in bounded chunks and yields complete lines, so the working set is the chunk
// plus one line — never the file. The parser side is `ECGDSP.parseECGLines`, an ADDITIVE entry point:
// `parseECG` still takes whole text for the browser and every existing caller, and both share one
// parse body so the two cannot drift. Verified export-inert on a real night (2026-08-23): the
// volatile-stripped `node-export` JSONs are identical before and after.
export const LINE_CHUNK_BYTES = 16 * 1024 * 1024; // 16 MB — the bound on the read buffer

export function* readLinesBounded(path, chunkBytes = LINE_CHUNK_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(chunkBytes);
    const dec = new TextDecoder('utf-8');
    let carry = '';
    for (;;) {
      const got = readSync(fd, buf, 0, chunkBytes, null);
      if (got <= 0) break;
      // `stream: true` so a multi-byte character split across a chunk boundary is not corrupted —
      // silently mangling one row is worse than failing, because the parse still succeeds.
      const text = carry + dec.decode(buf.subarray(0, got), { stream: true });
      let start = 0;
      for (;;) {
        const nl = text.indexOf('\n', start);
        if (nl < 0) break;
        const end = nl > start && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
        yield text.slice(start, end);
        start = nl + 1;
      }
      carry = text.slice(start);
    }
    carry += dec.decode();
    if (carry.length) yield carry; // a final line with no trailing newline is still a row
  } finally {
    closeSync(fd);
  }
}
