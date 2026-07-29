<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
---
The offline alert stays quiet for an `optional: true` device that never joined — the box no longer contradicts itself about a strap nobody is wearing.

**The defect.** `alert_poller` iterated `cfg["devices"]` and never consulted `optional`, so an optional-and-absent device produced this, six minutes apart:

```
INFO     COOSPO 808S 0022265: optional backup device not present — keeping a quiet eye out
WARNING  alert: COOSPO 808S 0022265 has been offline for ~5 min — capture is missing it
```

plus a webhook, on **every service start** — three in three days for a COOSPO 808S that is not paired, not bonded, and not advertising (verified: absent from `bluetoothctl devices`, `bluetoothctl info` empty, invisible to a 12 s LE scan). Capture is not "missing" a device that was never expected to join.

The connect loop already drew this distinction and says why: it logs the "quiet eye out" line **once** and backs off, deliberately, *"instead of a warning every backoff cycle (the COOSPO spam)"*. The alert loop simply never asked. An alert channel that cries over a non-event is one an operator learns to ignore — which costs the alerts that matter.

**The nuance that keeps it honest.** Suppression is conditioned on `ever_connected`, not on `optional` alone. An optional device that **did** join and then dropped is a real event — it was contributing data and stopped, which is exactly what this alert is for. Silence is only correct for one that never showed up at all, so the loop remembers which happened rather than re-deriving it.

The decision lives in `alerts.offline_alert_suppressed(optional, ever_connected)`, beside its sibling `offline_alert_due` — pure, so the rule is testable without driving the poller. `optional` arrives straight from YAML, so absent/`None` reads as "not optional": a required device silently demoted to quiet would be the worst possible way to get this wrong, and has its own known-answer case.

5 tests, **mutation-checked in both directions** — removing the suppression fails the never-joined test; suppressing *all* optional devices (ignoring `ever_connected`) fails the joined-then-dropped test. Known answers for the predicate including the `None` arm, plus two that drive `alert_poller` end to end.

`pytest` **1655 passed**, **100.00 %** statement + branch coverage, `ruff` clean. Out-of-suite (`capture-host/`) — no bundle, no `manifestHash`, no fixture.
