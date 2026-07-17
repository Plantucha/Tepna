<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [GlucoDex]
brief: none
---
Apply the Clock-Contract §3 whole-file DMY/MDY lock in GlucoDex parseCSV — a European (DMY) Libre export no longer scatters ambiguous rows onto MDY calendar dates mid-file.
