<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS (audit + smallest change set landed 2026-09-05; the deliberately-NOT-built list in §7 is the remainder, each item gated on a measurement this PR starts collecting) · **Created:** 2026-09-05 · **Residue:** 2026-09-05-retry-sleep-stale-connected, 2026-09-05-fsync-on-loop-unmeasured, 2026-09-05-supervised-restart-resets-state, 2026-09-06-writer-close-list-hand-kept

# Capture-host resource orchestration — audit, diagnosis, smallest change set

Charter: make the capture host run a multi-device overnight capture unattended — several BLE
adapters, several device links, concurrent acquisition / storage / processing / health / recovery —
without one resource starving or wedging another. Reference for *principles only*:
[AirCANnect](https://github.com/m-kozlowski/aircannect) (ESP32/FreeRTOS CAN bridge). Nothing was
copied; §5 says what was adopted and what was deliberately left on the shelf.

Companion: [`OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md`](OPERATIONAL-MATURITY-AUDIT-2026-08-27-BRIEF.md)
(IN-PROGRESS) already ruled *"P#4 orchestrator NOT NEEDED"*. **This audit re-derived that verdict from
the code and keeps it.** The defects found are in *release* and *observability*, not in scheduling.

## 1 · Diagnosis (written before any code was changed)

`capture-host/capture.py` (8 424 lines, one process, one `asyncio` loop) coordinates by **broadcast**,
not by ownership: global `asyncio.Event`s — `_RECOVER` (radio recovery in progress), `_OXYII_PAUSE`,
`_POLAR_PAUSED` (a set), `_STOP` — plus one `_CONNECT_LOCK` and one cross-process
`offline_lock.slot(who)` (`OfflineBusy` when held). Every device runner is its own supervised task
(`keep_running`, `capture.py:6960`) with its own reconnect loop; pollers (storage, QC, archive,
adapter watchdog, …, now 14) are supervised the same way.

**What is actually right about it — and must be preserved:**
- One task per device link ⇒ per-device BLE command serialisation is *structural*, not a lock. A
  runner never issues two GATT commands concurrently because it is one coroutine.
- The one contended shared resource — the *radio during recovery* — is already a single gate, and
  every consumer already checks it (`_RECOVER.is_set()` before connect). That is the whole of the
  admission control the system needs; a queue in front of it would serialise something that
  contends at most once per night.
- The spare-adapter pool (`adapter_pool.py`, 119 lines, **currently unwired** — no importer outside
  its own tests) already states the right principles: explicit ownership, never steal an owned
  adapter, prefer a free one. It was *not* wired in by this PR (§7).

**Where it fails the charter** (each row verified in source, not inferred from the 08-27 audit):

| id | resource | defect | where |
|---|---|---|---|
| **S1** | storage | A row write that raises (`ENOSPC`, closed handle) was **uncounted**: `fh.write` was bare in every one of 8 writer classes; `flush_failures` counted only `_maybe_flush`. A full disk lost raw rows *silently* — the charter's one unforgivable failure. | `writers.py` `_row` / 7 sidecar `write` methods |
| **S2** | storage ↔ timing | `_maybe_flush` runs `flush()` **+ `os.fsync()` on the event loop** every 5 s per stream. bleak delivers notifications *on the loop*, so every live stream's host stamp waits behind every other stream's fsync. **Never measured.** | `writers.py:599` |
| **L1** | radio gate | `_restart_radio` set `_RECOVER` and slept 5 s with **no `finally`**; a cancellation during that sleep (shutdown, supervisor restart) left `_RECOVER` set forever ⇒ every runner refused to connect until process restart. The other two set-sites (`_migrate_to_spare:1409`, `adapter_watchdog:4878`) already had `finally: clear()`. | `capture.py` `_restart_radio` |
| **L2** | loop | Event-loop latency — the one number that says whether *anything* on this host is starving the P0 path — was not measured at all. | — |
| **L3** | loop | `diskguard.active_nights`, `_current_night`, `nightarchive.pending_nights` **walk the capture tree synchronously on the loop** (`os.scandir` + `stat` per night, `_grew_since_marker` walks every archived night). On a 100-night SD card that is a multi-hundred-ms stall on the P0 path, every poll. | `storage_poller:5468`, `qc_poller:5848`, `archive_poller:6049` |
| **O1** | observability | Backoff state was **invisible**: a runner in `asyncio.sleep(backoff)` published nothing — the status file could not distinguish "reconnecting in 180 s" from "dead". Gate state (`_RECOVER` etc.) was likewise unpublished. No jitter ⇒ three devices dropped by one radio fault retried in lock-step. | 3 runners (`run_polar:2254`, `run_viatom:3295`, `run_oxyii:3550`) |
| **O2** | supervision | Four background tasks were started with **bare `asyncio.create_task`** — AS11 shadow detector, CPAP auto-start, CPAP stored-spool pull, O2Ring presence scan. An exception killed them silently for the rest of the night; nothing recorded it. | four starters in `main` |

**Explicit resource model** (the charter's §2, stated so the gaps are named rather than implied):

| resource | instances | owner | contention | state today |
|---|---|---|---|---|
| BLE adapter | 1–N (`hci*`) | the runner(s) bound to it; recovery holds it via `_RECOVER` | radio reset vs every connect | gate, now failure-safe (L1) |
| device link | 1 per configured MAC | its runner task | none (one task) | per-device backoff now published (O1) |
| event loop | 1 | everything | every callback, every fsync, every tree walk | now measured (L2), walks moved off (L3) |
| storage | 1 tree | writers | flush/fsync vs notifications | loss now counted (S1), fsync timed (S2) |
| offline slot | 1 (cross-process) | `offline_lock.slot(who)` | offline jobs vs each other | already explicit; now in `STATUS["gates"]` |
| CPU | 1 host | — | pollers vs P0 | **not budgeted** (§7) |
| memory | 1 host | — | — | **not bounded** (§7) — no unbounded queue was found either; writers are direct-write |

## 2 · Change set (smallest coherent — one PR)

Everything below is additive. No runner's schedule changes except for ±10 % jitter on the
exponential branch; no interface moved; no bundle touched.

**`writers.py`** — `_FlushHealth.put(fh, text) -> bool` wraps every row write in all 8 classes:
`OSError`/`ValueError` ⇒ `rows_lost += 1`, transition-logged once as `ROW LOST`, recovery message
names the count (*"writing again, after N failed flush(es) and M lost row(s)"*). `rows` now means
**landed** rows and `rows_lost` **refused** rows — two counters, never conflated. `fsync(fh)` is timed;
`fsync_max_ms` / `fsync_last_ms` are published and a single once-per-file `SLOW fsync … on the event
loop` line fires above `SLOW_FSYNC_MS = 250`. Header writes stay unguarded (they run once, before any
data, and a failure there already aborts the open).

**`capture.py`**
- `_retry_sleep(name, delay, why, attempt)` (`:1911`) replaces every `asyncio.sleep(backoff)` in the
  three runners: publishes `retry = {attempt, why, wait_s, next_at_ms}` to the device's status,
  clears it in `finally`, and jitters ±`_RETRY_JITTER` (0.10) **only** on `why == "backoff"` —
  charging / stalled / not-worn waits are fixed on purpose (they are device physics, not contention).
  `attempt` resets with `backoff` on the same three data-arrived sites.
- `_restart_radio`: `_RECOVER.set(); try: sleep finally: _RECOVER.clear()` — all three set-sites now
  release on every exit path, gate-asserted.
- `keep_running` records `STATUS["tasks"][label] = {crashes, last_error, restart_at_ms}`; the four
  bare `create_task` starters are now supervised under it.
- `gate_state()` (`:6900`) publishes `recover / oxyii_pause / polar_paused / connect_lock /
  offline_slot / stop` as `STATUS["gates"]` on every status write.
- `loop_monitor` (`:6920`, 14th `_BACKGROUND` poller) publishes `STATUS["loop"] = {lag_last_ms,
  lag_max_ms, stalls, ticks}` (stall = lag > 100 ms) and warns at most once per 300 s above 1 000 ms.
- The three tree walks run under `asyncio.to_thread`.
- Both writer publish sites (Polar, Viatom) carry `rows_lost` and `fsync_max_ms` beside
  `flush_failures`.

**`webmon.py` / `monitor.html`** — every new field has a reader, because `find_unwired.py --check`
(rightly) refused the first version of this PR with *"status keys published by capture.py and read by
nothing: `fsync_max_ms`, `rows_lost`, `tasks`"* — the exact class this audit is about, committed by
the audit. `/api/state` forwards `rows_lost` / `fsync_max_ms` / `retry` per device and `loop` /
`gates` / `tasks` top-level (contract test extended, verbatim rule kept); the monitor's write chip
now says **`⚠ N rows lost`** when rows were refused, **`⏳ fsync N ms`** when the slowest fsync
crossed 250 ms, a **`↻ backoff #n · Ns`** chip while a runner waits, and a sidebar **Loop** card
(stalls / max lag / held gates / crashed-and-restarted tasks). `ALLOW_FUNCS["busy_with"]` was
deleted: `gate_state()` reads it, so the suppression was spent.

**Tests** — `tests/test_cpap_spool_wire.py` unwraps the supervisor to reach the factory (the
contract it pins — `spool_type` and `st` reach the loop — is unchanged). `tests/test_resource_orchestration.py`, 39 cases (23 functions, parametrised over the
8 writer classes discovered by `dir(writers)` so a ninth class cannot dodge the gate): ENOSPC row loss
per class (`rows` unchanged, `rows_lost ≥ 50`, `flush_failures == 0`, one `ROW LOST` line, recovery
message); late row on a closed handle; RR-sidecar loss; slow-fsync log per class + a pin on the 250 ms
threshold; `_retry_sleep` publish/clear/jitter/cancel; all three backoff sites source-scanned; cancel
inside `_restart_radio` clears `_RECOVER`; every `_RECOVER.set()` has a `finally` + `clear`;
`keep_running` crash bookkeeping; the four starters supervised (source-scan); `gate_state` baseline
and set; `status_loop` writes `gates`; `loop_monitor` counts a planted 150 ms stall and rate-limits;
storage walk runs off the main thread; `to_thread` at all three walk sites (source-scan).
Existing schedule tests pin `_RETRY_JITTER = 0` so they test the schedule, not the noise.

## 3 · Before / after (per charter §37)

| | before | after |
|---|---|---|
| full disk mid-night | rows vanish; `rows` keeps counting attempts; nothing logged until a 5-s flush fails | `rows_lost` counts each refused row; `ROW LOST` logged once; `rows` counts only landed rows |
| shutdown during radio restart | `_RECOVER` stays set; no runner reconnects until process restart | cleared on every exit path |
| a runner in 180-s backoff | status indistinguishable from a dead runner | `retry.attempt / wait_s / next_at_ms` visible |
| three devices dropped together | retry in lock-step forever | de-phased by ±10 % per attempt |
| background helper crashes | silent for the night | `STATUS["tasks"][label].crashes / last_error`, restarted |
| loop starvation | unknown | `STATUS["loop"].lag_max_ms / stalls`, warning ≥ 1 s |
| fsync cost on the P0 path | unknown | `fsync_max_ms` per stream, `SLOW fsync` line ≥ 250 ms |
| tree walk on the loop | every poll | off-loop |

## 4 · What is measured vs. what is claimed — brutally

- **Measured (unit level):** every row in §3 has a test that plants the failure and reads the counter.
- **Not measured:** *no overnight has run with this code.* Nothing is deployed to `vigil` (deploys are
  owner-authorised only). `fsync_max_ms` and `loop.lag_max_ms` have **no real-corpus value yet** —
  the entire point of adding them is to get one before deciding whether S2 needs the writer moved off
  the loop. "Estimated improvement" is therefore **not a number**; it is: two silent-loss classes
  (S1, L1) became impossible-to-miss, and two unknowns (S2, L2) became readable.
- **Fairness (charter §29) was not measured** because there is nothing to measure yet: the runners
  do not share a queue, so the only fairness question is loop latency, and the instrument for it is
  what this PR adds.
- **Failure injection (charter §28):** ENOSPC on write, closed handle, cancellation mid-recovery,
  supervisor crash, a planted 150 ms loop stall — all at unit level. Radio hard-fault, adapter
  hot-unplug, memory pressure, clock step — **not injected**; see §7.

## 5 · AirCANnect comparison (charter §35)

| category | verdict | why |
|---|---|---|
| resource model explicitness | **WEAKER → EQUIVALENT** | AirCANnect names every resource in a struct; Tepna named them in this brief and publishes their state (`gates`, `loop`, `tasks`). Still no single in-code registry — deliberately (§7). |
| admission / ownership | **NOT APPLICABLE** | one task per link ⇒ no admission contention; the one shared gate is a bool. An `ACCEPTED/BUSY/DEFERRED/…` enum would model a queue that does not exist. |
| health states + evidence counters | **EQUIVALENT** | `flush_failures`, `rows_lost`, `crashes`, `stalls` are counters, not booleans; "connected ≠ healthy" is already the runners' rule (data-arrival, not connect, resets backoff). Quarantine of a flapping *adapter* — WEAKER (§7). |
| retry discipline | **BETTER** | bounded exponential (cap 180 s), reset only on genuine data, attempt + next-retry published, and **jitter** — which AirCANnect itself lacks. |
| failure-safe release | **EQUIVALENT** | every gate set-site has `finally`. |
| cancellation / generations | **EQUIVALENT / NOT APPLICABLE** | asyncio cancellation is real; `_LINK_EPOCH` already stamps a link generation on every connect. |
| storage backpressure | **EQUIVALENT** | loss is now evidence, never silent. Degradation *levels* 0–5 — WEAKER: not built (§7). |
| memory bounds | **EQUIVALENT** | no unbounded queue exists (writers are direct-write; pollers are periodic). No explicit bound was added because none was found needed — audit result, not omission. |
| CPU budgeting / timing telemetry | **WEAKER → EQUIVALENT** | loop lag + fsync time now measured; no per-task CPU budget. |
| structured telemetry | **EQUIVALENT** | rate-limited transition logs, status JSON. |
| deterministic tests | **BETTER** | 39 planted-failure tests; AirCANnect's tests are hardware-in-loop. |
| priority hierarchy P0–P8 | **EQUIVALENT in practice** | the loop has no priorities, but the P0 path (bleak callback → `fh.write`) has nothing in front of it once walks are off-loop and fsync is measured. |

## 6 · Acceptance checklist (charter §36) — honest marks

✅ resource ownership explicit and queryable (`gates`, `tasks`, per-device `retry`) · ✅ retries
bounded, jittered, published · ✅ every gate released on every exit path · ✅ raw-data loss never
silent · ✅ loop starvation observable · ✅ background tasks supervised · ✅ walks off the loop ·
✅ deterministic failure-injection tests · ✅ no rebalancing of active capture (none exists) ·
✅ scientific correctness untouched (no DSP, no clock, no export changed) ·
❌ adapter hotplug / quarantine · ❌ degradation levels · ❌ CPU budget · ❌ fairness measured ·
❌ post-recovery verification ("connected ≠ healthy" for a *radio*) · ❌ shutdown ordering audited ·
❌ overnight witness. **10 of 17 substantive items; the ❌ column is §7.**

## 7 · Deliberately NOT built (and the measurement each waits on)

| item | why not now | gated on |
|---|---|---|
| move fsync off the loop (thread/queue writer) | changes the P0 write path from direct to queued — new loss class (queue on crash). Not without a number. | `fsync_max_ms` from one real night ≥ 250 ms |
| wire `adapter_pool.py`; adapter hotplug, quarantine, flap cap | multi-adapter nights are not yet the operating mode; `_migrate_to_spare` covers the one real case | a second adapter in the deployed config |
| admission enum / generations / quiesce coordinator | models contention that the one-task-per-link design does not have | never, unless a shared queue appears |
| degradation levels 0–5 | needs the S2/L2 numbers to know what to shed first | `loop.stalls` on a real night |
| watchdog false-alive / shutdown ordering | separate audit; not on the charter's P0 path | — |
| `connected=False` during `_retry_sleep` | stall path today keeps `connected` true while sleeping; changing it moves `_LINK_EPOCH` semantics — residue row | design decision |

## 9 · 2026-09-12 — THREE of §7's gates have been MET by measurement (Kestrel)

A fresh charter arrived asking for a system-wide Resource Orchestrator: resource identity, real
ownership, claim/queue/lease/release, priority, fairness, deadlines, dependency ordering, crash
recovery, BLE arbitration, observability. **Most of it is this brief**, already audited and landed on
2026-09-05, and the rest is §7 — deferred with a stated reason and a named gate, not overlooked. That
is recorded here so the next reader does not re-derive it, and because the charter's own first rule is
*inspect before designing*.

What is genuinely new is that **three of §7's gates have since been met**, so those rows are now
actionable rather than waiting:

| §7 item | gate it waited on | status 2026-09-12 |
|---|---|---|
| move fsync off the loop | `fsync_max_ms` ≥ 250 ms on one real night | ✅ **MET, and the remedy is narrower than the row assumed** |
| adapter hotplug / quarantine / flap cap | a second adapter in the deployed config | ✅ **MET — vigil ran FOUR adapters** |
| post-recovery verification ("connected ≠ healthy" for a *radio*) | — (no gate was stated) | ✅ **now has a measured instance** |

**fsync.** Residue `2026-09-10-fsync-band-crossed-and-the-remedy-is-narrower`: 20 `SLOW fsync` events
across six consecutive nights, 252–1702 ms. The band this brief set is crossed many times over. ⚠️ And
the objection that justified deferring it — *"changes the P0 write path from direct to queued — new
loss class (queue on crash)"* — **does not apply to the shape that is actually needed**: `flush()` is
userspace→kernel and cheap; only `fsync` is the 250–1702 ms part, and after `flush()` the rows are
already in the kernel, so a *process* crash loses nothing. Move the **fsync**, not the writer, and the
loss class never appears. A disk-pressure confound is NOT excluded (`/srv/data` was 98 % full that day),
so a post-fix measurement must record free space beside the latency.

**Adapters.** On 2026-09-11/12 vigil ran **four** radios at once (two Zephyr dongles, the CSR, the
Intel), which is exactly the operating mode this row said did not yet exist. It also produced the
failure the row anticipated: residue `2026-09-11-dead-adapter-goes-unnoticed` — a configured adapter
wedged at 19:23 and was still wedged 15 minutes later, `org.bluez.Error.InProgress` and kernel `-110`
repeating every 2 s, **zero of three sensors connected, and nothing on the box said so**. No btreset
systemd unit exists; `journalctl` logged **0** reset attempts across the window. ⚠️ Not Zephyr-specific:
the detection gap applies to whichever radio is configured, and `ZEPHYR-INSTRUMENT` already records the
Realtek's own intermittent deafness.

**"Connected ≠ healthy."** This item had no gate because nobody had a clean instance. There is one now,
and it is unusually sharp: the wedged adapter reported `UP RUNNING` to `hciconfig` **while `HCI Reset`
(`0x0c03`) itself timed out at `-110`**, and a USB de/re-authorize left the device enumerated with no
HCI node at all — alive at USB, dead at HCI. A health check that reads link state, or even adapter
state, would have called that radio healthy for fifteen minutes. Post-recovery verification for a radio
therefore has to probe a command round-trip, not a flag.

### What today's fragmentation work contributes to this brief

A link drop that mints a new file-set **is** a resource-lifecycle event, and two of its causes were
fixed under this brief's model rather than beside it (#2405): the ring never consulted `resumable_stamp`
while the Polar path had since #1532 — a resource whose release/re-claim was not idempotent across a
reconnect — and a zero device stamp resolving to `_POLAR_EPOCH` drove `clock_watchdog` into a re-sync
that *drops the link*, i.e. background maintenance preempting live acquisition, which §8's priority
ordering exists to prevent. Both are now guarded and gated.

### Honest score, against the charter's own categories

The charter asks for a score and forbids claiming 100 % because code exists. On its 22 categories, with
this brief's §6 marks carried forward and the three gates above re-opened: **roughly 10 implemented, 3
now actionable-with-evidence, 4 deliberately not-applicable to a one-task-per-link design (admission
enum, generations, quiesce coordinator, CPU budget), and the remainder partial.** The single largest
real gap is not a missing abstraction — it is that **no resource on this box is health-checked after
recovery**, which the 15-minute dead adapter demonstrates end to end.

⚠️ **What this brief still declines to build, and why that has not changed.** The charter asks for a
generic orchestrator with priority, fairness, aging, deadlines and dependency ordering. §1's diagnosis
stands: the daemon is **one task per link** with a process-global `_CONNECT_LOCK` for establishment.
There is no shared queue for priorities to order, no second waiter for fairness to arbitrate between,
and no A-holds-1-wants-2 pair for deadlock ordering to prevent. Building that machinery would model
contention this design does not have — and `find_unwired` would correctly call every unused field of it
decorative, exactly as it did for `adapter_pool` (5 public functions, allowlisted as ASPIRATIONAL,
waiting on per-device pinning nobody has asked for). **Build the three gated items; do not build the
framework around them.**

## 8 · Verification

`capture-host/check.sh` (ruff · shellcheck · pytest `--cov --cov-branch --cov-fail-under=100` ·
`find_unwired.py --check`) green on the PR head — see the PR body for the `TOTAL` row.
