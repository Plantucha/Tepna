<!--
  O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (core BUILT — verified 2026-09-05: `capture-host/oxy_power.py` is the engine, wired into
`capture.py` at the link-axis emit, the two automatic pull pollers, `pull_oxyii_session`, the presence scan
loop and the restart-storm hold; 55 assertions in `tests/test_oxy_power.py` (30 adversarial state-machine
cases, §23) + 18 wiring cases in `tests/test_oxy_power_wire.py`; `check.sh` green. Remainder is §22/§24 —
the power budget and the 15-item acceptance run need the ring on the owner's bench, and the passive-scan
mode (§3) is untested against vigil's BlueZ. **Owner:** owner (box) for §22/§24 · **Next step:** one
attended night with `webmon /state` `"power"` sampled hourly) · **Created:** 2026-09-05

# O2Ring — a power-aware BLE lifecycle for the acquisition system

**Relationship:** EXTENDS `O2RING-AUTONOMOUS-HARVEST-2026-08-26-BRIEF.md` (the charter) and
`O2RING-PRESENCE-TRIGGER-IMPL-2026-08-26-BRIEF.md` (the PRESENCE axis). It adds a fourth axis — **POWER** —
to the LINK · RECORDING · PRESENCE triple, on the same `OXYLIFE.csv` journal (`axis="power"`), and it
changes **who is allowed to spend the radio and when**. It does not add a downloader, a scanner, or a
second identity check: every primitive it needs already existed (§1), and the gap analysis below is what
was actually missing.

Task charter (owner, 2026-09-05): *MINIMIZE radio on-time · MINIMIZE ring battery drain · MAXIMIZE harvest
reliability · NEVER sacrifice raw data or provenance*, priority order §25: **raw data integrity > device
identity > safe protocol > provenance > reliable unattended operation > battery/radio > CPU.** Every
decision below that trades power against data went the data way.

---

## §1 Gap analysis — what existed, what did not (measured against `origin/main` 476dfdf0)

| task § | requirement | state before | state after |
|---|---|---|---|
| §2 | explicit power states | **ABSENT** — LINK (`OxyState`), RECORDING (`OxyRecEngine`) and PRESENCE (`OxyPresState`) axes existed; nothing modelled *the radio* | `oxy_power.PowerState`, 12 states, 45 legal edges, illegal edges refused and counted |
| §3 | passive scan default | **INVERTED** — presence observer used `BleakScanner.discover()` (active) unconditionally; only `_connect_scan` had the passive-opportunistic flag | observer shares `_O2_PASSIVE_SCAN`: passive first, downgrades to active on the stack's first refusal |
| §4 | presence ≠ ready ≠ recording ≠ ready-for-harvest | PARTIAL — three axes existed but no single decision consumed all three | `RingPower.harvest_request(link_state, worn)` reads LINK + RECORDING + the re-arm chain |
| §5 | per-ring cache | memory-only, scattered (`_CHARGER_SINCE`, `_*_PULLED`, `_OXYII_RESTARTS`, `_OXYII_HOLD_UNTIL`) | `RingCache` per engine, published in `webmon /state → power[name].cache`; transitions journaled |
| §6 | transitions not raw adverts | PARTIAL — `oxy_presence.witness_chain` already reduced sightings to transitions | engine consumes `note_presence(state)` transitions only; sightings are a counter |
| §7 | named scan-policy constants | **ABSENT** — `_presence_scan_loop` slept `window_s` after a `window_s` scan: **50 % duty, all night, ring present or not** | `SCAN_LOW / MODERATE / RESPONSIVE`, chosen per window from the power state (table below) |
| §8 | SAFE→CONNECT→IDENTIFY→INVENTORY→DOWNLOAD→VERIFY→COMMIT→DISCONNECT | **EXISTS** — `pull_session._pull_once` + `oxy_transfer` (0xE1 identity, ledger, `.part`→rename commit) | unchanged; the engine books its outcome |
| §9 | seven phase timeouts | PARTIAL — six existed under other names; CONNECT was bleak's unnamed default | `oxy_power.TIMEOUTS` names all seven; `pull_session` passes `connect_s` explicitly |
| §10 | 3 attempts then cooldown | `oxy_transfer.MAX_ATTEMPTS` existed for *chunks*; nothing bounded *connections* | `MAX_ATTEMPTS=3` strikes → `COOLDOWN` 1800 s |
| §11 | failure-type backoff | `FailureClass` + `_is_recoverable` existed, **UNWIRED** to any wait | `BACKOFF_S[class]`, doubling per strike, capped at the cooldown |
| §12 | no connect-fail loops | **UNWIRED** — `autopull_poller` retried a failed connect *immediately*, `retries` times per cycle | `attempt_allowed()` vetoes; a failure ends the hourly cycle, backoff owns the retry |
| §13 | no stale handles | **EXISTS** — `async with BleakClient` + `wait_for` | unchanged |
| §14 | disconnect cleanup | PARTIAL — no `stop_notify` | **deliberately unchanged**: the ring is a non-bonded peer, its CCCD resets on disconnect; a `stop_notify` on a dying link is a second failure mode for zero gain |
| §15 | disconnect after work | EXISTS for pulls (context manager) / ABSENT for live (live holds the link by design — it is the capture) | unchanged |
| §16 | never interrupt live raw PPG | `autopull_poller` already gated on `on_body(st) is True`; the charger/doff/presence path did not | `harvest_request` refuses while LINK is `live` → `deferrals_live` |
| §17 | BLE ownership / RESOURCE_WAIT | **ABSENT** — five uncoordinated mechanisms (`offline_lock`, `_OXYII_PAUSE`, `_CONNECT_LOCK`, adapter pool, CPAP) | `note_busy()` → `RESOURCE_WAIT`, **not a strike**; `RadioOwner` names who holds it |
| §18 | battery bands from adverts | **ABSENT** | `battery_band()` from the live vitals frame the link already delivers; never a connect for battery; never a delete |
| §19 | synced-idle re-arm only via WORN→RECORDING→REMOVED→SYNC_READY | PARTIAL — `_CHARGER_PULLED` latch per charge session was the only "once" | `note_worn_rec()` chain; `synced_this_idle` cleared only by the full chain |
| §20 | power-failure recovery | PARTIAL — journal survives, cache does not | unchanged by design: a restart re-derives from what it observes; §5 rows are in the journal |
| §21 | telemetry counters | **ABSENT** | `Counters` (scan/connection/harvest seconds, files, bytes, strikes, cooldowns, three deferral classes) → `webmon /state["power"]` |

