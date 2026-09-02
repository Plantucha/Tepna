<!--
  VIGIL-OVERNIGHT-FINDINGS-2026-07-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — **every software rung is shipped**; what remains is field OBSERVATION, which is why this cannot be flipped DONE by a code search. Verified against artifacts: P1.1 hysteresis ba267b04 (#924); P1.2/P1.3 unbind/bind `tests/test_bluez_wedge.py` + `tepna-btreset.sh`; P1.4 startup self-test 804b5b9f; P1.5 dual-radio failover b364380e (#1583); P2.1 backoff `capture.py:2470-2496`; P2.2 `writers.resumable_stamp`; P3.2 prune gated on `nightarchive.unarchived_nights`; P3.3 dest validated at startup; `vigil.sh` under git with `tests/test_vigil_sh.py`. Open: **the ladder has been seen WORKING but never seen CLEARING A REAL WEDGE** — that waits on an event nobody can schedule; P0.1/P0.2's clean-night counts and the post-P2.2 flappy-night relink rate are box journal reads; and **P3.1's decision was never recorded** (P1.5 implements option (c), which makes (c) the de-facto answer — but inference is not a record). **Owner:** Heron · **Next step:** write P3.1's decision down) · **Created:** 2026-07-24
**P2.x VERIFIED IN CODE 2026-08-19, and five of six are SHIPPED — see the P2 verification block below.**
Genuinely open: none of the software rungs. **P1.5 (dual-radio failover) IMPLEMENTED 2026-08-20** (the L3 rung: on a spent reset budget, repoint ADAPTER to a healthy spare + re-bond there — tested end to end, field-gated on observing it clear a REAL wedge). **P2.2 (resume file-set) SHIPPED** (`writers.resumable_stamp`). · **Created:** 2026-07-24

# Vigil overnight findings — the night the dongle wedged (2026-07-23 → 24)

> **Scope:** out-of-suite (`capture-host/`); no Dex bundle / `manifestHash` / provenance impact.
> **Method:** 13 live observation passes over one real overnight capture (3 sensors: Polar H10 chest ECG,
> Polar Verity Sense armband PPG, Wellue O2Ring-S finger oximeter), OBSERVATION-ONLY — the running night's
> recording was never disturbed. Every claim below is backed by the live log, `/api/state`, `hciconfig`,
> and `/sys` at the time stamped. Companion raw log: `scratchpad/vigil-overnight-notes.md`.
> **Relationship to prior work:** this is the empirical companion to
> `VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md` (§4's 11-item BLE fix ranking and §5's UB500 BOM). Static
> analysis *predicted* the recovery-ladder and scan-churn risks; a real night **fired them**, added the
> root cause static analysis missed (USB autosuspend), and re-prioritised the list against measured impact.

---

## 0. The one-paragraph story

A single flaky **USB Bluetooth dongle** (TP-Link UB500, RTL8761B) that Vigil was pinned to **wedged twice**
during the night (01:39–02:16, 03:33–~04:50 — a combined **~110 minutes** where *no device recorded*),
while a **healthy internal Bluetooth radio sat idle the entire night**. Both outages ended only because the
dongle firmware **self-healed by luck** — Vigil's own recovery ladder ran and **no-opped** (it lacks the OS
privilege to reset the radio), and its watchdog **declared "adapter healthy again" 25+ times while the
adapter was DOWN**, repeatedly resetting its own escalation counter. The night's oximetry survived only
because the **O2Ring records to its own flash** independent of Bluetooth, and its onboard recording was
auto-pulled intact (full ~7 h) when it went on the charger. The two **Polar devices have no such backup**
(their hardware cannot live-stream and onboard-record at once), so their ~110 min of gap data is **lost**.
**Root cause is one line of config away from prevention** (disable USB autosuspend on the dongle); the
software-resilience gaps are real and must be fixed too, because the next radio fault should be survived by
design, not by luck.

---

## 1. Timeline (measured)

