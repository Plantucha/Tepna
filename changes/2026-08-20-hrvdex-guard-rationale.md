---
bump: patch
type: changed
brief: DEAD-FIELD-HINTS-FLEET-FOLLOWUPS-2026-08-19-BRIEF.md
---

**Closes `DEAD-FIELD-HINTS-FLEET-FOLLOWUPS`: (b) executed, (c) refuted with a number.**

**(c) — generalising the `dead-field-hints` gate to any `getElementById` literal — is REFUTED.** The
brief required the false-positive rate be measured before building it. Over all 8 nodes: **284
literals, 94 unresolved = 33.1 %**. The unresolved set is dominated by ids the *engine injects at
runtime* (`metric-registry-css`, `dex-profile-css`), so this is structural, not fixable. The `lbl_`
prefix was safe precisely because nothing creates one dynamically; that property does not generalise.
At one-in-three it is the "noisy red that gets routed around rather than read" the brief predicted.

**(b) executed.** Three HRVDex guards now state why they never pass, naming the absent id and the date:
`applyAgeNorms` (`prof_weight`/`prof_height`), `updateProfile`'s persistence branch (`prof_age`), and
the HR-zone block (`profileZones`). `renderANSAgeCard` already carried its rationale and was left
alone. **Kept rather than deleted** — the guards are what make these functions safe if a per-field
profile surface is ever restored; deleting them trades a no-op for a crash.

⚠️ **Export-inert, PROVEN:** `computeHash` 7fe268e6b141 unchanged across the re-bundle (`manifestHash`
0721aadb5190 → 44d68225a833) and `verifiedUnder` still matches, so no fixture re-verification is owed.
