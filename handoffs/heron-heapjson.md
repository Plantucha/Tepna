# Heron — unit 24: the heap row is owner-blocked on one marker file

**Unit.** Drain the residue row `2026-09-25-heap-growth-is-json-retention-not-a-buffer-leak`, capture-host lane, OPEN at origin/main. Measurement only.

**Branch and worktree.** None. I changed no repo file, and I touched nothing on the box. #3918 merged at 2026-10-25 10:34Z, and `node tools/wt-done.mjs ~/wt-stallcover-hrn` retired its worktree. So my one PR slot is free.

**Exact stopping point.** Board finding #1186 carries the measurement. The row stays OPEN, and it now reads owner-blocked. `origin/main` is `bdc34c97d`.

**What I measured.**

1. The instrument the row needs already ships. `capture.py:12490` `DecodeCensus` counts decodes per call site, and `:12641` `top_container_holders` names who holds the big containers. Both run inside the tracing window only.
2. The deployed tree is current. `/opt/tepna/capture-host` sits at `bdc34c97`, which is today's main, and the deployed file carries five `DecodeCensus` references.
3. The config permits the probe. `/opt/tepna/capture-host/config.yaml:165` reads `enabled: true`, 30 minutes to arm, two snapshots, 60 minutes apart, top 15.
4. The one absent input is the one-shot request. `/srv/tepna/heap-probe.request` does not exist, and `/srv/tepna/captures/heap-probe.json` still carries 2026-09-25 00:21. So the census has never produced a row, and the row's own figures predate it.
5. The 2026-10-13 arm was lost, and the code now prevents the repeat. `/srv/tepna/heap-probe.request.consumed` reads `heron 2026-10-13 night`. The deployed probe awaits capture at `:12790` and consumes at `:12800`. A restart before capture no longer spends the arm.
6. A census-invisible decode binding does not exist in the daemon. The census rebinds `json.loads` and `json.load` as module attributes. I grepped the deployed venv for direct imports of those functions. Only pip's vendored copies use that form, and pip never runs in the daemon.
7. No decode site in the daemon's own code runs per sample. All eleven `capture.py` sites are periodic or one-shot, and the busiest carries five call sites. The probe measured 50 decoded objects a second, so a per-site count discriminates by three orders of magnitude.
8. A bound covers the module-level event list. `_RADIO_EVENTS` at `:1953` trims to 50 entries at `:1965`, so it is not a retainer.

**Next step.** Wait for the owner's word on the arm. On a yes, write `/srv/tepna/heap-probe.request` with one line naming the session and the night, then read `/srv/tepna/captures/heap-probe.json` the next morning and report `decodes_by_site` and `top_holders`. Arming is a box change, so it stays owner-authorized, and a peer relay never changes that.

**Open questions.** Does the owner accept the tracing tax for one night? The docstring measured 25 event-loop stalls of 1 to 12 seconds under tracing, against 3 in the two hours after it stopped. The recording itself stayed whole that night.

**Blockers.** Without the marker file the row cannot advance at all. Every static narrowing it admits is now taken, and items 6 and 7 above closed the two that remained.

**Doc-search query.** `what retains decoded JSON in the capture loop, json decoder objects growing per hour` → `tests/test_nightqc.py:4545` the QC poll retains nothing · `tests/test_heap_probe.py:493` the census design and why a referrer walk is not implementable · `capture.py:12381` `heap_report_row`.

**Fleet-Session: Heron**
