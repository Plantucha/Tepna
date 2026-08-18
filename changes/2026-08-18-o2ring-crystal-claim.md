---
bump: patch
type: fixed
---

**CLAUDE.md §7 attributed a link failure to a crystal, and the owner asked for it removed.** The text read
*"the O2Ring's real error is non-linear (−3035 ppm decaying to −1622 ppm)"* and described it as crystal
behaviour, with `CK_AXIS_MAX_PPM`'s headroom justified as *"a crystal is wrong by ppm; the worst real one
in this corpus is −3035."*

**Re-measured 2026-08-18** against the host over a 7.2 h night, from `OXYFRAME.duration_s` (the ring's own
device-side counter — it has a clock, and it shows the time on its screen):

    t=0-3 h   lag flat at ~4 s        -> sub-ppm, as good as the Polars
    t=4 h     lag +42.4 s             -> first BLE dropout
    t=5,6,7   +54.5, +66.9, +80.2 s   -> then ~12.5 s/h

**A crystal does not change rate by thousands of ppm; a stalled link does.** The "decay from −3035 to
−1622" is what accumulating dropouts look like through a single linear fit.

## What changed, and what deliberately did not

Both passages carried **sound conclusions on a wrong premise**, so the premise is corrected and the
conclusions are kept — deleting the figure outright would have left two arguments unsupported:

- **≥3 anchors** — still required, and the note now says *why it is if anything stronger*: dropout-driven
  divergence bends harder than any crystal, so the curvature the third anchor exists to detect is more
  pronounced, not less.
- **`CK_AXIS_MAX_PPM = 50000`** — unchanged. The −3035 figure is retained as the largest **apparent**
  divergence, now labelled a link artifact. That makes the bound *more* necessary: a crystal's error is
  bounded by physics, a stalled link's is not, and the bound is the only thing between such an artifact
  and a fabricated timebase.

The old wording is **quoted inside the correction** rather than deleted, per the house pattern — the
reason it changed is the useful part, and a silent edit would let the next reader re-derive it.

Not changed: §7's "short O2Ring fragments whose real error is ~3 s" — that is a fragment-span statement,
consistent with dropout-scale error, and not a crystal claim.

Measurement tooling landed separately in the third-corner PR (`tools/tch-third-corner.mjs`).
Gate: docs-ledger 38/38, release-ledger 9/9.
