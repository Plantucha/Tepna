---
bump: patch
type: added
nodes: []
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

Audits the formulas the reference-guide brief names. HRmax (Tanaka), GMI (Bergenstal) and QTc
(Bazett/Fridericia) all match between guide and DSP. SampEn does not — not in its values, which are
right everywhere, but in its argument: `r` is the absolute tolerance in ECGDex and PulseDex, a
multiplier in PpgDex, and inlined in OxyDex, under the same function name and arity in sibling files.
Mis-calling ECGDex returns null; mis-calling PpgDex returns 0.01 instead of 0.52 — not an error, a
plausible value that reads as pathological regularity. Pinned rather than unified, because changing a
signature moves a DSP and re-records fixtures for a defect with no live instance; the gate makes a
future harmonisation deliberate and reds a cross-node copy-paste. Mutation-verified.
