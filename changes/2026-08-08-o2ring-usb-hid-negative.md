<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [capture-host]
brief: O2RING-USB-HID-NEGATIVE-2026-08-08-BRIEF.md
---
Record a measured negative: the O2Ring-S's USB-HID pipe is not an OxyII responder.

Docs only. The ring docks as `1915:f33c` — Nordic's vendor id, not Viatom's — exposing one HID interface,
one 64 B interrupt-IN endpoint, no OUT endpoint, `/dev/hidraw0`. `oxyii.py` is already a
transport-agnostic codec of the `0xA5` envelope, so if those frames rode USB a stored-session pull would
need no radio at all: no scan, no wedged dongle, no on-charger advertising mode. They do not.

Every read-only opcode returns silence, as does the documented `0xFF`→`0x10`→`0xE1` handshake, both short
and 65 B-padded writes, and a legacy-Viatom control frame; a 10 s passive listen yields zero unsolicited
reports. Three legs make that a real negative rather than a failed handshake: the report-id sweep is the
control — the ring STALLs every report id except 0, so it is parsing the transfer and validating a field;
`HIDIOCGFEATURE` STALLs on a Feature report its own descriptor declares, so the descriptor is a stock
Nordic template rather than a description of behaviour; and the stack was demonstrably awake throughout,
because the ring was BLE-connected and streaming during the silent probes. That last leg is what rules
out "it was asleep on the charger".

What it does not claim is stated in the brief: not that no protocol works there, only that the
BLE-documented envelope gets no reply in any framing tried. Two cheap leads are left open.

Also recorded: the codec was byte-verified against an INDEPENDENT oracle transcribed from the protocol
reference rather than by calling our own code for the expected value — and that confirmed existing
coverage rather than adding any, since `tests/test_oxyii.py` already pins the fixture twice. Worth saying
plainly, because "we verified the codec" means nothing without naming the oracle, and an oracle that
calls the implementation under test is not one.
