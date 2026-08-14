---
bump: minor
type: added
---

The capture-host restart helper gains a `reload` verb, and the monitor a **Reload units** button, so a
systemd unit change that arrives by `git pull` can be applied without an interactive password.

This is the same gap `tepna-restart.sh` was written for, one layer down. `git pull` puts new code on
disk and the helper restarts the daemon to pick it up — but if the pull also changed the *unit* file,
systemd keeps the old definition until something calls `daemon-reload`, and that needed a password.
Measured 2026-08-14: `sudo -n systemctl` is refused (vigil's blanket grant is password-gated; the
`NOPASSWD` lines are scoped to `/usr/local/lib/tepna/*`), and the unprivileged polkit path answers
`Access denied … requires interactive authentication`. So the box could complete every part of its own
deploy except this one.

**A RELOAD IS NOT AN APPLY, and the verb reports the two facts separately.** `daemon-reload` re-reads
unit *files*; it does not push a `[Service]` change into an already-running process. That distinction
is not academic — this box had carried the "changed on disk" notice since 2026-08-06 while all 17
directives its unit and drop-in set were already loaded and live, and the notice was read as "the
daemon is running stale config", which it was not. The verb therefore says whether a reload was owed
(`NeedDaemonReload`, the machine-readable form of that notice — never a grep of `systemctl status`
prose, which is localised, width-reflowed, and absent on some versions, so grepping it fails OPEN) and
separately that a restart is still what carries `[Service]` changes across.

`reload` is deliberately **not** in `KILLS_SELF`: it stops nothing, so it is answered INLINE with the
helper's real output. Deferring it would return a cheerful 200 carrying nothing, for a verb whose whole
value is the answer — the silent-success shape this suite exists to catch. The monitor's post helper
grew an explicit `dropsConnection` flag for the same reason: polling the box back up after a reload
would print "daemon is back" for a drop that never happened.

Gated: 4 new assertions (zero arity, not in `KILLS_SELF`, inline answering with real detail, no
`scheduled_in_s`), each verified by re-applying the mutant it exists to kill — putting `reload` in
`KILLS_SELF`, giving it arity 1, and removing the verb all red the suite. The bash was driven against
a fake `systemctl` across owed / not-owed / reload-fails / flag-survives-its-own-reload.
