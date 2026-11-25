---
bump: patch
type: fixed
brief: none
---

ECGDex reports an absence as an absence. The HF and LF shares are null when the two bands hold no power, where they read 0.0 and 0.0. The SD1/SD2 ratio is null when SD2 is below the published precision. The metric table prints a dash for an absent value.

The device RR and HR parsers count the rows they could not use, and the load line says the count. The export states the RR count when a row was lost. A companion file that gives no usable data earns a warning in the three Polar adapters. Data Unifier and OverDex show the warning. The ECG drop list names a PPI file when the firmware RR file replaces it.
