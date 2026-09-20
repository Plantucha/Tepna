<!-- CPAP-ACQ-P3-GAP-ACCOUNTING-2026-09-18-BRIEF.md — Tepna Copyright 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-09-20 (W1 #2626 · W2 #2627 · W3 #2634 · W4 landed 2026-09-18, all MERGED — verified against `gh pr view` 2026-09-20; no open items) · **Created:** 2026-09-18

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

#### W2(a) — DONE 2026-09-18 (#2627). W2(b) — the queue — SPLIT OUT, and gated on a measurement

**W2(a), the counter honesty, is done.** `stalls` and `post_drop_tail` are `None`; `total_lost` sums only
terms that can move and `lost_coverage` names what it does not cover; `transport_gaps` reports UNKNOWN
rather than a structural 0. The sharpest defect was not in the list above: **`acq_evidence_cpap._counter`
already carried the rule in its docstring — *"absent accounting is UNKNOWN, never a fabricated 0 — 0 means
'counted, and none happened'"* — and defeated it in the body with `int(summary.get(k) or 0)`**, one line
below. Not a missing rule; a rule contradicted by its own implementation. Worth carrying as a search
shape: a module that states the principle is not thereby obeying it.

⚠️ **THIS ITEM'S ORIGINAL DONE-WHEN NAMED A CAPABILITY THE ARCHITECTURE DOES NOT ADMIT, and that is
recorded rather than quietly dropped.** It required *"a test drives a real overflow through
`stream_to_bus`"*. `stream_to_bus` is a single sequential `async for` — **producer and consumer are the
same coroutine** — so a bounded queue between them can never hold more than one item, `overflow` can never
fire, and such a test cannot be written honestly. The only way to pass it would be to force the condition
from inside, which is the isolated property `tests/test_cpap_ingest.py:124` already asserts. Wiring the
queue into the loop as it stands would be decorative — the half-wired shape this brief exists to remove.

⚠️ **STATE CHANGE 2026-09-18: W2(b) is now gated on ONE NIGHT'S DATA, not on an open question.** The
sink write is timed (`sink_max_ms` / `sink_slow`, `SINK_SLOW_MS` anchored to `_LOOP_LAG_WARN_MS`),
so the next night's gap-accounting line says whether a sink ever held the loop long enough to
produce one of the measured stalls. That is the difference between an item waiting on a DECISION
and one waiting on a CLOCK — and it resolves on the ordinary `tepna-update.timer` pull plus a
streaming night, which needs nothing from us.

**W2(b) is therefore the producer/consumer split, and it is GATED ON AN EMPIRICAL QUESTION that must be
answered BEFORE the rewrite, not after:** *does a slow sink ever stall the read loop on the real rails,
and if so, how often?*

The evidence so far says the case is weaker than §17 assumed when it was written. Measured on vigil
2026-09-18 (#2622): after #2382 moved the fsync barrier off the loop, **slow fsyncs no longer stall
capture** — the latency distribution barely moved (median 326 → 376 ms, max FELL 1702 → 1334) while the
share of files seeing a slow barrier went 1.7 % → 20.5 %. So the dominant source of sink slowness on this
box already does not block the read loop, and backpressure would be introduced for a stall shape nobody
has demonstrated. Today's backpressure lives in bleak's own notification buffer, not in ours.

A producer/consumer rewrite of the **P0 capture path**, with cancellation and shutdown-ordering
consequences, is not authorised on a hypothesis. Measure first.

#### W2(b)'s gate — ANSWERED 2026-09-18 (Heron). The loop DOES stall; the cause is NOT attributable

The question was *"does a slow sink ever stall the read loop on the real rails, and if so how often?"*, with
the instruction to separate two negatives: the record could show a stall and shows none, versus the record
could not show one either way. **The true answer is a third reading: the record can see the PHENOMENON but
not the CAUSE, and its view of the phenomenon is censored in a known way.**

**There is already an instrument.** `capture.py`'s loop-lag task sleeps and measures how late it woke —
*"that lateness IS the time some other callback held the loop"*. So this needed no new instrumentation to
answer, only reading.

**The loop does stall, by seconds.** Over the 14 days to 2026-09-18 on vigil, 151 logged stalls:
min 1002 ms, **median 1502 ms**, p90 2683 ms, **max 4822 ms**, at 10–35 per day.

**And they cluster hard on streaming.** Pairing `CPAP auto-start: stream started` with the closing
`CPAP stream gap accounting` gives 15 windows totalling **89.6 h** inside a 309.2 h span:

| | stalls | rate |
|---|---|---|
| inside a CPAP stream | **121** | **1.35 / h** |
| outside | 30 | 0.14 / h |

Roughly **10×**. Wearables stream in both periods (858 `connected` events), so this is not simply "at
night".

⚠️ **THREE LIMITS, and the first two make the 10× a LOWER BOUND rather than an estimate.**
1. `_LOOP_LAG_WARN_MS = 1000` — stalls between the 100 ms *counting* threshold and 1 s are **never
   logged**, so the journal cannot see them at all.
2. `_LOOP_LAG_WARN_EVERY_S = 300` — logging is throttled to one line per five minutes, so a burst
   collapses to one entry. Throttling bites hardest exactly when stalls are most frequent, which
   censors the busy periods more than the quiet ones.
3. **The detector measures the EVENT LOOP, which every task shares. It cannot say what held it.** A
   stall during a CPAP stream may be the EDF write, the bus push, a wearable writer, or something else
   entirely.

**So: the premise of a bounded queue is real — a consumer CAN lag by seconds — but "a slow sink" is not
established as the cause and cannot be from this record.** Closing W2(b) as unnecessary would be wrong;
building the producer/consumer split on this evidence would also be wrong, because it would be built for
a cause that has not been identified.

**The next step is attribution, not the rewrite** — the loop-lag task would have to name the holder
(which callback ran long), which is a code change to the P0 path and is its own unit with its own risk.
Not folded in here, per the instruction accompanying this gate.

⚠️ **For whoever takes W2(b):** wiring `BoundedIngestQueue` will trip `find_unwired`'s spent-suppression
scan, because its `ALLOW_FUNCS` entry is written as pending that wiring. That is the gate working, not a
regression — the same thing happened to W1's `classify_frame` (#2626). Noted here so it is not
rediscovered.

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

**W3 · DONE 2026-09-18 (Wren) — `cpap_continuity.py`, wired by `_build_cpap_controller`, verdict on three
surfaces.** Two departures from the text above, both deliberate: (1) **FOUR states, not three** — `verified-gap`
joins the named three, because the verification compares device `startTime` across the drop and can therefore
MEASURE a gap; folding a measured gap into `resumed-unverified` asserts ignorance where there is knowledge, the
mirror of the fabrication §∅ forbids (accepted by the coordinator in review). (2) **Not on `AcqLifecycle`** — it
is instantiated nowhere outside its own module, so a field there would be set by no real recovery; the tracker
lives on `LiveStreamController`, which is where a drop actually ends a session and where `startTime` flows.
Measured while building: the raw-record sink and the acq-evidence envelope are BOTH OFF on the production box
(`raw_record_dir` unset ⇒ `raw_record_factory` None ⇒ `acq_evidence_out` None; zero `cpap-raw-*.jsonl`), so
INV9's centrepiece is not in effect there and the verdict is ALSO published on the controller's `op("start")`
result and the gap-accounting log line. That finding is the owner's (config), routed by Kestrel.

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