| time | event | evidence |
|---|---|---|
| 22:03 | O2Ring begins **onboard** recording (its own flash) | pulled `.dat` session id `20260723220322` |
| 22:11 | capture.py (PID 35411) starts on adapter `AC:A7:F1:29:9D:1D` | log |
| 22:11–01:39 | 3 sensors capture; H10 flawless (ECG cov **0.99**), Verity good (~0.9), O2Ring flapping (cov 0.6→0.24) | `/api/state`, QC |
| **01:39** | **Wedge #1** — hci0 DOWN, "configured adapter not found", all sensors time out | `hciconfig`, log |
| 02:16:29 | watchdog reaches sign 2/2 → `hciconfig hci0 reset` **exited 1** (no privilege) | log |
| 02:16:41 | adapter **self-heals** 12 s after the failed reset; sensors reconnect | log — **~37 min lost** |
| 02:16–03:33 | normal capture resumes | files grow |
| **03:33** | **Wedge #2** — hci0 DOWN again (uptime before: ~1.3 h, *shrinking*) | `hciconfig`, log |
| 03:34, 04:38 | 2 power-cycle attempts; no successful reset (unprivileged) | log |
| ~04:50 | adapter self-heals again | log — **~75+ min lost** |
| 05:04–05:15 | user removes sensors; **O2Ring onboard `.dat` auto-pulled** (on-charger), **full ~7 h recovered** | `stored/…_STORED.dat`, meta `approx_samples: 25243` |
| 05:08 | Verity on-charger offline pull → **0 files** (no onboard recording exists) | log |
| 05:13 | H10 offline-recordings list → **`[]`** (no onboard recording exists) | `/api/polar/recordings` |
| 05:15 | **Root cause identified:** wedging radio = **USB dongle** with **autosuspend enabled** | `/sys/.../power/control=auto` |

**Data yield:** H10 55 MB / 6 files (ECG 0.99, no backup) · Verity 126 MB / 31 files (~0.9, no backup) ·
O2Ring 23 MB / **189** live fragments (cov collapsed to 0.24) **+ a clean, gap-free 7 h onboard copy**.
Net: a usable H10/Verity night for the ~5.5 h outside the wedges; complete O2Ring oximetry via the backup;
the ~110 min of wedge gaps lost for the two Polars.

---

## 2. Root cause

**The radio Vigil used was the USB dongle, not the internal Bluetooth.** Definitive `/sys` + `hciconfig` map:

| hci | BD address | hardware | USB id | role tonight |
|---|---|---|---|---|
| **hci0** | `AC:A7:F1:29:9D:1D` | **TP-Link UB500 (RTL8761B)** | `2357:0604` | **configured `adapter:` — wedged ×2** |
| hci1 | `58:10:31:F3:2C:30` | internal Realtek radio | `0bda:b850` | **UP RUNNING, idle, unused all night** |

**Prime trigger — USB autosuspend on the dongle:**
```
/sys/devices/…/usb11/11-1/11-1.2   (TP-Link UB500)
  power/control              = auto     ← autosuspend ENABLED
  power/autosuspend_delay_ms = 2000     ← suspend after 2 s idle
  bus-port                   = 11-1.2   ← this IS the watchdog.usb_path value
```
RTL8761B + USB autosuspend is a well-documented Linux failure: the kernel suspends the dongle in a brief
idle window and the firmware never cleanly resumes — "powered but deaf," which is exactly the observed
DOWN / not-found / self-heal-on-re-init behaviour. The O2Ring's constant connect/scan churn manufactures
precisely the sub-2 s idle gaps that trip it. That the UB500 is RTL8761B is also *why* the existing
watchdog talks about "RTL8761B FIRMWARE hang" — the ladder was written for this exact part.

---

## 3. Direct answer: fix BLE handling **or** recommend a different dongle?

**Both — but they are different layers and the order matters. Neither alone is sufficient, and swapping the
dongle is the *last* resort, not the first.**

1. **First, prevent the wedge with a free config change (hardware layer).** Disable USB autosuspend on the
   dongle. This most likely eliminates the entire failure class at zero code cost and would have prevented
   tonight's ~110 min of loss outright. **Do this before anything else.**
