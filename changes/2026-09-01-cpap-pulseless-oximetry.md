<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [cpapdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
CPAPDex `oximetryLane` no longer fabricates a clean oximetry night when the SA2 file carries SpO2
but no Pulse channel (DEEP-AUDIT-VI F7).

The lane substituted an all-ZERO pulse series for the missing channel. The oximeter self-gate —
mirrored verbatim from OxyDex — then read pulseValid = 0 inside every desat window, stamped every
genuine desaturation `perfusion-collapse`, and the lane published **ODI 0.00 / desatCount 0** with
`artifactCount` equal to the true desat count. Executed on identical SpO2 with five clean 5 %
desats: with a pulse channel odi 7.5 / 5 desats / 0 artifacts; without it odi 0 / 0 / 5. Pulse-less
SA2 is a real corpus shape (Pulse.1s absent in 1 of 250 files), and the mirror source
(`oxydex-dsp.js detectODI`) already treats the pulse series as optional and degrades to ungated
detection.

Fix: pass `null` for the absent (or zero-length) channel — `selfGateDesat` returns unflagged on a
null series, exactly the OxyDex behaviour — and name the absence on the lane as
`pulseLane: 'present' | 'absent'` so a consumer cannot read `artifactCount 0` as "no artifacts"
when nothing was gated. `pulseMedian` / `pulseRange` are null on the absent lane rather than a
statistic of zeros. The `selfGateDesat` mirror itself is untouched.

Gate: a new `CPAPDex F7` group (11 assertions) runs the same SpO2 with and without the channel and
was pair-verified — 7 of 11 red on the previous `cpapdex-dsp.js`, all green on this one. The five
committed CPAPDex fixtures all carry a Pulse channel, so their outputs are byte-identical under
the new code (`regen-cpap-goldens`: 0 moved); `manifestHash` moves with the re-bundle.
