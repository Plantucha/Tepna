<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pulsedex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
`artifactClean`'s local median was drawn from the artifacts it was correcting. The 11-beat window pushed the **raw** neighbours, so a *cluster* of artifacts — a dropout burst or an ectopy run, which is the normal way artifacts arrive, not the exceptional way — could form the majority of that window and become the median used to replace them.

Two consequences, both now pinned:

- **The replacement could land outside the function's own `[300, 2200]` bounds** — a beat "corrected" to a value the very next line would itself flag as an artifact. On the adversarial twin, 5 beats were "corrected" to 180 ms.
- **The cleaned series kept the burst's variance**, corrupting whole-record rMSSD — and in the direction that reads *healthier* (higher HRV), which is why it never looked wrong. The audit measured **+58 %** on the real corpus; the twin here is starker (132 ms vs the physiologic 22 ms).

Fixed by admitting only physiologically plausible neighbours into the window, which addresses both at once: the median is uncontaminated, and being drawn from in-range values it is in range by construction. The bounds are now named once (`RR_MIN`/`RR_MAX`) because the window filter and the artifact test must agree — if the median can come from values the test rejects, the correction hands back a beat the function considers an artifact.

6 new assertions pinning the actual **boundary**, not one convenient case: a 6-beat burst is still a minority of the 10 neighbours, never flipped the median, and was already correct — asserted so the fix is shown to target contamination itself rather than bursts generally. A 7-beat burst flips it and is the regression case. An artifact-free recording is asserted to pass through value-for-value unchanged, so the guard is not over-broad.

Mutation-verified: restoring the raw window reproduces exactly 5 below-floor beats and rMSSD 132, while the 6-beat case stays green.

Fixtures do **not** move, as the audit predicted — GATE B 25/25 reproducible, and both corpus-backed PulseDex fixtures re-ran through the suite byte-identical. PulseDex plus both orchestrators rebuilt.
