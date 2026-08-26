<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-24 · **Created:** 2026-08-24 · **Follows:** `AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION-2026-08-24-BRIEF.md`

# AS11 session detector — implementation (shadow-mode-first)

The executable companion to the investigation report (`AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION`),
which is now ratified (owner picked "the session detector" 2026-08-24; Mutator relayed the owner-tasking
with the implementation contract). This brief holds the build reference (the capture-host API sweep), the
exact state machine, the shadow rollout, and the done-when. Out-of-suite (`capture-host/`) — no bundle /
`manifestHash` / provenance impact; gated by `capture-host/check.sh` (ruff · shellcheck · pytest
`--cov-fail-under=100` · `find_unwired`).

**Hard invariants (unchanged from the charter — the implementation contract).** READ-ONLY on the AS11
(never `Set`/`EnterTherapy`/`EnterStandby`/`SetDateTime`) · supervisor sits ABOVE `LiveStreamController`,
never a second controller (§18) · UNKNOWN ≠ stopped and BLE-disconnect ≠ therapy-end · the Clock Contract
is untouched (the ~21-min device-clock skew is reconciled at the ingest boundary, not here) · **shadow
mode first is also the data collector** — it logs its would-have decisions against real button usage,
which simultaneously tunes the debounce and validates the machine before anything acts · flip to acting
only after ≥1 clean night of shadow-vs-reality agreement · manual button is a permanent override both
ways.

## Architecture (ratified)
`CPAPSessionSupervisor` OBSERVES the device and decides start/stop; `LiveStreamController` keeps
live-stream / drain / raw / EDF / finalize. The supervisor NEVER opens a competing lifecycle — in
acting mode it drives the controller through its single public seam `await controller.op("start"|"stop")`.

