---
bump: patch
type: added
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

`briefs/OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md` — registers the owner's O2Ring
`.dat` auto-harvest program (§1–27 preserved verbatim in the appendix, following the AS11 precedent,
because the scratchpad it arrived in is ephemeral).

🔴 **The §1 architecture map changed the premise.** The spec asks for event-driven harvest with the
poller demoted to a safety net. That decision is already shipped and deployed — `charger_pull_due` and
`notworn_pull_due` are pure, documented, and on the box — **and the path has never once executed:**
`auto-pull: armed` appears **0** times in the whole journal against **312** poller lines, with zero
trigger firings ever. The loop returns on `on_charger: False` before arming.

⚠️ **The flag's name describes a third of what it does.** `on_charger` also silently disables the
**not-worn** trigger, which the code's own comment calls *"the only reachable trigger for a coin-cell
device such as the H10"* — so that device's sole retrieval path has been dead for as long as the flag
has been set. A recording device whose only trigger is disabled fills its onboard slot once and then
silently records nothing.

**The symptom is an absent log line.** Nothing failed, nothing errored, and no gate can observe a line
that was never printed. It was found by *counting arming lines*, not by reading the code — the code
says the feature exists, and it does.

It dissolves two live arguments as debates about a path that never ran: the settle-vs-sleep-window
question, and this morning's slow night. *"The poller is healthy"* and *"the system is slow"* were both
true, because the poller was the only mechanism running.

Unit 1 splits the flag and makes arming print in **both** directions, changing no deployed behaviour —
enabling a never-executed path is an event that deserves a deliberate config change, not a default
flip. The awake-tail measurement, the `duration_s` state machine, T0–T7 latency and §22's restart
matrix are sequenced after. §6 carries the owner question the repo cannot answer: the config is
gitignored.
