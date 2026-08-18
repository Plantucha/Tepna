---
bump: patch
type: added
nodes: [ECGDex, MotionDex]
brief: none
---

`dormant: true` on the four remaining registry metrics that are declared and never computed —
`rraccRate` and `edrDisagree` (ECGDex), `uprightFrac` and `lateralFrac` (MotionDex) — extending the
PpgDex precedent to the two nodes that had the same silent state and no marker for it.

HOW THEY WERE FOUND, and the method matters because two earlier versions of it were wrong. A sweep
loaded every `*-registry.js` as an OBJECT in a vm context rather than regex-parsing it, and printed its
denominator every run: 445 live metrics (+21 already dormant) across 44 authored surfaces. 445+21=466
matched an earlier independent audit's total exactly — an anchor that could have failed, which the two
discarded versions lacked: v1 flagged ~100 by matching ids and the alias table but not each entry's own
`label:` field (rendering here is zero-touch, auto-wired BY LABEL), and v2 then reported `0 missing` for
a node whose entry-block regex had captured 16 of its entries. The over-report announced itself; the `0`
looked exactly like success. Every surviving candidate was then confirmed BY HAND on every name — id,
primary label and each alias — and separately traced through the accessor path (`*_DEFS` projection,
generic `Object.keys(cn.metrics)` loop, and each named `night.metrics` read), because a rename at the
consumer boundary defeats name-keyed search: that is exactly how `desatProfile` looked unsurfaced while
rendering eight cards under `n.desat`.

WHY THESE FOUR AND NOT THE OTHERS. Six live metrics reach no surface. `desatProfile` is surfaced under a
renamed accessor and is a mis-scoped parent entry, not a finding. `snorePressureCorr` is COMPUTED (two
sites in `cpapdex-dsp.js`) and unsurfaced — the opposite state, whose remedy is to render it, so
`dormant` would be a lie on it. These four have no compute site at all.

DORMANT IS DELIBERATELY WEAK, and the wording is the correction. The PpgDex block's rationale said the
registry pre-declares metrics so an implementation "inherits a reviewed tier". That is true there —
`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` backs it — and FALSE here: verified, these four appear in
no `*_DEFS`, no brief and no doc, so there is nothing adjudicated to inherit and no record of what was
measured or against what. `edrDisagree` carries a grade and nothing in the repo says what disagreement it
measures. So the flag asserts DECLARED, NOT IMPLEMENTED and nothing more; promotion is removing it once
the metric is computed AND surfaced, and re-adjudicating the grade at that moment. Every entry keeps its
existing `evidence` untouched — proven, not asserted: both revisions were loaded in separate vm contexts
and compared field-by-field, and only `dormant: true` differs across all four (6 fields each, identical).
That check earned its keep — one entry was a single-line declaration that the edit had to expand into a
block, which is precisely the rewrite that can silently drop a field.

NO GATE SHIPS HERE, deliberately. A parallel session claimed the generalised registry-coverage gate
(every id must be projected into `*_DEFS`, or resolved on a surface, or explicitly `dormant`) before this
work started, and a third node-scoped gate would duplicate it and collide in `tests/dex-tests.js`. These
flags are what that gate will read. Its surface leg must walk ACCESSORS, not ids and labels, or it
inherits the blind spot that hid `desatProfile` — inside the gate built to prevent it — and it should
read the ratified `_META_DENY` rather than minting a second exception list.

PROVENANCE. Both registries are inlined into exactly one bundle each and neither orchestrator, so no
serialisation. `ECGDex ba04069c749d -> d039a1dbd1b2`, `MotionDex 51794ade2941 -> 7081f188bcfa` (MotionDex
moved twice: biome reformatted its registry AFTER the first build, so the bundle was briefly stale
against its own source — format before build). `docs/ECGDex.html` is the served copy; MotionDex has none,
checked rather than inferred. ECGDex's compute closure moved `153afac14e59 -> 77456d3e7793`, so
re-verification was owed and is DISCHARGED against the real corpus, not asserted.
