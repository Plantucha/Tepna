<!--
  OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-27 · **Created:** 2026-08-27 · **Executes:** `OPERATIONAL-MATURITY-ROADMAP-2026-08-27-BRIEF.md` §1 (the audit) and §15 (the P0–P4 ranking that gates everything after it) · **Affects:** nothing yet — this brief is measurement only

# §1 audit — ALL EIGHT priorities measured against HEAD

## 0 · Currency, stated before the first number

Measured at **`90fea439`**, `HEAD..origin/main` = **0 commits**, `git status --porcelain` = **0 files**.

🔴 **This line is not ceremony, and it is the audit's mandatory opening step.** The same inventory run
in the shared root — **18 commits behind, and missing `cpap_spool_caller.py` entirely** — returned
**16** not-wired entries against the current tree's **14**. An audit is *entirely* measurement, so a
stale tree does not yield a slightly-wrong audit; it yields a confident classification of a codebase
that no longer exists. Verify both numbers, in the tree you measure in, before the first result.

## 1 · What exists — the answer is "a great deal"

All nine subsystem families §1 names are present, **46 modules / 29,917 LOC**: O2Ring (6) · CPAP/AS11
(14) · H10+Verity (3) · clock (5) · adapters (4) · evidence (3) · storage (3) · health (4) ·
orchestration (4). **Nothing in §1's list is absent at module level.** This is why the charter's own
§1 warns against duplicating existing functionality, and why this audit is a CONSOLIDATION.

**Prior art that already carries whole columns** — do not re-derive:
- `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14` + its `-FOLLOWUPS-2026-08-15` → the **IMPLEMENTED BUT
  NOT WIRED** column.
- `FINISHED-WORK-IMPROVEMENTS-2026-08-20` → carries a *"definitely NOT recommended; each has a record,
  do not re-open without new evidence"* list, which is the **NOT NEEDED** column already populated.
- `tools/find_unwired.py --check` → the live not-wired inventory, **14 entries**, each with a written
  justification. Machine-checked, so it cannot go stale silently.

## 2 · The classification (§1's five states)

| roadmap priority | verdict | evidence |
|---|---|---|
| **P#1 Autonomous recovery** | **ALREADY**, with gaps un-probed | `keep_running` supervises all 14 pollers · `_RECOVER` adapter watchdog + `_set_active_adapter` failover · `oxy_restart` process-restart recovery · `.part` partial-transfer handling in 5 modules · `oxy_inventory.classify` corrupt-artifact verdict · `_connect_timeout` bounding · `MAX_ATTEMPTS` |
| **P#2 Resource manager** | **ALREADY** — as broadcast guards, see §3 | `offline_lock.slot()` global exclusive pull slot · `_OXYII_PAUSE` · `blocking_devices` · `_RECOVER` · `is_capturing` |
| **P#3 Opportunistic acquisition** | **ALREADY — completed 2026-08-27** | `probe_justified` (presence · not-recording · rate limit) · `pull_deadline` budget · `flush_gate` finalisation · `oxy_inventory.reconcile` already-harvested |
| **P#4 Unified orchestration** | **NOT NEEDED on current evidence** — §3 | no `Manager`/`Orchestrator`/`Semaphore`/`acquire()` exists, and the measurement says one is not required |
| **P#5 Stable identity** | **ALREADY** | `resolve_hci` MAC→`hciN` resolved at every connect · `missing_identity` · `is_expected_ring` address-only |

| **P#6 Long-run health** | **ALREADY** — 10 of 11 signals; the 11th is NOT NEEDED, §3a | `last_sample` · `link_epoch` · `last_error` · `state="waiting"` · `data_stale_sec` · `FailureClass` · `clock_uncorrectable` · `OfflineBusy` · `uptime` · `last_run` |
| **P#7 Self-healing bounds** | **ALREADY** | exponential `backoff` (grows; deliberately NOT reset on a non-viable session, or a flapping link would never escalate) · `MAX_ATTEMPTS` · `FailureClass` terminal states · `prune` for stale temp state |
| **P#8 Acq/analysis boundary** | **ALREADY, and actively enforced** | §3b |

## 2a · Two "gaps" I found and then withdrew — vocabulary, not absence

Recorded because the withdrawal is the useful part: **a grep finds only your own vocabulary.**

