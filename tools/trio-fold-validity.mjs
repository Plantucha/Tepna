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

import { readFileSync as nodeReadFileSync } from 'node:fs';

/* The sidecar path for a raw stream path: `…_ECG.txt` → `…_ECGRUNS.txt`, `…_PPG.txt` → `…_PPGRUNS.txt`.
   `null` when the path does not end in `_<STREAM>.txt`, so a caller never reads a guessed name. */
export function runsSidecarPath(streamPath, stream) {
  if (typeof streamPath !== 'string' || !/^[A-Z0-9]+$/.test(String(stream || ''))) return null;
  const tail = `_${stream}.txt`;
  return streamPath.endsWith(tail) ? `${streamPath.slice(0, -tail.length)}_${stream}RUNS.txt` : null;
}

/* ── READ THAT SIDECAR, AND NAME WHICH OF FOUR THINGS HAPPENED ─────────────────────────────────────
   Row 2026-10-17-sample-parsers-called-without-their-sidecar: 62 call sites under `tools/` hand a
   sample parser no `opts.runsText`, so a blanking run the box recorded reaches those readers as
   signal. Four of them hand-rolled this read first, and each collapsed the states that matter
   (`cvhr-edge-widen.mjs`, `ppg-autogain-e2.mjs`, `trio-batch.mjs`, `pat-pinned-move.mjs`).

   ⚠ AN ABSENT SIDECAR IS "VALIDITY UNKNOWN", NEVER "NO ABSENCES"
   (`briefs/SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md`, the reader contract). The file is missing
   for three non-equivalent reasons: the stream has no entry in the writer's `RUN_MIN_BY_STREAM`, the
   capture predates the writer, or the path yields no sidecar name at all. An EMPTY sidecar is the one
   state of the four that does say something, because its header states what was looked for. So this
   reader names the state and never returns an empty string, which every consumer downstream would
   read as a clean stream.

   §∅: `runsText` is `null` in every state but `read`. A caller tests that one field and passes the
   guarded `runsText ? parse(text, { runsText }) : parse(text)`, so an unmeasured stream parses
   exactly as it did before this reader existed, and `state` says which of the four it was.

   `opts.io` takes a `{ readFileSync }` stand-in, so a test plants all four states with no disk.
   `opts.tally` counts them for `validityLine` below. */
export function readRunsSidecar(streamPath, stream, opts) {
  const io = opts && opts.io;
  const read = io && typeof io.readFileSync === 'function' ? io.readFileSync : nodeReadFileSync;
  const path = runsSidecarPath(streamPath, stream);
  const out = (state, runsText, reason) => {
    const tally = opts && opts.tally;
    if (tally) tally[state] = (Number.isFinite(tally[state]) ? tally[state] : 0) + 1;
    return { path, stream: String(stream || '') || null, runsText, state, reason };
  };
  if (!path) return out('unnamed', null, `no \`_${stream}RUNS.txt\` name follows from this path, so nothing was read — validity UNKNOWN`);
  let text;
  try {
    text = read(path, 'utf8');
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'ENOENT') return out('absent', null, `${path} is not there — validity UNKNOWN for this stream, never "no blanking runs"`);
    return out('unreadable', null, `${path} could not be read (${code || (e && e.message)}) — validity UNKNOWN for this stream`);
  }
  return out('read', text, null);
}

/* The four states, in the order `validityLine` prints them. */
export const VALIDITY_STATES = Object.freeze(['read', 'absent', 'unreadable', 'unnamed']);

/* One line a tool prints beside its own numbers, from the tally `readRunsSidecar` filled. `null` for
   an empty tally: a run that read no stream states nothing, rather than four zeros that read exactly
   like a sweep where every sidecar was there. */
export function validityLine(tally) {
  const t = tally || {};
  const at = (k) => (Number.isFinite(t[k]) ? t[k] : 0);
  if (!VALIDITY_STATES.reduce((a, k) => a + at(k), 0)) return null;
  return `validity sidecars: ${VALIDITY_STATES.map((k) => `${at(k)} ${k}`).join(' \u00b7 ')} — an absent, unreadable or unnamed sidecar is validity UNKNOWN for that stream, never a clean one`;
}

/* Sample count of one fragment, or null when the fragment states none. */
const lenOf = (r, key) => {
  const v = key === 'int16' ? r && r.int16 && r.int16.length : r && r.n;
  return Number.isFinite(v) ? v : null;
};

/* ECGDex `rec.blankingSpans` (`{ first, n, value }`, sample indices) of every fragment, on the merged
   axis. `recs` arrives sorted and filtered exactly as `mergeEcg` holds it.

   §∅: a FRAGMENT states three things, and this merge keeps all three apart. `ecgdex-dsp.js` writes no
   field at all for a one-argument parse, writes `null` plus a `blankingSpansReason` naming the channels
   it rejected when the sidecar's rows all went unplaced, and writes `[]` when the sidecar recorded no
   run. So the merged record states one of three things too:

   - `undefined` — no fragment carried a sidecar, so the night keeps today's record shape.
   - `spans: null` with a `reason` — a sidecar reached the parse, and no fragment yielded a readable
     row. Nothing was measured, and an empty list here would read as a clean stream.
   - `spans: [...]` with `refused > 0` and a `reason` — the fold read part of the night and could not
     read the rest. The reason travels, so a consumer of the merged record can tell which it holds.

   The direction is the harmful one. Until the reason travelled, a night this reader could not place
   looked exactly like a night the box never wrote a sidecar for
   (`2026-11-01-the-ecg-fold-cannot-tell-an-absent-sidecar-from-an-unreadable-one`). The capture host
   has drawn this line since `capture.py`'s `session_meta`, which answers `unreadable: True` plus a
   reason rather than the bare `{}` that made the two states one. */
export function mergeBlankingSpans(recs) {
  const list = Array.isArray(recs) ? recs : [];
  /* A fragment CARRIES a sidecar when it states either a list or a refusal. `undefined` is the
     one-argument parse, which states nothing, so a list of those is the absence above. */
  const carried = list.filter((r) => r && (Array.isArray(r.blankingSpans) || r.blankingSpans === null));
  if (!carried.length) return undefined;
  const reasons = [];
  let refused = 0;
  for (const r of carried) {
    if (r.blankingSpans !== null) continue;
    refused++;
    const why = typeof r.blankingSpansReason === 'string' && r.blankingSpansReason ? r.blankingSpansReason : 'no reason stated';
    if (!reasons.includes(why)) reasons.push(why);
  }
  const spans = [];
  let idx = 0;
  let placeable = true;
  let unplaced = 0;
  let read = 0;
  for (const r of list) {
    if (r && Array.isArray(r.blankingSpans)) read++;
    for (const s of (r && Array.isArray(r.blankingSpans) && r.blankingSpans) || []) {
      if (!s) continue;
      if (placeable && Number.isFinite(s.first)) spans.push({ ...s, first: s.first + idx });
      else unplaced++;
    }
    const k = lenOf(r, 'int16');
    if (k == null) placeable = false;
    else idx += k;
  }
  const reason = refused ? `${refused} of ${carried.length} fragment(s) with a sidecar went unread: ${reasons.join(' \u00b7 ')}` : null;
  /* `read` counts the fragments that yielded a list. At zero the merge measured nothing, and `spans`
     says so with `null` rather than with the empty list that means a clean stream. */
  return { spans: read ? spans : null, unplaced, refused, reason };
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
