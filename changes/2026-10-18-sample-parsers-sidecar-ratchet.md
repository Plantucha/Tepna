---
bump: patch
type: added
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---

**Two gates now hold the validity sidecar to its readers.**

The first gate covers done-when 4. It scans 396 authored sources for calls of the six parsers that accept `runsText`. It pins each node file.s count of calls that pass no sidecar, with the reason. It pins the `tools/` population as one total, because a tool name in `tests/` reads as a gate to the adoption check. A new bare call turns it red, and a migrated call turns it red until its pin drops in the same PR.

On `2c9644d04` it finds 91 calls, and 81 of them pass no sidecar. Residue `2026-10-17-sample-parsers-called-without-their-sidecar` owns those 81 calls.

The second gate covers done-when 3 for PpgDex. A run held at a mid-range value is invisible to the rail rule, and only the `_PPGRUNS` sidecar records it. The gate requires that the sidecar run excludes the intervals that cross it, and that the export reports 220 absent samples. It also requires that no sample value and no row changes. A plant that disables the sidecar spans fails 3 of its 8 assertions.
