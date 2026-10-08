---
bump: patch
type: fixed
brief: none
---

Follow-up review fixes (2026-10-08):

1. OxyDex `pushEvent()` eligibility now uses measured duration (`endIdx - evStart - evMissing`), not elapsed span. An event with 12s span but 7s measured is rejected when minSec=10.
2. Gap-crossing policy explicit: event retained as ONE across gaps (not split/rejected), with `missingSec` quantifying the unobserved span. Test locks in the policy.
3. XSS gate: documented regex limits — does not validate assigned value safety. `el.innerHTML = userInput + escapeHTML(safeVar)` passes the gate but is unsafe; human review required.
