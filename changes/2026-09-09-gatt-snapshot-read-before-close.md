<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Read the GATT snapshot and link state **before** the leak guard closes the link — #2170's diagnostic
was blind.

`_gatt_snapshot` shipped in #2365 one line below `await client.disconnect()`. bleak's `disconnect()`
ends with `assert self.services is None` (`_cleanup_all` resets the collection), so the probe could
only ever report the teardown it had just performed. Measured on vigil 2026-09-09: **98 of 98 events
printed the byte-identical `no service snapshot (BleakError)`** — zero variance, from a check that ran
and never examined its subject. The uniformity was the tell; a real mixture of partial, empty and
torn-down snapshots cannot agree to the byte 98 times.

The message also carried `"although the link is up"`, which was **asserted and never measured** — and
it is precisely one of the two things at issue. New `_gatt_link_state` measures it, and the log now
separates the two mechanisms that produce the identical `BleakCharacteristicNotFoundError`: a peer
that dropped mid-discovery (`link=DISCONNECTED`) from a collection bleak built before BlueZ published
the characteristic objects (`link=connected` with a non-empty snapshot). Its third answer is
`unknown (ExcType)` — bleak's `is_connected` raises once the backend is gone, and defaulting that to
`False` would manufacture the peer-drop finding every time the probe merely could not look.

⚠️ The stub was complicit and is fixed with it. `_FakeBleak` modelled the calls bleak *receives* and
not the state bleak *keeps*, so it held its snapshot across `disconnect()` and #2365's own test passed
green over the defect. It now drops `_services` on close, which reds **two** tests against the old
ordering — the new one and #2365's.

This does not fix #2170's underlying fault (98×/day, absorbed by #2365's retry 97 times in 98). It
makes the next day of log able to name the mechanism, which the previous instrumentation could not.
