---
bump: patch
type: added
brief: PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md
---

`tools/pat-per-led.mjs` takes `--phys-lo` / `--phys-hi`. **Defaults are unchanged** at the `[200, 650]`
mirrored from `pat-align.js`, and verified so: `2026-08-01` still returns PAT SD **156.6**, the figure
§4 of the brief publishes. The flags touch only `patLags`'s accept/reject comparison, nothing upstream,
so a shifted rail changes which lags are admitted and never how a foot is detected.

The rail had to become movable because a single rail cannot answer the question the brief was stuck
on. Median accepted lag is **426 ms** on both capture trees; the rail's midpoint is **425**. At one
rail, "426 ms is the true chest→ankle transit" and "the estimator is returning its own midpoint" are
indistinguishable.

**Shifting the rail while holding its 450 ms width separates them, and the answer is unambiguous on
both trees:**

```
rail          midpoint   median lag (box / smoke)
[150, 600]      375          374 / 380
[200, 650]      425          425 / 425     ← shipped default
[250, 700]      475          472 / 472
[300, 750]      525          519 / 520
                             slope 0.964 (n 27) / 0.934 (n 31)
```

A 150 ms rail shift moves the median 145 ms. **The reported lag is the rail we chose.**

**And narrowing is worse than a null result.** At `[325, 525]` — width 200, midpoint unchanged — PAT SD
falls from ~126 ms to **56.5 (box) / 55.1 (smoke)** against a predicted `200/√12 = 57.7`. Narrowing
moves the headline **through the 60 ms `DRIFT_MAX_MS` bar on essentially every night** while recovering
no signal at all: the number is the width and nothing else. That is the aggressive gating the charter's
§19 forbids, and it is why the 200–500 ms mode-search rail two briefs were each asking for should not
be built — width 300 gives `300/√12 = 86.6`, which would have read as a 33 % improvement produced by a
constant.

⚠️ **Scope: this retires the MEDIAN from `pat-per-led`, not the oracle's MODE.** `PPG-FOOT-PLACEMENT`
§4a is explicit the two must not be substituted, and its own evidence points the other way for the
mode — under a 6× half-width sweep `pat-window-oracle`'s mode is invariant (405/405/405, 215/215/215).
A mode-invariance test under a *shifted* rail rather than a resized one is the honest next question and
is not run here.

Rule and prediction were both written before any shifted rail existed; the prediction
(ESTIMATOR-DOMINATED) was confirmed, unlike the one in #2500, which was falsified and recorded as such.
Every measurement is replicated on both capture trees, per the rule that came out of #2493/#2500.

`PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md` is **DONE** — all five Done-when items met.
