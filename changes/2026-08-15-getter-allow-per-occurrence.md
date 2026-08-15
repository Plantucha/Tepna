---
bump: patch
type: fixed
brief: DEEP-AUDIT-IV-2026-08-04-BRIEF.md
---

The Clock-Contract lint's allow-list was keyed by FILENAME, so one known-benign getter exempted an
entire DSP from Clock Contract §5.

```js
var GETTER_ALLOW = { 'glucodex-dsp.js': 'synthetic-gen date-anchor …' };
if (GETTER_RE.test(t) && !GETTER_ALLOW[f]) getterHits.push(f);
```

`glucodex-dsp.js` computes `daypart`, `dawn`, `nocturnalHypo`, `hourly` and `daily` — all wall-clock
reasoning over floating `tMs`, which is exactly what §5 exists to protect. A viewer-timezone-dependent
CGM overnight-hypo window is the defect this lint is for, and the lint could not see one. The assertion
still printed *"clean across N files (glucodex-dsp.js allow-listed w/ reason)"*, which reads as a scoped
exemption and was a whole-file one.

**Measured before changing anything:** the file has exactly **3** matches, all on `:1535`
(`Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate())`) — the documented synthetic-generator date
anchor. The allow-list now names those three occurrences, and the file's match multiset must equal them.

Two properties, and the second is what keeps it honest:

1. **a new getter reds**, because it is not in the list — this is the audit's own probe
   (`new Date(ms).getHours()` injected into that file), which previously left the group **green**;
2. **if the exempted line is ever converted to `getUTC*`, this reds too**, because the multiset stops
   matching — so a stale exemption cannot outlive its reason, which is precisely how the whole-file blind
   spot arose. The failure message distinguishes the two cases, since they need opposite fixes.

Both verified by re-applying each case, and the tree confirmed restored afterwards. Test-layer only: no
re-bundle, no fixture, no provenance movement. The `getUTC*` conversion of `:1535` still rides the next
GlucoDex on-touch re-bundle — narrowing the gate does not consume that.

**Also recorded, not shipped.** DEEP-AUDIT-IV's §1 (PpgDex's robust-HRV gate admitting
`motionIndex == null` as "still") was already fixed by `8e958e28` (#956), including §1.5's second
instruction to publish `sdnnRobustBasis` — verified in the tree rather than assumed, and closed in the
brief so the same line is not audited a sixth time.

And its punch-list item 2 — *did any of the six real alternation nights have partial ACC coverage?* —
**cannot be answered from the committed exports**: they predate #956 (no `sdnnRobustBasis`,
no `sdnnRobustNEpochs`) and `quality` has `motionRejectedPct` but no motion-COVERAGE field, so "the ACC
was off" and "the ACC saw movement" are not separable. It needs a corpus re-run pairing each night with
its ACC stream. Recorded with that method so the next reader does not repeat the scan that cannot work.
