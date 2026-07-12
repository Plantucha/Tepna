<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [HRVDex]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Return NaN when a frequency band is absent instead of fabricating one from an epsilon denominator, and unit-guard MxDMn/MeanRR — HF n.u. surfaced as 125,000,000 % and the MxDMn ratio read 1000× low.

**§3 — spectral presence gate.** `(totalPow − vlf) || 0.001` treated an *absent* band as `0` and then
substituted a 1000×-too-small epsilon. ECGDex and PpgDex export `lf`/`hf` but no `totalPower`/`vlf`, so on
that documented ingest path `HF n.u.` — a quantity that is **0–100 by definition** — surfaced on the hero
"HRV Bench" card as **125,000,000 %**, and went *negative* when only `vlf` was present. Every spectral
derivative (`d_lfhf`, `d_hfnu`, `d_lfnu`, `d_svi`, `d_sdi`, `d_rsa`, `d_sai`, `d_vlf_hf`, `d_spectral_ent`,
`d_lfhf_totpow`) now gates on its inputs being **present**, mirroring the existing `_hasSubj` rule, and
reads `NaN` when they are not. `d_sdi`'s old guard was always-truthy (a `+0.001` term saw to that) and
`d_spectral_ent` fabricated a VLF share via a `|| 0.0001` floor; both are gone. The honest path is
untouched — with all four bands present, `HFnu + LFnu` is exactly 100.

**§4 — MxDMn/MeanRR unit guard.** A Welltory export is mixed-unit (MeanRR in ms, MxDMn in **seconds**) —
the exact trap `DexUnits.guardBaevsky` exists for. `d_si` and `d_csi` used the guard; `d_mxdmn_meanrr`,
three lines away, divided raw seconds by raw milliseconds and read **1000× low**. It now uses the same
guard-normalized operands as `d_csi` — which is literally the same quantity — so the ratio is
unit-invariant and the two agree exactly.

Also makes the derivation genuinely headless (`getProfile()` is guarded; profile-dependent columns fall to
NaN rather than throwing) and exposes `HRVDex.derive()` / `HRVDex.rowFromNodeExport()` so both runners can
gate these columns directly. Export-inert: no fixture output moved.
