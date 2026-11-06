// Tepna — tools/trio-fold-merge.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0

/* ── A NIGHT'S FRAGMENTS MERGE ON PARSED RECORDS, AND EVERY TOOL OWES THE SAME MERGE ───────────────
   Residue 2026-11-06-the-sigma-window-concat-joins-a-nights-parts-as-text.

   `tools/trio-batch.mjs` held `mergeEcg` and `mergePpg` inside its night loop, so the other tool that
   folds a night's parts — `tools/derive-sigma-window.mjs` — joined them as TEXT instead: one header,
   one `t0Ms`, and no entry for the silence between two parts. A break between parts then reached both
   detectors as continuous signal, which is the §∅ discontinuity case rather than a coverage one.

   The rule lives in its own module because `trio-batch.mjs` runs its night loop at import, so a
   caller can import nothing declared inside it — the reason `tools/trio-fold-clock.mjs` and
   `tools/trio-fold-validity.mjs` exist. The two bodies below are those merges, moved unchanged apart
   from `opts.warn`, which lets a test read the warnings a merge emits instead of the console. */

import { mergeClockResyncs, mergeOffsetSegments } from './trio-fold-clock.mjs';
import { mergeBlankingSpans, mergePinnedSpans } from './trio-fold-validity.mjs';

/* ── MERGING SESSIONS, AND WHY IT IS DONE ON PARSED RECORDS ────────────────────────────────
   Concatenating the raw TEXT is not an option: the worst per-stream union in this corpus is
   775 MB (07-20 Verity ACC) and 559 MB (07-18 ECG), both past V8's ~537 MB maximum string, so a
   text merge would throw `Invalid string length` on exactly the nights with the most data.
   Parsed samples are ~10x denser than their text, so merging there is both safe and exact.

   NO TIME IS EVER FABRICATED. The silence between two sessions is real — the sensor was off-link
   — and each parser already has a way to say so, which is the way used here:
     ECG carries `gaps:[{idx,ms}]`, so the inter-session silence becomes one more gap entry at
     the join, and every carried-over gap has its index shifted by the join offset.
     PPG carries per-sample `relSec`, so a later session's samples simply land at their true
     offset from the first session's t0 and the hole appears as a jump in relSec.
   A merge that closed those holes instead would be inventing signal. */
