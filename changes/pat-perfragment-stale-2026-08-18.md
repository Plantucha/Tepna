---
bump: patch
type: changed
brief: PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md
---

**"Per-fragment Δ" was already implemented, and the diagnosis behind it was wrong.**

The item proposed computing Δ per fragment instead of one per night. `tools/pat-host-offset.mjs` never
computed one per night:

- `for (const ef of E) for (const pf of P)` — every ECG-file × PPG-file pair scored separately
- `hostAnchors(ef.f)` / `hostAnchors(pf.f)` → `DexClock.hostAxis(...)` — the axis is built **per file**,
  so Δ is per-fragment by construction
- `for (let w = lo; w + WINDOW <= hi; w += WINDOW)` — and scored per 120-min window inside each pair

So the granularity is *finer* than proposed, and the offset is **read** from each fragment's own
host-disciplined axis rather than fitted — the tool's stated design. Implementing a fitted per-fragment
Δ would have been a step backwards.

⚠️ **The diagnosis matters more than the item.** The reasoning was *"box nights fail uniformly (0/13) …
while a single Δ describes the whole timeline"* — but there was never a single Δ. What separates a
working box night from a failing one is **fragment LENGTH, not fragment Δ**: the 2026-08-11 single-
segment night cleared its null on 2/3 windows, while the 0/13 nights carry 24 ECG / 68 PPG fragments
whose overlaps are too short to reach `WINDOW_MIN` and the beat-count floors — so they are **refused
before any Δ is applied**. Fixing Δ granularity could not have helped them; the windows never ran.

The item describes the scout, not the shipped form: it predates `PAT-UNDER-PERBLOCK-ALIGNMENT` §3e.4
replacing the estimator, and nothing marked it stale when that landed.
