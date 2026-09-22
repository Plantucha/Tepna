---
bump: patch
type: added
brief: MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md
---

docs/WFDB-INTEROP-MAPPING.md — roadmap §11's deliverable, written as the five places Tepna and WFDB do NOT correspond rather than as a field table: floating t0Ms against a wall-clock instant, a measured host-disciplined fs against a nominal header one, a wall-clock event against a sample-index annotation, physical units against raw ADC with gain/baseline, and structured sourceChannel identity against a free-text signal name. §6 is the sharpest: WFDB encodes an invalid sample IN-BAND (WFDB_INVALID_SAMPLE (-32768), wfdb.h 10.7.0, with the standard's own comment conceding the hazard) where §∅ requires null — and the constant is not in SIGNAL(5), so an adapter author reading only the format spec never meets it. No adapter is written: §11 defers it behind two conjunctive conditions and neither holds. Files residue 2026-09-22-wfdb-invalid-sample-not-recognised for the live read path in our own PhysioNet reader.
