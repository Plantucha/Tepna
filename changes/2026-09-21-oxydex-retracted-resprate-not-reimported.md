---
bump: patch
type: fixed
brief: none
---

OxyDex's export loader no longer reads a pre-#2527 export's newMetrics.respRate back into the night: the proxy respiration rate was retracted at compute on 2026-09-15 (r = 0.05 against two inductance belts) but a legacy export still carries a number, and reloading one re-drew the retracted 'Respiratory Rate (RSA spectral proxy)' section. Planted legacy export asserts respRate === null on reload with a live-key control beside it. Closes the two 2026-09-03 respRate residue rows, which #2527 had already overtaken at the producer.