2. **Then fix the BLE handling (software layer) — non-negotiable regardless of the dongle.** Tonight
   survived on *luck* (firmware self-heal + the O2Ring's flash). The watchdog reported false health 25+
   times, its recovery ladder was disarmed, and there was no failover to the healthy second radio. **Any**
   radio fails eventually; a bedside monitor must survive a radio fault *by design*. These fixes make the
   next fault — on any hardware — a non-event.
3. **Do NOT rush to buy a different dongle.** The UB500 is fine hardware once autosuspend is off. Before
   spending money: (a) turn autosuspend off, and (b) A/B test the **internal Realtek radio** (hci1), which
   was healthy all night — both free. Only if the dongle still wedges after autosuspend-off **and** the
   internal radio also proves unreliable should you replace hardware — and then choose a chipset with
   strong mainline-Linux firmware support and **disable autosuspend on it too** (the same bug bites most
   USB BT dongles). A recurring-wedge dongle *is* a dying-dongle signal, but tonight's evidence points at
   the power setting, not the silicon.

**In one line:** *fix the power setting first, fix the BLE resilience always, replace the dongle only if
both a de-suspended dongle and the internal radio fail you.*

---

## 4. Prioritised fix plan

### P0 — stop the wedge (do tonight; free; prevention)
> **⚠️ CORRECTION 2026-07-26 — P0.1 as originally written NEVER TOOK EFFECT.** The rule shipped as
> `50-tepna-btdongle.rules`, and udev applies rules in lexical order: Ubuntu's own
> `/usr/lib/udev/rules.d/60-autosuspend.rules` runs *after* a `50-` file and sets `power/control` back
> to `auto`. Verified on a fresh Ubuntu 26.04 box — rule installed, attributes matching, `udevadm test`
> showing it apply — and `power/control=auto` on every boot regardless. So the "root-cause fix" this
> section claims was in force was silently losing, and both wedges below happened with autosuspend
> effectively ENABLED. Only the daemon's own startup self-test (§P1.4) surfaced it. Renamed to `99-`.
- **P0.1 Disable USB autosuspend on the dongle.** Persistent udev rule:
  ```
  # /etc/udev/rules.d/99-tepna-btdongle.rules   ← 99, NOT 50 (corrected 2026-07-26)
  ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="2357", ATTR{idProduct}=="0604", ATTR{power/control}="on"
  ```
  Immediate (until reboot): `echo on | sudo tee /sys/devices/…/11-1.2/power/control`.
  *Done-when:* the dongle survives a full night with 0 `configured adapter … not found` lines.
- **P0.2 A/B the internal radio.** Set `adapter: 58:10:31:F3:2C:30`, re-bond the 3 sensors (bonding is
  per-adapter), run a night. A different chipset may simply not have the fault. Keep whichever wins.

### P1 — make a radio fault survivable, not lucky (software resilience; the correctness fixes)
- ✅ **P1.1 — DONE 2026-08-04, in two halves landed a week apart.** *(a)* The health check now asserts the
  pinned adapter: `_adapter_is_up()` feeds `classify_adapter_health(devs, adapter_up=…)`, and
  `capture.py:2623` states the intent — *"this is what stops the watchdog declaring health over a dead
  radio."* That half was already in when this was picked up, and it kills the original 25× shape.
  *(b)* **The hysteresis this item actually asked for was still missing**, and it is a distinct live
  path to the same outcome: `adapter_up` stops a DOWN radio reading healthy, but a **flapping** adapter
  — genuinely up on alternate polls — still cleared `consecutive` every time it blipped, so `grace` was
  never accumulated and the ladder was never reached. Now `recover_checks` (default 2) consecutive clean
  polls are required before the wedge count is cleared; a wedged poll breaks the run.

  `cycles` is reset behind the same gate, which matters more than it looks: it is the power-cycle budget,
  so clearing it on a single flap allowed unbounded power-cycling, while never clearing it would let one
  early wedge disarm the ladder for the rest of the night. Both directions are now tested.

  Verified by re-applying the defect — 5 mutants, all killed. Two of them **survived the first pass**
  (the `cycles` reset, and a `max(1,…)` guard on the config). The guard turned out to be dead code —
  `healthy_run >= recover` is already satisfied by the first clean poll for any value ≤ 1 — so it was
  removed rather than left as a claim nothing could check; the config test now pins an observable
  (`recover_checks: 3` needs three clean polls) instead.
- ~~**P1.1 The watchdog health check must assert the PINNED adapter is `UP RUNNING`.**~~ *(original text)* Tonight it logged
  "adapter healthy again" 25+ times over a DOWN radio, each time resetting the wedge counter and *delaying
  its own escalation by ~65 min*. Add **hysteresis**: require the pinned adapter UP and stable for N polls
  before declaring recovery. This is the **single most important software fix** — a health check decoupled
  from reality neutralises every downstream defence. (Extends DEEP-ANALYSIS §4 "recovery ladder".)
- **P1.2 Give the recovery ladder the privilege to actually run.** capture.py runs with `CapEff: 0`; its
  `hciconfig … reset` returned `exited 1` both wedges. Grant a scoped capability — `setcap cap_net_admin+ep`
  on a dedicated reset helper, or a `polkit`/`sudoers` rule limited to `hciconfig <pinned> reset` + the
  specific USB unbind/bind paths. Without this the ladder is decorative.
- **P1.3 Enable `watchdog.usb_path` (now known: `11-1.2`).** A USB unbind/bind is the only reliable clear
  for an RTL8761B firmware hang when a soft reset can't; needs P1.2's privilege.
- ✅ **P1.2/P1.3 — the PRIVILEGE half is DONE 2026-08-05, and the 2026-08-04 diagnosis of it was wrong.**
  That header block said these were *"BLOCKED ON A DEPLOY, not on code,"* naming `tepna-usbreset.sh` as
  the thing that had never been installed. Two errors, both found by measuring the live box rather than
  re-reading the brief:
  - **`tepna-usbreset.sh` is not this rung and must never become it.** It toggles `authorized` on a
    docked **Polar sensor** to re-open the PS-FTP window, and is hard-allowlisted to `0da4:0008`. Its own
    header names *"the very BLE adapters the capture depends on"* as the thing it exists to never touch,
    and a test (`test_the_bluetooth_adapter_cannot_be_deauthorized`) pins that. Installing it — which did
    happen on 2026-08-04, root-owned with a working NOPASSWD grant, verified passwordless 2026-08-05 —
    moved this rung not at all.
  - **The blocker was CODE, and it was silent.** `capture._usb_rebind` wrote
    `/sys/bus/usb/drivers/usb/{unbind,bind}` **itself**. Measured on the box 2026-08-05: those files are
    `--w------- root root`; capture runs as `vigil` with `CapEff: 0000000000001000` — CAP_NET_ADMIN alone,
    no CAP_DAC_OVERRIDE. So every write raised `PermissionError`, was caught, and was logged at **INFO**
    as *"skipped"*. The rung had never once run and could not.
  - **Worse, the config had `usb_path: 1-2` set** (and `1-2` is genuinely the UB500, `2357:0604`). The
    only warning on this path fires on ABSENCE, so setting the key **silenced the sole check** while the
    rung stayed inoperable. A configured-but-incapable rung reads as armed — strictly worse than a
    disabled one.
  - **Fixed:** new root-owned `tepna-btreset.sh` (allowlisted by USB device class `e0:01:01`, so it may
    touch **only** radios — the exact mirror of usbreset's dock-only allowlist, and the two are asserted
    disjoint), reached via `sudo -n` exactly as the clock/RSSI/radio-restart rungs already are. Direct
    write still tried first for a box that has the capability. A failed rebind now logs at **WARNING**.
    `usb_rebind_available()` + a new `defense_warnings` branch make a set-but-incapable `usb_path` say so
    at boot. On the manifest in `deploy/check-system-files.sh` and granted by `enable-clock-control.sh`.
  - ✅ **THE RUNG IS OBSERVED WORKING ON REAL HARDWARE — 2026-08-08 ~21:00, on the box.** Deployed
    (`check-system-files.sh`: `10 managed, 0 drifted`; helper root-owned `0755`). The boot-time defence
    report is the first confirmation, and it confirms by SILENCE in the right place: it emitted its
    archive warning while saying nothing about `usb_path`, i.e. `usb_rebind_available()` returned True —
    where before this work there was no check on that path at all. Then the rung was fired deliberately
    against the live UB500, with two sensors connected and nothing on-body:

    ```
    BEFORE  hci0 UP RUNNING · AC:A7:F1:29:9D:1D · devnum 2 · driver usb
    RUN     sudo -n /usr/local/lib/tepna/tepna-btreset.sh 1-2
            RC=0 · "re-bound: 1-2 (2357:0604)"
    AFTER   hci0 UP RUNNING · AC:A7:F1:29:9D:1D · devnum 2 · driver usb
    ```

    The daemon stayed `active` throughout; the **Verity never dropped**; the **O2Ring dropped and
    self-reconnected within ~90 s** with no intervention. `devnum` is unchanged **by design** — this is a
    driver re-bind, not a USB re-enumeration, so the device number is expected to persist. (The helper
    says `re-bound`, not `re-enumerated`; `tepna-usbreset.sh` is the one that moves `devnum`, and that
    difference is exactly why the two are separate helpers.)
  - ⚠️ **What this does NOT prove, stated plainly.** It proves the MECHANISM — the privileged unbind/bind
    executes, the adapter returns, the capture loops recover on their own. It does **not** prove the rung
    clears a real **RTL8761B firmware hang**; that needs a real wedge, and none has occurred since
    2026-07-23. The honest claim is *"the last rung can now run, and has run"* — not *"the 2026-07-23
    outage is fixed"*.
  - **Still open:** P1.2's *other* half. `CapEff` is no longer 0 (CAP_NET_ADMIN is ambient, so
    `hciconfig reset` can run), but that rung has still never been exercised against a wedged adapter.
    Field-gated on the same missing wedge.
