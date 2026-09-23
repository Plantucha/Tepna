---
bump: patch
type: changed
brief: none
---

tools/pb-agreement.mjs emits its run as one tepna.verdict/1 object, and its adoption row stops claiming it is a selftest printer that decides nothing about data - it has always printed either a kappa or a named refusal about a real corpus. The criterion binds on whether kappa is DEFINED (no zero margin in the paired-night table), never on its magnitude: OXYDEX-PB-OVERCALL-2026-07-31 states the device is not ground truth, that disagreement does not mean OxyDex is wrong, and names "a threshold chosen to make kappa look better on 39 nights of one subject" as the error to avoid - so an adoption that turned this measurement into a gate would contradict the brief that commissioned it. A negative kappa therefore still PASSES; a degenerate table is NOT_APPLICABLE with result null and the refusal reason carried, because a zero margin is a property of the data rather than a failure; no paired nights is NOT_RUN. Power is NOT assessed and criterion.name says so on every status, since the brief states n = 1 subject and no supported night count, and inventing one would be the same tuned-to-kappa error one field over. scope stays internal. WO_CLAIM_RATCHET shrinks 8 -> 7.
