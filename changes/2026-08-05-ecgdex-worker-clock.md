<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ecgdex]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
ECGDex carried three timestamp parsers: `clock.js`, an inline `_ckPF` in the parse worker, and `parseTSfloat` on the main thread. Both copies built `tMs` with a bare `Date.UTC(...)`, so they skipped the Clock Contract §2.7 component-range guard and silently ROLLED an impossible stamp onto a plausible wrong instant — `2026-02-30T12:00` → 2026-03-02, `2026-13-45T25:99:99` → 2027-02-15, where DexClock returns null. That value becomes `t0Ms`, the anchor for the whole recording, so it does not corrupt a row; it fabricates the night. The browser path also never emitted `endEpochMs`, which `ECGDSP.analyze` reads — so every browser-produced export differed from the gated headless one on a field the headless run fills. Both copies are deleted: the worker ships the raw stamp STRINGS back and the main thread parses them once with DexClock. Injecting clock.js into the worker (the brief's prescription) was rejected on measurement — `parseTimestamp` closes over module-scope helpers (`_ckMk`, `_dmy`), so a `Function.toString()` of it alone does not travel and it would need a serializer in the shared spine, re-stamping all 8 provenance fragments for a bug living in one app. The host-axis `fs` correction leg of F21 is NOT in this change and stays open.