- ✅ **P1.4 — COMPLETED 2026-08-04.** The self-test already existed (`defense_warnings` +
  `startup_defense_check`) and covered item (a), the recovery ladder's `CAP_NET_ADMIN`, plus the
  autosuspend prevention. **Items (b) and (c) were not checked**, so the two defences most likely to be
  silently off were the two nothing looked at:
  - **(b) `usb_path` unset** — the last rung of the ladder. A soft power-cycle does not clear an RTL8761B
    firmware hang, so a wedge surviving it had no remaining fix. §P1.3 identified the bus-port (`11-1.2`)
    on 2026-07-24 and recovery still could not use it, because the key was never written. Warned, not
    defaulted: the id is host-specific and guessing one would rebind the wrong device.
  - **(c) archive destination** — measured on the live box 2026-08-04: **no archive configured, 0
    `.archived` markers across 11 nights**, so every night existed in exactly one copy while capture ran
    perfectly. Also warns when a dest IS set but is not a **mountpoint** — `ismount`, never `isdir`,
    because an unmounted mountpoint is a writable empty directory on the boot disk and the mirror
    "succeeds" onto the wrong filesystem (`storage_targets`' own reasoning; VIGIL-OFFLOAD-AND-RETENTION
    recorded exactly that, a removable disk unmounted at the check). And `enabled: true` with no
    destination counts as unconfigured — the flag alone is the most reassuring possible misconfiguration.

  Absence is distinguished from disarmed throughout: called without a `cfg`, the config-derived defences
  are **not judged** rather than reported armed. 7 mutants applied, 6 killed; the 7th is a genuine
  equivalent (the `_UNCHECKED` sentinel is truthy, so the explicit guard and a bare falsiness test behave
  identically) and is recorded here so nobody re-derives it.
