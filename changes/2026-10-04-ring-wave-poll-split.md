---
bump: minor
type: added
brief: RING-POLL-SPLIT-2026-10-04-BRIEF.md
nodes: [capture-host]
---

A config-selectable ring wave-poll mode, `o2ring.wave_poll_mode`, **default OFF** (`dual` is byte-identical
to today). In `split` mode 0x03 LIVE_SAMPLES_A is polled every cycle and 0x04 drops to a 10 s deadline, so
the buffer the vendor's single wave parser serves is drained almost entirely by one opcode.

0x04 is **reduced, never replaced**, for two reasons at once: it is the proven vitals path — 0x02 RT_PARAM
has never been polled, has no parser and no measured reply, and a failed vitals poll drops the LINK — and
it is the only opcode known to carry a stream position, so each surviving poll is also an arrival-floor
anchor.

∅ E11's arrival logger follows the opcode that carries the frames and says which: `PPG_FRAME` is 0x04 with
a position, `PPG_FRAME_A` is 0x03 with the position column BLANK. Never a host-maintained running sum — a
sum advances across a dropout the device sat out, which is exactly what the floor exists to see. The
consumer's refusal now names the opcode instead of blaming the capture's age.

⚠️ The brief records that the criterion as first specified would have REFUSED a working mode: "markers
excluded" is 0x04's correction and inverts on 0x03, where subtracting them moves the measured rate from
125.058 to 124.444 Hz. The corrected criterion is the raw row rate with the controls scored over both
opcodes summed, plus an adoption gate that a device position must exist at all. No experiment night has
run; nothing here is claimed about one.
