---
bump: patch
type: added
brief: INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16-BRIEF.md
---

Commits a cross-field diagnosis brief that was sitting untracked in the shared checkout — 16,721 bytes,
in no commit on any branch, so that one path was the only copy. Adopted at the owner's direction. The
author is unknown and the analysis is theirs; it is committed as written apart from two clearly marked
adopter's notes.

It also had a second cost while untracked: `docs-ledger` check3 fails on any unindexed brief, so every
session running the gate in the shared checkout was getting a red that was not theirs. Committing it
with its `DOCS-INDEX` row resolves that.

The brief asks a different question from its sibling reading queue. That one asks what to read; this
asks what Tepna has already built and what the method is called in the field it came from, under six
labels and an evidence rule that a shared name is never enough — each diagnosis must name the exact
function, the external method, what each requires, and a confidence. It reads ALREADY CORRECT on
overlapping Allan deviation, the Pan-Tompkins-family QRS chain with redundant SQI, Lomb-Scargle applied
directly to irregular beats, and the executable validation substrate; APPROXIMATION on `hostAxis`, since
a one-way BLE arrival timestamp cannot separate device event time, offset and transport delay without a
delay model; and MISSING on GUM-style uncertainty propagation, with the sharpest line in the document
being that a binary trusted flag cannot distinguish a 1 ms result from a 50 ms one.

Two claims were checked rather than passed on. §2.1 recommends adding equivalent-degrees-of-freedom
reporting to the Allan work; that route was already measured and rejected in
`CROSS-DOMAIN-METHODS-FOLLOWUPS` §6 as real and immaterial, and `HOSTAXIS-STABILITY-FOLLOWUPS` §3
decided the 1.96·SE band stays — so half that action item is closed against, while the other half, a
documented check that the input is genuinely a phase series, remains live and worth doing. §6 claims
`dead-ends.html` contradicts itself on the ~96 ms peripheral scatter, and that verified: the abstract
records the correction that it is an artifact of a fixed 450 ms acceptance window and that the cause is
open, while the body still opens with it as what actually limits PAT and shifts the disposition on that
basis. The paper is deliberately not edited here — `papers/` has a served `docs/` twin, so that is a
separate work-unit with a rebuild attached.

Docs only.
