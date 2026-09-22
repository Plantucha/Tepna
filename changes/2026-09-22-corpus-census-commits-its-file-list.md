---
bump: minor
type: added
brief: PINNED-SPAN-POPULATIONS-2026-09-18-BRIEF.md
---

tools/corpus-census.mjs — a census writes a COMMITTED manifest (one row per file: name, bytes, sha256 of the first 8 MB, the same digest the ECG census already used) and a later run DIFFS against it instead of reconstructing: added, removed and CHANGED files are each NAMED, where the 597 → 602 increment could only be recovered by elimination because rsync preserves mtime and `find -newermt` returned four of five. Both denominators are published (files and unique) since the census's own 597 was a deduplicated count, and a duplicate row names the file it duplicates. A moved population is SHORTFALL, not FAIL — a corpus grows; the finding is that numbers computed over the recorded set need re-running or re-stating. An empty census is NOT_RUN, never a clean bill. Both dedupe keys are published with their definitions, because the two differ by 10 % on the real corpus (604 unique by basename — the key the published census used — against 549 by content), and a "unique: N" that does not say unique BY WHAT repeats the row's sibling failure one artifact over. The ECG population is committed as analysis/census/ecg-h10.json so the row's own numbers are diffable from here on.
