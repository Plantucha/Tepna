---
bump: minor
type: added
brief: O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md
---

All 256 OxyII opcodes swept on real hardware: 25 undocumented responders beyond the 8 known.
`0x83` = VIBRATE (confirmed 5/5 with contact held) — a silent alert channel to the wearer the suite
never had. `0x03` drains a ~125 Hz PPG buffer that **caps at 250 samples ≈2 s and discards the
overflow with no error and no gap marker** — poll ≤2 s, treat `count == 250` as saturation.

Also measured, from captured data across 90 sessions: the ring emits **exactly 126 PPG samples per
status frame** (`O2RING-FRAME-SAMPLE-LOCK-2026-08-03-BRIEF`). The two streams are therefore ONE clock —
no ppm or independent timebase can be recovered by comparing them — but sample loss becomes *countable*
(`126 × frames − samples`) instead of inferred from arrival timing.

Records five same-day retractions and the rule that survived them: the null must be a documented
harmless command, never silence — and actuators are invisible to a detector that reads the data
frame, so they need a human observer. `probe_oxyii_opcodes.py` now writes its report after every
opcode and wall-clock stamps each one, because two runs were killed the instant an actuator fired
and took their whole record with them.
