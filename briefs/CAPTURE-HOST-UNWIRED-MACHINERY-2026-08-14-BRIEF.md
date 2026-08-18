<!--
  CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-15 · **Created:** 2026-08-14

# Machinery that exists, is tested, and is connected to nothing

> Audit of `capture-host/` against `origin/main` @ `d154c48a`, 2026-08-14. Every finding is a *logical*
> gap — not coverage, not style. All five survived re-verification; one tempting sixth did not, and is
> recorded in §7 so nobody "fixes" it.

## 0 · Why these are one finding, not five

The suite's own recurring failure class — `AUDIT-PROMPT`'s and `ui-export-paths-broken`'s — is **a check
that reports success about something it never examined**. This audit found its sibling: **a check that
examines something correctly and reports to nobody.**

It happened three times on 2026-08-14 alone, outside this audit:

| | |
|---|---|
| the charging veto (#1245) | correct, gated by 24 passing assertions, **unreachable** from the live path |
| the Deploy button (#1244 → #1249) | green 12-minute gate, failed on the **first real press** |
| `reload` (#1239) | the box carried a stale `NeedDaemonReload` since 2026-08-06 with nothing able to clear it |

Each was found by *using* the thing. Nothing in CI can see this class, because every one of these has
passing tests — the tests call the function directly, which is exactly the wiring that production lacks.

**§6 proposes the detector**, because five instances is a pattern, not a coincidence.

## 1 · `clock_uncorrectable` — a verdict computed, set, cleared, tested, and read by nobody

- **set** `capture.py:3757` — `_set(name, clock_uncorrectable=True, clock_synced=None)` when the clock
  watchdog exhausts its give-up budget.
- **retracted** `capture.py:1360` — a fresh sync clears it, deliberately (`_CLOCK_FRESHLY_SYNCED` exists
  solely to carry that retraction across tasks, per the comment at `:711`).
- **tested** 7 references across `test_clock_resync_on_reconnect.py` and `test_capture_runners.py`.
- **consumed by** — nothing. Not `alerts.py`, not `webmon.py`, not `nightqc.py`, not `monitor.html`.

For a suite whose entire Clock Contract rests on device time being trustworthy, *"this device's clock
could not be corrected"* is a first-order data-quality fact. It currently reaches no operator, no alert,
and no nightly QC report. A night captured under an uncorrectable clock is indistinguishable, downstream,
from a good one.

- [x] **DONE #1254.** Surface it. Cheapest honest option: `webmon`'s device projection + a monitor pill, since `worn_why`
      already establishes the "verdict plus its reason" pattern.
- [x] **DECIDED 2026-08-17 — NO, not as `nightqc` reads it today; the need is real but the naive
      implementation fabricates.** The premise above is right: the per-night row *is* the artefact an
      analysis reads months later. But `clock_uncorrectable` is **live device state, not a property of a
      night**. `capture.py:1536 _set()` does `d.update(kv)` into `STATUS["devices"][name]` — a mutable
      current-state dict with **no history** — and `:1432` *clears* the flag on a successful sync. So a
      night is never stamped with it; only the device is, and only as of now.

      `nightqc` post-processes night FILES. Reading `STATUS` at QC time and writing that value onto a night
      captured three days earlier attributes **today's** device state to that night. On a device that has
      since re-synced it reads clean when the capture was uncorrectable, and on one docked since it reads
      uncorrectable when the capture was fine. That is a fabricated per-night fact, and it is exactly what
      the Clock Contract §2.6 forbids — *a missing value must be visible (null), never invented.*

      **The honest route already exists and is one line from where the flag is set.** `_set()` forwards
      `link_epoch` into the **LINK sidecar (E5)** through this same call path, for this same reason — a live
      device fact that had to be pinned to the session it described. `clock_uncorrectable` riding the LINK
      sidecar the way `link_epoch` does would make it a genuine per-night fact, at which point `nightqc`
      can read it per night **honestly, from the night's own bytes**, and this box reopens as a real task.

      Recorded as a decline **with its condition**, not a rejection of the need: stamp it at capture time
      first. Doing it in `nightqc` without that step would surface a verdict nobody could trust — which is
      the failure this whole brief was written about, one layer over.

## 2 · `alerts.arrival_canary` — an alert nothing invokes

`alerts.py:268`. Called from `tests/test_pmd_arrival_writer.py` five times and from **no production
caller**. Its own docstring states the stakes:

> What remains is the failure nothing else can see: **DEAD** — the device is connected and writing
> samples, but its sidecar row count is not advancing.

and, of its predecessor:

> without this both surface weeks later inside an analysis — which is exactly how the back-timed stamps
> this replaces went unnoticed for the whole corpus.

The docstring also records that its *other* arm (`smeared`) was correctly retired after firing on every
stream on 2026-08-11. That retirement was right; it left the surviving arm wired to nothing.

- [x] **DONE #1258.** Call it from `alert_loop`, where the other per-tick predicates already run.
- [x] **DONE — the check WAS run, in #1258, before the wiring landed.** The box stayed unticked while the
      work shipped, so recording the evidence here rather than the tick alone: #1258 ran the DEAD arm
      against the real corpus and measured **0 gaps across 4 nights, zero false positives on every session
      since 2026-08-11** (the first night with any sidecar). The abstention on earlier nights is historical
      — they have no sidecar to advance — and is reported as abstention, not as a pass. A behavioural test
      now drives `qc_poller` and reads the journal, so the wiring itself is gated rather than asserted.

      ⚠️ Before wiring, the risk was real and is preserved for the record: the retired `smeared` arm fired
      on **every stream on the first real night** because its premise (a 5 ms floor) was never reachable.
      The DEAD arm avoided that fate by measurement, not by argument.

## 3 · `helper_path.grant_warning` never warns, and its condition is reachable

`helper_path.py:47` returns a one-line warning when a privileged helper would be `sudo`-run from a
location the granted user can rewrite. Nothing calls it. Nor `is_safely_owned`, which it wraps.

The condition is **not hypothetical**:

- `resolve()` falls back to the in-repo copy when no system copy exists (`helper_path.py:26-32`);
- on the box that copy is `-rwxrwxr-x vigil` — writable by the granted user;
- `daemon_control.build_cmd` prefixes `sudo -n` to whatever `resolve()` returns;
- `capture.py` calls `resolve()` at `:3433`, `:3457`, `:3514` and checks safety at none of them.

It degrades legibly today only by accident: sudoers is scoped to `/usr/local/lib/tepna/*`, so a repo-path
invocation is *refused* rather than escalated, and `daemon_control.run` has a hint naming it a deploy gap.
That is a second line of defence doing the first line's job.

**Compounding it — `SYSTEM_DIRS` is mislabelled.** `helper_path.py:20-22` comments both entries as
"Root-owned deploy targets", but the second is `/opt/tepna/capture-host`, the checkout, which is
vigil-owned **by design** — `tepna-update.sh` must be able to write it. A constant that describes its
second element incorrectly is how the fallback looks safe at the call site.

- [x] **DONE #1257.** Call `grant_warning` once at boot for every helper the daemon can invoke, and log it at WARNING.
      The boot self-test is the established place (`VIGIL-OVERNIGHT-FINDINGS` P1.4 added two checks there
      after finding the third missing).
- [x] **DONE #1257.** Correct the `SYSTEM_DIRS` comment: entry 1 is a root-owned deploy target, entry 2 is a
      **fallback for development** and is not safe to hold a grant.

## 4 · The same gate written two ways, and only one of them checks `charging`

| | |
|---|---|
| `cpap_harvest.blocking_devices:305` | checks `charging` **first**, then `worn is False` — and its docstring records the 2026-07-26 incident where every sensor was docked and the pull still refused |
| `capture.py:4689` | `if st.get("connected") and st.get("worn") is True: continue` — no `charging` check |

`capture.py:4689` gates the O2Ring auto-pull ("only while it is off the finger"). Today the ring reports
`worn=False` on the dock honestly, so the gap is **latent, not live**. It is listed because the two gates
encode the same rule — *a charging device cannot be on a body* — and only one of them says so.

- [x] **DONE #1259.** Add the `charging` check, or route both through one predicate. `blocking_devices` already is one.

## 5 · Minor: defined, never used

- [x] **DONE.** `last_sample` — published at `capture.py:1939` and `:2896`, read by nothing. It is a per-stream
      freshness stamp, which is what §2's DEAD detector wants; wire it or drop it.
- [x] **ALLOWLISTED, investigated.** Redundant: `pull_session.py` already gates re-pulls on finalisation via `parse_trailer`, which that caller needs anyway for the device summary. `oxyii.oxy_is_finalized:596`.
- [x] **ALLOWLISTED, investigated.** Redundant: `offline_lock.slot()` raises `OfflineBusy(_busy)`, so the label already reaches callers as `e.holder`. `offline_lock.busy_with`.
- [x] **DELETED.** `cpap_harvest._WPA_DIR` — its own comment claimed a CLI/test use that did not exist.

## 6 · The detector, because five instances is a pattern

Every finding above was produced by two mechanical scans that took seconds and could run in CI:

1. **Orphan status keys** — collect every `key=` published through `_set(name, …)` in `capture.py`;
   subtract everything referenced in `webmon.py`/`alerts.py`/`nightqc.py`/`timeline.py`/`monitor.html`.
2. **Orphan functions** — public `def`s whose only references outside their own module are in `tests/`.

⚠️ **Both scans need care, and the first draft of each was WRONG in a way that matters:**

- a name-plus-`(` pattern **misses callback references** — `to_thread(diskguard.prune_old_nights, …)` made
  retention and archiving look dead when both are wired. Match the bare name.
- `timespec` and `tool` were false positives: the first is `isoformat`'s kwarg caught by a loose regex,
  the second is consumed under a quoting form the filter missed.

So the detector must be **advisory with a curated allowlist**, not a hard gate — the same posture as
`mutation (diff-scoped)`. A hard gate here would fail on every legitimately declarative constant
(`PMD_SERVICE`, `OXYII_SERVICE`) and every CLI-only entry point.

- [x] **DONE — `tools/find_unwired.py`.** Build it as a `tools/` script first, run it, curate the allowlist, and only then decide whether it
      earns a CI job.

### 6.1 · First run — it found three orphans the hand audit MISSED

Run 2026-08-14 against `origin/main`. It reproduced every hand-found item **and** added three, because
it subtracts `def` lines while a human counting occurrences reads the definition as a use:

| new finding | why it is not "minor dead code" |
|---|---|
| **`rate_unmet`** (status key) | published when a device refuses the configured rate. The log line beside it says *"The config still says %s; **nothing else will tell you it did not happen**"* — and the field published to make that visible reaches no consumer. The claim in the log is more true than its author intended. |
| **`connection_ceiling_error`** | distinguishes "the ADAPTER is out of connection slots" from "the sensor is absent" — *"a diagnosable over-provisioning, not a flapping device"*. Nothing calls it, so slot exhaustion presents as a dead sensor and sends the operator after the wrong fault. |
| `predict_step_split` | O2Ring frame-lock helper, tests only. Genuinely §5-class. |

It also **correctly did not report** `tool` or `timespec` — the two false positives the hand scan
produced — and correctly treats `prune_old_nights` / `unarchived_nights` as wired despite their being
passed to `asyncio.to_thread` without parentheses.

- [x] **DONE #1269.** `rate_unmet` and `connection_ceiling_error` are §1/§2-class, not §5: surface the first to a
      consumer, wire the second where connect failures are classified. Own work-unit.

## 7 · What this audit checked and REJECTED — do not "fix" it

**The O2Ring writes `worn` directly, bypassing `worn_verdict`, exactly as the Polar path did before
#1245 — and that is CORRECT.**

- `capture.py:2896` publishes `worn=True` in the branch where vitals are flowing;
- `capture.py:2904` publishes `worn=live["worn"]` in the branch where they are not.

The Polar's HR contact bit **asserts skin contact in a charging dock and on a desk** (measured: 3 h 24 m
into a charger on 2026-08-14; 496 MB into a desk before that), which is why it may not own the verdict
alone. The ring's flag is honest on the dock — `cpap_harvest.blocking_devices`' docstring says so
explicitly, and the branch at `:2901` documents that only the vitals stop when it is docked.

**Same code shape, opposite verdict, because the sensors differ.** Routing the ring through the combiner
would add a veto it does not need and a dependency on `charging` inference where a direct measurement
already exists. Recorded here because reasoning by analogy from #1245 would produce exactly that change.

## 7.5 · Outcome

**Every section shipped, across eight PRs.** §1 `clock_uncorrectable` (#1254) · §2 `arrival_canary`
(#1258) · §3 `grant_warning` (#1257) · §4 `on_body` (#1259) · §6 the detector (#1260) · §6.1 the
ceiling classifier + `rate_unmet` (#1269) · §5 (#1271).

**The status-key half is CLOSED: 0 unexplained, 0 allowed.** Every key `capture.py` publishes now
reaches a consumer. The function half stands at **7 unexplained, 5 allowed** — the 7 carried to the
follow-up, characterised there rather than counted.

⚠️ **Every section needed a second gate run, and not one failure was a flake.** That is the finding
this brief did not predict:

| section | what the gate caught |
|---|---|
| §2 | three source-scan tests asserted the call EXISTS and never EXECUTED it — 7 uncovered statements; then the no-webhook branch, the exact property the code comment claimed |
| §3 | a self-test that would cry wolf on every dev startup; then a branch CI could see and this machine could not, because `/usr/local/lib/tepna` exists here and not there |
| §5 | a projection key that reached `webmon` without being declared in `DEVICE_KEYS` |

Two of the three were **environment-dependent**: the local gate read 100 % because this machine differs
from CI. A green local run is evidence about this machine, not about the code.

## 8 · Done when

- [x] **§1, §2, §3 are wired or explicitly declined in writing.** §1 surfaced to `webmon` + a monitor pill
      (#1254), and its remaining per-night question **declined in writing above** with the condition that
      reopens it — that decline, added 2026-08-17, is what actually closes this box: until then §1 was
      neither fully wired nor declined, only half-answered. §2 wired into `alert_loop` (#1258). §3
      `grant_warning` called at boot + `SYSTEM_DIRS` comment corrected (#1257).
- [x] **§4 is unified** — the `charging` check added so both spellings of the gate agree (#1259).
- [x] **§6's script exists and has been run**, allowlist curated — `tools/find_unwired.py` (#1260); its
      first run found three orphans the hand audit had missed (§6.1), two of which were §1/§2-class and
      were surfaced rather than allowlisted (#1269).
- [ ] **STANDING, not completable — do not tick.** §7 is still true — re-check before any change to the
      O2Ring worn path. This box is a precondition on future work, so an unticked state is its correct
      resting state; ticking it would assert a check that has no expiry.
