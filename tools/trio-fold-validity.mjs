// Tepna — tools/trio-fold-validity.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0

/* ── A FOLDED NIGHT KEEPS THE VALIDITY OF ITS FRAGMENTS ────────────────────────────────────────────
   Residue 2026-10-17-sample-parsers-called-without-their-sidecar (the `tools/trio-batch.mjs` slice).

   The box writes a `…RUNS.txt` validity sidecar beside each raw stream: `_ECGRUNS.txt` beside the H10
   `_ECG.txt`, `_PPGRUNS.txt` beside the Verity and the O2Ring `_PPG.txt`. The fold read none of them,
   so a blanking run the box recorded reached ECGDex and PpgDex as signal. Two losses stacked:

   1. The parse calls passed no `runsText`, so no fragment carried the sidecar's spans.
   2. The merges built fresh records and named no span field, so even the spans `parsePPG` RECOMPUTES
      from the samples (`rec.spans`, read by the pinned-interval exclusion in `ppgdex-dsp.js`) were
      dropped on every multi-fragment night. A single-fragment night skipped the merge and kept them.

   Both merges here rebase a span onto the merged SAMPLE axis by the count of samples before its
   fragment, the same rule `mergeEcg` applies to `gaps[].idx`. A span is `{ first, n, … }` over sample
   indices, and the consumers test fiducial indices against it, so no time conversion enters.

   The rule lives in its own module because `trio-batch.mjs` runs its night loop at import, so a test
   can call nothing inside it — the reason `tools/trio-fold-clock.mjs` exists.

   §∅: a span this merge cannot place is dropped and counted, never placed at a guessed index. An
   index off by a whole fragment points at real samples, and no reader can tell it from a right one. */

/* The sidecar path for a raw stream path: `…_ECG.txt` → `…_ECGRUNS.txt`, `…_PPG.txt` → `…_PPGRUNS.txt`.
   `null` when the path does not end in `_<STREAM>.txt`, so a caller never reads a guessed name. */
export function runsSidecarPath(streamPath, stream) {
  if (typeof streamPath !== 'string' || !/^[A-Z0-9]+$/.test(String(stream || ''))) return null;
  const tail = `_${stream}.txt`;
  return streamPath.endsWith(tail) ? `${streamPath.slice(0, -tail.length)}_${stream}RUNS.txt` : null;
}

/* Sample count of one fragment, or null when the fragment states none. */
const lenOf = (r, key) => {
  const v = key === 'int16' ? r && r.int16 && r.int16.length : r && r.n;
  return Number.isFinite(v) ? v : null;
};

/* ECGDex `rec.blankingSpans` (`{ first, n, value }`, sample indices) of every fragment, on the merged
   axis. `recs` arrives sorted and filtered exactly as `mergeEcg` holds it. Returns `undefined` when no
   fragment carried a sidecar, so a night with no sidecar keeps today's record shape. An empty array
   means a sidecar was read and recorded no run, which is a measurement, not an absence. */
export function mergeBlankingSpans(recs) {
  const list = Array.isArray(recs) ? recs : [];
  if (!list.some((r) => r && Array.isArray(r.blankingSpans))) return undefined;
  const spans = [];
  let idx = 0;
  let placeable = true;
  let unplaced = 0;
  for (const r of list) {
    for (const s of (r && Array.isArray(r.blankingSpans) && r.blankingSpans) || []) {
      if (!s) continue;
      if (placeable && Number.isFinite(s.first)) spans.push({ ...s, first: s.first + idx });
      else unplaced++;
    }
    const k = lenOf(r, 'int16');
    if (k == null) placeable = false;
    else idx += k;
  }
  return { spans, unplaced };
}

/* PpgDex `rec.spans` — one entry per optical channel, `{ spans: [{ first, n }], lo, hi }` or `null` —
   of every fragment, on the merged axis. `lo` and `hi` are the rail thresholds of ONE fragment's
   samples; a merged record holds several, so the merged entry states `null` for both rather than
   publishing one fragment's threshold as the night's. A channel no fragment measured stays `null`. */
export function mergePinnedSpans(recs, nch) {
  const list = Array.isArray(recs) ? recs : [];
  const out = Array.from({ length: Number.isInteger(nch) && nch > 0 ? nch : 0 }, () => null);
  let idx = 0;
  let placeable = true;
  let unplaced = 0;
  for (const r of list) {
    const per = r && Array.isArray(r.spans) ? r.spans : [];
    for (let c = 0; c < out.length; c++) {
      const e = per[c];
      if (!e || !Array.isArray(e.spans)) continue;
      if (!out[c]) out[c] = { spans: [], lo: null, hi: null };
      for (const s of e.spans) {
        if (!s) continue;
        if (placeable && Number.isFinite(s.first)) out[c].spans.push({ ...s, first: s.first + idx });
        else unplaced++;
      }
    }
    const k = lenOf(r, 'n');
    if (k == null) placeable = false;
    else idx += k;
  }
  return { spans: out, unplaced };
}
