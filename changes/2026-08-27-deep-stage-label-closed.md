---
bump: patch
type: changed
brief: DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md
---

The last open item — *"a better LABEL — PSG, **or** flow-based apnea scoring not gated on a 3 %
desaturation"* — is **closed**, and the brief flips to **DONE**. This is an evidence judgement on work
already in the brief, not new measurement.

**The lever was pulled and it answered.** The item offers a choice, and the flow-based half was obtained
and applied: the ResMed's own `_EVE.edf` scoring, **desat-independent by construction**, joined to
`sleepStages` across **29 nights** and swept over ±45 min of clock offset so the ResMed skew is bounded
rather than assumed away (§11a).

| | §9.6 requires | measured |
|---|---|---|
| clean Deep epochs hiding unscored apnea | ~50 % | **16.8 %** nominal · **26.1 %** worst-case over any tested misalignment |

**The verdict is a result, not an incompleteness of the box:** label noise is **unlikely, not excluded** —
about a factor of 2 short. Deep is also *not* enriched for flow events (16.8 % vs 13.8 % non-Deep, with
non-Deep flat at 12.9–15.1 % across every shift), which retires the concentration scenario §11 raised as
the reason the hatch might still close.

⚠️ **What would EXCLUDE it is PSG — a data-acquisition question, not this brief's work.** Two limits carry
forward and are why "excluded" is not claimed: the subject is **treated**, so residual events measure the
therapy working rather than apnea prevalence; and the bound is conditional on the **ResMed's own
sensitivity**. Neither is repairable by more analysis of this corpus.

⚠️ **Pre-existing index defect found and fixed on the way.** This brief's DOCS-INDEX status cell read
*"IN-PROGRESS 2026-08-18 — §1–§4 closed; only §5 open, the historical-fixture gap"* — a description
belonging to a different brief (this one has no historical-fixture gap). The row was patched **by line
with an identity assertion**, which is what surfaced the mismatch; a blind status-string replace would
have carried the wrong summary forward.
