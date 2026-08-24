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

51 tests, 100% statement and branch on the new module and on both extended ones. Ten crash-point
controls, and **8 planted defects re-applied to confirm the controls bite** — including layer-order,
size-equality-as-completeness, and in-flight-states-treated-as-finished. The two fsyncs are recorded
as measured-unverifiable: removing either survives the suite, because durability is not observable
from a unit test, and that is stated rather than covered over.

The diff-scoped mutation gate then found **26 survivors my own planted defects had missed**, and the
difference is the point: I chose 17 defects and killed all 17, but I chose them from what I already
believed. The mechanical operators chose differently. The pattern across them was one mistake repeated
— every *decision* was asserted and none of its *payload* was: reason strings, the offset handed to
the transport, bytes written on the failure paths, the attempt number. Those are contract here (this
module carries a reason precisely so the ledger can record the sentence the policy used), so a suite
that never reads one is not testing the contract it claims to.

Two were genuine logic gaps invisible to 100% coverage: `attempt > max_attempts` mutated to `>=`
survived because the bound test sat at 3-of-3, which skips under both, and `continue` → `break`
survived in two loops because the skipped entries came LAST, where both keywords produce identical
output. Ordering was the whole test.

Five survive as genuinely unkillable and are recorded in `tools/mutate-equivalence.json` with the
probe that was actually run, never a claim: `fh.truncate(None)` truncates at the current position,
which the preceding `seek` has already set to the offset (52 cases, 0 differing); and four
argument-drops at a call site passing a literal `0`, where `resume_strategy` returns before reading
them (12 combinations, 1 distinct result). ⚠️ The same operators on the OTHER `resume_strategy` call
ARE killable, and are killed — the equivalence is call-site-scoped, and the entry says so.
