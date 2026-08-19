---
bump: patch
type: fixed
brief: PAT-PROXIMAL-DISTAL-PAIR-2026-08-04-BRIEF.md
---

**The ±400 ms search window was censoring a real lag, not failing to find one — confirmed by widening
it.**

The brief's last open item asked whether four nights whose lags crowd the window edge were *truncated
rather than uncoupled*. On `2026-07-29` the answer is yes:

| | ±400 ms | ±800 ms |
|---|---|---|
| medLag | +315 ms | **+428 ms** |
| strict match | 11 % | **25 %** |
| ratio vs chance | 1.79 | **3.96** |

**428 > 400** — the true lag sits outside the window measuring it — and the coupling *more than doubled*
rather than merely relocating. That is censoring, not absence: a truncated window keeps an edge-biased
remnant and everything downstream is computed on it. The same failure `pat-gate.js` records for
`[PHYS_LO, PHYS_HI]`, in a second tool.

⚠️ **The four nights are not one phenomenon and should stop being cited as a set.** `07-30` is *not
significant* at ±400 (p = 0.228, ratio 1.15); `08-01` and `08-03` produce no scorable row at all. One is
censored, one is null, two are absent.

⚠️ **Signs disagree with the record.** The brief lists −381 for `07-29`; the tool reads **+315**, and its
header states positive is the only anatomically possible sign. That is a separate open question.

**Cost note:** the search is ~quadratic in pair count — ~9 s per night at ±400, ~20 min at ±800, and a
whole-corpus call ran 1 h 50 m at 100 % CPU with no output before being killed. Always pass `--night`.
