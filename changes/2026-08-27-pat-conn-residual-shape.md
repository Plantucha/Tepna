---
bump: minor
type: added
brief: PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md
---

`tools/pat-connection-stability.mjs` gains `baselineExposure()`: it applies **pat-align's own** dip
constants (centered rolling median over `baselineWinMs`, Θ, `minBeats`, `maxExcursionMs`) to each
connection's whole-connection lag series, so the residual the **detector actually sees** is measurable
rather than inferred from the half-vs-half delta.

⚠️ **A confound found in my own first method, recorded because it nearly became the answer.** The
observable is `lag = BLE offset + true PAT`, so counting runs below −Θ against a rolling baseline counts
**real arousal dips** — exactly what the detector exists to find. A "fabrication rate" computed that way
is not one. **Magnitude cannot separate the two sources; shape can:** a physiological dip **recovers**,
an offset step **persists**. Each run is now classified by what the level does *after* it.

🚧 **Instrumentation only — no conclusion is drawn, deliberately.** The persistence criterion currently
reuses Θ, and **that reuse is a choice I made while coding, not a pre-registered constant** — the same
class of unagreed threshold this thread has caught before. Until it is fixed in advance and the step
fraction is shown stable across it, `persists`/`recovers` are counters, not a rate. Two confounds are
also unaddressed and are named in source: a slow ramp can shift the before/after medians by itself, and
a real arousal may be followed by a genuine sustained PAT change — both read as `persists`.

So this lands the **capability**, and the `pat-align.js:335` tail stays a **bound, not a rate**, exactly
as #1880 left it. What would close it: pre-register the persistence threshold, sweep it, and report the
fraction with its sensitivity.
