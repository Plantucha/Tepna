// Tepna — tools/trio-fold-clock.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0

/* ── A FOLDED NIGHT KEEPS THE CLOCK ANNOTATIONS OF ITS FRAGMENTS ───────────────────────────────────
   Residue 2026-10-29-the-fold-merge-drops-the-ring-segmentation-it-now-publishes.

   `mergePpg` in `tools/trio-batch.mjs` builds a fresh record, and it carried neither
   `offsetSegments` nor `clockResyncs`. `parsePPG` writes both and `ppgBuildNodeExport` emits both, so
   a SINGLE-fragment night published its segmentation while a MULTI-fragment night published none.
   Measured over the 74 folded ring exports in `uploads/trio`: 0 carry either field. 46 of the 65
   joinable nights hold more than one fragment, so the blind half is the common one. `mergeEcg` repaired
   the same loss for its own annotations in 2026-07, and it rebases them onto the merged axis.

   The rule lives in its own module because `trio-batch.mjs` runs its night loop at import, so a test
   can call nothing inside it — the reason `tools/trio-anchor.mjs` exists.

   THE EPOCH IS THE WHOLE DIFFICULTY. PpgDex keys each axis anchor on the FRAGMENT's own first sample
   (`ppgdex-dsp.js:1105`, `devMs: relNs / 1e6`), and a segment's bounds are anchor `devMs` values. Every
   fragment's segment list therefore starts near zero, and a bare concatenation publishes overlapping
   ranges that no reader can order. Each bound moves by the fragment's wall-clock offset from the first
   fragment, which is the offset the merged axis already carries (`mergePpg`:
   `off = (r.t0Ms - base.t0Ms) / 1000`, then `relSec[idx + i] = off + r.relSec[i]`) and the quantity
   `mergeEcg` adds to `atRelMs`. The residual inside one fragment is the host-axis correction the merged
   `relSec` folds in; a bound states a position, and a position is not a measurement.

   §∅: a position this merge cannot compute is `null`. It is never 0, and it is never a fragment-local
   number published as a merged one — the second form is the one a reader cannot detect. */

/* THE SAMPLE INDICES OF THE MID-NIGHT CLOCK RESYNCS, on the merged sample axis.
   A PpgDex resync entry is `{ idx, deviceStepMs, phoneDeltaMs }` (`ppgdex-dsp.js:1462`) — it carries no
   `atRelMs`, so `idx` is the only field the fold moves. Every other field rides through untouched,
   `phoneDeltaMs: null` included: an unparsed seam stamp stays unmeasured rather than becoming a zero.
   `recs` arrives sorted by `t0Ms` and already filtered, exactly as `mergePpg` holds it, so the output is
   in merged-axis order. Absent resyncs return `undefined`, so a clean night's export keeps today's bytes
   and no clean fixture moves (the discipline stated at the `clockResyncs` write in `ppgdex-dsp.js`). */
export function mergeClockResyncs(recs) {
  const list = Array.isArray(recs) ? recs : [];
  const out = [];
  let idx = 0;
  /* One fragment of unknown length makes every LATER index unplaceable, and an index off by a whole
     fragment points at real samples — a wrong position no reader can tell from a right one. */
  let placeable = true;
  for (const r of list) {
    const res = r && Array.isArray(r.clockResyncs) ? r.clockResyncs : [];
    for (const c of res) {
      if (!c) continue;
      out.push({ ...c, idx: placeable && Number.isFinite(c.idx) ? c.idx + idx : null });
    }
    if (r && Number.isFinite(r.n)) idx += r.n;
    else placeable = false;
  }
  return out.length ? out : undefined;
}

/* THE OFFSET SEGMENTS OF EVERY FRAGMENT, with their bounds on the merged axis.
   `baseT0Ms` is the first fragment's `t0Ms` — the origin of the merged axis, passed in rather than
   re-derived here, so this module holds no second copy of `mergePpg`'s sorting convention. Each
   segment keeps `anchors`, `spanS`, `flatOffsetMs`, `residualRmsMs`, `jitterMs`, `ppm`, `rate` and
   `rateReason` as the node wrote them: a per-segment rate is a fact about that fragment's own anchors,
   and the fold neither improves nor invalidates it. Clock Contract §7 holds either way, since the
   anchor count and the span sit in the object beside the `ppm`. */
export function mergeOffsetSegments(recs, baseT0Ms) {
  const list = Array.isArray(recs) ? recs : [];
  const haveBase = Number.isFinite(baseT0Ms);
  const out = [];
  for (const r of list) {
    const segs = r && Array.isArray(r.offsetSegments) ? r.offsetSegments : [];
    if (!segs.length) continue;
    const off = haveBase && r && Number.isFinite(r.t0Ms) ? r.t0Ms - baseT0Ms : null;
    for (const s of segs) {
      if (!s) continue;
      const move = (v) => (off != null && Number.isFinite(v) ? v + off : null);
      /* The segmentation survives even when its bounds cannot: that this night segmented AT ALL is the
         fact a single-rate reader is missing, and it does not depend on where the bounds fell. */
      out.push({ ...s, fromDevMs: move(s.fromDevMs), toDevMs: move(s.toDevMs) });
    }
  }
  return out.length ? out : undefined;
}
