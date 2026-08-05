<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [CPAPDex, OxyDex, suite]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
idForLabel lowercased before checking the registry, so a render site passing a real camelCase metric id fell through to badgeForLabel's fabricated-`experimental` fallback while the registry graded it properly — CPAPDex's residualAHI and usageHours are `measured` and rendered `experimental`, a two-tier under-grade on the two headline therapy numbers. Six tokens across two nodes; fixed in all eight registry clones. The no-fabricated-tier gate reported green over it because it asked a raw REGISTRY[tok] lookup instead of the resolver the runtime uses; it now asks badgeForLabel.
