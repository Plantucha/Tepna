---
bump: patch
type: fixed
brief: none
---

Publish a `NOT_RUN` verdict with the night population when `oracle-ecg-firmware-rr.mjs` finds no H10 ECG+RR pair. An absent root and a root holding no pair then stop reading alike. A run that scored nothing exits 2.
