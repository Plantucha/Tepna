---
bump: patch
type: fixed
brief: CORPUS-TIER-30-NIGHTS-2026-09-20-BRIEF.md
---

corpus-tier's first real run (118.2 GB tiered, /srv/data 96 % → 50 %) refused 29 zero-byte markers
with no NAS twin and exposed that nothing carried rig-originated files to the NAS. It now syncs a
missing twin before tiering, and zero-byte files stay local — a marker's existence is its signal.
