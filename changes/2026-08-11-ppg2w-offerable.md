<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`ppg2w` was missing from the O2Ring's offer set, so it could never be switched on — and any settings
save silently deleted it from config.yaml. The ring lost 110 MB/night of second-wavelength pleth.
