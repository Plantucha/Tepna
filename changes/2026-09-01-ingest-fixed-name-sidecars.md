<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex, ppgdex]
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---
The capture host's fixed-name sidecars and the H10's `_RR` companion no longer fail OPEN into a
primary-waveform lane at the ingest seam (DEEP-AUDIT-VI F12).

`dex-ingest.js nonSignalName()` matched sidecars by a token alternation that requires a LEADING
UNDERSCORE (`_(CLOCK|LINK|…)`), so a fixed name with no device prefix and no stamp could never match
it: on the real 2026-08-30 vigil folder `planIngest` queued `CPAP-INVENTORY.jsonl` and `OXYLIFE.csv` as
ECG RECORDINGS, and `CLOCKSYNC.csv` (a sidecar that landed 2026-09-01) classified ecg+ppg the day it
appeared — the third generation of the defect the function's own PMDARRIVAL comment records. Separately
`ppgKind` had no `_RR` branch, so `Polar_H10_*_RR.txt` (ECGDex's companion) fell to the bare-name default
and was queued as a PPG PRIMARY, dying in parsePPG (2 of 2 on that folder).

Fix: every fixed name capture-host writes into a night folder is pinned in `nonSignalName`
(`CPAP-INVENTORY · OXYLIFE · CLOCKSYNC · SESSIONDETECT · AS11CLOCK · WEDGEFIRE · MANIFEST · QC-SUMMARY`),
`_RTCLOG` joins the stamped alternation, `.JSONL` joins the container list (`.CSV` deliberately still does
not — a bare `.csv` waveform legitimately defaults through); `ppgKind` sets `_RR` aside and `foreignKind`
labels it `rr` for the breakdown. Measured on the real folder: files admitted as a primary 27 → 23; the
four removed are exactly OXYLIFE, CPAP-INVENTORY and the two `_RR`.

Gate: the §6.4 routing group grows by 24 assertions (nine sidecar names × ecg+ppg, the `_RR` triple, the
`_PPI` and bare-`.csv` controls) — pair-verified: 16 red on `origin/main`'s `dex-ingest.js`, 49/49 here.
`dex-ingest.js` inlines into ECGDex, PpgDex and the two orchestrators — all four re-bundled
(ECGDex 00ba2427dba9 → 5ad244b6566c, PpgDex 9996f626bf58 → fa637ac924a1); `regen-ecgdex-goldens` +
`regen-ppgdex-goldens`: 0 moved.
