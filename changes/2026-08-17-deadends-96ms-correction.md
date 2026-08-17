<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [docs]
brief: INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16-BRIEF.md
---

`papers/dead-ends.html` §2.7 asserted a mechanism its own abstract had retracted four days earlier, and
drew a live research disposition from it.

The abstract has said since 2026-08-13 that the "~96 ms of peripheral beat-to-beat scatter" is an
artifact — the standard deviation of a fixed 450 ms acceptance window (450/sqrt(12) = 129.90 ms),
measured through an ECG rate rounded to nominal on a corpus with no second clock — and that the wall's
cause is OPEN. The section that STATES the finding still opened with "What actually limits it: ~96 ms",
so a reader met the retracted mechanism where they look for the result and the retraction only in the
abstract. That is the same ordering hazard this paper files as wall 2.8, and the same one a stale
PROPOSED brief header produces.

Three surfaces corrected, additively — the argument is not rewritten, the correction is added where the
number appears:

- **The heading**, which was the worst of them: "2.7 Cross-device wearable PAT is ~~drift-dominated~~
  limited by peripheral beat-to-beat scatter" put the retracted mechanism in the section TITLE, so it
  reached anyone scanning the contents without reading a word of the body. Now "~~limited by peripheral
  beat-to-beat scatter~~ unrecoverable - cause OPEN".
- **The body claim**, struck and retained for the record, preceded by the correction so the retraction
  arrives before the number.
- **The disposition it justified** - "the disposition changes to needs better peripheral foot timing" -
  struck. This is the part that mattered: a withdrawn number had been left setting a research direction.

NO REPLACEMENT "TRUE LIMIT" IS NAMED, deliberately. The repo carries two candidate figures under
different conditions - within-bin sigma ~68 ms (46-94) from PAT-SAWTOOTH-ANSWERS-THE-130MS, and 10-23 ms
on three of six box nights with the axis fixed from wearable-clock-drift.html - and NEITHER is
gate-backed. Naming one would repeat this section's own error at a smaller scale. Caught while writing
the fix: the first draft asserted ~68 ms flatly as "the honest figure", which the sibling paper's
10-23 ms contradicts.

Scope verified rather than assumed: `papers/papers.html` and `papers/wearable-clock-drift.html` ALREADY
carried the v3 withdrawal, so `dead-ends.html` §2.7 was the only surface still asserting it. The
literature diagnosis that flagged this was exactly right and exactly bounded.

`docs/papers/dead-ends.html` rebuilt; `verify:docs` clean, `citation-ledger` and `docs-ledger` green.

⚠️ `tools/build-docs.mjs` printed nine paths to stage, NONE of which had changed, and omitted the twin
it had just rewritten - CLAUDE.md's warning reproduced verbatim. Staged from `git status`.
