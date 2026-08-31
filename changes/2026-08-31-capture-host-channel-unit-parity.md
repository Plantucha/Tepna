<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
CPAP capture-host L/s unit hygiene: corrected the auto-stop log and standby comments that labeled L/s flow as L/min; migrated the misleading auto-stop config key `flow_eps_lpm` to `flow_eps_lps` (legacy key still accepted with the SAME value — never divided by 60 — plus a deprecation warning); and locked the MaskPressure (bus↔EDF) and PMD (`_LIVE_META`↔PSL-header) unit pairs with differential regressions so two representations of one channel cannot silently diverge.
