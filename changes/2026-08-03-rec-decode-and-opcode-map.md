<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
brief: POLAR-PMD-COMMAND-SURFACE-2026-08-02-BRIEF.md
---
A `.REC` off the device's flash now decodes into the format the Dexes already read.

`rec_to_psl.py` closes the onboard-backup loop. The container needs **no new decoder**: its payload is
a run of PMD data frames byte-identical to the live link, so the whole offline path is a container walk
plus `pmd.decode_frame` — the same function `capture.py` uses every night.

**The last unknown was a boundary, not an encoding.** Every frame decoded exactly 52 samples — precisely
944 ms x 55 Hz, so the data was plainly all there — and then raised "truncated". Sweeping the slice end
against the decoder showed a 281-byte record decodes cleanly at **+279/+280** and fails at +281: the
layout is `10-byte PMD header + 269-byte payload + 2 trailing bytes` (content unidentified, plausibly a
CRC). Slicing to the next frame's offset fed those two bytes to the delta decoder, which read them as a
block header that could not complete and discarded all 52 good samples. Asking the decoder where the
frame ends beat reasoning about the delta encoding.

Result on a 4.7-minute recording: **300 frames → 15,580 samples, 282.85 s, 55.08 Hz, zero warnings**,
and PPGDex parses it.

⚠️ **Mechanically proven, physiologically NOT.** Every test recording was made with the device in its
charging dock, off-body, so PPGDex returns rMSSD 300.5 ms and pNN50 85.7 % — beat detection correctly
reporting no coherent pulse. Amplitude does not separate the two cases (the docked file's AC is
*higher*, 8320 vs 3379 — off-body light wanders where skin damps it); periodicity does. Validation
needs one on-body offline recording, which is a five-minute experiment.

⚠️ **The stamp is UTC** — measured to −0.3 s against a host UTC clock — while the Clock Contract stores
floating LOCAL civil time. `--tz-offset-min` converts at the boundary; the default of 0 writes UTC
through and says so, because a silent offset is the failure this guards.

Also adds `probe_pmd_opcodes.py`, which maps the PMD instruction set **including undocumented opcodes**
without executing them: send the opcode alone, one byte, and read the status. A device that implements
an op rejects it on LENGTH (`0x04`); one that does not rejects the OPCODE (`0x01`). The difference is
the map. It is opt-in behind `--i-accept-the-risk` and states the residual risk plainly — an
undocumented op needing no parameters WILL execute on a bare probe, which cannot be prevented from
outside the firmware. It snapshots full device state before/after, aborts at the first unexplained
change, skips the two ops known to persist across power cycles, and stops anything left running.

capture-host only, out of suite — no bundle, no `manifestHash` movement, no fixture re-recorded.