**Not built, on purpose:** a persistent per-ring cache file (§5) — the OXYLIFE journal already is the durable
record and a second file is a second truth; `stop_notify` (§14, above); a change to `pull_session`'s
phase order (§8 — it already is the order the task specifies).

---

## §2 The state machine

```
                 ┌──────────────────────────────────────────────────────────────────┐
                 ▼                                                                  │
   RADIO_IDLE ──► PASSIVE_SCAN ──► DEVICE_DETECTED ──► HARVEST_CANDIDATE ──► CONNECTING ──► HARVESTING ─┐
       ▲  ▲          │  ▲              │  ▲                 │                   │ │ ▲                   │
       │  │          │  └──────────────┘  └─────────────────┘                   │ │ │                   │
       │  │          └────────────────────────────────────────────────────────►─┘ │ │                   │
       │  │   live loop: RADIO_IDLE/PASSIVE_SCAN/DEVICE_DETECTED ──► CONNECTING ──┘ │                   │
       │  │                                                                          ▼                   ▼
       │  │                                                           CONNECTED_IDLE ◄──► ACTIVE_CAPTURE
       │  │                                                                          │        │
       │  │                                                                          ▼        ▼
       │  └───────────────────────────────────────────────────── DISCONNECTING ◄─────┴────────┘
       │                                                          │   │   │
       │        ┌─────────────── (cooldown over) ─────────────────┘   │   │
       │        ▼                                                     ▼   ▼
       ├──── COOLDOWN ◄─────────────── ERROR_BACKOFF ◄──── (strike)   RESOURCE_WAIT
       │        ▲                            │                            │
       │        └──── 3rd strike ────────────┘                            │
       └──────────────────────────────────────────────────────────────────┘
```

- **Radio-on set** (`RADIO_ON`): PASSIVE_SCAN · CONNECTING · CONNECTED_IDLE · ACTIVE_CAPTURE · HARVESTING ·
  DISCONNECTING. Every second in it has a `RadioOwner` (`scan_for_o2ring · live_o2ring_capture ·
  o2ring_harvest · cpap_capture · recovery`).
- **Waiting states leave ONLY through RADIO_IDLE or a re-scan — never straight into CONNECTING.** That
  missing edge *is* §12: the connect-fail loop cannot be expressed.
- An illegal transition is refused and counted (`illegal_skipped`), never raised into the data path.

### §7 scan policy (one radio, many rings → the shortest interval any ring asks for)

| policy | window | interval | duty | when |
|---|---|---|---|---|
| `SCAN_LOW` | 10 s | 110 s | 8 % | RADIO_IDLE — no ring present |
| `SCAN_MODERATE` | 10 s | 50 s | 17 % | DEVICE_DETECTED / HARVEST_CANDIDATE — present, not expected to sync |
| `SCAN_RESPONSIVE` | 10 s | 10 s | 50 % | RECORDING axis reads `end_candidate` — a session is closing |

