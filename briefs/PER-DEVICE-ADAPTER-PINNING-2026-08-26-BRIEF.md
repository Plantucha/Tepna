<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (executable core BUILT, remainder is DEPLOYMENT — re-verified 2026-09-02; ⚠ §2's line citations point at unrelated code, see R6; and two of its test done-when legs belong to the design its own §3.3 WITHDREW and should be struck rather than stamped open — *per Heron's read, not independently re-verified*. Earlier verification 2026-08-31: `resolve_adapter_name` (`capture.py:1115`), per-device `adapter:` parsing with inheritance, `apply_instance` (1185), and the `status_union` merge layer all exist; what remains is a `tepna-capture@.service` systemd template, one instance per radio, splitting monitor/nightqc out as services, and a clean Sena re-measure — boot/deployment shape, owner-territory, several units) · **Created:** 2026-08-26 · **Residue:** 2026-09-02-per-device-citations-drifted

# Per-device adapter pinning — make every device swappable, the way the CPAP already is

**Owner-requested 2026-08-26.** The CPAP can already be told which radio to use
(`cpap.ble_stream.adapter`, a MAC, re-resolved to `hciN` on every connect). Every other device
cannot: **one process-wide `ADAPTER` global serves all three wearables at once**, so "put the ring on
the UB500 and leave the Polars on the Sena" is not expressible in config — it is a code change.

**Owner decision 1, taken 2026-08-26 before any code: the pin is a PREFERENCE, not an absolute** —
a pin obeyed too literally can lose a night, which is worse than a night captured on the "wrong" radio.

**Owner decision 2, same day, after the §4b experiment: ONE SYSTEMD INSTANCE PER ADAPTER
(`tepna-capture@sena` / `@ub500` / `@intel`), and the runtime override machinery §3.3 originally
specified is WITHDRAWN.** Those two decisions fit together rather than conflicting: the pin stays a
preference, but the way a wedge is survived changes from *relocate the devices* to *restart that one
adapter's instance*. §3.3b is the design; §3.3 records what was withdrawn and why, because the reason
is the reusable part — **compensating machinery is what you build when recovery is expensive.**

---

## 1 · Why now — the measurement that motivates it

Three-way counterbalanced scan, 2026-08-26, per-advertisement RSSI (not a cached device list):

| adapter | unique devices / 11 s | RSSI floor |
|---|---|---|
| **UB500 (hci0)** | 92, 94 → **93** | **−106** |
| Sena (hci1) | 63, 58 → 60 | −88, −86 ⚠️ |
| **Intel (hci2)** | 16, 15 → **15** | −101 |

**The UB500 hears ~6× what the Intel does and reaches deepest.** That is a large enough difference to
make "which radio carries which device" a decision worth being able to *express*.

⚠️ **The Sena row is CONFOUNDED and must not be quoted as its performance.** The daemon uses `hci1`
as the live capture adapter, so the scan competed with its own operations; a −86 floor while hearing
60 devices is the signature of a truncated scan, not a deaf radio. Its true figure is **≥** shown. A
clean number needs the daemon paused. Recorded this way deliberately — an earlier version of this
comparison was contaminated by a leaked discovery session and produced a confident wrong answer.

## 2 · What exists today

- **`ADAPTER`** — module global in `capture.py`, a MAC, **30 references**. Resolved fresh to `hciN` on
  every connect via `adapter_hci()` / `adapter_kw()`; never cached, so a renumber self-heals.
- **`_set_active_adapter(mac)`** — repoints that one global. Its docstring is the crux:
  *"Every device task resolves ADAPTER->hciN FRESH on each reconnect, so this one assignment moves
  capture onto `mac` — the failover mechanism itself."* **One global is load-bearing for failover.**
- **`_resolve_cpap_adapter(spec)`** — the pattern to generalise. Accepts an `hciN` name **or a MAC**,
  always returns an `hciN`, re-resolved every connect, logs and falls back to the BlueZ default when
  the MAC is absent so *an absent radio never silently masquerades as a working pin*.
