<!--
  OXYII-G1-TRANSACTIONAL-SYNC-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-23 · **Created:** 2026-08-23 · **Follows:** `OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md` (G1, spec §8–§19) · **Builds on:** `oxy_inventory.py` (G2, #1681), `oxy_restart.py` (G3, #1689) · **Affects:** `capture-host/pull_session.py`, a new transfer module

# G1 — the download becomes a transaction, and every crash point gets a planted control

G2 gave the vocabulary, G3 gave the restart plan. G1 is the part that actually moves bytes, and the
only part where a crash can lose data. **The design is fixed by measurements, not preference** — the
numbers below are cited at every point they constrain a choice.

---

## 1 · The measured envelope this is designed against

| quantity | value | source | what it constrains |
|---|---|---|---|
| handoff + drain, p90 | **69.2 s** | G5, 819 pause/resume lines | the link-occupancy budget |
| same, max | **104.7 s** | G5 | the timeout floor — a 60 s timeout would abort 5 of 409 real pulls |
| drain bytes / session | median **78 KB**, max ~108 KB | G5, 39 `.dat` | why bytes are not the cost |
| pull cadence | **hourly** (3600 s), `drop_not_worn_sec=180` as debounce | 409-pull journal | a lost transfer waits up to an hour for a retry |

**The single most design-relevant fact: the cost is link ACQUISITION, not bytes.** A median 78 KB
moved inside a p90 69 s window means throughput is irrelevant and connection count is everything.
Every retry is a fresh acquisition, so the retry policy is the performance policy.

⚠️ **The envelope is `_OXYII_PAUSE` set→clear — CAPTURE PAUSED, not LINK HELD.** Those diverge exactly
when a pull retries, and G1's budget is about the second. Quoting 69.2 s as "link time" would
overstate what is actually reserved. The fine split needs finer-than-INFO logging and is not
available yet.

## 2 · Four functions, because the crash points are between them

Spec §14/§15 asks for discovery → selection → download → verify → commit as **separate** functions.
The reason is not tidiness: **every boundary between them is a crash point with a different correct
recovery**, and a monolithic `_pull_once` cannot express that difference.

```
list_sessions()   → what the ring says it has          (read-only, cheap, no commitment)
select()          → what we will fetch, and why        (PURE — consumes the G2 ledger)
download()        → bytes → `.part`                    (the only long-running step)
verify()          → `.part` → validated or rejected    (no writes outside the .part)
commit()          → atomic rename into the night tree  (the only irreversible step)
```

`select()` is pure and therefore testable without a device: it is `oxy_restart.plan()`'s sibling for
the online case, and it consumes the same ledger. **The selection policy** (spec §15) —
NEW → download · PARTIAL → per-protocol resume-or-restart · VERIFIED → skip · FAILED → bounded retry
— lives entirely inside it, so the retry-vs-restart decision is a unit test, not a field observation.

## 3 · The ten crash points ARE the test list

Spec §9/§11 names them; they become planted controls, one per boundary. The invariant each protects:

| # | crash point | must hold after restart |
|---|---|---|
| 1 | before any request | nothing on disk, nothing in the ledger |
| 2 | after FILE_LIST, before download | ledger has DISCOVERED, no bytes |
| 3 | mid-download | `.part` exists, ledger says DOWNLOADING/PARTIAL, **never adopted** |
| 4 | after last byte, before verify | `.part` complete-looking — still not adopted |
| 5 | during verify | no writes outside the `.part` |
| 6 | after verify, before rename | VERIFIED but not COMMITTED → G3's `commit` action |
| 7 | mid-rename | either old or new name exists, never neither |
| 8 | after rename, before ledger write | bytes committed, ledger stale → reconcile must notice |
| 9 | after ledger write | COMMITTED and consistent — the only clean stop |
| 10 | during ledger append | torn final line → `load_rows` skips it, history survives |

⚠️ **#8 is the one that needs saying out loud.** Rename-then-record means a window where disk is
ahead of the ledger, and G3 currently classifies bytes-with-no-row as `repull` — correct and safe,
but it re-fetches a recording we already have. Recording-then-rename inverts the window into
ledger-ahead-of-disk, which G3 classifies as `missing` → also `repull`. **Both orders are safe and
both cost one redundant fetch; neither can lose data.** Pick rename-first because a committed file
with a stale ledger is recoverable by inspection, whereas a ledger claiming a file that does not
exist is not.

## 4 · Validation depth — SHA proves identity, never validity

Spec §18/§19. Three layers, cheapest first, and the ordering is the contract:

1. **expected vs received size** — the ring reports size at FILE_START; a short file stops here.
2. **finalisation** — `oxyii.parse_oxy_trailer` / the `48 12 5a da` sub-magic. G2's rule, unchanged:
   *size equality is not completeness*, because the ring reports full size **before** the trailer
   flushes.
3. **semantic** — record-boundary walk: 10-byte header, 3-byte records, `0xFF 0xFF` trailer.

🔴 **Layer 3 is where the honest gap is, and it must not be hand-waved.** Python-side parsing today is
`oxyii.py`'s trailer plus partial structure; **full record-boundary validation may need a subset port
from the JS parser**. That is a real work item with a real cost, not a line of design prose. Until it
exists, G1 validates at layers 1–2 and the ledger must say so — a `VERIFIED` that means
"size+finalised" is a different claim from one that means "parses", and conflating them is exactly
the false-completion §31 forbids.

**SHA-256 is recorded for identity and change-detection only.** It cannot detect a file that is
internally malformed but stably so, and no amount of hashing turns "these are the bytes we received"
into "these bytes are a valid recording".

## 5 · The recovery choice sits behind ONE function

Spec §17. Whether the ring **re-serves from the start** or **resumes mid-file** after a drop is
**not yet measured** — the direct test needs a physical ring wake and is scheduled. Until then:

```python
def resume_strategy(partial_bytes: int, reported_size: int) -> Resume: ...
```

Both hypotheses are carried behind that one call: the AS11 **re-serve-from-start** analogy (the
in-house precedent) and a **resume** variant. Every caller is written against the returned decision,
so the drop test flips a single function body rather than a policy scattered through the transfer
loop. **If the test never happens, re-serve-from-start is the safe default** — it costs one extra
acquisition (~69 s p90) and cannot produce a spliced file, whereas a wrong resume offset produces a
file that is the right size and silently corrupt.

## 6 · Failure taxonomy — reuse, do not reinvent

`cpap_acq.FailureClass` is the in-house template and already encodes the property that matters:
`recoverable` as a **field**, not an inference. Its split — TRANSPORT/TIMEOUT/FRAME_CORRUPTION/
STREAM_STALL/DEVICE_UNAVAILABLE recoverable; AUTH/PROTOCOL/STORAGE/VALIDATION/FATAL not — transfers
directly. The one addition G1 needs is **`TRUNCATED_TRANSFER`** (recoverable): the ring stopped
sending mid-file, which is neither a timeout nor corruption and has its own retry policy.

⚠️ **A bounded retry needs a bound that is not a guess.** With an hourly poller, a recording that
fails three times is unavailable for three hours; with retries inside one window, three attempts cost
~3.5 min of link at p90. Those are different budgets and the bound belongs to the second.

## 7 · Done when

- [x] The five functions exist separately, with `select()` pure and unit-tested without a device.
- [x] All ten crash points have a planted control; each verified by re-application, not assertion.
- [x] Validation states which LAYER a `VERIFIED` row was verified at — no single flag spanning
      "size+finalised" and "parses".
- [x] The semantic-validation gap is either closed by a parser port or recorded as an open item with
      its cost — never implied to exist.
- [x] `resume_strategy` is the only place the re-serve/resume choice appears, provable by grep.
- [x] The retry bound is stated in link-seconds against the p90, not as a bare count.

---

## 8 · What execution actually changed about the design

Three of these were found by taking §7's "verified by re-application, not assertion" literally. They
are recorded because in each case the design as written *read* correct and the control did not bite.

**The `.part` discipline was a CONVENTION, and conventions are not invariants.** §3's crash points 3
and 4 require that a kill mid-transfer leaves something no reader can adopt. As designed, that held
only because the caller passed a `.part` path — so the controls pinned the test's own wiring, not the
module, and a single wrong argument would have written a half file under a real recording's name.
`download()` now REFUSES a target that does not end in `.part`. That is the only version of the
invariant the module can hold by itself.

**`select()` built a second `Resume` behind §5's back.** The new-recording branch constructed
`Resume(RESTART, 0, "new")` inline — true today, and wrong the first time the policy changes.
⚠️ An AST check for `return Resume(` **missed it**, because the construction sat inside a
`Selection(...)` argument list; the plain grep §7 asks for is what caught it. The criterion said
"provable by grep" for a reason, and the cleverer check was the one that failed. All four
construction sites are now inside `resume_strategy`.

**The crash-9 control only ever tested the consistent case.** "COMMITTED and consistent" has two
halves, and the test asserted one: a committed recording whose bytes CHANGED underneath us passed it.
Planting "a size mismatch under VERIFIED is ignored" survived the whole suite. The control now pins
`size_drift`, and the same defect re-applied is killed.

**The resume path shipped a splice bug, found by reading it against §5's own warning.** `r+b` seeks
but does not truncate, so resuming over a *longer* stale `.part` leaves the old tail attached:
measured, offset 2 over `b"ABXYZW"` writing `b"cd"` produced **`b"ABcdZW"`** while `bytes_written`
reported 4 and the file was 6. That is "the right size and silently corrupt" — the exact phrase §5
uses to justify re-serve-from-start — reproduced inside the module that quotes it. It was LATENT,
because `allow_resume` defaults False, and it would have activated on the day the drop test flipped
that flag: the one moment nobody would be looking for a new corruption path. Fixed with an explicit
`truncate`, with a control that dies when the truncate is removed.

**Two invariants are MEASURED-unverifiable, and are not claimed as covered.** Removing either fsync —
the file's before verify, the directory's after rename — leaves all 42 tests passing, because
durability is not observable from a unit test. That was confirmed by re-application rather than
assumed, and it is stated here instead of being papered over by a coverage percentage.

⚠️ **"Unverifiable" here means AT THE UNIT LAYER — it is not a permanent unknown, and filing it as
one would be its own quiet false completion.** fsync removal IS observable to fault injection: a
crash-at-syscall harness can kill between the write and the rename and check what survived. So this
is a named OPEN ITEM for the OxyII chaos lane (the P7 analog), not a property that cannot be tested.
The unit suite cannot see it; that is a statement about the instrument, not about the invariant.

**Still open, and deliberately not implied to exist:** semantic (layer-3) validation, which needs a
subset port of the JS record parser; and the physical drop test that decides `resume_strategy`'s one
flag. Wiring into `pull_session.py` lands separately, after review of this module.
