---
bump: minor
type: added
brief: none
---

Every unmeasurable PAT quantity now carries its own reason beside the null — the same sentence in the
page card and in the batch download, written once where the absence is made.

**The first half of §∅ was already right and the second half was missing.** `coupledPAT` and `packCp`
emitted a bare `NaN` for the beat-to-beat residual IQR, the drift range and the drift rate whenever
they could not be measured. `JSON.stringify` writes `NaN` as `null`, so `pat-feasibility-batch.json`
already said *absent* correctly and never said *why*; the page turned the same `NaN` into an em-dash
and left the card's sub-line holding a static caption for a number that is not there (`— ms` ·
"lag IQR vs local baseline"), or, for drift, the empty string. A reader of either surface could see
that something was missing and had no way to learn whether the night had no overlap, no bins, or no
surviving residuals.

**Three siblings, nothing renamed.** `residIQRReason`, `driftRangeReason` and `ppmReason` are computed
on the same line as the `NaN` they explain, cross the worker boundary with it, and reach the download
as `beatToBeatIQRmsReason`, `driftRangeMsReason` and `driftPpmReason`. No existing key changes name or
type: the three numbers still serialise to `null`. **The shape is outcome-independent** — each reason
key is always present and is `null` when its number publishes, never absent and never `''`. The repo
has paid for the other shape once already (a key whose *presence* came to mean "a fit happened";
`tests/dex-tests.js` — *absence is null, not absent*), and a field that exists only on failure is that
same defect wearing the opposite sign.

**The rate moved to the top level so it could be tested.** A ppm is a range over a span and therefore
has two ways to be absent that are not the same sentence — no span to divide by, or no numerator — so
it needed a real refusal, not a shared one. `packCp` is declared inside `self.onmessage` and can only
ever be source-scanned, which is the stated reason `pat-align.js` and `analysis-stats.js` left this
file; the rate is now `driftPpmWithReason` at the worker's top level, where the reconstructed-realm rig
already used by *PAT worker — both legs EXECUTE at sub-sample positions* can pull it out and run it.
The unread second copy of the same formula, sitting a few lines above `packCp` and assigned to a
variable nothing read, is gone with it.

**And each leg now divides by its own span.** `packCp` closed over the chest→ankle overlap for every
leg, so `cpF`'s rate was the finger leg's drift range over the ankle leg's recording and `cpFA`'s
belonged to neither of its two ends. Nothing read those two numbers, which is why it survived — but the
new sentence quotes the span in minutes, and a refusal naming the wrong recording would be worse than
the silence it replaces. The overlap is now a parameter and every call names it.

**Plant and control are one generator at two beat spacings**, which is what makes the pair evidence
rather than two fixtures. Lags alternate 210/640 ms, both inside the PHYS window so both pair. At a
20 s spacing each ±30 s local window holds three beats, the median is the *other* value, every residual
is 430 ms against a 90 ms tolerance and nothing survives — zero residuals, zero bins, both quantities
genuinely unmeasurable. At 31 s the windows hold one beat each and both publish. The plant then
round-trips through `JSON.parse(JSON.stringify(...))` and asserts the three nulls arrive with three
*different* sentences beside them, so no reader of the file can reach a `0` where a refusal happened.

**MINOR, by `changes/README.md`'s own rule**: the three download keys are an additive export, which is
"backwards-compatible capability", and that outranks the patch-level span fix travelling with it. No
consumer of the existing six keys sees a changed name, type or value on a measurable night.
