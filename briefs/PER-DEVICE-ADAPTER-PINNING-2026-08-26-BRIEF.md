<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-26

# Per-device adapter pinning — make every device swappable, the way the CPAP already is

**Owner-requested 2026-08-26.** The CPAP can already be told which radio to use
(`cpap.ble_stream.adapter`, a MAC, re-resolved to `hciN` on every connect). Every other device
cannot: **one process-wide `ADAPTER` global serves all three wearables at once**, so "put the ring on
the UB500 and leave the Polars on the Sena" is not expressible in config — it is a code change.

**Owner decision, taken 2026-08-26 before any code: the pin is a PREFERENCE (option A), not an
absolute.** A wedged radio still migrates its devices; the pin says where they live in normal
operation, and the log says when failover overrode it. The alternative — an absolute pin — was
rejected on the grounds that *you can lose a night to a pin being obeyed too literally*, which is a
worse failure than a night captured on the "wrong" radio.

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

### 3.3 Failover — option A, and the part that needs care

`_set_active_adapter` currently moves *everything*. Under per-device pins it must become:

- **`effective_adapter(dev)`** = `dev.failover_override or dev.adapter or ADAPTER`.
- On a wedged radio, failover sets `failover_override` **only on the devices whose effective adapter
  is the wedged one** — devices on a healthy radio are untouched. Today they would all be moved.
- The override is **cleared when the pinned radio returns healthy**, so the preference reasserts
  itself rather than silently persisting for the rest of the night.
- 🔴 **Every override logs at WARNING with both radios named** — *"O2Ring: pinned AC:…:1D is wedged,
  failing over to 00:…:02"*. A preference that is silently overridden is indistinguishable from a
  preference that was never honoured, which is precisely the class of defect this suite keeps finding.

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

## 4b · PER-ADAPTER DAEMONS — owner-raised, and the experiment says YES (measured 2026-08-26)

Owner asked whether each adapter should have its own daemon, so a wedge can be cleared without
disturbing the other radios. My first answer was that per-adapter **supervised task groups** inside
one process would be a lighter way to get the same isolation. **That answer was wrong, and the
experiment that falsifies it is one script.**

Reproduced the leak deliberately on the idle `hci2`, then tried every cheaper recovery in turn:

```
S0 baseline                                        false
S1 BleakScanner.start()                            true
S2 reference dropped WITHOUT stop()  (the leak)    true
S3 busctl … Adapter1 StopDiscovery   ->  (rc=1, "Call failed: No discovery started")
S4 after that StopDiscovery                        true      <- NOT cleared
S5 after the owning PROCESS exits                  false     <- cleared
```

Two independent recoveries fail, for the same underlying reason:

- **A new client in the same process fails** — this run reproduced the exact production error,
  `BleakDBusError: [org.bluez.Error.InProgress] Operation already in progress`, which is what the
  O2Ring threw every 60 s on the morning of 2026-08-26.
- **A cross-client `StopDiscovery` is REFUSED** with *"No discovery started"* — BlueZ refcounts
  discovery **per D-Bus client connection**, so from any other connection the leaked scan does not
  exist and cannot be stopped.

**Therefore only closing the OWNING connection releases it, and a process is the unit that owns a
connection.** Task groups cannot recover a leaked scan; they would hit `InProgress` exactly as a new
client does. **Per-adapter daemons are required for isolated recovery** — the owner's instinct was
right and mine was not.

**But note what this does and does not argue for**, because the two halves have different owners:

| | mechanism | who fixes it |
|---|---|---|
| **Prevention** | guarded scan — stop discovery on *every* exit path incl. cancellation | the runner's in-flight fix |
| **Recovery when prevention fails** | process exit — hence per-adapter daemons | this brief's §4b |
| **Isolated recovery** | per-adapter daemons, so one radio's restart costs only its own devices | this brief's §4b |

Prevention remains the primary fix; a leak that never happens needs no recovery. §4b is the blast-radius
bound for when it does — and it is not hypothetical: clearing the 2026-08-26 wedge required a full
daemon restart that dropped **every** device, including a CPAP on a different, healthy radio.

⚠️ **What per-adapter daemons still do NOT isolate**: `bluetoothd` is a single shared daemon, and this
leak was BlueZ state. Separate processes bound the *blast radius* of the remedy; they do not prevent
one adapter's fault from being a BlueZ-level fault. Do not oversell them as isolation.

**Costs, unchanged and real:** failover becomes cross-process (today one assignment migrates devices);
`status.json`, the monitor, QC and the sidecars are single-process and would need a merge layer or a
locked store; and the device→adapter map — i.e. §3.1 of this brief — is the partition key, so this
work **depends on per-device pinning landing first**.

**Sequencing: per-device pinning → then daemon split.** Not the reverse.

## 5 · Done when

- [ ] `resolve_adapter(spec)` is shared by the wearable and CPAP paths — one resolver, not two.
- [ ] Optional per-device `adapter:` parsed; absent ⇒ inherits the global; **an existing config's
      behaviour is byte-identical** (gate-asserted, not asserted in prose).
- [ ] All five bonding call sites take the device's effective adapter.
- [ ] Failover moves **only** the devices on the wedged radio, logs every override naming both
      radios, and **clears the override when the pinned radio recovers**.
- [ ] `STATUS` exposes `adapter_pinned` + `adapter_effective` per device; monitor renders the
      effective one.
- [ ] Startup logs any pinned device **not yet bonded on its pinned adapter**.
- [ ] Tests cover: inheritance, explicit pin, pin to an absent MAC, **partial** failover, override
      clearing on recovery. `capture-host/check.sh` green at the 100 % coverage floor.
- [ ] A **clean Sena measurement** (daemon paused) replaces §1's confounded row before anyone uses
      this brief's table to choose a radio.
