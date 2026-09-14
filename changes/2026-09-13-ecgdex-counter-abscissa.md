<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
Build ECGDex beat times from the device's own ns counter instead of `sample index ÷ one global fs` — measured over the 8 largest H10 nights the mean-rate axis drifts 0.56–2.62 s from the counter, on gapless nights as much as gappy ones, and that divergence is what made the Integrator certify a −137 ppm "inter-device drift" neither device exhibits.
