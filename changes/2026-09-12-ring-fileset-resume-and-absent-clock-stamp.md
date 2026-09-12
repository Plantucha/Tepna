---
bump: patch
type: fix
brief: residue 2026-09-06-ring-never-resumes
---

The ring now resumes its file-set across a short reconnect, as the Polar path has since
#1532 — three parts, because resuming without making the sidecar writers append-safe
would truncate the file it resumes onto, and without carrying `O2PpgGrid` would put two
overlapping synthesized timelines in one `sensor timestamp [ns]` column.

A zero device stamp is now refused as absence instead of resolving to `_POLAR_EPOCH`
(2000-01-01) and arriving as a 26.7-year skew that triggered a link-dropping re-sync.
