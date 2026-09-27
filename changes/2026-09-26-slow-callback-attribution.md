---
bump: minor
type: added
brief: none
---

When the capture loop stalls, the journal now names **which callback** held it and for how long, at the
moment it happens. `loop_monitor` measures the shared resource and says so honestly — its log line reads
*"whatever held it"* — because sleep-lateness is a symptom with no subject.

**That gap cost a night of wrong attribution.** On 2026-09-25 the 737 stalls inside a tracing window were
read as *"25 at the QC poll's cadence"*: `stalls so far:` is a CUMULATIVE counter, and the warning is
rate-limited to 300 s, so **the spacing of warnings is the limiter's period** and can never establish a
cause. Two sessions reasoned from that spacing before anyone checked what the field meant.

🔴 **The obvious mechanism is the wrong one, and the choice rests on a measurement.** asyncio has this
built in — `loop.set_debug(True)` plus `slow_callback_duration`. Benchmarked over 60,000 callbacks through
the real dispatch path, median of 3:

| mechanism | per callback | vs baseline |
|---|---|---|
| baseline | 1.29 µs | — |
| `loop.set_debug(True)` + `slow_callback_duration` | **18.09 µs** | **14.0×** |
| wrapped `Handle._run` | **1.56 µs** | **1.20×** |

Debug mode is 14× because it also captures a source traceback per handle and tracks coroutine origins — a
broad tax to answer a narrow question, and the same shape as the heap probe's measured **19×** stall tax.
So this wraps `Handle._run`, the one choke point every callback passes through, for **+0.26 µs/callback**
(≈0.13 % of a core at 5,000 callbacks/s). The handle is rendered **only past the threshold**, so the fast
path pays nothing beyond the timing pair. **The overhead is a test, not a comment.**

⚠️ **And that is why this gate is a config key rather than the heap probe's consumed one-shot.** The probe
needed consuming because 19× re-armed on every daemon start; 1.20× is a tax you can leave on for the
nights you are diagnosing. Still **off by default** — an instrument nobody asked for should not run.

- **Threshold `_SLOW_CB_MS = _LOOP_LAG_STALL_MS`** — one definition of "a stall", asserted by a test:
  if they drifted, `STATUS["loop"]["stalls"]` would count one thing while the attribution named another
  and the pair's cross-read ("N stalls, and here are the callbacks") would be silently false.
- **Not rate-limited, deliberately** — the limiter is what made the previous instrument's output
  unreadable as a cadence. A flood IS the finding.
- **A coroutine step is named by its COROUTINE**, not by `Task.__step`: every awaiting task dispatches
  through the same method, so naming the callback would give one name for a dozen coroutines —
  attribution technically present and useless.
- `describe_handle` **falls back rather than raising**: it runs inside dispatch, and an instrument that
  can throw there takes the loop down with it.

⚠️ **`find_unwired --check` red my first version and was right.** It published `STATUS["slow_callbacks"]`
with an aggregate — *"published by capture.py and read by nothing"*. The property owed here is the journal
line; a dashboard field for a reader who might want one is the half-wired mechanism this repo keeps
finding, in the instrument built to stop exactly that class of error. The publish is gone; the per-name
counters stay in memory because the log line itself consumes them ("seen N times, worst X ms").

⚠️ **Every test here is a PLANT, and none is a control** — the whole surface is new, so nothing in the
file can execute against `origin/main`. Said explicitly because I have mislabelled a plant as a control
three times this week: a test that cannot run on the old code proves nothing about the change. **The
cross-side control for this unit is `check.sh` staying green at 100 % with the watch registered and off**,
which is the state every night runs in.