export function mergeEcg(recs, opts) {
  const warn = (opts && opts.warn) || console.warn;
  recs = recs.filter((r) => r && r.int16 && r.int16.length && r.t0Ms != null).sort((a, b) => a.t0Ms - b.t0Ms);
  if (recs.length <= 1) return recs[0] || null;
  /* The LONGEST fragment's fs, not the first one's. Both are `130 Hz + host-axis correction`, but the
     correction is only applied to fragments that clear ECGDex's span gate (40 min), so `recs[0]` is
     routinely a 5-second reconnect stub carrying the raw device crystal while a 7-hour fragment on the
     same night carries the disciplined rate. Sample-index → duration is imposed on every fragment
     here, so it should come from the fragment that owns most of the samples. */
  const fs = recs.reduce((a, b) => (b.int16.length > a.int16.length ? b : a), recs[0]).fs;
  /* A rate change mid-night would make one sample index mean two different durations. It does not
     happen on an H10 (130 Hz fixed), but assuming it cannot is how a silent corruption starts.
     0.05 Hz = 385 ppm. The old bound was 0.5 Hz = 3846 ppm, which was never a guard on anything real:
     an H10 crystal lives within ~30 ppm, and the widest per-night spread across the 2026-07-16..29
     corpus is 52 ppm. It was loose enough to admit a 133.2 Hz fragment (an ungated host-axis rate off
     a 62 s stub — the defect this bound could not see, fixed at source in `ecgdex-dsp.js`) while still
     being tight enough to THROW on it, so a good night failed to fold for the wrong reason. */
  const odd = recs.find((r) => Math.abs((r.fs || fs) - fs) > 0.05);
  if (odd) throw new Error(`ECG sessions disagree on fs (${fs} vs ${odd.fs}) — refusing to merge`);
  let n = 0;
  for (const r of recs) n += r.int16.length;
  const out = new Int16Array(n);
  const gaps = [];
  const overlaps = [];
  const clockResyncs = [];
  let idx = 0,
    prevEndMs = null;
  for (const r of recs) {
    if (prevEndMs != null) {
      const d = r.t0Ms - prevEndMs;
      /* `idx`, not `idx - 1` — THE CONVENTION IS "the first sample AFTER the dropout"
         (INTEGRATOR-GAP-AWARE-OVERLAP-FOLLOWUPS §2.1, fixed 2026-07-31; stated at the definition in
         `ecgdex-dsp.js parseECGText`). At this point `idx` is where THIS session's first sample is
         about to land, so `idx` IS the first sample after the silence — and `idx - 1` was the last
         one before it, the opposite of what `parseECGText` emits for an in-file dropout.
         Why first-after wins: the consumer (the dead-time walk in `ecgdex-dsp.js`) tests
         `g.idx <= refIdx[k]` and credits the dropout to every beat at or past that index. Under
         first-after, a beat ON the boundary sample is genuinely after the hole and SHOULD carry the
         dead time. Under last-before it was credited to the beat immediately BEFORE the hole too —
         one sample, 7.7 ms at 130 Hz, immaterial against hour-scale segments (which is why it went
         unnoticed) but wrong in the direction that inflates elapsed time. */
      if (d > 0)
        gaps.push({ idx, ms: d }); // the real off-link silence
      /* d < 0 = this session starts BEFORE the previous one is predicted to end: either the two
         overlap in wall-clock, or `fs` over-states the previous fragment's duration. Samples are
         concatenated contiguously, so the merged timeline is longer than reality by |d| and there is
         no honest single-scalar repair. COUNTED rather than silently dropped: measured 0 of 33
         boundaries on 2026-07-26 and 0 across the 2026-07-16..29 corpus, so this is a tripwire for a
         regime we have not seen, not a live correction. If it ever fires, the merge is lying about
         elapsed time and the fold should be treated as suspect. */
      else if (d < 0) overlaps.push({ idx, ms: d });
    }
    for (const g of r.gaps || []) gaps.push({ idx: g.idx + idx, ms: g.ms });
    /* A mid-file clock resync (DEEP-AUDIT-VI F1) is a property of the NIGHT, not of the fragment it
       happened in — two of the three poisoned nights (08-23, 08-27) are multi-fragment, and without
       this line their folded exports carried no `recording.clockResyncs` while the single-fragment
       08-26 did. `idx` re-bases onto the merged sample index; `atRelMs` onto the merged relative
       axis via the fragment's wall-clock start, the same axis `gaps[].idx` above lands on. */
    for (const c of r.clockResyncs || []) clockResyncs.push({ ...c, idx: c.idx + idx, atRelMs: c.atRelMs + (r.t0Ms - recs[0].t0Ms) });
    out.set(r.int16, idx);
    idx += r.int16.length;
    prevEndMs = r.t0Ms + (r.int16.length / fs) * 1000;
  }
  if (overlaps.length)
    warn(`  ⚠ ECG merge: ${overlaps.length} negative session boundary(ies), total ${(overlaps.reduce((a, o) => a + o.ms, 0) / 1000).toFixed(2)} s — merged elapsed time is OVER-stated by that much`);
  /* The `_ECGRUNS.txt` blanking spans of every fragment, on the merged sample axis
     (`tools/trio-fold-validity.mjs`). Absent when no fragment carried a sidecar; `null` plus a
     `blankingSpansReason` when a sidecar reached the parse and no fragment yielded a readable row.
     ∅ Those two are different facts, and the reason is what tells a reader of the merged record
     which one it holds. */
  const blank = mergeBlankingSpans(recs);
  if (blank && blank.unplaced) warn(`  ⚠ ECG merge: ${blank.unplaced} blanking span(s) after a fragment of unknown length — dropped, not placed`);
  if (blank && blank.reason) warn(`  ⚠ ECG merge: ${blank.reason}`);
  return {
    blankingSpans: blank ? blank.spans : undefined,
    ...(blank && blank.reason ? { blankingSpansReason: blank.reason } : {}),
    int16: out,
    fs,
    gaps,
    overlaps,
    clockResyncs,
    t0Ms: recs[0].t0Ms,
    offsetMin: recs[0].offsetMin,
    source: 'file',
    durSec: n / fs,
    /* Carry the TIMING PROVENANCE across the merge — the ECG twin of mergePpg's F3 fix below
       (WEARABLE-HOST-AXIS-FOLLOWUPS §F3): without this a folded multi-fragment night has no
       `hostAxis`/`deviceEpoch`, so the export's `recording.timingSource`/`recording.deviceEpoch`
       (H10-2019-ORIGIN) came out absent on exactly the nights BLE reconnects fragment — the common
       case. Independence mirrors mergePpg's rule: it is a property of the capture SETUP, so any
       fragment that resolved it speaks for the night; `ok:false` because a merged night has no
       single anchor set — the fs above already carries the longest fragment's correction. */
    hostAxis: (() => {
      const parts = recs.filter((r) => r.hostAxis);
      if (!parts.length) return undefined;
      const indep = parts.some((r) => r.hostAxis.independent === true) ? true : parts.some((r) => r.hostAxis.independent === false) ? false : null;
      /* §∅ ON THE FOLD'S OWN OUTPUT: a fresh object drops every field it does not name, and
         `clock.js` publishes `deviceDrawn` on each fragment's axis. Dropped here, a folded night
         reads `undefined` — absence standing in for "not drawn" — at exactly the consumers that
         refuse on `deviceDrawn === true`. A drawn counter stays drawn across a merge, so the worst
         fragment speaks: any fragment drawn makes the night drawn, all-false makes it false, and
         nothing known leaves it null. It is carried ADDITIVELY and does NOT gate `independent`,
         which is `clock.js`'s own discipline (a synthetic fixture's uniform axis cannot be told
         from a fabricated one). */
      const drawn = parts.some((r) => r.hostAxis.deviceDrawn === true) ? true : parts.some((r) => r.hostAxis.deviceDrawn === false) ? false : null;
      return {
        ok: false,
        merged: true,
        fragments: parts.length,
        independent: indep,
        deviceDrawn: drawn,
        timingSource: indep === true ? 'device+host' : indep === false ? 'device' : null,
        reason: 'merged night — per-fragment axes; fs carries the longest fragment’s correction'
      };
    })(),
    /* Bimodal years-vs-seconds, so no sample-weighting: the night is plausible only if EVERY
       fragment is (a mid-night sync leaves the early fragments on the 2019 origin), and the
       published offset is the worst fragment's — the one a reader needs to see. */
    deviceEpoch: (() => {
      const parts = recs.filter((r) => r.deviceEpoch);
      if (!parts.length) return null;
      const worst = parts.reduce((a, b) => (Math.abs(b.deviceEpoch.offsetMs) > Math.abs(a.deviceEpoch.offsetMs) ? b : a));
      return { offsetMs: worst.deviceEpoch.offsetMs, plausible: parts.every((r) => r.deviceEpoch.plausible) };
    })()
  };
}
export function mergePpg(recs, opts) {
  const warn = (opts && opts.warn) || console.warn;
  recs = recs.filter((r) => r && r.n && r.t0Ms != null).sort((a, b) => a.t0Ms - b.t0Ms);
  if (recs.length <= 1) return recs[0] || null;
  /* SESSIONS AT DIFFERENT SAMPLE RATES MUST NOT SHARE A GRID. This merge concatenates samples and
     stamps ONE `fs`; it used to take `recs[0].fs` and validate only channel count and site, so a
     night whose rate changed mid-way was merged under the FIRST fragment's rate.
  
     Measured 2026-08-03. The Verity moved 55 Hz -> 176 Hz at 21:54; the fold merged 18 sessions
     spanning both and declared fs = 55 over data that was mostly 176 Hz. Beat detection derives its
     refractory window in SAMPLES from `fs`, so the window came out 3.2x too short in real time, a
     second peak per cardiac cycle was accepted, and the night's mean HR exported as **108.6 bpm
     against the chest ECG's 52.1** — a clean 2.08x. Nothing errored. The three-cornered hat then
     faithfully reported the Verity as the night's worst sensor (sigma 3.37 bpm) on a doubled series,
     which is how a fold bug turns into a false finding about hardware.
  
     DROP the minority-rate sessions rather than throw: the ECG path refuses outright, but here the
     dominant rate usually carries almost the whole night, and refusing would discard a good recording
     over a few minutes of pre-sleep fragments. Keep the LONGEST session's rate (by samples, not by
     being first — the stray fragment is often earliest), and say what was dropped. */
  const domFs = recs.reduce((a, b) => (b.n > a.n ? b : a), recs[0]).fs;
  const rateOk = (r) => !(r.fs > 0) || !(domFs > 0) || Math.abs(r.fs - domFs) / domFs <= 0.05;
  const offRate = recs.filter((r) => !rateOk(r));
  if (offRate.length) {
    const secs = offRate.reduce((t, r) => t + r.n / (r.fs || domFs || 1), 0);
    warn(
      `  ⚠ PPG merge: dropped ${offRate.length} session(s) at a different sample rate ` +
        `(${[...new Set(offRate.map((r) => (r.fs || 0).toFixed(1)))].join('/')} Hz vs ${domFs.toFixed(1)} Hz, ` +
        `${(secs / 60).toFixed(1)} min) — merging them would mis-time beat detection`
    );
    recs = recs.filter(rateOk);
    if (recs.length <= 1) return recs[0] || null;
  }
  const base = recs[0];
  const nch = base.ch.length;
  const bad = recs.find((r) => r.ch.length !== nch || r.site !== base.site);
  if (bad) throw new Error('PPG sessions disagree on channel count or site — refusing to merge');
  let n = 0;
  for (const r of recs) n += r.n;
  const ch = Array.from({ length: nch }, () => new Float32Array(n));
  const amb = new Float32Array(n);
  const relSec = new Float64Array(n);
  let idx = 0;
  for (const r of recs) {
    const off = (r.t0Ms - base.t0Ms) / 1000; // true offset — the gap shows up here
    for (let c = 0; c < nch; c++) ch[c].set(r.ch[c].subarray(0, r.n), idx);
    if (r.amb) amb.set(r.amb.subarray(0, r.n), idx);
    for (let i = 0; i < r.n; i++) relSec[idx + i] = off + r.relSec[i];
    idx += r.n;
  }
  const pinned = mergePinnedSpans(recs, nch);
  if (pinned.unplaced) warn(`  ⚠ PPG merge: ${pinned.unplaced} pinned span(s) after a fragment of unknown length — dropped, not placed`);
  return {
    ch,
    amb,
    relSec,
    fs: base.fs,
    n,
    t0Ms: base.t0Ms,
    offsetMin: base.offsetMin,
    durSec: relSec[n - 1],
    site: base.site,
    gap: null,
    /* The pinned-rail spans of every fragment, sidecar-led where a `_PPGRUNS.txt` was read, on the
       merged sample axis (`tools/trio-fold-validity.mjs`). Without this field the merged record had
       none, and `compute`'s pinned-interval exclusion ran on no multi-fragment night. */
    spans: pinned.spans,
    sentinelRejected: recs.reduce((t, r) => t + (r.sentinelRejected || 0), 0),
    sentinelKept: recs.reduce((t, r) => t + (r.sentinelKept || 0), 0),
    /* THE CLOCK ANNOTATIONS OF THE FRAGMENTS, rebased onto the merged axis (residue
       2026-10-29-the-fold-merge-drops-the-ring-segmentation-it-now-publishes). `mergeEcg` above
       carries its own, and this record carried neither, so `offsetSegments` and `clockResyncs`
       reached 0 of the 74 folded ring exports while every single-fragment night published both.
       Both stay `undefined` when no fragment had one, so a clean night keeps today's bytes. The
       epoch rule, and why a bound cannot stay fragment-local, live in `tools/trio-fold-clock.mjs`. */
    clockResyncs: mergeClockResyncs(recs),
    offsetSegments: mergeOffsetSegments(recs, base.t0Ms),
    /* Carry the TIMING PROVENANCE across the merge (WEARABLE-HOST-AXIS-FOLLOWUPS §F3). Without this
       the merged rec has no `hostAxis`, so the export's `quality.timingSource` came out null on every
       folded night — the field existed and was never populated, which is precisely the hollow-gate
       failure this repo keeps hitting.

       SAMPLE-WEIGHTED, not worst-case. A worst-case rule was tried first and measured to be wrong: it
       refused 2026-07-28, a night whose O2Ring genuinely reports real timestamps and which closes at
       -11.4 ppm, because one short fragment carried too few host anchors to judge. Weighting by
       samples makes the merged verdict identical to what the single-file detector would say if the
       fragments were concatenated — which is the thing being approximated. */
    hostAxis: (() => {
      const parts = recs.filter((r) => r.hostAxis && r.n > 0);
      if (!parts.length) return undefined;
      let tot = 0,
        acc = 0,
        anyOk = false;
      for (const r of parts) {
        if (r.hostAxis.quantizedShare != null) {
          acc += r.hostAxis.quantizedShare * r.n;
          tot += r.n;
        }
        if (r.hostAxis.ok) anyOk = true;
      }
      const share = tot > 0 ? acc / tot : null;
      /* MIRRORS parsePPG's `axisSynthetic` (DA-V §2.7 F17) — and it MUST, because this is the fold
         path and the single-file path, and a provenance rule that holds in one and not the other is
         how a folded night ends up making a claim the same bytes would not make unfolded.
         The share-based signature alone went blind when capture-host's rate-SLEW estimator (2026-07-27)
         stopped the synthesised column being a singleton delta set: `quantizedShare` fell to 0.00083
         on a real night, so `drawn` read false and every folded O2Ring night claimed
         `timingSource:'device+host'` — a real second clock — for an axis accumulated from host
         arrival times. The O2Ring layout is the provenance fact; the fingerprint is only evidence
         for it, and the writer can erase the evidence. */
      const isFinger = parts.some((r) => r.site === 'finger');
      const drawn = (share != null && share >= 0.99) || isFinger;
      /* INDEPENDENCE CARRIES ACROSS THE MERGE TOO (DA-V §2.4 F13). A fold whose fragments all say
         "this host column is the device stamp rounded" has no second clock either, and dropping the
         verdict here would re-introduce on the fold path exactly what parsePPG stopped claiming on
         the single-file one. ANY fragment with a genuinely independent host column is enough to
         earn `device+host` — independence is a property of the capture setup, and a short fragment
         that could not resolve it is silent, not contradictory. */
      const indep = parts.some((r) => r.hostAxis.independent === true) ? true : parts.some((r) => r.hostAxis.independent === false) ? false : null;
      return {
        ok: anyOk,
        fragments: parts.length,
        quantizedShare: share,
        drawn,
        independent: indep,
        // Mirrors parsePPG: a drawn axis with host anchors is host-timed; with none, it has no timing.
        timingSource: drawn ? (anyOk ? 'host' : 'none') : indep === false ? 'device' : 'device+host'
      };
    })()
  };
}
