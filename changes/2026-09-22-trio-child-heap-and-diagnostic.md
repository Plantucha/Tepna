---
bump: patch
type: fixed
brief: none
---

`tools/trio-batch.mjs`: a failed child's own error text is printed on EVERY non-zero exit, not only when the child produced no result lines — a child that died after computing its whole night had its abort message discarded by the result-line filter, which is the one case where it mattered. And two constants re-measured against the current corpus: `CHILD_HEAP_MB` 2048 → 4096 (2048 aborts with SIGABRT and 0 of 5 exports on the largest night; 3072 is the measured floor at 3.00 GB peak, 4096 gives one step of margin at 3.42 GB) and `PER_JOB_GB` 1.2 → 3.5 against a measured 3.0–3.4 GB peak per night — the latter over-subscribes any host by 3× (on the dev rig, ~47 slots claimed where ~16 fit) — and the comment naming the capture box is corrected in place, because that box cannot run this tool at all: `node` is absent there. Both earlier sweeps are kept beside the new ones: a constant measured on a smaller corpus was not wrong then. Also documented: a single-night invocation never enters the child path (the parent computes it in-process at Node's default heap), so a solo reproduction is not evidence about a fold.