- **Five bonding call sites** pass the global directly: `capture.py:1815, 1861, 1866, 2662, 2774`.

## 3 · Design

### 3.1 Config — optional, per device, MAC-preferred

```yaml
adapter: 00:01:95:CC:53:02        # unchanged: the DEFAULT for any device without its own pin
devices:
  - name: Wellue O2Ring-S
    adapter: AC:A7:F1:29:9D:1D    # NEW, optional — this device prefers the UB500
```

Absent key ⇒ inherit the global. **No existing config changes meaning**, and a config that sets
nothing behaves exactly as today. An `hciN` name is accepted for symmetry with the CPAP but a **MAC
is preferred and should be what we write**, because `hciN` re-enumerates across reboots — measured
2026-08-25, one reboot moved the Sena from `hci3` to `hci1`.

### 3.2 Resolution — one function, shared with the CPAP path

Generalise `_resolve_cpap_adapter` into `resolve_adapter(spec)` and have the CPAP call it too, so
there is **one** MAC→`hciN` resolver rather than two that can drift. Same contract: re-resolve on
every connect, `None` on absence, and **log the fallback** — an absent pinned radio must be visible.

### 3.3 ⚠️ SUPERSEDED — the override machinery is DELETED; systemd does this better

**This section originally specified runtime failover machinery**: a per-device `failover_override`, a
partial-failover walk that moved only the devices on a wedged radio, and clear-on-recovery. That is
**withdrawn**, owner-agreed 2026-08-26 after §4b's experiment landed. Recorded rather than deleted
because the reasoning is the useful part.

**Why it was wrong: that machinery existed only because RECOVERY WAS EXPENSIVE.** With one daemon,
clearing a wedge means restarting everything, so the design routed *around* a wedge instead of fixing
it — compensating state, three new code paths, and a bug found in its first twenty lines (the global
was moved alongside the overrides, so an unpinned device relocated twice and clearing its override
restored it to the SPARE, not its pin — a failover that silently became permanent).

**Make recovery cheap and isolated and the whole apparatus is unnecessary.**

### 3.3b THE ARCHITECTURE — one systemd instance per adapter

```
tepna-capture@sena.service     ← the devices pinned to the Sena
tepna-capture@ub500.service    ← the devices pinned to the UB500
tepna-capture@intel.service    ← the devices pinned to the Intel
```

**The supervision already exists and was built for exactly this failure.** The live unit carries:

```
Restart=always     RestartSec=5     WatchdogSec=120     StartLimitIntervalSec=0
```

and its own comment says why: *"WatchdogSec turns the box's signature HUNG-BUT-ALIVE failure (a wedged
BLE stack that captures nothing while the process keeps running) into an automatic kill+restart."*

So the recovery path becomes: **a wedged adapter trips ITS instance's watchdog → systemd kills and
restarts only that instance → the leak clears → the other radios never notice.** And that recovery is
the one §4b PROVED works — process exit is the only thing that releases a leaked BlueZ discovery,
because BlueZ refcounts discovery per D-Bus client connection and a process is what owns one.

Nothing hand-rolled: no override map, no partial-failover walk, no clear-on-recovery, no cross-process
migration. The mechanism that already recovers a wedge simply stops being all-or-nothing.

**What per-device pinning becomes: a PARTITION KEY, not runtime state.** Each instance filters the
device list to its own adapter and serves only those. Static config, ~30 lines, no override precedence
to get wrong — against ~250 lines and a new state machine for the withdrawn design.

```yaml
adapters:                              # NEW — instance name -> radio MAC
  sena:  00:01:95:CC:53:02
  ub500: AC:A7:F1:29:9D:1D
  intel: F0:D5:BF:1E:79:21
devices:
  - name: Wellue O2Ring-S
    adapter: ub500                     # an instance name, or a bare MAC
```

The MAC indirection is load-bearing for the same reason as everywhere else in this file: `hciN`
re-enumerates, a MAC does not.