- **START** — `FGState` (the device's explicit flow-generator operating-state enum) reads `Therapy`.
  Clean SmartStart edge, **no start debounce**. `MaskPressure ≥ 2 cmH₂O` corroborates (upgrades
  confidence, never the sole trigger).
- **STOP (primary — device verdict)** — `MachineMetrics.LastTherapyUseDateTime` advances past the value
  captured at session start. The marker is monotonic and device-clock-relative, so comparing it to its
  OWN baseline cancels the device-clock offset — no host-vs-device compare, Clock Contract untouched.
  Confirmed live 2026-08-24: it advanced `21:48:55Z → 23:34:36Z` = attended wall-stop − 21 min.
- **STOP (fallback — sustained Standby)** — used only when no verdict advance is seen: `FGState==Standby`
  must persist ≥ `stop_debounce_s` (default 40 s, an INPUT to tune from shadow data, §10). A brief
  mask-off SmartStop flicker must NOT close a session, which the debounce absorbs.
- **UNREACHABLE** — a failed/absent read HOLDS the committed state; an ACTIVE session is never closed by
  absence of evidence. Only a positive verdict or sustained explicit Standby stops.

### Exact state machine (implemented in `capture-host/cpap_supervisor.py`, pure + hardware-free)
States: `IDLE`, `ACTIVE` (two only — "device unknown" is a HOLD of the committed state, not a third
state; a reconnect/mask-off is not a new session, §12-15). Per-observation decision:

| prior | condition | → | transition | trigger |
|---|---|---|---|---|
| any | `not reachable` | (hold) | — | `unreachable_hold` (resets Standby run) |
| IDLE | `FGState==Therapy` | ACTIVE | start | `fgstate_therapy` (baseline_use captured) |
| IDLE | else | IDLE | — | `idle_steady` |
| ACTIVE | `last_use > baseline_use` | IDLE | stop | `device_verdict` (outranks FGState; fires even if FGState unread) |
| ACTIVE | `FGState==Therapy` | ACTIVE | — | `active_steady` (clears Standby run) |
| ACTIVE | `FGState==Standby`, run < debounce | ACTIVE | — | `standby_pending` |
| ACTIVE | `FGState==Standby`, run ≥ debounce | IDLE | stop | `sustained_standby` |
| ACTIVE | reachable, `FGState` unread, no verdict | ACTIVE | — | `state_unreadable_hold` |

`Decision` duck-types the house journal contract (`.as_row()`) so a `*LifeLogWriter` sidecar
(`SESSIONDETECT.csv`) records every transition with its evidence (§20). Confidence: `confirmed`
(FGState + MaskPressure agree, or device verdict) · `corroborated` (sustained Standby, mask low) ·
`fgstate_only` · `held` · `conflicted` (Standby stop while mask still pressurised — surfaced, not hidden).

### Connection management (the detector must not make BLE less reliable, §8)
Poll `FGState` + `LastTherapyUseDateTime` (+ `MaskPressure`) via a ~1 s short-connect ONLY while INACTIVE;
once the controller is streaming, take in-stream MaskPressure evidence instead of a competing poll. Do
NOT hold the high-rate stream open just to detect a start. Poll interval is config (`as11_detector.
poll_interval_sec`, default 30 s).

## Build reference — capture-host API surfaces (2026-08-24 sweep)
The two idioms the whole lane uses: **everything is dependency-injected** (transport `write`/`recv_frame`,
`cipher_factory`, clocks `mono`/`wall`), and **the pure logic layer does no I/O** — so it reaches 100 %
branch coverage against fakes with the stdlib alone. Keep the BLE connect in a thin daemon shim; keep
everything else pure + injected.

- **`as11_pull.py` (READ-ONLY session).** `await establish(pair_key, client_id, write, recv_frame) →
  session_key`; then `seal, unseal = cipher_factory(session_key)`. There is **no generic `rpc()` and no
  `get_items` wrapper here** — `get_date_time(write, recv_frame, seal, unseal, *, rpc_id=13) → res
  ["dateTime"]` is the encrypted-RPC template: `await _send_enc(write, seal, L.<builder>(rpc_id))` →
  `res = await _await_result(recv_frame, rpc_id, unseal)`. **To read FGState/MachineMetrics I add a
  `get_items` orchestration wrapper mirroring `get_date_time`, calling `L.get_items(names, rpc_id)`.**
  Also read-only: `pull_spool_round`/`pull_spool`, `stream(...)` (async generator; dispatches StreamData
  vs other notifications internally; `As11Error` on error).
- **`as11_link.py` (framing + builders, stdlib only).** `get_items(names, rpc_id=12) → framed bytes`
  (method `Get`, cmd 0x43; **raises `ValueError` on an empty/non-string array — validate first**);
  `get_date_time(rpc_id=13)`; `rpc(method, params, rpc_id, version)` generic envelope; `fig_frame`/
  `fig_unframe`; VCIDs `VCID_ENC_TX=0x0397`/`VCID_ENC_RX=0x0396`. No `GetVersion`/0x06 builder exists.
- **`cpap_stream.py::LiveStreamController` (I sit ABOVE this).** Single public coroutine `await op("start"
  |"stop") → {ok, streaming, channels,…}`. Liveness only via private `_running()`/`_task`; **no
  session-id, no journal on the controller** — that observation gap (audit G3) is exactly what the
  supervisor fills. Notification dispatch lives in `stream_to_bus` → `as11_pull.stream`.
- **`cpap_acq.py` / `oxy_lifecycle.py` (the shape to mirror).** Pure FSM: an `Enum` state, a
  `LEGAL_TRANSITIONS` frozenset (auditable as data), a frozen `Transition` with `.as_row()` (';'-delim,
  blank never fabricated-zero for None), `to()/fail()/can()`. `capture.py::_oxy_emit` is the guarded
  daemon shim to replicate: `if not lc.can(new): return` (illegal edge SKIPPED so the daemon never dies;
  doubles as idempotence) → `lc.to(...)` → `writer.write(t)` → surface in STATUS. The supervisor-loop
  template is `cpap_spool.sync_spool(pull_round, …, on_transition=None)`: injected driver + injected
  announce seam, module stays pure.
- **Journal seam (§20).** NOT the telemetry bus (`telemetry.TelemetryBus` is the live-sample stream).
  It is the `Transition.as_row()` + `writers.OxyLifeLogWriter(path, …, device=…).write(t)` sidecar
  idiom (duck-typed on `.as_row()`) — the detector writes `SESSIONDETECT.csv` the same way oxyii writes
  `OXYLIFE.csv`. `writers.LinkLogWriter` is the sibling for connection/RSSI evidence.
- **Clock discipline (the RTC answer, at the ingest boundary).** `host_clock.read_state()/classify()/
  timebase_decision()` for host trust; `clock_offset.estimate(points) → {ok, offset_ms, certified, …}`
  (refuses with a reason, never a silent zero). Device offset = read the device clock via
  `get_date_time`, host wall via the injected clock, feed pairs to `estimate` (or diff one ISO pair for a
  coarse offset). The supervisor supplies `last_therapy_use` to the core as an already-parsed monotonic
  marker (Clock-Contract regex at the boundary, never `new Date`).
- **Config (`settings_schema.py`).** Allowlist `SETTINGS[key] = (type, min, max, needs_restart, default,
  help)`; a key absent from the table is unsettable by design, and the **default is the single source of
  truth** (the daemon falls back to it when the key is absent). Add `as11_detector.enabled`
  (bool, default False) + `as11_detector.poll_interval_sec` (float, 1–3600, default 30) + mirror in
  `config.example.yaml`.
- **Test/coverage (`check.sh`).** `tests/test_<module>.py`; inject `mono`/`wall` as lambdas; `FakeAS11`
  with preloaded `(vcid, payload)` frames + identity cipher (`_seal=_unseal=lambda x:x`) runs the whole
  session path stdlib-only; a driver/lifecycle param defaulting to a real one in prod
  (`x = x or Real()`). `find_unwired.py --check` flags machinery imported by nothing — so the supervisor
  must be constructed by the daemon (behind the default-off flag) to pass.

## Rollout (shadow-first — increments, matching how the pull core landed before daemon integration)
1. **Increment 1 — detection core + operator shadow probe (THIS PR):** `cpap_supervisor.py` (pure core) +
   `as11_pull.get_items` read wrapper + `cpap_detect.py` shadow poll adapter (injected seams, pure +
   100 %) + `probe_as11_shadow.py` operator tool (CLI `main`, the bleak/cipher/connect shim) that runs
   the detector against a natural session on the box and writes `SESSIONDETECT.csv`. OBSERVING-ONLY,
   drives nothing. Wiring is the probe (mirrors `as11_link`/`as11_pull` landing before their daemon use).
2. **Validate:** ≥1 clean night of shadow-vs-reality agreement (its would-have start/stop vs the real
   button usage); tune `stop_debounce_s` from the logged Standby runs (charter §10; ~40 s is the input).
3. **Increment 2 — daemon integration (follow-up PR):** `settings_schema` rows (`as11_detector.enabled`
   default False + `poll_interval_sec`) + `config.example.yaml` + a default-OFF daemon hook that
   auto-runs the detector beside the other arms, deferring to in-stream evidence while the controller
   streams (poll only while INACTIVE, §8).
4. **Increment 3 — acting mode (follow-up PR, after ≥1 clean shadow night):** the adapter calls
   `controller.op(...)` on `start_capture`/`stop_capture`; manual button is a permanent override both
   ways. SubscribeEvent push (task #17) is an additive latency upgrade that may later replace the idle
   poll — not a dependency.

## Done when
- `cpap_supervisor.py` + `cpap_detect.py` + `as11_pull.get_items` land with `check.sh` green (ruff,
  shellcheck, pytest 100 % stmt+branch, find_unwired) — the supervisor constructed by the daemon behind
  `as11_detector.enabled` (default False).
- 🔴 **REWRITTEN 2026-08-26 — the original criterion was UNACHIEVABLE, not merely pending.** It read
  *"one shadow night captured and reviewed"*, but the AS11 accepts ONE connection, so the supervisor
  defers for the whole session and is structurally blind while streaming. Measured 2026-08-26:
  `SESSIONDETECT.csv` = 125 rows, last written 22:49:35 (a daemon restart), and it did **not grow once**
  across an 8.7 h capture. A shadow night therefore yields nothing on any night the CPAP streams — which
  is every night that matters. Waiting could never have closed this.
  **Now:** one night's **BOUNDARY events** captured and reviewed — the supervisor's own defer/undefer
  transitions plus spool events — then debounce tuned and the acting-mode follow-up spawned. The
  streaming deferral is accepted as ARCHITECTURE (owner-deputy ruling, option b): polling between
  sessions would add radio contention to the one resource whose capture is sacred, for information we
  mostly do not need mid-session, and boundaries are where detection earns its keep anyway. Polling
  mid-session is re-filed as an acting-mode question for the follow-up, not a fix to this brief.
- READ-ONLY confirmed by source scan (no `Set`/`Enter*`/`SetDateTime` anywhere in the new code); Clock
  Contract untouched.
