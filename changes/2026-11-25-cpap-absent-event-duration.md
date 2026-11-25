---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
nodes: [CPAPDex]
---

An EDF+ event duration that the device never stated now reads `null` and not 0. `parseTAL` gave 0 to an omitted duration field and to a written "0" alike, because the string "0" is falsy as well. The bus then published a 0-second apnea. A written 0 keeps its value, which is the marker form a real AirSense uses for a span.