- ~~**P1.4 Startup self-test of the defences.**~~ *(original text)* At boot, verify (a) the ladder can run (caps present),
  (b) `usb_path` is set, (c) the archive dest is mounted. If any defence is disarmed, log **LOUD** at
  22:00 — do not discover it at 01:39. (A disarmed resilience feature you *believe* is armed is worse than
  none, because you plan the night around it.)
- **P1.5 Dual-radio failover.** hci1 was healthy and idle all night. Pre-bond all sensors to **both**
  radios; on a pinned-adapter wedge, fail capture over to the spare instead of waiting for a self-heal.
  The box already has the second radio — use it.
  - ✅ **IMPLEMENTED 2026-08-20 (`adapter_watchdog` L3 rung).** When the reset ladder's power-cycle budget (`max_adapter_cycles`) is spent, `list_adapters()` (`hciconfig -a` → `parse_hciconfig`) + `failover_target()` pick a healthy adapter that is UP and NOT the pinned one; `_set_active_adapter()` repoints the process pin, the sensors re-bond on the spare (per-adapter bonds), the cycle budget resets, and the loop continues. Because `adapter_kw`/`adapter_hci` resolve `ADAPTER`→`hciN` FRESH on every reconnect, that single repoint moves every device task to the spare. A `max_failovers` cap (default 3) stops two flaky radios ping-ponging; `watchdog.failover: false` restores the old give-up. Bonding on failover is lazy rather than the brief's pre-bond-to-both — functionally equivalent and simpler (the bond is created when the spare is actually needed and reachable). Degrades safely: no `hciconfig`/no spare → `list_adapters()` is `[]` → the ladder exits exactly as before. Pure parser + decision fully tested; the watchdog branch tested end to end (failover + budget exhaustion, disabled-no-probe, bond-failure-non-fatal). ⚠️ **Field-gated remainder:** proven to fail over in tests, not yet observed clearing a REAL wedge (none has occurred since) — the same status the reset ladder carries.

### P2 — data quality & efficiency under a bad link (reduce the damage a flap does)
> ### 📊 P2 VERIFIED IN CODE, 2026-08-19 — five of six shipped; the brief read as fully open and was not
>
> Checked item by item against the current daemon (the DEEP-ANALYSIS phase-map pattern):
>
> | item | state |
> |---|---|
> | P2.1 backoff | ✅ `backoff = min(backoff*2, 300)` from 5 s, reset **only on a viable session** (E3 — a bare connect does not reset it, or a flapping link would pin it at the floor). `capture.py:2470-2496` |
> | P2.2 resume file-set | ⛔ **OPEN** — reconnects still mint a new file-set (15 Verity sets on 2026-08-18 alone). The one real remaining P2 item, and an architecture change: gate it on its own brief. |
> | P2.3 pull vs dead adapter | ✅ pulls gate on `_RECOVER`/pause state; the charger/doff pollers skip mid-recovery |
> | P2.4 coverage rollup | ✅ per-stream `coverage_pct` (timeline), per-device coverage in `QC-SUMMARY.json`, monitor renders "% captured" — and the **morning digest** (2026-08-19) now pushes it daily via the webhook, which closed the "surfaced" half |
> | P2.5 pull progress | ✅ `pull_progress` set during pulls, cleared even on failure, surfaced through webmon |
> | P2.6 relink logging | 〰 **PARTIAL, differently-shaped:** `link_epoch` is tracked and written to the LINK sidecar + status (E5) — a *recorded* surface the 25 s sampler cannot miss — but the literal ask (an INFO line with outage duration) is not implemented. The sidecar arguably supersedes it; saying so here rather than ticking it. |
>
> P1.5 (dual-radio failover) remains open and is now the section's only *large* item: the box has **two**
> adapters today (the third was removed with the hardware swap), so the premise still holds.

