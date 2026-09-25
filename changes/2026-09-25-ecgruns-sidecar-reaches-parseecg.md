---
bump: patch
type: fixed
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---

The `…_ECGRUNS.txt` validity sidecar reaches `parseECG`, and a recorded span REFUSES the epoch whose
window it intersects (`null` + reason `blanking-run`) — §∅'s discontinuity-refuses half, as the owner
ruled on 2026-09-17.

The writer landed with `ECG_RUN_MIN = 30` (derived over 196,172,536 samples: at 30 the natural
near-baseline population is EMPTY, so zero false positives are measured rather than argued) and
**nothing read it**, so an H10 validity band could only ever read UNKNOWN by construction. Four wires
were missing, not one: `ecgKind` set the file aside as a non-signal; `planIngest` had no `runs` bucket,
and its `byKind[kind] || byKind.ecg` default fails OPEN, so the sidecar landed in the PRIMARY waveform
bucket and was then dropped against its own `_ECG.txt` as a 'duplicate'; `signal-orchestrate`'s
`streamKind` did not know `_ECGRUNS` even once `_COMPANION_KINDS.ecg` listed `runs`; and neither the
adapter nor the app passed the text into the parse.

No sidecar ⇒ byte-identical: verified, not asserted — across all four ECG goldens and all six PpgDex
goldens, **0 non-provenance lines moved**; only the code identity did.
