<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF.md
---
The O2Ring's passive scan now SENDS the filter BlueZ requires — owner ruling 2026-09-20 ("or_patterns
lands first, then the coexistence matrix"; "measure the AD first"). Measured on vigil: bleak's BlueZ
backend refused every patternless passive request at construction, once per daemon process since the
power axis shipped (174 processes), so every "passive" window since 09-05 was ACTIVE and the
radio-duty saving §7 of the power brief was designed around was never taken.

- `oxy_presence.passive_or_pattern_spec()` — the filter as plain `(offset, ad_type, prefix)` triples,
  bleak-free, BUILT FROM THE RING'S MEASURED ADVERTISEMENT: the 2026-09-05 air capture
  (`VIGIL-BLUETOOTH-ADAPTERS` §F5; 537 ADV_IND from `d1:98:62:7c:92:b3`, docked, unworn AND connected)
  decodes to Flags 0x06 · manufacturer 0xF34E data 00 · appearance 0x0341 · name S8-AW 2100. The
  filter is Flags 0x06 + 0xF34E (measured) + 0x036F (`O2RING-PROTOCOL` §6's documented recording-mode
  id, unmeasured). A RADIO FILTER, NOT AN IDENTITY CHECK — identity stays address-only.
- `capture._passive_scan_kw(akw)` — `scanning_mode="passive"` with the `OrPattern`s merged INTO the
  adapter pin's `bluez` dict (a second `bluez=` would replace the pin). Used by both scan sites,
  `_connect_scan` and the presence observer's factory (now exercised once by a test through a stub).
- `oxy_presence.passive_refusal(exc)` classifies the downgrade — `or_patterns` (code, fixed here),
  `experimental` (bluetoothd), `passive` (other), None (a real scan error: still RAISED, never masked
  by a second scan). The downgrade line carries the class.

⚠️ NECESSARY, NOT SUFFICIENT. With patterns supplied, bleak's next check (`manager.py:592`) needs
`org.bluez.AdvertisementMonitorManager1`, which bluetoothd exposes only with `--experimental`; vigil's
bluetoothd 5.85 runs without it (absent on hci0–hci3, measured). Acceptance is a two-step transition:
on the first deploy the downgrade line moves from "requires bluez or_patterns" to `[experimental]`
(proves the plumbing); after the owner's drop-in + one bluetoothd restart it stops appearing in new
daemon processes (proves passive); then the attended night proves the ring is sighted while recording.
Residue: `2026-09-20-passive-scan-needs-experimental-bluetoothd` opened (the box half, owner-side);
it also withdraws two errors of mine — "recorded nowhere" and "advertises only while disconnected".
Nothing armed on the box.
