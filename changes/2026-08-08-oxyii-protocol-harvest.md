<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: OXYII-PROTOCOL-HARVEST-2026-08-08-BRIEF.md
---
Harvested nglessner/o2ring-s-protocol: GET_INFO / GET_CONFIG / GET_BATTERY parsers and the Format-A session trailer.

Anchored by a byte-level proof their protocol is ours: their documented GET_INFO frame
A5 E1 1E 00 02 00 00 + CRC BF equals our encode(0xE1, seq=2), now a committed known-answer test.

Added to oxyii.py (all read-only, all pure): frame builders + parsers for GET_INFO (firmware, serial),
GET_CONFIG (20-field settings struct), GET_BATTERY. The highest-value piece is the Format-A 48-byte
session-stats trailer (parse_oxy_trailer + oxy_is_finalized), wired into pull_session's .meta.json as
device_summary: the ring's own avg/min SpO2 + desat counts (an independent cross-check on OxyDex,
validated byte-exact against a real 95 KB .dat — total-seconds 31701 and min-SpO2 81 match the body) and
the 48 12 5a da sub-magic as a reliable finalisation predicate, since the ring can report full size via
cmd=0xF2 before the trailer flushes.

MTU: we do not force 517 (bleak-on-BlueZ auto-negotiates 247, which upstream confirms is sufficient; the
517 in their Bumble examples is a Bumble artifact). Added a WARN in pull_session when the acquired MTU is
< 200 so upstream's silent-drop failure (cmd=0xF2 returns zero bytes, no error) fails loud instead.

Deliberately NOT harvested: SET_CONFIG (0x01), FACTORY_RESET (0xE3), FACTORY_RESET_ALL (0xEE) — all write
persistent state, the class this project gates; opcode constants documented so they are not reused, but
no frame builder ships. The AES-128 path is unused on this firmware (cmd=0xFF returns no session key).

Trailer offsets and sub-magic mutation-checked. capture-host 2935 tests, coverage 100%.

Out-of-suite Python only — no shipped bundle, no manifestHash movement, no fixture re-recorded.
