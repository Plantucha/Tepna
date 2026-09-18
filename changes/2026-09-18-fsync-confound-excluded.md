---
bump: patch
type: changed
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

Resource-orchestration §7 — the post-fix fsync measurement the brief said was owed, taken on vigil. The
disk-pressure confound is EXCLUDED: zero `storage: LOW` lines in a six-week journal, 148 GB free. Latency
barely moved (median 326→376 ms, max FELL 1702→1334); incidence moved 12.1× per file (1.7 %→20.5 %) while
file volume fell 1003→803, so it is not a volume artifact. Reads as the fix's quantified cost side —
barriers queue in the worker instead of blocking the loop, so more cross 250 ms and none stalls capture.
Three limits stated: the transition is 09-10, five days before #2382 merged; there is no baseline before
09-05 (instrument onset, not a fast disk); "files" is the night directory, not fsync'd writers.
