---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

HRVDex and OxyDex expose `getHooks()` — the counterpart to `setHooks`, returning a shallow copy of
the current hook set so an injected hook can be undone EXACTLY (MUTATION-PROGRAM-FOLLOWUPS §9.4).
This unblocks the profile-gated branches of `computeDerived`, which could not be tested without
leaking a fake profile into every later group in the realm. The injection contract itself is now
gated (installs, ignores non-functions, ignores unknown keys, survives null, round-trips), as are
the VO2 branches it unblocks: Tanaka HRmax, the three gates a manual HRmax must clear, and the
altitude correction with its 0.55 floor. Verified by re-applying 15 mutants: 14 killed, 1 proven
equivalent.
