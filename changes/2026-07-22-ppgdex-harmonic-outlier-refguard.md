<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PpgDex]
brief: PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE-2026-07-11-BRIEF.md
---
Guard the optical reference-channel pick against harmonic counting — if the SNR-picked LED reads a near-integer multiple of a coherent clean majority, move the reference onto the majority; inert on the real corpus (the adaptive refractory already de-doubles), defense-in-depth for a lone future doubling channel.
