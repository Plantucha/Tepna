<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: O2RING-USB-HID-NEGATIVE-2026-08-08-BRIEF.md
---
The O2Ring USB silence has a mechanism now, not just an inference.

Docs only. The brief recorded a measured negative — OxyII gets no reply on the ring's USB-HID pipe — plus
an inference that the interface was a stock Nordic transport with nothing bound behind it, and two open
leads. Both leads are now spent and the inference is replaced by something better supported.

The mode hypothesis was tested properly. The first sweep ran while the daemon held a BLE link, so "the
firmware binds its handler to one transport at a time" was live. `tepna-restart.sh stop 3` — the
deadman-timed verb that exists so a tool can take a sensor's link off the daemon — gave a clean window
with the daemon inactive: every read-only opcode silent, with and without the handshake, and 30 s of
patient listening returning nothing.

Then the vendor's own Windows installer answered it. `O2 Insight Pro` ships `Holtek_HIDApi.dll`, genuinely
imported (the exe carries `"holtek write time out."`, the DLL exports `CloseHIDDevice`), and its HID
surface is `HidD_GetFeature` / `HidD_SetFeature`. The vendor's USB protocol is HID FEATURE reports — the
exact transfer type this ring STALLs with errno 32, which the first pass recorded and read only as
"declared but unimplemented". The O2Ring S is also absent from the app's model-code table, and the
vendor's current SDK for it is BLE-only.

That also resolves the apparent tension with the protocol reference's "byte equivalence between BLE-pulled
files and the vendor app's USB export": it compares FILES, not transports, and nothing in that document
ever claimed OxyII rides USB.

Recorded alongside: a check that proved nothing. Counting raw `04d9`/`1519` byte pairs in the binaries gave
34 vs 33 — noise in a 2.4 MB file, since any 2-byte sequence recurs by chance. The device ids were never
located; `strings` cannot see numeric constants. Written down so the next reader does not mistake it for
evidence, or repeat it.
