---
bump: minor
type: added
nodes: [oxydex]
brief: SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md
---

`tools/nsrr-oxydex-odi.mjs` — the second NSRR arm: OxyDex's ODI-4 → AHI estimate scored against
expert-scored PSG AHI.

SHHS EDFs carry `SaO2 @ 1 Hz` — the O2Ring's exact modality and sample rate — so this is the same kind
of signal the shipped oximetry path consumes, not a domain-shifted proxy. `nsrr-adapter.js` already
held the whole pipeline (`NSRR.analyzeRecord`: EDF → OxyDex rows, profusion XML → reference AHI); its
only callers were browser tools, so it could not be run over a corpus without a person clicking. This
is the headless driver and nothing more — it reimplements no adapter logic.

Bands are pre-registered in the source, taken from `papers/odi4-ahi-bias.html` rather than invented:
that paper characterises a severity-proportional ODI-4 under-count and records it as corrected at the
detector level, so the falsifiable question is whether the correction holds on real PSG.

16 selftest assertions, all planted arithmetic — OLS gradient recovery, the clinical 4-class edges,
errored records excluded from the denominator — and it refuses to print an agreement figure from
synthetic input. Absent a corpus it SKIPs loudly, printing every path searched.
