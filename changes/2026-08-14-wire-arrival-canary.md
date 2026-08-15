---
bump: patch
type: fixed
---

`alerts.arrival_canary` is now called by `alert_loop`. It was called by nothing outside its own tests.

Its docstring names the failure it alone can see: the packet-arrival sidecar write is wrapped in a bare
`except: pass` — telemetry must never disturb the data callback — so a persistent failure is invisible
**by construction**. Samples keep arriving, the files keep growing, and the per-connection BLE offset
that `min(arrival − device)` exists to recover simply stops being recoverable. It surfaces weeks later
inside an analysis, which is exactly how the back-timed stamps it replaced went unnoticed for a whole
corpus.

**⚠️ Wired only after checking it against the real corpus**, because its sibling `smeared` arm was
retired for firing on EVERY stream on the first real night — a premise that was wrong, not a threshold
that was loose. Measured over every session on the box:

| | |
|---|---|
| sessions with data and a healthy sidecar | **355** |
| sessions the canary would fire on | **0** |
| sessions with data and no sidecar at all | 812 — abstains |

That third row looked alarming, since the blind sessions are the *same devices* rather than the non-PMD
ones the docstring claims (Verity 381 blind vs 341 seen, H10 226 vs 7). They are entirely pre-2026-08-11,
when the sidecar did not exist: the first night with any sidecar is 2026-08-11, and every session on or
after that date has one, 0 gaps across 4 nights. So the abstention is historical, and the zero-false-
positive result covers every session since the feature existed.

Deduped per night and warned at WARNING before the optional notifier — the journal is the only alerting
surface a box without a webhook has, the same rule the frozen-sensor alert beside it states.

**The tests were wrong twice before they were right, and both drafts would have passed CI:**

* A source-scan that strips lines beginning with `#` still reads a **trailing** comment, so
  `for _msg in []:  # alerts.arrival_canary(` satisfied all three assertions. Prose passing for code.
* Rebuilding the source from `tokenize` output joined with `""` welds `if notifier:` into `ifnotifier:`,
  so a phrase search silently matches nothing — a false pass in the other direction. `untokenize` pads
  from the original positions and is the correct tool.

**And the 100 % floor caught what no source scan can.** Three assertions proved the call *exists*; the
gate then proved they never *ran* it — 7 uncovered statements. A behavioural test now drives `qc_poller`
and reads the journal. A second run failed at 99.99 % on one uncovered **branch**: the canary firing with
no notifier configured, which is precisely the property the code comment claims. Three tests now cover
fires-with-webhook, fires-without, and stays-silent-on-a-healthy-sidecar.

From `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §2.
