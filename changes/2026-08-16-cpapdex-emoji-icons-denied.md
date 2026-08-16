---
bump: patch
type: fixed
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

`DEEP-AUDIT-V-FOLLOWUPS` §1.3: the two CPAPDex offenders in the fabricated-tier debt are emoji, and
they belong in `_META_DENY` rather than getting evidence tiers. Called out in the brief as "the only
part of the 94 that is unambiguous", so no owner judgement was required.

They are row icons, not labels. `cpapdex-render.js` calls `row('🔗', 'AHI ↔ ODI', …)`, and the badge
helpers read the first string argument — so the glyph is what reached `badgeForLabel` while the real
label sat in the second position. Badging a glyph asserts an evidence tier about a decoration, which is
the fabricated authority §🎫 exists to prevent.

The ratchet drops 70 → 68, and the remaining 68 are now exactly the OxyDex metric tiles the brief
describes: 68 OxyDex, 0 elsewhere. Both ratchet assertions pass at 68 — the not-slack one requires the
debt to sit within five of the cap, so a wrong number reddens rather than passing quietly.

Provenance, and the part worth recording: this looked export-inert and was not. A registry deny-list
reads like render-path, so the expectation was that `manifestHash` would move and `computeHash` would
hold. Computed rather than asserted, per §🔏, `computeHash` moved 844f2d51a30a → a557499df026 — the
compute closure is a denylist and `cpapdex-registry.js` is inside it. So the corpus re-verification was
owed and was run: `verify-fixtures.mjs` green, four fixtures stamped `verifiedUnder → a557499df026`, ten
already current.

An intermediate check on the way there returned a false verdict worth noting: `computeHashFromText` is
async, so comparing its two return values without awaiting compared two Promise objects, which are never
equal, and printed "MOVED" before anything had been measured. It happened to agree with the real answer,
which is exactly what makes that class of mistake expensive.

All three generated trees rebuilt and verified; GATE A 9/9, GATE B 18 reproducible.