**What is deliberately GIVEN UP: cross-adapter failover.** Today a wedged radio migrates its devices
to a healthy one. Under the split, a wedged instance restarts on its own radio instead. That is an
acceptable trade **because the reason failover was built has gone** — it exists (VIGIL-OVERNIGHT-FINDINGS
P1.5) because a wedge meant ~110 minutes of blind total loss, and a five-second targeted restart is a
far better answer to that than relocating devices onto a radio their bonds are not on. If a radio is
dead rather than wedged, that is an operator event, not something to paper over at 03:00.

⚠️ **THE REAL COST, and it is the actual work: SHARED STATE.** `status.json`, the monitor, `nightqc`
and the nightly summary are single-process today. Three instances need a merge — a per-instance status
file plus a reader that unions them, or a small store with locking. This is the part to design
carefully; it is *clearer* than override semantics but it is not smaller.

⚠️ **What the split still does NOT isolate:** `bluetoothd` is a single shared daemon and the leak was
BlueZ state. Separate processes bound the blast radius of the REMEDY; they do not make one adapter's
fault stop being a BlueZ-level fault. Do not oversell them.

### 3.4 Bonding — the cost that must be surfaced, not discovered

Bonds are **per adapter**. Moving a Polar to a different radio forces a **re-bond there**, and the
five call sites above must pass the device's effective adapter rather than the global.

This is not a footnote: a fresh H10 bond is an active confound on the 2026-08-25 jitter comparison
(`SENA-VS-UB500-JITTER-2026-08-26-BRIEF` §6.2). So:

- **The O2Ring is free to move** — it rejects Just-Works pairing and streams unbonded.
- **A Polar move costs a re-bond**, and the daemon must say so at startup: log which pinned devices
  are not yet bonded on their pinned adapter.
- ⚠️ **A failover override triggers bonding on the fallback radio too.** That is correct behaviour —
  a link is worth more than a clean bond ledger — but it means a night after a failover may carry a
  fresh bond it did not have before, and anything comparing nights must know.

### 3.5 Surfaces

- `STATUS` per device gains **`adapter_pinned`** and **`adapter_effective`** (both MACs), so the
  monitor can show *which radio each device is actually on* rather than which one config asked for.
  These are different facts whenever failover is active, and conflating them hides the override.
- The `adapter_watchdog` currently takes the single global; it needs the **set** of effective
  adapters in use.

## 3.6 THE MERGE LAYER — the actual work of the split

Three instances, one operator view. `status.json`, the monitor, `nightqc` and the nightly summary are
single-process today.

### 3.6.1 Split the READERS out of the capture daemon

A capture instance owns **one radio**. Serving HTTP and summarising nights are not per-radio jobs, and
putting them inside one arbitrary instance would make that instance special — and its restart would
take the monitor down with it.

| unit | owns |
|---|---|
| `tepna-capture@<adapter>` | the BLE links for its radio, and only those |
| `tepna-monitor` | the HTTP monitor — **reads** the union, writes nothing |
| `tepna-nightqc` (timer) | night summarisation — **reads** the union |

⚠️ **Not everything in today's daemon is per-adapter.** The **SD/ez-share harvest is WIFI**, not BLE, and
must not be triplicated — one instance must own it or it moves to a utility unit. The **auto-pull
triggers are per-device**, so they follow their device to its instance. Decide each explicitly; a job
that silently runs three times is worse than one that runs zero times, because it looks like it works.

### 3.6.2 Per-instance files, unioned by a pure reader

Each instance writes **`status.<instance>.json`** atomically (write temp + rename, as today), carrying
its device set, its adapter, and a **`heartbeat_ms`**. Nothing shares a file, so there is **no locking
and no writer contention** — the property that makes this the cheap option.

The reader unions them into the shape consumers already expect.

### 3.6.3 🔴 THE LOAD-BEARING RULE: union over the EXPECTED set, never the FOUND set

**A dead instance must be VISIBLY DEAD, not silently absent.**

