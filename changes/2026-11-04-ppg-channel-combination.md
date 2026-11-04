---
bump: minor
type: added
brief: none
---

Add `tools/ppg-channel-combination.mjs`, which re-cuts the paper's channel-combination result. Each 300 s block fits channel selection, PCA-1 and a maximum-SNR beamformer on its first half. It scores all four on the second half. The criteria are the shipped spectral SQI and foot-to-foot dispersion. One recording counts once when two capture trees both hold it. The run emits a `tepna.verdict/1`.
