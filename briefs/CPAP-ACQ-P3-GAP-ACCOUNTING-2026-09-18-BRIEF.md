<!-- CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md — Tepna Copyright 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-09-18

# CPAP-ACQ P3 — gap accounting, backpressure, continuity and acquisition ownership

**Parent:** [`CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md`](CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md)
(the living charter for the P1–P5 programme). That charter names this brief as its **Next step** and has
carried *"P3 has no brief at all"* in its status header since 2026-09-02. This is that brief.

---

## §0 · The charter's picture of P3 is STALE — measured 2026-09-18, before writing a line of plan

The charter's §8 records INV7 as **"MODULE BUILT (P3, held)"**, and its §3 line reads *"P3 · Gap accounting
+ bounded queue (G4, G5)"* as if both were still to build. Neither is now true, and they are not untrue in
the same direction. A per-symbol census of `capture-host/` says:

| symbol in `cpap_ingest.py` | consumers OUTSIDE the module and its own test | state |
|---|---|---|
| `GapCounters` | `cpap_stream.py` (2) · `acq_evidence_cpap.py` (4) · `as11_pull.py` (via `counters.note_frame`) | **LIVE** |
| `FrameKind` | `as11_pull.py` (4, aliased `_FrameKind`) | **LIVE** |
| `classify_frame` | **none** | **DEAD TWIN** (§2 W1) |
| `BoundedIngestQueue` | **none** | **UNWIRED** (§2 W2) |

So **G4 is substantially closed and G5 is untouched**, where the charter treats them as one held unit. The
accounting runs at the frame boundary in `as11_pull.py:157/162/168` (`MALFORMED` for a non-`StreamData`
frame, `FOREIGN` for a foreign `streamId`, `OK` with `n_samples` otherwise), the counters are created by
`stream_to_bus` at `cpap_stream.py:157`, summarised and logged at `:210` — at `warning` level when
`total_lost or sink_errors or foreign_stream`, `info` otherwise — and the summary is consumed as forensic
CATEGORIES by `acq_evidence_cpap.py`. **INV7 is met for the frame classes that reach `note_frame`** — an
`OK`, `FOREIGN` or `MALFORMED` frame is represented explicitly rather than silently `continue`d. It is
**not** met for transport loss, which is the class G4's own text leads with (*"A dropped BLE notification
... a stall — none are counted"*). §1 W2 measures why.

⚠️ **Do not read that as "G4 done, close it".** What is live is the accounting; what is dead is the
module's own classifier, and the two implement the same decision (§2 W1). The charter's "held" label
predates the wiring and was never re-measured — the stale-capability error `§📌` keeps finding. **This
brief re-stamps the charter's §8 rows in the same session as this triage**, per `CLAUDE.md §👥.0`.

**Precondition discharged.** Both the charter and `CHANGELOG.md` hold the wiring *"as one announced P1+P3
touch after the feature-arm controller-race fix lands"*. The wiring above **is** that touch, already
landed; nothing in this brief waits on the controller race.

---

## §1 · What is genuinely open

Four items, each with its own evidence. Two descend from the charter's gap list (G4 remainder, G5) and two
are invariants the charter's §8 marks as having **no artifact at all**.

### W1 · `classify_frame` is a dead twin of logic that runs live — single-source it or delete it

`cpap_ingest.py:36 classify_frame(msg, expected_stream_id) -> FrameKind` decides exactly what
`as11_pull.py:153–168` decides inline, and **nothing calls it**. Two implementations of one decision, of
which only the dead one is tested against its own spec (`tests/test_cpap_ingest.py`, 9 `assert classify_frame` lines) while
the live one is tested only through `tests/test_as11_pull.py`. That is a second source of truth whose
copies no test can be made to disagree, because no test exercises both against the same input.

**This is a decision, not a task.** Either:
- **(a) wire it** — `as11_pull.py` calls `classify_frame(msg, stream_id)` and switches on the result, so the
  tested spec becomes the executed one; or
- **(b) delete it** — the live inline form is the only classifier, and its 10 assertions move to
  `test_as11_pull.py` where they test the code that runs.

(a) is preferred: the frame-boundary decision is the thing a second acquisition path (BLE spool, P4) will
need, and a function is reusable where an inline `continue` is not. **(b) is acceptable and must not be
ruled out** — an unused function kept "for the future path" is how the twin arose. What is NOT acceptable
is keeping both. Whichever is chosen, the executing session states which and why in this brief.

### W2 · G5 — three counters have no writer, so TWO published aggregates are structurally zero

`cpap_ingest.py:9`'s own header comment — *"Today `stream_to_bus` awaits the sink inline in the read
loop"* — is **still an accurate description of today**, measured 2026-09-18. There is no bounded queue
between the frame reader and the sink, no queue-depth telemetry, and no backpressure.

That absence is not confined to the queue. A writer census of all eight `GapCounters` fields:

| field | its only writer | live? |
|---|---|---|
| `frames_ok` · `samples_ok` | `note_frame(OK)` ← `as11_pull.py:168` | **live** |
| `foreign_stream` | `note_frame(FOREIGN)` ← `as11_pull.py:162` | **live** |
| `malformed` | `note_frame(else)` ← `as11_pull.py:157` | **live** |
| `sink_errors` | `cpap_stream.py:192` | **live** |
| `overflow` | `BoundedIngestQueue` (`cpap_ingest.py:138`) — **unwired** | **dead** |
| `post_drop_tail` | **nothing** | **dead** |
| `stalls` | **nothing** | **dead** |

Three dead fields is not three cosmetic gaps, because two aggregates are built from them:

