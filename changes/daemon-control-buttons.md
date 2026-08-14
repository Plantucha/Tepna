---
bump: minor
type: added
brief: VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md
---

Stop and restart the capture daemon from the monitor. Every recovery this box has needed went through
ssh: on 2026-08-13 the daemon was restarted SIX times to apply config changes that only take effect at
a device's next connect, and a runaway sensor was silenced by POSTing config through the settings API
because nothing else could reach it. `tepna-restart.sh` was already deployed, root-owned and
NOPASSWD-granted — this adds a caller, not new privilege.

**`POST /api/daemon`** takes `{verb, minutes?}`. The verb is an ALLOWLIST looked up to a fixed argv, so
no caller string reaches a command line, and the argv is a list rather than a shell string so there is
nothing to quote for. `minutes` is a bounded int, REFUSED rather than clamped — a typo of 4800 must not
become a silent 480-minute outage. Inherits the existing POST token gate via middleware.

**RESTART KILLS THE SERVER THAT ANSWERS IT.** The monitor is served BY the unit being restarted, so a
synchronous call stops the process mid-write and the operator sees a failed request for an action that
in fact succeeded — indistinguishable from a crash, and how people learn not to trust a button. The
handler validates, ANSWERS, then fires on a 0.75 s delay; the page expects the drop and polls the box
back up.

**Validation happens before the answer, not in the deferred half** — the trap that ordering creates. A
late-validating design returns a cheerful 200 and then does nothing, which is worse than a 400 because
the operator believes capture stopped when it did not. Asserted: a bad verb and an impossible `minutes`
are both 400 and fire nothing.

**Stop shows what is LIVE before acting.** It reads `/api/state` at click time and names the connected
devices in the confirm, because "stop capture" at 23:00 with three sensors streaming is a different act
from the same click at noon and the button cannot tell them apart.

A missing sudoers grant is named as a DEPLOY gap rather than a failing daemon — `sudo -n` exits 1 with
"a password is required", which reads identically to a broken unit unless said. Same distinction as
check.sh's shellcheck-127 note, with a mirror test so the hint cannot fire on every failure. The helper
call is bounded by a timeout, because this box has had processes wedged 18 h in uninterruptible sleep
and a control endpoint that can hang forever stops working exactly when it is needed.

29 tests. The two that matter are verified by mutation rather than assumed: firing inline kills the
ordering tests, and `test_RESTART_answers_BEFORE_it_fires` was VACUOUS until `fired == []` was added —
it passed just as happily against an inline handler, because the injected runner returns instantly.
