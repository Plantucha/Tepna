---
bump: patch
type: security
brief: DEEP-AUDIT-VI-2026-09-01-BRIEF.md
---

scrubExport now reduces a per-element schema.provenance, not only the top-level one. A multi-record element carries a full v2.0 envelope, so with scrub ON every per-element input name and sha256 survived — against the SELF-INGEST §5 acceptance that a scrubbed JSON contains no device serial, filename or input sha256.
