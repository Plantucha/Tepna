---
bump: minor
type: added
brief: OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md
---

`capture-host/oxy_transfer.py` — the O2Ring download becomes a transaction (charter G1), standalone.
Five separate functions, because every boundary between them is a crash point with a *different*
correct recovery: `list_sessions` (read-only) → `select` (PURE) → `download` (`.part` only) →
`verify` (reads only) → `commit` (the one irreversible step).

`select()` needs no device, so the retry-vs-restart policy is a unit test rather than a field
observation. It branches on `recoverable` as a FIELD of the failure class, never an inference from a
message — a permanent validation failure is not made retryable by having attempts left. An *unknown*
label is retried, deliberately: retrying a permanent failure wastes one bounded acquisition, while
declining a recoverable one loses the recording, and the default belongs to the cheaper error.

The retry bound is small because the cost is link ACQUISITION, not bytes — a median 78 KB inside a
p90 69.2 s handoff (G5, 409 pulls) means every retry is a fresh ~69 s acquisition, so three attempts
inside one window cost ~3.5 min of link. That is the budget the bound is set against.

`resume_strategy()` is the single place the re-serve/resume choice appears, so the scheduled physical
drop test flips one function body. It defaults to re-serve-from-start: the behaviour is UNMEASURED,
and a wrong resume offset yields a file that is the right size and silently corrupt.

🔴 Validation is layers 1–2 (size, then Format-A finalisation) and the row SAYS SO —
`VALIDATION_DEPTH = "size+finalised"`. Layer 3, the record-boundary walk, needs a subset port of the
JS parser and is an OPEN ITEM, not an implied capability: a `VERIFIED` meaning "size+finalised" is a
different claim from one meaning "parses". Size equality is not completeness — the ring reports full
size *before* the trailer flushes.

`oxy_inventory` gains DOWNLOADING/VERIFYING/FAILED and a `failure` field; `reconcile` already treats
anything outside VERIFIED/COMMITTED as `repull`, so the new states fail closed with no change there.
DOWNLOADING and VERIFYING are what a crash LEAVES BEHIND, never evidence of a live transfer.
`cpap_acq.FailureClass` gains `TRUNCATED_TRANSFER` (recoverable) — the ring stopping mid-file is
neither a timeout nor corruption.

41 tests, 100% statement and branch on the new module and on both extended ones. Ten crash-point
controls, and **8 planted defects re-applied to confirm the controls bite** — including layer-order,
size-equality-as-completeness, and in-flight-states-treated-as-finished. The two fsyncs are recorded
as measured-unverifiable: removing either survives the suite, because durability is not observable
from a unit test, and that is stated rather than covered over.