- **`total_lost` ≡ `malformed`.** It is `overflow + malformed + post_drop_tail` (`cpap_ingest.py:91`),
  documented as *"the honest 'how much did we miss' number"*. Two of its three terms cannot move, so it
  reports decode loss only and can never report transport loss — while reading as though it covers both.
- **`transport_gaps` is structurally always 0.** `acq_evidence_cpap.py:97` computes it as
  `overflow + post_drop_tail` — **both dead** — and publishes it on the acquisition evidence surface as a
  forensic category *"so a reader can tell WHY it is incomplete"*. A reader sees `0` and concludes no
  transport loss occurred. The truth is that transport loss is **not measured**.

⚠️ **This is §∅ at the evidence layer: an absence wearing the shape of a measurement.** It is worse than
a missing field, because a missing field is visible and a zero is not. The `stalls` field is the same
shape with a spec citation attached (*"spec §30 STREAM_STALL"*) and no detector behind it.

**Done means:** every `GapCounters` field either has a live writer or is gone; a bounded queue with a
declared capacity and observable depth sits between the frame reader and the sink; a test drives a real
overflow through `stream_to_bus` and asserts the count lands in the SAME `GapCounters` the classifier
writes (`tests/test_cpap_ingest.py:124` asserts that property of the pair in isolation — this extends it
to the wired path); and no published aggregate sums a term that nothing can increment.

⚠️ **A field that is deliberately not-yet-measured must read as unmeasured, not as zero** — §∅. If
`stalls` or `post_drop_tail` is to stay pending a later phase, it is `None`, not `0`, and the aggregates
that consume it say so. Do not close this item by deleting the fields and leaving the aggregates' names
promising a coverage they no longer have.

### W3 · INV8 — recovery does not imply continuity, and nothing can say so

There is **no `continuity_status` field anywhere in `capture-host/`** (measured: zero occurrences outside
comments). The anchor is `cpap_supervisor.py:225`, whose comment already states the exact condition the
field would carry: *"in-progress Standby run: we can no longer vouch for its continuity."* The code knows;
it has no way to say it, so a consumer downstream of a recovery cannot distinguish a stream that was
continuous from one that was resumed.

**Done means:** a recovered acquisition carries an explicit continuity state, and the state distinguishes
*continuous* from *resumed-but-unverified* from *verified-continuous*. Per §∅, the unverified case is its
own value — never the continuous one by default, and never a bare boolean whose `false` doubles as "not
checked".

### W4 · INV11 — one acquisition owner at a time, with no owner and no lock

Zero occurrences of any owner or lock construct (`acquisition_owner`, `single_owner`, `_owner_lock`) in
`capture-host/`. The charter's §8 marks INV11 *pending wiring*; there is nothing to wire. Two acquisitions
of one device can start concurrently today, and the failure would present as interleaved frames rather
than as an error.

**Done means:** an acquisition acquires an explicit owner token for a device before it may stream, a
second attempt is REFUSED with a named reason rather than queued or silently coexisting, and the refusal
is a test, not a comment.

---

## §2 · Sequencing, and what each item costs

W1 and W2 are one work-unit — they touch the same two files and the same test module, and W1(a) makes the
queue's frame path a single call. W3 and W4 are independent of both and of each other.

| item | files | independent? | note |
|---|---|---|---|
| W1 + W2 | `cpap_ingest.py` · `as11_pull.py` · `cpap_stream.py` · `acq_evidence_cpap.py` · 3 test modules | together | one PR; W2 is the largest of the four |
| W3 | `cpap_supervisor.py` + wherever the recovery result is published | yes | needs the §∅ three-state decision first |
| W4 | new owner/lock surface + `cpap_stream.py` entry | yes | smallest of the four |

⚠️ **`capture-host/` has its own gate and it is `./check.sh`, not `npm run check`** — ruff · shellcheck ·
`pytest -q --cov --cov-branch --cov-fail-under=100`. A `pytest` line without `--cov` does not evaluate the
coverage floor; it does not report it as failing, it does not report it at all. Every item here lands
under 100 % branch coverage because every other module in this programme did.

---

## §3 · Done when

- `classify_frame` has **either** a live caller **or** no definition — stated, with the reason, in this
  brief by the session that decides (W1).
- A frame that arrives while the sink is behind is **counted**, a test proves the count arrives through
  the wired path rather than through the module in isolation, and **no published aggregate sums a term
  that nothing can increment** (W2).
- A consumer of a recovered acquisition can distinguish "continuity verified" from "not verified" without
  reading a log line (W3).
- A second acquisition of a device already being acquired is refused with a named reason, under test (W4).
- `./check.sh` green — ruff, shellcheck, and `pytest --cov --cov-branch --cov-fail-under=100`.
- The charter's §8 rows for INV7/INV8/INV11 and its status header reflect the state this brief leaves
  behind (this brief's own §0 re-stamp covers INV7 only).

## §4 · Do NOT

- **Do not close G4 on the strength of §0.** The accounting being live is not the twin being resolved.
- **Do not treat `transport_gaps: 0`, `total_lost` or `overflow: 0` as evidence of no transport loss**
  until W2 lands. All three are unmeasured, and `transport_gaps` cannot be anything but 0 today.
- **Do not add a second frame classifier** for the BLE spool path in P4. If that path needs one, it needs
  W1(a) first — which is the argument for (a) over (b).
- **Do not make continuity a boolean.** §∅: the unverified state is its own value.
- **Do not widen this brief to the BLE spool path (G1/G6).** That is P4, it is one hardware capture from
  done, and folding it in here would block four small items behind a hardware dependency.
