<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: []
brief: none
---
Count the four-corner hat over every capture night that holds four corner roles. The census loads
the shipped `sensor-trio-worker.js` into a Node realm and calls its own `runRealNight`, so it adds
no second estimator. It reports each corner sigma with its second count and its covered span, the
classic hat over the same seconds out of `nCornerHat`'s own subset table, and every refusal by its
reason. The criterion `nights_with_an_unnamed_refusal` was stated and hashed before the run.