- **P2.1 Backoff on hopeless reconnects.** The O2Ring logged ~185 relink attempts; a device that has failed
  service discovery N times running will not succeed on N+1 fired 10 s later. Exponential backoff
  (15 s→30 s→60 s→120 s, cap ~5 min, reset on a real link) cuts battery drain, log volume (~10×), file
  fragmentation, and the sub-2 s idle gaps that *feed the autosuspend wedge*. (DEEP-ANALYSIS §4.)
- **P2.2 Resume the file-set on reconnect instead of minting a new one.** A flapping link fragmented the
  night into **189 O2Ring** and **31 Verity** file-sets (Verity × 4 streams = ~124 files). The PPG grid
  writer already inserts honest gap rows — a reconnect is just a larger gap. Resume within a short window
  (< 5 min, same device, same night) → one file per stream per night with gap accounting intact. A true
  outage (the 37/75-min wedges) should still start a fresh set — that boundary is correct.
- **P2.3 Suppress the O2Ring auto-pull during a known adapter outage.** The 300 s stored-session pull
  fired twice into a dead adapter and blocked the full timeout each time (02:14, 03:15). Gate it on
  "pinned adapter healthy AND link sustained"; make the 300 s timeout interruptible on adapter-down.
- **P2.4 Night-level coverage rollup.** The per-session gap accounting is excellent but never rolls up;
  the O2Ring's true "% of wall-clock captured" (0.24) is computed but not surfaced. Write per-device
  night coverage into `status.json`/QC and the morning summary — it is the number that matters.
- **P2.5 Surface pull progress.** `pull_progress` stayed `None` in `/api/state` throughout the onboard
  pulls — the live page shows no indication a download is happening. Emit start/percent/finish.
- **P2.6 Log every relink (epoch increment) at INFO with outage duration.** Verity silently went epoch
  1→46; a dropped-and-recovered link is exactly what a post-mortem needs and it left no trace.

### P3 — backup parity & retention safety (close the data-loss paths)
- **P3.1 Give the Polars a backup path, or accept they have none.** Tonight only the O2Ring survived the
  wedges because it flash-records independently of BLE. The Polars **cannot live-stream and onboard-record
  simultaneously** — so live monitoring means single-copy, and a wedge is unrecoverable for them (proven:
  Verity pull 0 files, H10 recordings `[]`). Options: (a) accept it and rely on P0/P1 to keep the radio up;
  (b) investigate periodic offline-record windows when the live view isn't critical; (c) treat dual-radio
  failover (P1.5) as their real protection. **Decision needed — document the choice.**
- **P3.2 Gate retention pruning on a verified second copy.** `diskguard.plan_prune()` is purely age-based
  and does not consult `nightarchive`'s `.archived` marker; with the archive disk unmounted (below) it is
  one long absence from deleting the only copy of a night. Skip any night lacking `.archived`, or gate the
  prune on `dest_present`.
- **P3.3 Archive poller: poll-then-sleep + startup dest validation.** `archive.dest`
  (`/run/media/michal/data/tepna-archive`) was **unmounted all night** — tonight lived on one disk despite
  `archive.enabled: true`. The poller sleeps 3600 s *before* its first check, so the warning didn't land
  until 23:11. Check first, and validate the dest at startup (folds into P1.4).
- **P3.4 Host disk headroom.** 88% full (18 GB free). Fine for one night (~1 GB) but tight against 14-night
  retention with the archive disk absent. Watch or expand.

