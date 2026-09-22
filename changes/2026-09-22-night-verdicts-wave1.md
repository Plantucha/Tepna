---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

The vigil nightly QC and end-of-night back-check each emit one tepna.verdict/1 object beside QC-SUMMARY.json (QC-VERDICT.json, BACKCHECK-VERDICT.json); the morning report reads the back-check object; night_verdicts.py emits corpus-free samples for the adoption gate. The back-check population now shows the files the check skipped — an empty-list ok is UNKNOWN.
