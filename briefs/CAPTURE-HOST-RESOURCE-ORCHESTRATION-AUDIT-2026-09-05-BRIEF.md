<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS (audit + smallest change set landed 2026-09-05; §7 is the remainder. **Re-verified 2026-09-15 (Heron) against the tree, because §9 left all three of its met gates reading as outstanding:** §7's *fsync off the loop* is BUILT and its residue is closed `fixed #2382` — `writers.py` carries `_fsync_worker`/`_submit_fsync`/`_drain_fsync` and the queue holds dup'd-fd+health pairs, never rows, which is exactly the narrow remedy §9 argued for; *adapter hotplug/quarantine/flap cap* is NOT built and its residue `2026-09-11-dead-adapter-goes-unnoticed` is still OPEN; *post-recovery verification for a radio* is **BUILT 2026-09-18 (#2624)** — `_adapter_responds` (`capture.py:5931`) round-trips `hciconfig <hci> version`, chosen by measurement: it increments the adapter's TX `commands:` counter by 1 where the state read increments it by 0. A failed round trip now BREAKS `classify_adapter_health`'s `adapter_up is True` suppression and is wedge evidence on its own; a TIMEOUT is False deliberately, every other failure is None. Live on vigil since the 2026-09-18 deploy. ⚠️ The SECOND blindness §9 named is NOT closed: it still reads only the PINNED adapter, so a wedge on any other radio is unseen. **So §7's remainder is ONE item, not three** — and the two that closed did so in opposite directions, which §10 and §11 record: §10 excluded the fsync disk-pressure confound by measurement (zero low-disk windows in six weeks; latency barely moved, incidence rose 12x per file), and §11 REFUTED the adapter-ladder residue row's headline — the ladder DID detect, escalate and reset on 2026-09-11; the real defects are ~19 min detection latency and rungs that cannot fix a cdc_acm wedge. **Re-triaged 2026-09-20 (Heron) on picking up §7's remainder: that row names THREE things of three different statuses, and reading it as one unbuilt item is how it keeps getting re-sized.** (a) The *flap cap* IS ALREADY BUILT — `max_failovers` (default 3) has capped ping-pong between two flaky radios since P1.5, at both failover call sites; the row lists as missing something that ships. (b) *Quarantine* is now built, in the shape the measurement actually justifies (changeset `2026-09-20-live-spare-round-trip`): `failover_target` chose a spare on `up`, the CACHED kernel flag that the 2026-09-11 radio reported while `HCI Reset` timed out at -110, so the ladder could disconnect and re-bond every wearable onto a radio that answers nothing and then reset its own reset budget as though it had recovered. A spare is now round-tripped before migration, a deaf one is quarantined for a cooldown (never a permanent verdict), and a box whose every spare is deaf refuses the migration rather than spending the flap cap. ⚠️ Only `False` convicts — an undeterminable probe leaves prior behaviour exactly as it was. (c) What is genuinely LEFT is *wiring `adapter_pool.py`* — still imported by nothing but its own test, and its per-device `{device: adapter}` map still has no consumer because the daemon repoints ONE global pin, so wiring it is an architecture change and not a hookup — and *hotplug*. Neither is unblocked by this work. The health of an IDLE radio is residue `2026-09-20-unpinned-radio-wedge-seen-only-at-failover`) · **Created:** 2026-09-05 · **Residue:** 2026-09-20-unpinned-radio-wedge-seen-only-at-failover, 2026-09-05-retry-sleep-stale-connected, 2026-09-05-fsync-on-loop-unmeasured, 2026-09-05-supervised-restart-resets-state, 2026-09-06-writer-close-list-hand-kept

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
(`keep_running`, `capture.py` `keep_running`) with its own reconnect loop; pollers (storage, QC, archive,
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
| **S2** | storage ↔ timing | `_maybe_flush` runs `flush()` **+ `os.fsync()` on the event loop** every 5 s per stream. bleak delivers notifications *on the loop*, so every live stream's host stamp waits behind every other stream's fsync. **Never measured.** | `writers.py` `_maybe_flush` |
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
| ~~move fsync off the loop (thread/queue writer)~~ **BUILT — #2382** | gate met (20 `SLOW fsync`, 252–1702 ms over six nights) and the remedy landed in the narrower shape §9 identified: the **fsync** moved, not the writer, so the feared queue-on-crash loss class never appeared | ~~`fsync_max_ms` ≥ 250 ms~~ — discharged; verified in the tree 2026-09-15 |
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

> **Re-verified against the tree 2026-09-15 (Heron).** §9 says these three are "actionable rather than
> waiting", and a reader three days later cannot tell which have since been done — one had. Stated per
> row so the next pickup does not re-derive it:
>
> * **fsync — BUILT, #2382, residue closed.** `writers.py` carries `_fsync_worker` / `_submit_fsync` /
>   `_drain_fsync`, and its own comment records that the queue carries "(dup'd fd, health) pairs, never
>   rows". That is the narrow shape argued for above, landed: the **fsync** moved and the writer did not,
>   so the queue-on-crash loss class that justified the original deferral never appeared. ⚠️ The
>   disk-pressure confound §9 raised **is now EXCLUDED — measured 2026-09-18, §10 below.** Free space was
>   never low (zero `storage: LOW` lines in a six-week journal, 148 GB free), and the latency distribution
>   barely moved. What DID move is the incidence, 12× per file — §10 says what that is and is not.
> * **Adapter hotplug / quarantine / flap cap — NOT built.** Residue
>   `2026-09-11-dead-adapter-goes-unnoticed` is still `OPEN`.
> * **Post-recovery verification for a radio — NOT built, and the gap is narrower than "no probe exists".**
>   There is no HCI command round-trip anywhere in capture-host (`0x0c03` / `HCI_RESET` / `hci_send`:
>   zero hits outside comments). `classify_adapter_health` is PURE and flag-fed — it takes `adapter_up`
>   from `_adapter_is_up(_hci_now)`, a *state read* on the **single pinned** adapter, and has exactly one
>   consumer (`capture.py` `adapter_watchdog`). So it is blind twice over: it would have read the wedged radio's
>   `UP RUNNING` as healthy while `HCI Reset` itself timed out, AND it cannot see a wedge on any of the
>   other three radios vigil was running, because it only ever looks at the pinned one. A round-trip probe
>   is the fix for the first blindness; it does not address the second.

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

## 10 · 2026-09-18 — the owed post-fix measurement, taken on vigil (Kestrel)

§9 left one thing owed in as many words: *"a post-fix latency measurement owes free space beside it, and
none has been taken."* Taken now, read-only on the box, from `journalctl -u tepna-capture` (journal spans
2026-08-04 → 2026-09-18) plus `df`.

**The population splits on the log string itself.** `writers.py` `note_fsync` tags the post-fix line
`(off-loop worker)`; the pre-fix line does not. 185 `SLOW fsync` events total, **20 pre / 165 post** — and
the 20 matches §9's *"20 `SLOW fsync` events"* exactly, which is the corroboration that the split is real
and not a grep artifact.

### The confound is excluded

- **Zero** `storage: LOW` or `storage: recovered` lines in the entire six-week journal — so free space
  never crossed `min_free_gb` at any point on either side of the fix.
- `df` at measurement time: **148 GB free of 233 GB (34 % used)**.

Disk pressure does not explain the post-fix latency. That is the question §9 asked, and the answer is no.

### The latency barely moved — the INCIDENCE moved

| | n | min | median | p90 | max | mean |
|---|---|---|---|---|---|---|
| pre-fix (on-loop) | 20 | 252 | 326 | 414 | **1702** | 398 |
| post-fix (off-loop) | 165 | 255 | 376 | 619 | **1334** | 422 |

Median +50 ms, mean +24 ms, and the **maximum FELL** (1702 → 1334 ms). The disk is not taking materially
longer to confirm a write. What changed is how many files see a slow barrier at all:

| window | events | files in the night dirs | share of files |
|---|---|---|---|
| pre 09-05 → 09-09 | 17 | 1003 | **1.7 %** |
| post 09-10 → 09-18 | 165 | 803 | **20.5 %** |

**12.1× per file** — and note the denominator moved the *other* way: file volume FELL 1003 → 803, so the
rise is not a volume artifact. Per day it is 5.4×; per file, 12.1×.

### What that is, and what it is not

`_slow_said` fires **once per file**, so these counts are files-with-≥1-slow-barrier, never a count of slow
barriers. Read with the distribution above, the most economical reading is that the fix did what it was
built to do and this is its cost side: barriers now queue behind one another in the worker instead of
blocking the loop, so more of them cross 250 ms while none of them stalls capture — which is exactly what
the log line's own text asserts (*"capture was not stalled by it"*). **The trade was never quantified
before; it is now.**

⚠️ **Three limits, stated rather than smoothed over:**

- **The transition is 2026-09-10 — five days BEFORE #2382 merged (2026-09-15).** The split by log string is
  sound regardless, but *why* the box carried the off-loop code before the merge is not established here,
  and it should not be explained away. Anyone reasoning from these windows should settle that first.
- **There is no baseline before 2026-09-05.** The journal starts 08-04 and carries zero `SLOW fsync` lines
  until 09-05 — that is the instrument arriving, not a fast disk. A "nothing before September" reading
  would be `§4b`'s examined-nothing shape.
- **"Files" is every file in the night directory**, not every file behind an fsync'd writer, so the share
  is an under-estimate of the per-writer rate. The imperfection is identical on both sides, so the ratio
  survives it; the absolute 1.7 %/20.5 % do not.

### Unrelated, found while measuring

`tepna-sniff.service` (*"Tepna — nightly BLE air capture + audit"*) is in **failed** state on vigil. Not
touched — box ops is owner-authorized — and recorded here only so it is not discovered twice.


## 11 · 2026-09-18 — the adapter ladder DID fire on 2026-09-11; the residue row's headline is wrong (Kestrel)

§7's second remaining item is *adapter hotplug / quarantine / flap cap*, whose residue row
`2026-09-11-dead-adapter-goes-unnoticed` opens with: *"A BLE adapter that stops answering HCI is not
detected, reset, or reported by anything on the box"*, and records *"`journalctl` logged **0** reset
attempts across the whole window."* The row also names its own first task — *"whether it exists, is wired,
or simply has no trigger for this state is UNRESOLVED and is the first thing a picker-up should establish
rather than assume."* Established, from the box's own journal, which still reaches back to 2026-08-04.

### The ladder exists, is wired, and fired

```
19:42:06  WARNING watchdog: wedge sign 1/2 — pinned adapter DOWN/not-found; Wellue O2Ring-S: InProgress; Polar H10 02849638: InProgress
19:43:06  WARNING watchdog: wedge sign 2/2 — pinned adapter DOWN/not-found; …
19:43:06  WARNING watchdog: power-cycling adapter 99:67:24:2E:CD:98 (attempt 1/3)
19:43:15  INFO    watchdog: recovery: hciconfig hci0 reset exited 1
19:44:17  WARNING watchdog: wedge sign 1/2 — pinned adapter DOWN/not-found; Polar H10 02849638: InProgress
```

Detected, escalated through `grace_checks`, power-cycle attempted, `hciconfig reset` **exited 1**. The
row's own manual attempt — *"`hciconfig reset` returned `Can't init device: Connection timed out (110)`"* —
is the same failure by hand, which is the corroboration that the rung ran and could not work.

### Why the row measured zero, and why both reasons matter more than the row

Two independent causes, either sufficient:

1. **The window closed before the event.** The row's check was `journalctl --since -12min` taken around
   19:38. The first wedge sign is **19:42:06**. The evidence had not happened yet.
2. **It searched for vocabulary the code does not emit.** The row grepped `btreset` / `reset-adapter` /
   `resetting-hci`. The daemon logs `watchdog: power-cycling adapter …` and `recovery: hciconfig … reset`.
   Zero matches, zero of them meaningful.

⚠️ **And the same shape produced the row's other zero.** *"No btreset systemd unit exists on the box"* is
TRUE and is not evidence: the ladder is not a unit. It is `adapter_watchdog`'s L1/L2 rungs inside
`capture.py`, with `tepna-btreset.sh` reachable as `daemon_control._VERBS["rebind"]`. Re-verified
2026-09-18 — there is still no btreset unit, unit file, or script at the searched paths, and the ladder
still fired. **Searching for the wrong artifact type returns zero exactly as convincingly as absence
does.**

### What is ACTUALLY open, restated from the evidence

| the row claims | measured 2026-09-18 |
|---|---|
| not detected | **detected** — wedge sign 1/2 at 19:42:06 |
| not reset | **reset attempted** — power-cycle + `hciconfig reset`, 19:43:06/19:43:15 |
| not reported | **reported** — four WARNING lines |
| 0 reset attempts | **1 attempt, which FAILED (exit 1)** |

So the defect is real but is **neither of the two things the row names**. What remains:

- **Detection latency ≈ 19 minutes.** Wedge onset 19:23:12 (the row's own timestamp) → first wedge sign
  19:42:06. On a capture box that is most of a lost episode. Why it took that long is NOT established
  here and should not be guessed: `grace_checks`, the `healthy_run` hysteresis, the `_POLAR_PAUSED` skip
  and the pinned-adapter read are all candidates, and §9's *"blind on any of the other three radios"*
  finding is independent of all of them.
- **The rungs cannot fix this wedge class.** `hciconfig reset` exited 1 from the daemon and timed out by
  hand; the row's USB de/re-authorize left the device enumerated with no HCI device created. A ladder
  that detects correctly and has no effective rung is a different defect from a missing detector, and it
  is the one the fix should target.

### One hypothesis measured and REFUTED, recorded so it is not re-derived

`capture.py` `_OFFLINE_OP_TIMEOUT_S` warns that *"adapter_watchdog, clock_watchdog and rssi_poller all skip while
`_POLAR_PAUSED` is non-empty, so the one mechanism built to unwedge a stuck radio is disabled by exactly
the condition that wedges it"*, and the window carries **77 pause/resume pairs in 29 minutes** — a clock
auto-sync retry storm (64 `org.bluez.Error.InProgress` retries). That is an attractive explanation for a
silent watchdog and it does **not** hold: the union of the paused intervals is **359 s of a 1733 s span =
20.7 %**, which can starve roughly 6 of ~29 polls, not all of them. The starvation is real and bounded;
it is not why detection took 19 minutes.

⚠️ Note also that `_OFFLINE_OP_TIMEOUT_S = 300` bounds a SINGLE op and says nothing about duty cycle —
77 short ops are not one long one. That gap is worth keeping in mind for the latency question above, but
20.7 % does not carry it on its own.


## 8 · Verification

`capture-host/check.sh` (ruff · shellcheck · pytest `--cov --cov-branch --cov-fail-under=100` ·
`find_unwired.py --check`) green on the PR head — see the PR body for the `TOTAL` row.