### P4 — tooling hygiene
- **P4.1 `vigil.sh` fixed but untracked.** Three real bugs fixed tonight (foreground-subshell hang → the
  daemon became the script's child and `start` never returned; `$!` recorded a corpse pid so
  `status`/`stop`/`restart` all mis-reported; `stop`'s `exit 0` made `restart` a silent no-op) plus pid-
  recycle safety (act on `/proc/<pid>` identity, not a bare pid). Backup at `~/vigil.sh.orig-2026-07-24`.
  **It launches every overnight capture and has no version control — move it into `capture-host/` under
  git.**

---

## 5. What went RIGHT (keep these — do not regress)
- **O2Ring flash + auto-pull is the hero.** The E3 backup design did *exactly* its job: a gap-free 7 h
  onboard recording auto-pulled in 35 s the moment the ring hit the charger, fully recovering oximetry the
  live link had shredded. This is the model the whole system should aspire to.
- **On-charger auto-pull** fired correctly and fast for the ring, and correctly returned 0 for the Polars
  (nothing to pull) without error.
- **Watchdog phantom-link detection** cleared benign O2Ring phantom links cleanly and, crucially, never
  escalated to the adapter ladder on those — `grace_checks: 2` prevented needless power-cycles that would
  have taken the healthy H10/Verity links down. (The bug is the *health check*, P1.1 — not the phantom
  logic.)
- **No crash, no leak, no spin.** 6.5 h, RSS flat 56→61 MB, CPU ~0.4%. capture.py stayed healthy while
  correctly retrying a hardware fault it could not fix.
- **The `/api/polar/*` pull path** pauses live capture, holds the connect lock, and resumes cleanly — the
  H10 live ECG resumed with no error after the coordinated list op.
- **Honest per-session gap accounting** (`N gaps … X% of real time lost`) is exactly the right instinct;
  P2.4 just asks it to roll up to the night.

---

## 6. Lessons learned (the durable ones)
1. **A resilience feature you can't see is disarmed is worse than none.** The watchdog's false-"healthy"
   and the unprivileged ladder were both invisible until a real wedge — you plan the night trusting a
   defence that isn't there. → startup self-tests that scream (P1.4).
2. **Health checks must assert the specific thing that matters,** not a proxy. "BlueZ answered" ≠ "the
   pinned adapter is UP." A single-sample UP also catches a flicker and calls a dying radio healthy →
   hysteresis (P1.1).
3. **Recovery by luck is not resilience.** Both wedges ended on firmware self-heal; the software fixed
   nothing. Design for the fault that *doesn't* get lucky (P1.2/1.3/1.5).
4. **Independent onboard recording is the strongest backup there is.** It is blind to host/BLE chaos. The
   ring had it and its night was saved; the Polars didn't and theirs was lost (P3.1).
5. **Root cause lives below the app.** Static code analysis ranked 11 BLE fixes and never found the actual
   trigger — a `/sys` power setting on the USB dongle. Always check the hardware/OS layer (P0).
6. **A flapping link is not free.** It burns battery, floods logs, fragments files into the hundreds, and —
   the subtle one — its idle gaps can *cause* the very autosuspend wedge that then kills the night.
   Backoff is a resilience fix, not just tidiness (P2.1).
7. **The theory you record after two data points can be wrong.** Mid-night I attributed Verity churn to
   radio contention; a third pass (ring churning hard while Verity went quiet) refuted it — it was
   settle-into-bed motion. Hold explanations loosely until the data forces them.

---

## 7. Findings ledger (all passes → this brief)

| id | finding | plan item |
|---|---|---|
| ROOT | wedging radio = USB dongle (RTL8761B) w/ autosuspend on; internal radio idle | P0, P1.5 |
| F-WD1 | watchdog health check declares "healthy" while pinned adapter DOWN (25+×) | P1.1 |
| F-WD2 | recovery ladder unprivileged (`CapEff 0`), `hciconfig reset` exited 1 | P1.2 |
| F-WD3 | `usb_path` rebind rung disabled (port now known: 11-1.2) | P1.3 |
| F-WD4 | no startup self-test of defences | P1.4 |
| F-WD5 | no failover to the healthy second radio | P1.5 |
| F5/F8 | reconnect mints a new file-set → 189 O2Ring / 31 Verity fragments | P2.2 |
| F7 | fixed-cadence reconnect (~185 attempts); contention theory refuted, backoff still valid | P2.1 |
| F9 | O2Ring live coverage collapse (0.6→0.24); no night-level rollup | P2.4 |
| F11 | auto-pull blocks 300 s on a dead adapter (×2) | P2.3 |
| F6 | silent relink leaves no log line (Verity epoch 1→46) | P2.6 |
| F-UX | `pull_progress` stays None during onboard pulls | P2.5 |
| F-BK | Polars keep no onboard backup (live-stream XOR offline-record) | P3.1 |
| F2 | retention prune not gated on a verified second copy | P3.2 |
| F1 | archive dest unmounted all night; poll-then-sleep; no startup validation | P3.3 |
| F3 | host disk 88% full | P3.4 |
| F4 | `vigil.sh` bugs fixed but untracked | P4.1 |

---

## 8. Done-when
- One full night on the de-suspended dongle (P0.1) with **0** `adapter not found` lines; and a night on the
  internal radio (P0.2) — keep the winner.
- Watchdog asserts pinned-adapter-UP with hysteresis (P1.1) and a forced wedge is recovered by the ladder
  (P1.2/1.3), verified by unbind/bind in a test; startup logs the armed/disarmed state of every defence
  (P1.4). New pytest cases cover each (the existing suite stubs `find_device_by_filter`, so BLE-refusal and
  adapter-state paths need explicit fakes — see the PR #397 passive-scan regression test as the pattern).
- Reconnect backoff (P2.1) + file-set resume (P2.2) land, and a subsequent flappy night shows one file per
  stream and < 20 relink attempts/hour.
- P3.1 decision documented; P3.2 prune gated; P3.3 archive dest validated at startup.
- `vigil.sh` moved under `capture-host/` with its fixes and a pytest smoke test.
- Follow-up brief spawned per house rule for whatever executing this surfaces.

---

## THIN-NIGHT SIGNATURE — measured 2026-08-04, and it is not what it looked like

Investigated because the trio corpus stopped growing: recent nights kept missing a device, and the
daemon journal is full of `org.bluez.Error.InProgress`, `BleakDeviceNotFoundError`, and
*"offline op exceeded 45 s and was abandoned — … the adapter is wedged"*. 620 / 389 / 181 respectively
in 24 h. It reads like a wedged radio.

**It is not a wedged radio, and three checks say so.**

1. **"the adapter is wedged" is not a diagnosis.** It is part of a message that names *three* possible
   causes ("sensor off, out of range, or the adapter is wedged"). Counting occurrences of that string
   counts timeouts, not wedges. `hci0` — the adapter capture is pinned to — shows 62 MB RX, 373 864
   events and **`errors:0`** at the HCI layer.
2. **`adapter_watchdog` is not being starved.** The obvious hypothesis was that it skips while
   `_POLAR_PAUSED` is non-empty (the code says so itself at `capture.py:2365`: *"the one mechanism built
   to unwedge a stuck radio is disabled by exactly the condition that wedges it"*). Measured from the
   journal, the pause duty cycle is **36.6 %** (1024 windows, median 42 s, median free gap 10 s), so a
   60 s check lands free ~63 % of the time and two consecutive free checks are ~40 % likely — several
   hundred opportunities a day. It fires **zero** times.
3. **Because it correctly declines.** `classify_adapter_health` treats a clean not-found as *not worn,
   leave alone*. During the day the sensors genuinely are off. The watchdog abstaining is the design
   working, not failing.

### The actual discriminator: errors AGAINST connects and output

| night | files 21:00→09:00 | errors | connects | reading |
|---|---|---|---|---|
| 2026-07-27 | 131 | **282** | 89 | good night — *with* heavy error churn |
| 2026-08-01 | 14 | 36 | 15 | low everything — not worn |
| 2026-08-02 | 152 | 10 | 58 | good night, quiet |
| **2026-08-03** | **14** | **296** | **13** | **tried hard, captured almost nothing** |

**Error count alone is worthless as a health signal** — 2026-07-27 produced a complete trio while
logging 282 errors overnight. What separates a failure from an idle night is the *ratio*: 2026-08-03
logged nearly as many errors as 07-27 with **one seventh the connects and one ninth the output**. That
is a night where capture was attempted and largely failed. 2026-08-01, by contrast, is low on every
axis — nobody wore the devices.

### What is actually missing

**Nothing alerted on 2026-08-03.** The alert surface covers device-offline against a 300 s threshold,
and `offline_alert_suppressed(optional, ever_connected)` deliberately silences a device that was never
worn — correct, since not wearing them is normal. But a night that *tries and fails* looks the same to
that logic as a night nobody slept with the sensors on, and the first is a defect while the second is
a Tuesday.

A **thin-night signal** — "the sleep window produced < N files despite > M connect attempts" — is the
missing check, and the two numbers above give it a shape. It is deliberately NOT proposed as a code
change here: the threshold is a judgement about how many nights a person is expected to wear three
devices, which is an owner call, not a measurement. Recorded so the next reader starts from the
discriminator rather than from the error log.

**Re-runnable:** the measurement is three `journalctl` window queries plus a `find -newermt` per night;
no apparatus was committed because the input lives only on the box.
