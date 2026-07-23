<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex]
brief: none
---
Count device-scored unclassified 'Apnea' events in residual-AHI — `classifyAnnotation` mapped a bare ResMed "Apnea"/"Apnoea" to a distinct 'Apnea' class that `eveClassToType` had no case for, so it fell through to null and vanished from `eveEvents`, understating residualAHI (and the ganglior bus) vs the device's own AHI. Add type 'UA' counted in nApnea/`_eventRate` AHI but kept out of the obstructive/central split, with a fusion impulse 'apnea'/class 'unclassified' mapping; 'Unclassified' timekeeping/leak TALs still correctly drop to null.
