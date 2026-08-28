---
bump: patch
type: added
brief: none
---

**Property tests** for the Python clock surface — 13 properties, each quoting the contract sentence it
tests, plus `hypothesis` pinned in `requirements-dev.txt`.

## 🔴 Where they are NOT, and why that is the finding

The Clock Contract's verification list describes **`clock.js`**. There is no Python counterpart: no
`parseTimestamp`, no DMY/MDY disambiguation, no time-only rollover, no floating-`tMs`. Four of the six
listed properties have **no Python subject at all**, and writing them here would test `datetime` itself
— `assertions-encode-shape` in its purest form, passing forever and pinning nothing of ours.

So the properties went where contract-grade invariants actually live: the two functions that reduce
many noisy anchors to one number **under a stated refusal rule**, which is exactly what a known-answer
table cannot cover.

| function | properties |
|---|---|
| `as11_clock.analyze` | refusal below two **finite** anchors carries no estimate · non-finite anchors are dropped *before* the count · offset is the median identity · **translation-equivariance** in the device clock · zero span refuses the *rate* while the *offset* still ships · sub-threshold `n` refuses the rate across the whole range · a planted linear drift is recovered as its own ppm · `minute_is_real` is exactly the stated comparison |
| `clock_offset.estimate` | a refusal carries no number and a success always quotes `t_ref_sec` · the certified offset is `None` **wherever the two estimators disagree** |
| the honest small set | an unreadable filename yields `None`, never a fabricated stamp · an impossible calendar day is refused **at our call site** |

## The properties bite — three planted mutations, each killed precisely

| plant | killed by |
|---|---|
| `ppm = -slope * 1e6` (sign flip) | the planted-drift property, **alone** |
| `if n < 1` (refusal off-by-one) | the refusal property, **alone** |
| offset nudged off the median | 3 properties, including translation-equivariance |

Translation-equivariance is the one a fixture cannot express: it holds for *every* input, and it is
what makes the number an **offset** rather than a fitted constant.

## The `24:00:00` question — answered by reading, and it is a NON-divergence

§2.7 requires end-of-day `24:00:00` to be **accepted**, and forbids "a bare `h > 23` guard".
`strptime("%H")` *is* that guard. But the 14-digit stamp's **sole producer** is
`writers.capture_filename`, which formats `strftime` from a `datetime` whose hour is 0–23 by
construction; `writers.file_stamp` is anchored to that layout and requires a plausible year, so a
vendor filename cannot reach the parse either.

**Nothing can emit it, so nothing diverges.** Recorded as a comment at the call site with the condition
that would retire it: a non-`strftime` producer routed into this path makes the clause live and the
rejection a real bug.

`.hypothesis/` is ignored at the repo level — belt-and-braces, since Hypothesis already writes its own
`.gitignore` inside the directory. That is why `git status` never showed it while `git check-ignore`
said it was not ignored: the ignore was one level down, not absent.
