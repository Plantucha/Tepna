<!-- SPDX-License-Identifier: Apache-2.0 -->
# Magpie · unit `seamlane` — the `_ECGSEAMS` sidecar reaches the browser drop lane

**Unit:** `seamlane` · **Branch:** `claude/seamlane-mg` · **Worktree:** `wt-seamlane-mg` (beside the
primary checkout) · **PR:** DRAFT #4413 · **Board:** claim #3591, note #3613 (thread 7)

**Doc-search that found the prior work:**
`node tools/doc-search.mjs --read "dex-ingest companion lane for a validity sidecar on the browser drop path, and which nodes read a seam sidecar"`
→ board #3591 · board #3580 · `briefs/RESIDUE.md`:1230 ·
`briefs/SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md`:1-4 · `tests/dex-tests.js`:48147-48231.

## Where this stopped

DRAFT #4413 is open and green over its committed head: TC=0, LINT=0, `verify-fixtures`
`✓ suite green — 0 fixture(s) stamped, 19 already current`, `✓ check — all 50 steps passed`, EXIT=0,
0 steps NOT RUN, `secret-scan` PASS, `pr-compliance --pr 4413` exit 0. The standalone suite reads
`all 16390 assertions passed (878 groups)` with the new group at 23 of 23. The walker undrafts it; I
never undraft my own.

## What the unit closes

Row `2026-11-05-the-ecgseams-browser-drop-lane-has-no-companion-lane`. `ecgdex-dsp.js` has read the
box's `…_ECGSEAMS.txt` clock-seam sidecar since #4407, and `dex-ingest.js` sent every `*SEAMS` name to
skip, so the browser drop path could never hand it a byte. `ecgKind` now returns a distinct `seams`
kind, `planIngest` carries its own bucket and a deduped lane, and `ecgdex-app.js` picks the nearest
group by stamp through `_pickSidecarFor` and `_sidecarsFor`.

## The second defect, which is the larger half

The app sends any drop over 5 MB or of more than one part to the parse worker, then rebuilds the
record from `DSP.ecgTimingResolve(d.scan)`. That record never passed through `parseECGLines`, so it
attached NO sidecar at all. Every real overnight `_ECG.txt` has that shape, so the `_ECGRUNS` sidecar
shipped in #2317 never reached a big night either. One exported `attachEcgSidecars` body now serves
both roads, rather than a second copy in the app — the third-ingest-copy drift of DEEP-AUDIT-VI F2.

## Three tests that pinned spelling

Groups 311 and 431 and the done-when-4 ratchet each pinned a call's whole TEXT, so one extra sidecar
in the same options object felled all three. I rewrote the first two to read the capability instead.
The ratchet keeps its literal, because it needs a discriminator between a wired and a bare call, so
the small road spells its options object out at the call site.

## Next steps

1. The walker undrafts #4413, Kodiak merges, then `node tools/wt-done.mjs ~/wt-seamlane-mg`.
2. Release the claim on thread 7 with the key
   `2026-11-05-the-ecgseams-browser-drop-lane-has-no-companion-lane`.
3. A RESIDUE-only PR closes that row as `fixed #4413` and appends a NEW row: `planIngest` step (5)
   device-filters `rr`, `hr` and `acc` only, so the `runs`, `seams` and `accruns` lanes accept a
   sidecar from any device.
4. Then row `2026-11-05-four-clock-carrying-nodes-still-read-no-seam-sidecar`, node by node, PpgDex
   first on `PPGSEAMS`, then PulseDex on `PPISEAMS` and `HRSEAMS`, then MotionDex on `ACCSEAMS`.
   HRVDex and OxyDex need a measurement naming which of their inputs the box writes a sidecar for.
