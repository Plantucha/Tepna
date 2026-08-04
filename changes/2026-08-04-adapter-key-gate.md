---
bump: patch
type: added
brief: INTEGRATOR-OXYDEX-ADAPTER-GAP-FOLLOWUPS-2026-07-22-BRIEF.md
---

Executes §3's audit and gates it. No second `hypoxicBurden`: every night-level key `adaptOxyDex` reads is
emitted, and the five always-null fields across 40 real exports are all correct by design. The durable
half is **structural** rather than corpus-driven — a corpus check would SKIP in CI, which is where it must
bite. Mutation-verified by re-inserting the original defect (`n.hb` in the adapter).
