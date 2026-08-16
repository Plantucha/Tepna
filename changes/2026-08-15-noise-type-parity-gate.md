---
bump: minor
type: added
brief: HOSTAXIS-STABILITY-2026-08-13-BRIEF.md
---

One rule for naming a power-law noise type has **three** implementations in two languages, and nothing
held them equal.

```
clock.js               CK_ALLAN_NOISE   -0.75 / -0.25 / 0.25 / 0.75   SE-aware refusal ✓
capture-host/allan.py  _NOISE           identical                     classify(sl, se=…) ✓
ppgdex-dsp.js          ALLAN_NOISE      identical                     classifyAllan(sl) ✗
```

They agree today. **The agreement was luck, not a constraint** — `grep ALLAN_NOISE tests/dex-tests.js`
returned nothing before this group existed, while the Python copy was under edit the same day. That is
the same shape as `registry-defs-parity` and the closure-identity scan, both of which exist because two
copies of one truth drift silently, each staying internally consistent.

The gate is a **source scan** — the Python cannot execute from that lane — and it wires
`capture-host/allan.py` into `readSources` as the first `.py` there, loaded as text only. It asserts the
three tables are identical in edges, names and order; that `clock.js` and `allan.py` both carry the
SE-aware refusal; and it **pins `ppgdex-dsp.js`'s missing SE-awareness as a KNOWN DEFECT**, since that
fix is compute-path and owes a re-bundle plus corpus re-verification under §🔏.

⚠️ **The gate had a hole of exactly the kind it exists to prevent, and mutating it is what found the
hole.** Four mutants: a moved Python edge, a renamed Python noise type, a drifted `ppgdex` edge — all
caught. The fourth, renaming `allan.py`'s `se` parameter away, **survived**: the assertion read
`/def classify\([^)]*se/`, and `se_unused=None` contains `se` as a substring. Tightened to `\bse\s*=`
and re-verified. A gate nobody has watched fail is not a gate, and that applies to the gate one is
writing.

**Also in this unit: `HOSTAXIS-STABILITY` is marked DONE.** It shipped as **#1227** and then read
`PROPOSED` for two days. Closed with item-by-item evidence rather than a header edit — `stability` and
`ppmUncertainty` on the spine, the MINSTD cross-language known answer (deliberately not the glibc LCG,
which overflows 2⁵³ in JS but not in Python's bignums), and `ecgdex-dsp.js:4371 hostAxis:` for the
export half.

That stale header nearly caused the work to be done twice: a session read it, checked the one
precondition §4.1 names, **announced a fleet-wide spine change to another session**, and only then
opened the tree. Retracted, nothing blocked. Two rules came out of it:

> An announcement is a request for other people to stop, so it comes **after** the tree check.

> A stale `DONE` makes someone re-check finished work; a stale `PROPOSED` invites them to **build what
> exists**. Do not weight them equally when sweeping.

A follow-up brief carries the `ppgdex` fix, the parent's three open questions, and the literature that
removes the boundary problem at its root rather than bounding it — lag-1 autocorrelation identification
(Riley 2004) names the dominant noise type analytically **without fitting a slope**, so there is no edge
for a point estimate to sit near and the EDF circularity dissolves.

Test-layer only: no bundle, no fixture, no provenance movement.
