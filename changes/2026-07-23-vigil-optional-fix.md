<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: VIGIL-DEEP-ANALYSIS-2026-07-22-BRIEF.md
---
Complete the optional-backup-device handling (out-of-suite capture-host/): the first cut quieted only a
connect TIMEOUT, but a churny absent device (the COOSPO) alternates InProgress + timeout, and the
non-timeout branch reset the log-once — so it still logged ~17x and, worse, its InProgress counted as an
adapter WEDGE sign that could trigger unnecessary power-cycles. Now an `optional: true` device quiets ANY
connect error (all mean "not cleanly joining"), the log-once resets only on a real connect, and the
adapter watchdog EXCLUDES optional devices from wedge detection entirely (an expected-absent backup is
not evidence of a wedged radio). Verified live: the COOSPO card reads "optional backup — not present"
with no warning spam and no wedge signs.
