---
bump: minor
type: fixed
brief: NODE-EXPORT-DURATION-SEMANTICS-FOLLOWUPS-II-2026-08-09-BRIEF.md
---

GlucoDex's `recordedSec` is measured from the cells instead of being the same expression as `spanSec`,
so a CGM sensor dropout stops reporting as recorded time.

```js
var _sec = Math.max(0, Math.round((_c[_c.length - 1].tMs - r.t0Ms) / 1000));
return { kind: 'continuous', spanSec: _sec, …, recordedSec: _sec, nWithDuration: 1, n: 1 };
```

The comment above it claimed the two *"agree BY MEASUREMENT, which is precisely what the sparse case
could not claim"*. They agreed by **construction** and could not disagree. The same comment named
HRVDex's sparse block as its sibling — the node that refuses exactly this (*"the obvious fix — stamp
`durSec = lastTMs − firstTMs` — would FABRICATE COVERAGE"*). GlucoDex cited the right precedent and did
what the precedent forbids.

**Now measured, reusing the node's own gap definition rather than inventing a second one.** The cleaner
already flags every gap cell (`FLAG.GAP` short bridge / `GAP_LONG`) and already knows the cadence, so a
segment is a maximal run of non-gap cells with duration `cells × cadence` — the arithmetic `activeMin`
uses one function away. `recordedSec` is their sum; `spanSec` is untouched. The two can now disagree.

**What it found on real data.** The committed 28-day Lingo corpus export claimed one segment covering
everything; it is actually **four**, and 20 400 s — 5.7 h — of dropout had been counted as recorded:

```
recording.coverage.segments.0.durSec: 2449800 → 1206300
recording.coverage.segments.1: undefined → {"startMs":1776602520000,"durSec":35400}
recording.coverage.segments.2: undefined → {"startMs":1776643320000,"durSec":1165500}
recording.coverage.segments.3: undefined → {"startMs":1777819620000,"durSec":22200}
recording.coverage.recordedSec:  2449800 → 2429400
recording.coverage.n:                  1 → 4
```

⚠️ **`synthetic_glucodex_gap_golden` was asserting the defect over its own planted gap** — 258 900 s
"recorded" across a fixture built specifically to contain a hole, now 209 100 s across 2 segments. That
twin exists because `FIXTURE-VERIFICATION-GATE` §4 added committed-input adversarial fixtures precisely
so CI could catch this class without a corpus. It ran on every push and reproduced the wrong answer
faithfully, because nothing compared its coverage against its own gap. A fixture only tests what an
assertion asks of it.

**`kind` stays `'continuous'`, deliberately.** It names the sampling MODALITY — a CGM is a continuous
monitor whether or not a sensor dropped out — exactly as HRVDex's `'sparse'` names spot measurements.
Completeness is what `segments`/`recordedSec` are for, and folding it into `kind` would rebuild the
conflation this fix removes. Verified that nothing switches on `kind`; `adaptEnvelopeNode` reads
`segments`.

**A deliberate one-cell convention change, bounded and gated.** A segment's duration is `cells × cadence`,
not `lastCell − firstCell`. The alternative gives a one-cell segment `durSec: 0` — asserting nothing was
recorded when one sample was, the absent-vs-zero confusion HRVDex's block warns about — and it disagrees
with `activeMin`. The cost is that a gapless record's `recordedSec` exceeds `spanSec` by exactly the final
cell, because `spanSec` measures between sample *instants* while a cell covers a cadence of time. That
overshoot is bounded at one cadence per segment and asserted, rather than left for someone to discover as
a >100 % coverage ratio.

**This reaches fusion.** The segments travel to `adaptEnvelopeNode`, which judges overlap on recorded
time — so a CGM dropout stops counting as overlap with another node. That is the mechanism
DEEP-AUDIT-III §6.2 built and GlucoDex was feeding a single whole-span segment.

**Compute-path, computed not claimed:** `computeHash 2ab4fab25b6e → 5ad4d400eb4a`,
`manifestHash fa3e8d398d5a → cb3c4dd0e7d6`. All 3 fixtures regenerated with
`tools/regen-glucodex-goldens.mjs`, `verifiedUnder` re-stamped after a green corpus run. Both
orchestrators, `docs/GlucoDex.html` and the 4 analysis tools that inline `glucodex-dsp.js` rebuilt.

With this, both halves of FOLLOWUPS-II are executed and the group's four rows are all ratchets — no
`KNOWN DEFECT` pins remain in it.
