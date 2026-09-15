---
bump: patch
type: changed
brief: none
---

Residue row: `aai` is a user-visible `heuristic`-tier metric with no reachable external validation
path, and three routes to SHHS1's expert-scored arousals were tried and failed.

Route 3 — `NSRR.edfToOxyRows` → `OxyDex._bare.processNight` → `spikes` + `odi4.count` — works end to
end with no code change, but runs at ~146 s/record against the ODI path's ~9.5 s, a 15× gap that is
unexplained. The row says explicitly that route 3 is the right one and needs only the slowness
diagnosed, so routes 1 and 2 are not re-tried.
