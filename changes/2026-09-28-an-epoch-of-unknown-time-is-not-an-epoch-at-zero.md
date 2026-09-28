---
bump: patch
type: fixed
brief: none
---

`regressLnRmssd` now requires a **finite** `tMin`. It guarded `isFinite(e.tMin)`, and **`isFinite(null)` is
`true`** — so an epoch whose minute-offset was null passed, `xs.push(null)` put it into the regression, and
arithmetic coerced it to **0**: an epoch of *unknown* time fitted as though it sat at ECG start.

Same defect as #3197, one function away — and the reason that row's remedy could not be "use the file's own
idiom".

## The asymmetry on the same line is the lesson

```js
if (rm > 0 && isFinite(rm) && isFinite(e.tMin)) {
```

`rm` is safe — **not because its guard is better**, but because `null > 0` is `false`, so its own bound
excludes null before the loose `isFinite(rm)` beside it is ever reached. One guard is protected by an
accident of its bound; the one next to it is not. Copying "the idiom" copies the accident, not the safety.

## Measured, by running the shipped function

```
clean four-epoch fit   −1.0748 /h
+ one epoch tMin null  −0.5156      ← nearly halved
+ one epoch tMin []    −0.5156
+ one epoch tMin '25'   0           ← the whole regression collapses
```

⚠️ **A numeric string is not benign here, which I assumed and measured wrong.**
`xs.reduce((a, b) => a + b, 0)` **concatenates** a string, so one `'25'` makes the mean `"10025"/5` and the
fitted slope **0 for every epoch**, not just the bad one. That is why rejecting a numeric string is correct
*here* — and equally why the repo-wide sweep of ~430 bare guards is still the wrong unit: elsewhere a
numeric string may be a legitimate input, and only the call site knows.

`NaN` and an absent key were **already** rejected (`isFinite` is false for both), so the fix's real delta is
`null` · `[]` · numeric string. The plant asserts all five anyway, so the two that were already safe cannot
silently stop being so.

## Preventive, like #3197

`tMin` is produced by `ecgdex-dsp.js` as `+(w0 / 60).toFixed(1)` — always a number. No shipped input reaches
this today; it closes the door before a producer can open it.

Plants execute the **shipped function** (extracted from `env.sources`, both lanes) and assert on the FITTED
SLOPE rather than a count, because the slope is what a reader of the page actually sees. Anti-vacuity: a
fifth *well-formed* epoch must still move the fit, or every assertion above would pass on a function that
always returns the same answer.
