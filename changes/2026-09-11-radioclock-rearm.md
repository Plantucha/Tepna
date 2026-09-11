<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md
---
🔴 **The anchor enable does not survive a controller reset, and the collector sent it once.** `0xfd1f`
is a **runtime** command, not a build setting: any reset clears it, and the shipped collector called
`probe()` exactly once from `decide()` at startup. After an adapter bounce it would go on reading the
monitor stream and writing rows while **receiving no anchors at all** — no error, no refusal, just an
absence indistinguishable from a quiet night. That is the failure this module exists to prevent,
arriving through the one door it had left open. Measured by Kestrel on three reflashed nRF52840s
(2026-09-11): the enable answers `status 00` and is *not* expected to persist across a reset.

`rearm_needed()` watches the stream already being read and re-sends on the two packets that mean the
flag is gone: **New/Open Index** for our adapter — which also covers the case the startup probe
structurally cannot, an adapter that appears *after* we started — and a **Command Complete for
`HCI_Reset`**, which is what BlueZ produces on a power-cycle and on some suspend/resume paths.

Deliberately **not** triggered by Del/Close Index: the adapter is going away, there is nothing to arm,
and re-arming into a disappearing controller is how a retry loop is born. Deliberately **scoped to our
adapter index**: the monitor channel carries every controller on the box, and re-arming on a
neighbour's reset would send a vendor command to a radio we were never pointed at.

⚠️ **The re-arm is as loud as the thing it repairs is quiet.** A cleared flag is invisible, so a re-arm
that *failed* must not be — it logs the same three-way outcome the startup probe does (`enabled` ·
`not this image` · `no reply`/refused), and the run's summary carries the re-arm count. A silent
re-arm would reproduce the original bug one level up.

Four plants: adapter-up never re-arming (3 tests red), `HCI_Reset` never re-arming (2), re-arming on
any adapter (1), and a failed re-arm staying silent (1).

🔴 **And the re-arm must not trust a remembered index.** `hciN` is assigned at enumeration and
**reorders across exactly the event being re-armed on** — measured on three dongles across a reflash
(Kestrel, 2026-09-11), and the brief already records a unit moving `hci3` → `hci0` the moment another
dongle was pulled. A cached integer therefore fails in both directions: our adapter returning under a
new number is **missed**, and a neighbour inheriting the old number gets **sent a vendor command** —
the safety property inverted.

So New Index is matched on the **BD address**, which the packet itself carries (`hci_mon_new_index` =
`{u8 type; u8 bus; bdaddr[6]; char name[8]}`), and the index is **re-resolved from the address**
before anything is sent. A move is stated in the log rather than followed silently. The address is the
identity; the index is a cache — the same ruling the repo already applies to devices, applied to
adapters.
