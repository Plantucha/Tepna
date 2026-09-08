<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF.md
---
**The controller's own connection-event anchors, recorded as an OPTIONAL second clock.** Today the
second clock on a box capture is the host arrival stamp of each PMD packet, which reaches Python
through USB → kernel → BlueZ → D-Bus → bleak; `hostAxis` measures its spread at **102–5124 ms** on box
nights. A Nordic controller can report the anchor point of every connection event on its own clock,
below all of that. `radioclock.py` writes those anchors to `*_RADIOCLOCK.csv` beside the night and
**uses none of them** — whether they are good enough to discipline the axis is decided later, against
the brief's pre-stated bands.

🔴 **`capture.py` is not touched, and that is checkable rather than asserted:**
`git diff origin/main -- capture-host/capture.py` is empty. The collector is a separate process on a
separate unit; the capture daemon neither knows nor cares whether it runs, and a box with any ordinary
adapter captures exactly as today. The join key lives **inside the ACL packet**, which is why no hook
is needed.

🔴 **Default OFF, and feature-detected even when on.** Turning it on does not assert that a box can do
it: the collector proves the controller is Nordic *and* that the vendor enable succeeds before it opens
a file. On any miss it logs **one line**, exits **0**, and writes **nothing** — a non-Nordic controller
is the common case, not a fault, and a unit that went `failed` for it would leave a permanent red in
`systemctl --failed` on most boxes. **Absence is the absence of a FILE**, never an empty one, and that
holds per device as well as per box.

⚠️ **The six ways a box can be unable are six distinguishable log lines** — dongle absent, no devices
configured, not Nordic, command unknown to this firmware, **no reply at all** (a wedged controller,
measured on vigil 2026-09-07: it answered no HCI command for 15 minutes), and a refused send. They
share one outcome, so without distinct wording a reader cannot tell which happened, and each has a
different fix.

🔴 **The join key is `last_sensor_ns`, and the brief said `first_sensor_ns` until this was measured.**
Bytes 1..9 of a PMD frame are the **LAST** sample's stamp; `first_sensor_ns` is a value the decoder
BACK-TIMES and is not in the packet at all. A collector joining on it would have matched **zero** rows
on every multi-sample frame — and an empty join reads exactly like a night with no correlated packets.

**`CAP_NET_RAW` alone**, measured on the box rather than assumed: the vendor command went out from an
unprivileged uid with bluetoothd keeping the adapter. `CAP_NET_ADMIN` was tested and is not required.
`HCI_CHANNEL_USER` is disqualified outright — it takes the adapter away from BlueZ, which here means
the capture daemon losing its links mid-night.

**Installed, NOT enabled.** 68 tests, 100 % statement+branch on `radioclock.py`; the only untested
function is the raw socket read, which contains no decisions.
