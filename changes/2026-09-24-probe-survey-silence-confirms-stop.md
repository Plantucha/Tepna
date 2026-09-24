---
bump: patch
type: fixed
brief: none
---

`probe_verity_survey` reports `None` for a device confirmation whose status read went unanswered,
instead of deriving one from the empty parse. `pmd.parse_status_response(await cp.send(...) or b"")`
maps silence to `{}`, and `pmd.is_recording({}, meas)` is `False` by construction — so
`stopped_confirmed_by_device = not is_recording(...)` published **True** on a device that said
nothing at all. A fabricated positive: the survey's evidence that a probe left the armband clean came
from the probe's failure to ask it.

The same silence produced the opposite error one line away —
`recording_confirmed_by_device` read a safe-looking `False` — which is why the fix is one helper
returning `(parsed, answered)` at all three sites rather than a guard at the one that lies. The
answered flag is published beside each confirmation (`status_during_answered`,
`status_after_answered`, `status_answered.{before,after}`), so a reader can tell an unasked device
from a device that answered.

ABSENCE-SURVEY row 11 `probe_verity_survey.py` (default-reads-as-measured, high).

The SAME value path in `probe_verity_offline.py` had the same defect and is fixed with it: silence
published `recording_confirmed_by_device: False` **and** the operator-facing verdict *"the device does
not report recording"*, in the one file that already carried the honest form (`_status_of` →
`{"error": "no reply to status"}`, eighty lines above). That path also read status TWICE, so the
`status_during` it published could not certify the boolean beside it; it is now one read, and the
published status is the evidence. Third state in the verdict: *"did not answer the status query, so
whether it is recording was NOT established"*.

`CP_REPLY_TIMEOUT_S` is now a named module constant in both probes rather than a default-arg literal,
so a test of an unanswered read can shorten it — the three new survey plants cost ~20 s each (6 s per
attempt × `_with_link`'s retries) before it existed, and under 2.3 s each after.