The 50 % figure is what the observer ran at *around the clock* before this change.

### §9 timeouts (`oxy_power.TIMEOUTS`)

| phase | s | where it binds |
|---|---|---|
| discovery | 25 | `_connect_scan` |
| **connect** | **30** | `pull_session` `BleakClient(timeout=…)` — was bleak's unnamed default |
| auth | 10 | 0xFF handshake wait |
| service discovery | 10 | GATT walk |
| inventory | 20 | 0xF1 file list |
| transfer chunk | 20 | `oxy_transfer` per-chunk stall |
| disconnect | 10 | teardown |

### §11 backoff by failure class (× 2 per strike, capped at `STRIKE_COOLDOWN_S` = 1800 s)

`TRANSPORT_FAILURE / STREAM_STALL / TRUNCATED_TRANSFER` 60 · `TIMEOUT / FRAME_CORRUPTION / RECOVERABLE_ERROR`
120 · `DEVICE_UNAVAILABLE` 300 · `STORAGE / VALIDATION` 600 · `AUTHENTICATION` 1800 · `PROTOCOL / FATAL` 3600.
A ring that refused our auth is not helped by a faster retry.

---

## §3 Wiring decisions worth recording (each is a test)

1. **The engine is keyed by device NAME like `STATUS`, created in `run_oxyii` with the BLE address** so
   the address is on the record from first sight (address-only identity, standing ruling).
2. **Gate placement: the two AUTOMATIC pollers only.** `charger_pull_poller` (charger/doff/presence) and
   `autopull_poller` (hourly) ask `attempt_allowed(now)` then `harvest_request(...)` *before* spending any
   `_*_PULLED` latch, so a deferred trigger is still armed when the veto lifts. The **manual API pull is
   ungated** — an operator asking is the override.
3. **The hourly net runs `strict_idle=False`.** A night with no link never observes `worn=True`, so the §19
   chain cannot complete and a strict veto would leave the night's file on the ring forever. §25 puts raw
   data above battery; the event triggers stay strict. A synced idle re-docked *without* being worn is
   DEFERRED by the charger trigger — deliberate, tested.
4. **A busy offline slot is RESOURCE_WAIT, not a strike** — no radio was spent, nothing was learned about
   the ring.
5. **A failed hourly attempt ends the in-cycle retry loop.** The failure was a strike inside
   `pull_oxyii_session` and opened a typed backoff; the `retries` loop keeps draining a *reachable* ring.
6. **The restart-storm hold (#2209) is a COOLDOWN with a deadline** — journaled once per deadline
   (`note_cooldown` idempotent on `until`), and the pollers refuse until it passes. Its own protection is
   untouched; the power axis makes it visible and adds nothing to it.
7. **Bookkeeping lives inside `pull_oxyii_session`** (`attempt_started` / `attempt_finished` in its
   `finally`), so a *second* dispatch from the same site (#2243's follow-on drain) is booked without the
   caller knowing about the axis.
8. **`_power_observe` reads the other axes' last published STATUS values** when a field is not supplied —
   no extra read, no extra radio; the ~1 Hz vitals path pays a dict lookup.

---

## §4 What remains unproven until the ring is on the bench (§22 · §24)

- **Passive scan on vigil's BlueZ.** `scanning_mode="passive"` with no `or_patterns` may be refused by the
  stack; the fallback to active is tested, the *success* path is not. Measure: `btmon` shows
  `LE Set Scan Parameters: Passive` during a presence window.
- **Power budget (§22):** scan on-time per night, connection seconds, harvests per night — all in
  `webmon /state["power"][name].counters`; sample hourly for one attended night and put the numbers here.
- **Ring battery drain over one night** with passive scan vs the previous 50 % active duty — the ring does
  not report drain; compare `battery` at doff across nights.
- **§24 acceptance (15 items):** ring worn → no harvest; ring removed with session → one harvest; failed
  connect ×3 → 30 min silence; live capture + charger dock → HARVEST DEFERRED; CPAP window + ring sync →
  RESOURCE_WAIT then harvest; restart mid-harvest → `.part` discarded, re-pull; ring absent 8 h → ≤ 8 %
  scan duty; battery `critical` band → no behaviour change except the band; second dispatch per event
  (#2243) → two attempts booked, one gate; manual pull during cooldown → runs; journal rows have
  `axis=power`; counters monotone; `illegal_skipped == 0` over the night; deferrals split by class;
  `synced_this_idle` cleared only after the full chain.

Residue: none surfaced at build time. If the attended night surfaces one, it goes to `briefs/RESIDUE.md`.
