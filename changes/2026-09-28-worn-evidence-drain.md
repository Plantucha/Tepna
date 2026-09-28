---
bump: patch
type: fixed
brief: MUTATION-SURVIVOR-LEDGER-2026-09-28-BRIEF.md
---

The twelve mutation survivors on `loss_audit.py::_has_worn_evidence`, reported on #3022 and unanswered for four days, are drained: five killed by tests that pin behaviour the function already documents in a comment — an unreadable or column-less file must not end the search, a torn tail row is not a measured beat, and the evidence read names its encoding — and seven recorded as no-distinguishing-input with the argument for each. The survivor ledger's close path runs for the first time on real entries and the open count falls twelve to zero; the ratchet's own verdict object stops mis-reporting the answered case as examined-nothing.
