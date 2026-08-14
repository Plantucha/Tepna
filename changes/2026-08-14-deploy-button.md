---
bump: minor
type: added
---

A **Deploy now** button in the monitor, and `tepna-update.sh`'s first-ever argument.

**The pull was never the missing step — the RESTART is.** `tepna-update.timer` already fetches and
fast-forwards every ~30 min, and the box is never far behind main. What it cannot do is decide to
interrupt a recording, so it defers the restart and reports it, tick after tick:

```
updated 935fb09b575e → da81d63dc332
deferred — a device is recording; the daemon keeps the old code until the box is idle
```

That is the script working as designed. What was missing is any way for a human to say "do it now
anyway" without ssh.

**`--no-restart` is the button's mode, and that is the whole design.** This script restarts the daemon
when the box is idle — which would kill the web server writing the button's response, so a deploy that
WORKED would present to the operator as a dropped connection. Instead it fetches, fast-forwards,
re-serves the bundles, and reports `RESTART-OWED`; the UI then offers the existing Restart button. Two
clicks that never lie about what happened, rather than one that sometimes does.

`--force-restart` overrides the recording interlock deliberately, and **says which interlock it stepped
over** — this log is the only witness on a box nobody logs into, so `forced` is carried separately from
`state` rather than just setting `state=idle`. The shortcut reaches the right branch and then prints
"box is idle" about a box that is recording, one line under "forcing a restart despite: recording".

**`deploy` is the one UNPRIVILEGED verb here, and `_NO_SUDO` keeps that visible at the call site.** The
updater runs as the capture user and refuses to install `/etc` or the granted helpers, because root
executing freshly-pulled repo code on a schedule would turn a compromise of that user into root by
waiting for a tick. Prefixing it with `sudo` would hand it exactly the privilege it was written to
decline.

**Also fixes a latent defect shipped one PR earlier.** The inline branch called the blocking
`daemon_control.run` directly on the event loop. That was tolerable while every inline verb was a
sub-second systemctl call, but `radio` sleeps 5 s inside the helper and `rebind` up to 11 s, so both
already froze the entire monitor — SSE feed and all requests — for their duration. A deploy doing a
network fetch (one real run on this box died after 300 s) would have made it unmissable. Now
`asyncio.to_thread`, with a per-verb timeout so the long bound belongs to `deploy` alone and a wedged
helper cannot pin the control endpoint for four minutes.

Gated: 62 assertions, with the sudo-free argv, the stored `--no-restart` flag, the per-verb timeout, the
`restart_owed` flag and the handler's use of `timeout_for` each verified by re-applying the mutant it
exists to kill. The bash was driven against a real throwaway git repo across `--no-restart` while
recording · `auto` while recording · `--force-restart` while recording · `auto` when idle · a bogus mode.
That harness caught a real bug: the mode validation sat ABOVE `die()`'s definition, so a bogus mode
printed `die: command not found` and then fell through to `auto` instead of being refused.
