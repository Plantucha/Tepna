<!--
  RUN-POLAR-MUTATION-PASS-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-08 · **Follows:** `CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md` §4.1

# `capture.run_polar` — the pass the fleet brief called the prize, and the one-line reason it was blocked

`CAPTURE-HOST-MUTATION-FLEET` §3 named this *"the single highest-value unit in `capture-host`"* — 502
reachable, 100 % concentration, 44 % of the fleet remainder in one function — and *"it has never been
attempted."* §4.1 gave it its own brief. This is that brief and its first pass.

## 1 · What blocked it was never the size

Earlier sessions measured `capture.py` and treated it as intractable **because of its size** (4 420
lines, a 26-minute run, 109 test files). That diagnosis was wrong, and the fleet brief's own
concentration metric already said so: it is ONE function with ONE fixture family.

The actual blocker is one line of the tooling. `tools/mutate.py` picks a module's test files
heuristically — tests that mention the module — and `capture.py` is imported almost everywhere, so it
selected **110 of them**. The clean baseline alone:

```
110 files   680 s        ← the heuristic's selection
 10 files     5.83 s     ← the files that actually reach run_polar
```

**117×.** mutmut derives its per-mutant timeout from that baseline and pays it per mutant. That is the
difference between a pass that runs and a pass that cannot be started, and it is `--tests`, not effort.

**The trade is deliberate and points the safe way.** A mutant killed only by a test outside the scoped
set now reads as SURVIVED — a false alarm, never a blind spot; the same superset property
`tools/mutate_pure.py` already relies on. Every kill claimed below is confirmed by ID against the real
module, and the full 3 000-assertion suite runs at PR time regardless.

## 2 · The measurement

`mutmut 3.7.0`, generation `26ba4c9b28e0`, scratch `mut-capture-9ugo1yv0`, 2026-08-08.

| | count |
|---|---:|
| `x_run_polar__mutmut_*` generated | **1 286** |
| killed | 586 |
| survived | 655 |
| timeout | 45 |

Triage of the 700 non-killed (`mutation_triage.classify`):

| bucket | count |
|---|---:|
| REACHABLE | **560** |
| UNOBSERVABLE | 128 |
| PROSE | 12 |

**Ceiling 90.0 %.** Quote it beside any kill-rate for this function or the number is unattainable.

⚠️ **The 45 timeouts are not survivors and must not be reported as gaps.** A timeout under CPU
contention is a mutant that would otherwise have been killed — `CAPTURE-HOST-MUTATION-FLEET` §6 records
one 5.18 s test pushing three unrelated mutants from KILLED to TIMEOUT. They are carried to §5.

### The mutant-name form, because it cost a 978-second run

`--only 'capture.x__run_polar__*'` matches **nothing**. mutmut's name is `x` + the function name
verbatim: `_now` → `x__now__` because *the function* starts with an underscore; `run_polar` →
`x_run_polar__`, one underscore. The fleet brief's example (`capture.x__now__*`) is correct for its
own function and misleads when copied.

mutmut asserts `"Filtered for specific mutants, but nothing matches"`; `tools/mutate.py` surfaces that
as `rc=1` with a **truncated** traceback, and the results dump then reads `not checked` for every
mutant — **which is exactly the shape of the poisoned/mid-run read** the runbook warns about. A wrong
filter and a poisoned baseline are indistinguishable at the output. `--list` before `--only`.

## 3 · The first family: the live-telemetry contract (69 mutants, one cause)

The largest coherent family among the 560 was **`BUS.register` / `BUS.push` / `BUS.unregister` with an
argument DROPPED or set to `None`** — 69 of them, the exact class `blind_spots.py` finds statically.

**Why every one survived.** `test_telemetry.py` exercises the bus directly with hand-written calls.
`test_capture_runners.py` drives `run_polar` and then asserts on **files on disk**. The whole live
contract sat between the two, unobserved — and neither defect this path has actually shipped is
visible in a file:

* **2026-08-05** — the initial registration passed `pmd.SAMPLE_HZ[meas]`, the rate the hardware ships
  at, not the rate this box negotiated. `stream_health` judges WEAK as `eff_fs < 0.7·nominal`, so ACC
  delivering its agreed 25 Hz against a declared 200 scored 0.125 and painted amber all night.
* the **`bpm` card did not exist** — the strap's own HR was written to file and never registered, so
  it had no card at all while RR did.

Both are one argument. Neither reaches a file.

### 3.1 · A test that declared its own subject unreachable

`test_telemetry.py::test_capture_registers_pmd_streams_with_an_UNKNOWN_rate_until_negotiated` pins the
2026-08-05 fix by **scanning capture.py's source** for `SAMPLE_HZ`, and says why:

> *"the registration sits deep inside `run_polar`'s per-connection setup, behind a live BLE session
> that no unit test reaches. A behavioural test here would need the device."*

**The premise is false.** `FlexPolarClient` in `test_capture_runners.py` negotiates all six PMD streams
with no device at all, and the two-phase registration is plain in the calls:

```
('ecg', 'ECG (H10)', 'µV',   0, 1, ())     ← before negotiation: rate UNKNOWN
('ecg', 'ECG (H10)', 'µV', 130, 1, ())     ← after START: the negotiated rate
```

A text scan also cannot tell `0` from `1` — mutant 312 does exactly that and survives the scan. The
scan is LEFT IN PLACE (it guards a different thing, the literal in the source) but it is no longer the
only guard. **Generalise the lesson, not the fix:** a test whose docstring explains why its subject
cannot be reached behaviourally is a claim about the fixtures, and it should be checked against them
before it is believed — a sibling file already reached it.

### 3.2 · Result — 66 killed, 3 proven equivalent

`tests/test_run_polar_live_contract.py`, 10 tests. Every kill confirmed by re-applying the mutant to
the real `capture.py` under a unique-anchor guard, with `__pycache__` cleared per iteration (both are
§6 method findings that previously produced confident wrong answers).

| stage | killed | left |
|---|---:|---:|
| card identity · key rule · two-phase rate · RR+bpm cards · push shape · PPI order · unregister | 43 | 26 |
| + an `on_hr` frame, + rejecting a DEVICE-QUALIFIED stream | 62 | 7 |
| + the push-rate assertion | **66** | 3 |

**The 3 are EQUIVALENT, proven not assumed.** `BUS.unregister(_live_key(pmd.MEAS_NAME.get(meas,
str(meas)), tag))` — mutants 1017/1019/1020 mutate only the `.get()` **default**. `writers` is keyed
solely by `meas_of.values()`, and that set is identical to `MEAS_NAME`'s keys (`[0,1,2,3,5,6]`), so the
default is unreachable. The fleet brief §7 notes `EQUIVALENT?` has read **0** in every automated run
while equivalences keep being proved by hand; these are three more for that column, and they argue
again for wiring the witness search.

## 4 · Two things the measurement corrected — both would have shipped as wrong prose

* **The push-rate finding was not the defect I assumed.** Seeing `hz` mutants survive, I was ready to
  report that the 2026-08-05 false-amber defect still existed on the push side. It does not:
  `stream_health` takes its nominal from `m.fs`, set by `register`, which is correctly `0` until
  negotiated. The push `fs` instead drives `msg["fs"]` — the rate the live SSE frame declares and the
  monitor plots its time axis against — and the ring capacity `max(64, ring_seconds·rate)`. A `None`
  there collapses to `rate = 1`: a one-sample-per-second axis under a 130 Hz trace. Real, and a
  different defect from the one I nearly named.
* **18 of the 26 second-round survivors were not a hard case at all** — the driver simply never passed
  an `hr_frame`, so `on_hr` was never entered while its bus contract was being asserted "confidently".
  A test that does not reach the code says nothing about it, and it says it in green.

Also pinned while there: RR arrives in the SIG's 1/1024 s units. Pushing the raw value instead of
converting to ms is a silent **+2.4 %** on every interval — a plausible number in a plausible unit,
which is the class of error nothing downstream can catch.

## 5 · Open — the rest of the 560

The BUS family is closed. Remaining REACHABLE survivors, by family, with the same measurement:

| family | count | note |
|---|---:|---|
| `log.*` call arguments (incl. multi-line continuations) | ~150 | killable only by asserting wording; weigh against pinning phrasing |
| `_set()` — the status-card fields | 66 | same shape as the BUS family, same fixture should reach it |
| branch conditions | 46 | the multi-iteration surface `_stop_after(…, 1)` never enters |
| `pmd.decode_frame` keyword args (`fs=`, `prev_last_ns=`, `scale=`) | ~12 | `prev_last_ns` is the seam anchor — dropping it silently reverts to nominal back-timing |
| `device_time` / `clock_skew_sec` | ~15 | the only honest confirmation a clock sync took effect |
| backoff / sleep cadences | 23 | the four-way reconnect-sleep choice |
| writer dispatch | 18 | |
| counters (`stale_bond_hits`, `rebond_attempts`, `secs`) | ~10 | the two-strike stale-bond logic that cost 4.5 h of ECG on 2026-07-29 |

**`_set()` (66) is the obvious next unit** — identical defect shape to the one just closed, and the
same spy fixture reaches it.

## 6 · Done when

* The 45 timeouts are re-run un-contended and reclassified; any that resolve to KILLED are removed from
  the survivor count rather than carried as gaps.
* `_set()`'s 66 are attempted with the fixture from §3.
* A decision is recorded on the ~150 `log.*` argument survivors: kill them (and accept that the suite
  then reds on every message edit) or classify them PROSE and raise the stated ceiling accordingly.
  **They must not simply sit in REACHABLE**, where they overstate the remaining work by a quarter.
* `--list`-before-`--only` is added to `MUTATION-AUDIT-RUNBOOK` alongside the name-form rule in §2.