- **"cooldown is MISSING"** — WRONG. It exists as **`backoff`** (`capture.py:1943`), exponential, and
  with a scar attached: it is deliberately *not* reset after a bare connect, because "a bare connect is
  not a viable session" and resetting there meant a flapping link's backoff could never grow.
- **"queue_depth is MISSING"** — WRONG framing. It is **NOT NEEDED**: the only `asyncio.Queue()`s are a
  device control queue and a webmon queue. There is no acquisition backlog to have a depth, because
  §3's architecture has no scheduler. `queue_depth` is a signal belonging to a queue-based design
  Tepna does not have — reporting it would fabricate a number about a structure that does not exist.

## 3a · §7's killer requirement is already satisfied, by an explicit design decision

*"A system that has technically been running for 72 hours but has not actually acquired anything must
be visibly unhealthy."*

Handled, and the source says so at `capture.py:4832`: `data_stale_sec` (120 s) is *"far shorter than
`offline_sec`, so a link that streams nothing is caught by the SAME 5-minute alarm a disconnected one
is."* **Connected-but-silent and disconnected raise the same alarm by construction** — which is
exactly the failure §7 names, already closed.

## 3b · §9's boundary is enforced at each crossing, not merely intended

`acq_evidence.py` publishes **`ganglior.acquisition-evidence`** — a schema *separate* from
`ganglior.node-export`, which is §9's "keep acquisition evidence separate from event evidence"
satisfied structurally rather than by convention.

And at every point where telemetry could leak into physiology, the source says so in-line —
`writers.py` ×5 and `cpap_ingest.py`: *"TELEMETRY, not physiology: never a `ganglior.node-export`
metric, never an evidence badge."* ⚠️ I first grepped for `ganglior` in `capture-host/`, got three
files, and pre-labelled the result "(empty = separate by construction)" before reading it. The hits
were the prohibition itself. **Read the output before labelling it.**

## 3 · The headline: coordination is BROADCAST, not an orchestrator — and that is adequate

§5 asks Tepna to *evaluate whether* an orchestrator is needed. Measured: **14 background pollers, each
independently supervised by `keep_running`, and ZERO priority arbitration** — no manager class, no
semaphore, no `acquire()`.

⚠️ **An earlier draft of this section framed that as "6 mechanisms covering 28 possible pairs", which
is misleading and was cut.** The guards are not pairwise wiring. `_RECOVER` and `_OXYII_PAUSE` are
global `asyncio.Event`s that every actor checks; `offline_lock.slot(name)` is a single global exclusive
slot. That is **O(N) mechanisms, not O(N²)** — the design scales with device count, and the N²
framing would have manufactured an argument for a scheduler the evidence does not support.

**What is genuinely absent is priority arbitration**: nothing decides *which* acquisition wins when
two are simultaneously eligible. The guards make that largely moot by being **conservative** — they
defer rather than compete (a harvest waits for streaming; a pull waits for the slot; everything waits
for `_RECOVER`). Deferral is the correct default for an instrument: a missed harvest retries, a
corrupted acquisition does not.

**Ranking (§15): P#4 is P2/P3 — NOT P0/P1, therefore NOT to be implemented now.** §15 is explicit:
*"If an existing mechanism already solves a problem adequately: KEEP IT"* and *"Do not build a
heavyweight scheduler unless the existing architecture actually requires one."* It does not.

## 4 · What would change that verdict

Stated in advance so the answer is not retrofitted to whatever the box does next:
1. A measured case where two eligible acquisitions **both defer** and neither runs (mutual deference —
   the deadlock the broadcast design can produce and pairwise wiring cannot).
2. A case where deferral loses data that priority would have saved — i.e. the conservative default
   costing a night.
3. Device count rising past the point where a new actor must read every existing guard to be correct.

None is observed today. **(1) is the one to watch**, and it is cheap to detect: two actors reporting
`waiting` continuously across a whole window.

### 4a · ⚠️ "Cheap to detect" was wrong — (1) was NOT observable at all (measured 2026-09-05, Heron)

The sentence above states a falsification condition and asserts its own detectability in the same
breath. The second half was never checked. Measured against HEAD today: **the observation (1) requires
could not have been made**, for two independent reasons — and the first has nothing to do with the
second, so fixing either alone leaves the condition unwatchable.

