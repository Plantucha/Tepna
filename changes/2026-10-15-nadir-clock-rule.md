<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [cpapdex-dsp]
brief: none
---
Define the nadir clock rule: a desaturation nadir timestamp follows elapsed clock time, not sample position. detectDesats accepts spanSec and reports nadirSec/startSec/endSec. Without spanSec the times are null.
