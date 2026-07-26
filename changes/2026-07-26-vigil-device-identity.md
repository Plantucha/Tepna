<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
One physical sensor keeps one identity across a device_id correction. The monitor extracted a Polar serial from the advertised name with a digits-only pattern, so hex-serial devices (Verity Sense) silently fell through to a MAC-derived id and were bonded under the wrong one; correcting that by hand later orphaned every file already written, and nightqc reported 795 ACC rows for an armband that had recorded 85 MB. Serial extraction is now hex-aware, file attribution is an exact field comparison instead of a substring search, and `device_id_aliases` lets a corrected id be additive rather than destructive. The filename parser also reads Polar Sensor Logger's split stamp, which the previous one could not.
