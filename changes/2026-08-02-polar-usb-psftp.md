<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host, docs]
brief: POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md
---
PS-FTP does ride Polar's USB HID pipe — and the shipped BLE pull path has never once worked.

An earlier revision of `probe_polar_usb.py` concluded USB served no files and told the reader not to
spend more on it. That conclusion was wrong, and both causes were off-by-one details in
v800_downloader's framing:

* **`is_end()` is `(packet[1] & 3) == 1`** — flags==1 is END, flags==0 is MORE. Every reply from the
  device is `11 04 ..`, flags 0, which was read as a terminator ("success, empty payload") when it
  actually means *"more follows, ACK me"*. A protocol politely asking for an ACK looks exactly like one
  with nothing to say, if you invert one bit.
* **The RFC60 length is `len + 4`, not `len`.** A bare length is accepted by the pipe and simply
  answered with nothing, so the mistake is silent.

With both fixed the Verity served a real directory listing over USB — `DBDC.DAT` (1), `USERID.BPB`
(70), `S/`, and a date-named session dir `20260621/` — which `polar_psftp`'s protobuf layer parses
unchanged. Only the framing differs; the parsing/allowlist layer is reusable as-is.

**The window is gated on USB re-enumeration**, now proven rather than inferred: unplug 14:08:52 →
replug 14:09:07 → the first GET returned the listing, and the next request one second later was back
to 1-byte filler. Ruled out first, by measurement rather than argument: ACK-counter desync (all 256
values swept), stale handles (including v800_downloader's 500 ms double-open ritual), wrong paths, and
transience (171 attempts at 1 Hz → 0 replies).

**The finding that reorders the brief.** `/api/polar/recordings` on the Verity is 27 × `409`, 2 × `502`,
**zero successes** over 7 days, and `captures/stored/*offline*` is empty — no offline pull has ever
landed for either Polar. Caveat kept in the brief: most of those attempts are from this session and the
sensor was docked and charging throughout, so "BLE listing is broken" is not yet separable from "broken
while charging". The undisputed negative is that nothing has ever been retrieved by the shipped path,
while USB listed the same tree in under a second.

Whether a multi-packet **file** read fits inside the re-enumeration window decides whether USB is the
primary path or just a fast lister — re-enumeration is software-triggerable as root, so if it fits, a
"re-enumerate → one GET" loop pulls a session over a channel independent of the radio, i.e. while live
capture continues. A watcher is armed on vigil to answer it on the next replug; §6b says not to plan
the build order around USB until that log shows a file coming back.

Also records the safety rule learned the hard way: **do not sweep opcodes on this pipe** — an
exploratory sweep of byte1 across `0x00..0xFF` re-enumerated the device mid-run. `_ALLOWED_QUERIES`
exists because a wrong query id "would do something far worse than set a clock"; the hazard is
identical on this transport. The probe stays read-only: GET and ACK only.

Out-of-suite Python + docs — no shipped bundle, no `manifestHash` movement, no fixture re-recorded.