Union over the files that happen to exist and a dead `@intel` simply contributes nothing — the monitor
shows the other two radios, every device it lists is healthy, and **nothing anywhere says a third of
the capture is gone.** That is this suite's most-repeated defect wearing new clothes: an absent
contributor reading as a clean result. It is the same failure as the `--group=` filter that matched
nothing, the `-k absent` that collected no test, and my own "15 active streams" that measured
subscription rather than delivery.

So:

- The **expected instance set comes from config** (`adapters:` + which are enabled), not from a
  directory listing.
- An expected instance whose file is **missing, or whose `heartbeat_ms` is older than a threshold**,
  is rendered **DEAD/STALE with its last-seen age** — never omitted.
- The monitor shows a dead instance as a **failed radio**, not as an absence of devices.
- `nightqc` records **which instances contributed**, so a night captured with one radio down is
  labelled as such rather than looking like a night where those devices were simply not worn.

**Gate it with a decoy**: delete one instance's status file and assert the union still reports that
instance as DEAD. A merge layer that cannot fail visibly is not worth building.

### 3.6.4 What stays untouched

Per-device capture files, sidecars and the clock-discipline rows are **already per-device**, so three
writers never contend — they were never the shared part. Only the *aggregated views* need the union.

## 4 · Risks

1. **Connection-slot ceiling.** `capture.py` already distinguishes *"ADAPTER CONNECTION CEILING — the
   adapter is out of link slots"* from a sensor fault. Concentrating devices onto one pinned radio
   makes that likelier; spreading them makes it rarer. Pinning is therefore also a *capacity*
   decision, not only a range one.
2. **Failover fan-out.** Today one assignment moves everything, which is simple and testable.
   Per-device override is more state and more paths — the tests must cover a partial failover
   (some devices moved, some not), not merely the all-or-nothing case.
3. **A pin to an absent radio.** Must fall back with a loud log, never fail hard, and never silently
   use the default as though the pin had worked — the same honesty rule `_resolve_cpap_adapter`
   already applies.

## 5 · Done when

- [ ] `resolve_adapter(spec)` is shared by the wearable and CPAP paths — one resolver, not two.
- [ ] Optional per-device `adapter:` parsed; absent ⇒ inherits the global; **an existing config's
      behaviour is byte-identical** (gate-asserted, not asserted in prose).
- [ ] All five bonding call sites take the device's effective adapter.
- [ ] `tepna-capture@.service` template; one enabled instance per adapter in use.
- [ ] `adapters:` name→MAC map parsed; each instance serves ONLY the devices whose `adapter:` resolves
      to its own radio, and **logs the device list it owns at startup** (an instance silently serving
      nothing must not look like an instance working).
- [ ] A wedged instance exits/trips its watchdog and is restarted by systemd **without** the other
      instances losing a link — verified by wedging one radio and watching the others keep streaming.
- [ ] **Merge layer (§3.6):** per-instance `status.<instance>.json` written atomically with a
      `heartbeat_ms`; a pure union reader; `tepna-monitor` and `tepna-nightqc` split out as READERS so
      no capture instance is special and its restart cannot take the monitor down.
- [ ] 🔴 **The union is over the EXPECTED instance set from config, never the found files** — a missing
      or stale instance renders DEAD with its last-seen age, and `nightqc` records which instances
      contributed. **Gate-backed with a decoy: delete one instance's status file and assert the union
      still reports that instance DEAD.** A merge layer that cannot fail visibly is not worth building.
- [ ] Every non-per-adapter job assigned explicitly — the **wifi SD/ez-share harvest must not be
      triplicated**; auto-pull follows its device. A job that silently runs three times looks like it
      works, which is worse than one that runs zero times.
- [ ] `STATUS` exposes `adapter_pinned` + `adapter_effective` per device; monitor renders the
      effective one.
- [ ] Startup logs any pinned device **not yet bonded on its pinned adapter**.
- [ ] Tests cover: inheritance, explicit pin, pin to an absent MAC, **partial** failover, override
      clearing on recovery. `capture-host/check.sh` green at the 100 % coverage floor.
- [ ] A **clean Sena measurement** (daemon paused) replaces §1's confounded row before anyone uses
      this brief's table to choose a radio.
