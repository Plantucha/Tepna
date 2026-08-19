---
bump: patch
type: changed
---

**`CPAP-AUTOHARVEST-FOLLOWUPS-II` is DONE — the last unproven link, an actual alert delivery, is now
observed.** The brief's own framing: *"a configured webhook is not a delivered one."* It now is:

    send() = True
    stats  = {delivered: 1, failed: 0, suppressed: 0, last_error: None}
    title  = "Tepna alert-path test"  ->  the configured ntfy channel

Run through the daemon's **own** `alerts.Notifier`, against the **live** `config.yaml`, under the
**daemon venv** interpreter — the brief's §1 warning verbatim, since its first attempt filed a false
defect off the system python. The reboot had wiped `/tmp/alerttest.py`; recreated to the same spec.

The deploy half (§1 b) was already closed 2026-08-15; re-measured at close: **0 commits behind** (the
111 → 3 → 0 progression is why that box gets re-measured, never trusted). §4 stays parked as the
conditional no-op it is. No follow-up brief: nothing surfaced during execution.

⚠️ One process note recorded against myself: the DOCS-INDEX status flip initially landed on the
**parent** brief's row — its description mentions the II brief, and a contains-check on (name AND
"PROPOSED") matched it first. Caught by `check3b` (row ≡ header) before commit, which is that gate
doing exactly its job. The fix asserts the row uniquely before writing.

Gate: docs-ledger 38/38.
