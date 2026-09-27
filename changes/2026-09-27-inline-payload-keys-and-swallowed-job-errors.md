<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [analysis]
brief: none
---
The worker-boundary gate's key extractor now reads a third payload idiom — an inline
`postMessage({ … })` literal, depth-1, only on a `postMessage(` call. Two producers build no named payload
object at all (`qrs-equiv-worker.js`, `qrs-yield-worker.js`) and were carried as declared **exclusions**
because the extractor could not read them; both are now declared and the exclusion set is **empty**.

Extending it found a live defect the exclusion had been hiding. Both QRS analysis pages read only `type`
and `result` from a worker's `done` message, while the worker posts `{type:'done', error}` when it is not
ready **or when the job throws** — so a thrown job advanced `done`, advanced the progress bar, contributed
no sample, and its error text was read nowhere. The run then reported a normal finish over a smaller
population. Both pages now record job errors and annotate the finished run with the count and the first
message (reduced coverage annotates, per the 2026-09-17 ruling — the run does not refuse).

`qrs-yield-worker.js` also shipped `reqId` and `wallMs` that no consumer read on any path: the page
serialises one job per worker record and never correlates by id, and the per-job wall time was never
surfaced. Deleted rather than surfaced, following the gate's own `detailCorr` precedent.

Three new plants guard the new idiom specifically, because the existing plant exercises the `out.X =`
branch and would pass while the inline branch read nothing: a key in an inline literal is extracted, is
reported dead when unread, and a **nested** member is not lifted to a top-level payload key.
