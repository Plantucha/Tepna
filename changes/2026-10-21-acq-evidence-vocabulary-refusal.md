---
bump: minor
type: changed
brief: ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md
---

The acquisition-evidence envelope refuses a word no reader knows. The module declared five vocabularies as bare string constants and validated none of them. A producer could write `host_only`, and every consumer would read that as unknown. Each vocabulary is now a tuple derived from those constants. Construction refuses an unlisted word, and UNKNOWN stays legal in all five. The one production producer that assembled outside a guard now carries one.
