---
bump: patch
type: fixed
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

`pat-align.js` §ΔPAT stated that *"the ~2.2 s per-connection BLE offset is CONSTANT within a connection —
a within-connection difference cancels it exactly, which is why `segments` gate runs."* **Measured false**
(`tools/pat-connection-stability.mjs`, 14 nights, 31 connections): first-half vs second-half offset
differs by a **median 43.8 ms, p90 142.9, max 815.6**, with **8/31 (26 %) beyond the ±90 ms tolerance**.

**No behaviour changes, and that is the finding.** `segments` still gate runs — a reconnect is a real
discontinuity — but they are not what makes the dip safe. **The centered rolling-median baseline is.** A
dip is read against a *local* baseline over `baselineWinMs`, not against the connection start, and over
one 60 s window the same drift is **median 1.18 ms** (p90 9.37, max 47.16) against **Θ = 10 ms**.

⚠️ **Both figures are quoted with their window**, because a drift without one is as underdetermined as a
ppm without its span (§🔒.7): 43.8 ms is *per connection*, 1.18 ms is *per baseline window*, and only the
second is what the detector is exposed to. Conflating them is what made the original claim sound safe.

⚠️ **The tail is left as a bound, not a rate.** p90 is 94 % of Θ and max is 4.7×Θ, both under
`maxExcursionMs` so neither is rejected as artifact. But the measurement is a first/second-half **fit
difference**, which cannot distinguish a slow **ramp** — largely tracked out by a centered median — from
a **step**, which is not. So it bounds the drift and does **not** establish a fabrication rate. Settling
it needs the within-connection residual *shape*, which the tool does not yet report; that is named in the
comment rather than guessed at.

**Scope note:** `pat-align.js` is inlined by **no** bundle (0 hits in `tools/build.mjs`, no
`data-inline-src`, no `.src.html`), so this carries no re-bundle, no `manifestHash` movement and no
fixture churn — it was scoped as a bundled-file change and is not one. Gates: `pat-align` 80/80 across
3 groups, biome clean.
