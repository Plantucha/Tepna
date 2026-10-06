---
bump: patch
type: fixed
brief: none
---

Six ECGDex registry ids are renamed to the names the code actually emits (`beatsNN`→`nBeats`, `qrs`→`qrsDur`, `rAmp`→`Ramp`, `tAmp`→`Tamp`, `ventRuns`→`runsGE3`, `bigeminy`→`bigeminyCycles`), so a cross-node lookup on the old name can no longer resolve to a tier for a quantity nothing produces; the browser test lane now carries every `*-registry.js` source.
