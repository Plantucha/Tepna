---
bump: patch
type: fixed
brief: none
---

The PhysioNet reader recognises WFDB's invalid-sample sentinel instead of scaling it into the ECG DSP as signal. `wfdb.h` defines `WFDB_INVALID_SAMPLE (-32768)` for an UNDEFINED amplitude; it is a library constant `SIGNAL(5)` never mentions, so a reader written from the format spec meets it as a -163.84 mV sample at a typical gain of 200 ADU/mV. Pan-Tompkins' thresholds are adaptive, so one such sample poisons detection well beyond its own span - excluding it from scoring alone would leave the number computed from an already-corrupted detector. The run is excised at the parse boundary and its wall-clock dead time declared through analyze()'s existing `gaps` channel, so detected beat times stay on the original axis; annotations inside an excised run leave the reference train and are COUNTED (refBeats + refBeatsExcluded = refBeatsTotal). Format 212 reports `checked:false` with a reason rather than an empty run list - whether WFDB maps -2048 to the same sentinel is unverified, and an unexamined stream must not read like a clean one. Preparatory correctness: MIT-BIH is format 212 throughout and 0 of 48 records are pinned, so this guard has never run on real data, and the selftest says so as NOT_RUN.
