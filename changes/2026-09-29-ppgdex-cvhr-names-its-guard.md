---
bump: patch
type: fixed
brief: none
---

Every PpgDex CVHR refusal now names **which guard fired**, and the reason reaches the export block the
Integrator actually reads.

Residue `2026-09-29-ppgdex-cvhr-nulls-without-naming-which-guard-fired`. Two of `cvhrFromNN`'s three
guards returned a bare `{ events: [], index: null }`, so a consumer seeing `cvhrIndex: null` could not
tell an ordinary short recording from an internal inconsistency. Now: `no beat-time series — tt absent`,
`tt/nn length mismatch 512 ≠ 511`, `beats 41 < 60`, `implausible-span` (already named), `span 99 s <
120 s`. The refusal itself is unchanged in every case — `index: null`, `events: []`.

**`:2629`'s three causes are split into three reasons, and the order is reversed on purpose.** It read
`N < 60 || !tt || tt.length !== N`, so "too few beats" won whenever both held. A missing `tt` or a
length mismatch is an internal inconsistency — a bug signal from this file's callers — while fewer than
60 beats is an ordinary short night. When both are true the inconsistency is now the one reported.

**Naming the guards was inert on its own, which is the part that had to be measured.** `analyze` carried
`cvhrReason`; the node-export `apnea` block — the one the Integrator reads as `json.apnea.cvhrIndex` —
never forwarded it, so every refusal still arrived as a bare null. Forwarded now, conditionally, matching
the neighbouring `cvhrHours`.

**Three committed goldens now say why they refused, and all three name the beat-count guard:**
`inverted` → `beats 42 < 60`, `o2ring_finger` → `beats 32 < 60`, `rich` → `beats 42 < 60`. The other
three carry no `apnea` block; their content is unchanged and only the embedded code hashes moved.

That **corrects a comment in this file**, which said `inverted` is 39.99 s "so `M = 39 < 120`" — the
*span* guard. It is not: at 42 beats the count guard fires first and the span check is never reached. A
comment written about these guards misattributed which one fired, which is the plainest argument for
naming them.

`manifestHash` `80b862e02881` → `8471c96c285e`; `computeHash` `3c4d3c663077` → `7d13766cab23` — a DSP
change, so both move and re-verification is owed: `verify-fixtures` re-ran green against the real corpus
and stamped `verifiedUnder → 7d13766cab23`. Nothing leans on `DexClock`; PpgDex inlines no `clock.js`
(`grep -c 'data-inline-src="clock.js"' PpgDex.html` → 0).

`cvhrReason` presence stays **conditional** — a reason appears exactly when the index is null. The export
site's comment justified that as *"present ONLY when the span refusal fired, so a refused null is told
apart from a too-short one"*, which is obsolete now that every refusal names itself and which uses key
presence to encode which guard fired. Making it unconditional would move the shape of nights that publish
a perfectly good index, so it is left as a follow-up candidate rather than folded in here.
