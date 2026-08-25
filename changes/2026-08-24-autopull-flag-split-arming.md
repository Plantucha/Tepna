---
bump: minor
type: fixed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

`capture-host/capture.py` — the event-driven auto-pull path **had never armed**, and nothing said so.

Measured on the box, whole journal: `auto-pull: armed` **0** occurrences against **312**
`auto-pull: enabled` poller lines, and **zero** trigger firings ever. The loop returned on
`not pcfg.get("on_charger", True)` with the box config carrying `on_charger: False`.

⚠️ **One charger-shaped flag gated two triggers.** `on_charger` also disabled the **not-worn**
trigger — which `notworn_pull_due` calls *"the only reachable trigger for a coin-cell device such as
the H10"*, because a CR2025 device never charges and the on-charger path is structurally unreachable
for it. That device's sole retrieval path has been dead for as long as the flag has been set.

**The symptom was an absent log line.** Nothing failed, nothing errored, and no gate can observe a
line that was never printed.

**The split:** `on_charger` now governs only the charger trigger; `on_doff` governs the not-worn one,
and each trigger is gated on its own flag at the call site.

🔴 **`on_doff` INHERITS `on_charger`'s effective value, and that is the whole back-compat design.**
Defaulting it True would arm a never-executed path on the next auto-deploy; defaulting it False would
silently disarm the doff trigger on every host that leaves `on_charger` at its default. Inheriting
reproduces today's behaviour **exactly on every host**, so the change is semantically neutral until
somebody edits config on purpose — enabling a path that has never run is an event, not a side effect
of deploying.

**Arming now prints in both directions**, naming the governing flag and its value, and the **poller's**
line reports the event-path state alongside its own — `auto-pull: enabled` was read fleet-wide as
"auto-pull works" while the event path had never armed once.

Six tests; five planted defects re-applied and killed, including both wrong defaults, the original
conflation, and the two ways the diagnostic could stop being informative (a reason that omits the flag
name, and one that cannot distinguish an inherited False from an explicit one).
