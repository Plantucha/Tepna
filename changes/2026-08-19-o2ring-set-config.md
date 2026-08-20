---
bump: minor
type: added
brief: O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md
---

**`0x01 SET_CONFIG` moves from the do-not-implement list to a GATED writer — the vendor app's
brightness and vibration-intensity knobs are now settable from the box, with read-back proof.**

Owner-ordered. Payload per the byte-verified upstream (nglessner/o2ring-s-protocol): 8 bytes LE,
`[field_index, 0, 0, 0, value, 0, 0, 0]`; the write-side indices are a different enumeration from
GET_CONFIG's read offsets (MOTOR write-6/read-4, BRIGHTNESS write-9/read-7).

- `oxyii.set_config_frame(field, value)` — whitelist of the 9 documented fields; nothing off-list can
  produce a frame, which is what keeps the opcode's neighbours (0xE3/0xEE factory resets) unreachable
  by construction. Brightness enforces its documented 0..2; other ranges are undocumented upstream, so
  a byte is accepted and the read-back is the validator.
- `ring_config.py` — operator tool: `--get` dumps the parsed struct; `--set FIELD VALUE` brackets the
  write with GET_CONFIG before/after and reports applied ONLY if exactly the expected byte moved to
  the expected value (switch fields: changes confined to the alarm bitfield bytes). Prints the
  before-value as the restore command. Exit 1 on ignored, half-applied, or side-effectful writes.
- Live-verified on fw 2D010002: brightness 0→1 (`byte[7] 0 → 1`, nothing else moved) and restored —
  the plaintext write path works on this firmware. MOTOR (=60) is now the buzz-fiducial tuning knob.
- 0xE3/0xEE stay NEVER-IMPLEMENT; the oxyii note is rewritten to say why 0x01 left the list and they
  cannot.

ring_config.py at 100% branch coverage (19 tests, incl. ignored-write, collateral-byte, write-blind
refusal, and switch-bitfield arcs); set_config_frame refusals gate-tested. capture-host lane only.