**(a) There is only one live actor.** The two `state="waiting"` publishers in `capture.py` are the CPAP
harvest poller and the stored-spool pull. The spool pull is **default-OFF and has never armed**
(`cpap_spool_caller.spool_arming`, never inherited; the first witnessed pull is still owed —
`CPAP-SPOOL-ACQUISITION-2026-08-25` Do-1, attended). "Two actors both waiting" cannot arise while only
one of them runs. That is the owner's to clear, not a code fix.

**(b) The second actor published into a no-op.** `_maybe_start_cpap_spool_pull` constructed
`_cpap_spool_loop(...)` **without `st`**, so the loop took its own `st = st or (lambda **kw: None)`
default and every state it published was discarded — it never reached `STATUS`, so neither webmon nor
the monitor could have rendered it. This is the *"published to STATUS and read by nothing"* class
`webmon.py` already names, one level worse: it never reached STATUS to begin with.

🔴 **The test suite could not see it, and the reason generalises.** `tests/test_cpap_spool_wire.py`
drives the loop with `st=lambda **kw: states.append(kw)` and asserts on what it collected. Every state
assertion passed, against a production path that published nowhere — the machinery was fully covered
and entirely inert on the box. **A test that injects the collaborator it is checking cannot observe
whether the real caller supplies one.** The fix carries a test that drives the real caller and inspects
what it *passed*, watched failing against the unfixed wiring.

**(b) is FIXED** — the spool actor now publishes to its own `STATUS["cpap_spool"]`, forwarded by
webmon and rendered as its own line. The separate key is load-bearing rather than tidy: merging into
`cpap` would let whichever actor wrote last hide the other, and **"two actors both waiting" is not
answerable from one shared slot** — so the obvious one-line version of this fix would have left (1)
just as undetectable, while looking fixed.

**(a) remains open**, so (1) is still unobservable today and this section's verdict is unchanged —
what changed is that it is now unobservable for *one* stated reason instead of two unstated ones.

## 5 · §15 RANKING — the conclusion, and it is a null result

**Every one of the eight priorities is ALREADY IMPLEMENTED. Nothing ranks P0 or P1. Therefore, under
§15, the correct action is to implement NOTHING and say so.**

| | count |
|---|---|
| ALREADY IMPLEMENTED | **7** (P#1, P#2, P#3, P#5, P#6, P#7, P#8) |
| NOT NEEDED on measured evidence | **1** (P#4 orchestrator) + 1 sub-item (`queue_depth`) |
| PARTIALLY / NOT WIRED / MISSING | **0** |

🔴 **A null result is the outcome an anti-overbuild rule exists to produce, and it is the one most
likely to be quietly overridden** — an eight-priority roadmap creates an expectation of eight
workstreams, and "we measured and built nothing" is a harder report to file than a sprint plan. §15
anticipated exactly this: *"Do NOT automatically implement all roadmap items … If an existing
mechanism already solves a problem adequately: KEEP IT."*

**This is not "the roadmap was wrong."** The charter asks Tepna to *audit before coding* and to
*evaluate whether* an orchestrator is needed. It got its answer. The value delivered here is the
measurement plus the falsification conditions (§4) — not code.

⚠️ **What this audit does NOT say:** that the system is *good*, or *unattended-ready*, or *proven*.
It says every mechanism the roadmap proposes has an implementation. Whether those implementations
WORK over 72 unattended hours is §13/§14's question, it requires the box, and it is untouched. A
module existing is not a mechanism working — that distinction is the whole reason §19's execution
witness exists one charter over.

## Done when

- [x] Currency verified before measurement; the stale-root hazard recorded with its 16-vs-14 receipt.
- [x] P#1–P#5 classified against HEAD with per-item evidence.
- [x] P#4 answered with a measurement and a pre-stated falsification condition.
- [x] P#6–P#8 measured — all three ALREADY IMPLEMENTED.
- [ ] §13's resource-budget measurements — **needs the box** (Thursday).
- [ ] §14's long-run behaviour tests — **needs the box** (Thursday).
- [x] The consolidated P0–P4 ranking across all eight priorities, once P#6–P#8 are measured — **its
      precondition was already met when it was written.** The box above it records P#6–P#8 measured,
      and §5 tabulates all eight (7 ALREADY IMPLEMENTED + P#4 NOT NEEDED) with "nothing ranks P0 or
      P1". The ranking existed in this document, unticked; verified 2026-09-05.
