---
bump: patch
type: fixed
brief: none
---

Keep the OxyDex SpO2 and motion channels in the export when the pulse column is absent.
A 5-min window under the HR floor now publishes `hr: null` with its covered count, and it
keeps its motion. The `timeseries` block ships whenever any one of its three members exists.
