---
bump: patch
type: changed
---

**`KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS`'s adapter-assignment box was already satisfied, and target 7's
confound does not exist in this corpus.** Measured rather than assumed:

**Written into night metadata.** Every `Tepna_*_LINK.csv` opens with
`# adapter=AC:A7:F1:29:9D:1D hci=hci0` — the adapter **MAC**, not just the `hci` index. That is the correct
identity: hci indices re-enumerate (which is why `adapter_hci()` exists), so an index-only record would
silently re-label the same radio between boots.

**Held fixed.** Across the whole capture corpus: **257 sessions on `AC:A7:…:9D:1D` (hci0)** against **1 on
`C6:CF:3C:4E:75:F0` (hci2)**. No night contains two adapters.

⚠️ **The single outlier does not create the confound either.** `2026-07-26 14:56:03` (16 rows) carries **all
four devices** — COOSPO, H10, Verity, O2Ring — on that one adapter. So adapter is a **between-session
constant, never a within-session variable**, and target 7's *"sensor-specific noise confounded with
adapter"* requires adapter to vary **with sensor**. It never does.

**What remains true:** any comparison spanning the 07-26 session and another is adapter-crossed. That is
1 of 258 and identifiable from the header, so the mitigation is to name it, not to re-capture.

No code change — this closes a box by measurement, not by building anything.
