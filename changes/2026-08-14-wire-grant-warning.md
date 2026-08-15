---
bump: patch
type: fixed
---

`helper_path.grant_warning` now runs at boot. It could always detect a privileged helper about to be
`sudo`-run from a path the granted user can rewrite, and it was called by nothing outside its own tests.

**The condition is reachable, not hypothetical.** `resolve()` falls back to the in-repo copy when no
system copy exists; that copy is `-rwxrwxr-x vigil` on the box; and `daemon_control.build_cmd` prefixes
`sudo -n` to whatever it returns. `capture.py` resolved helpers at three sites and checked safety at
none. Today it degrades legibly only by accident — sudoers is scoped to `/usr/local/lib/tepna/*`, so a
repo-path invocation is *refused* rather than escalated. That is the second line of defence doing the
first line's job, and it stops being true the moment a grant widens.

**`SYSTEM_DIRS` mis-described its own second element**, which is how the fallback looked safe at the call
site. The comment called both entries "Root-owned deploy targets"; the second is
`/opt/tepna/capture-host` — the checkout — vigil-owned **by design**, because `tepna-update.sh` must be
able to write it to complete a deploy. Corrected, and `SUDO_HELPERS` added so the boot self-test asks
about every sudo-invoked helper in one place: a per-call-site check is exactly what left this unwired,
since `capture.py` resolves three and `clockcfg`/`link_rssi` resolve others.

**⚠️ Gated on a deployed host, because a self-test that always fires teaches people to stop reading it.**
In any development checkout the helpers are repo-local and never root-owned, so an ungated check warns
five times at every startup about paths that hold no sudoers grant and never will — the failure that
retired the `smeared` canary arm. The presence of the system dir is the discriminator, which keeps the
signal that actually bit on 2026-08-14: a deployed box where a helper is *missing* from the system dir,
so `resolve()` silently falls back beneath a `sudo -n`.

**Two defects surfaced while building this, both found by running rather than reading:**

* A surviving mutant showed the `_UNCHECKED` sentinel I copied from `usb_path` was **decoration**.
  For a single value, "not looked" and "looked and it was empty" are different verdicts; for a list of
  warnings they are not — both produce nothing. Swapping the sentinel for `()` changed nothing
  observable, so it is now a plain default with the reasoning recorded.
* One `try` around the whole helper loop is a **fail-open**: a single unreadable path aborts the sweep
  and silences every helper after it, letting loop order decide which defences get reported. Now
  per-helper, extracted as `_gather_helper_warnings` so the failure mode is directly testable — the
  one-try mutant now reds.

One pre-existing test was updated deliberately rather than worked around. It asserted the self-test's
warnings equal `defense_warnings(None, None)`, which assumed the verdict is fully determined by
`(autosuspend, capeff)`; there is now a third, environment-dependent input. The new gatherer is stubbed
in that one test so its original claim — a missing `CapEff` line still reaches the verdict instead of
aborting the boot check — is preserved exactly.

From `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §3.
