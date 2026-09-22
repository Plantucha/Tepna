---
bump: minor
type: added
brief: VERDICT-CONTRACT-2026-09-21-BRIEF.md
---

The four remaining tests/ gates emit tepna.verdict/1 (VERDICT-CONTRACT §3d) through the shared aggregateChildren: verify-manifest (GATE A + B over bundles + fixtures; an absent fixture input is NOT_APPLICABLE, --bundle= is filtered), verify-shard-union (the union equals the plan; --deep now also consumes the shard OBJECTS and requires their aggregate to reach the full run's), check-dex (the two lanes read from their own objects; filtered by construction) and browser-gates (the four legs; a leg that threw is UNKNOWN; NN_ONLY/SEAL_ONLY are declared exclusions; playwright imported dynamically). Each has --json, --verdict-sample and a selftest; every exit code is unchanged. aggregateChildren carries each child's `why` into the reason.
