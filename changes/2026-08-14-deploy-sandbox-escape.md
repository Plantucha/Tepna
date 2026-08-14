---
bump: patch
type: fixed
---

The Deploy button failed on its first real press, and the monitor's six newest buttons were unstyled.

**`deploy` could not write `.git`.** Pressing it on the box returned:

```
error: cannot open '.git/FETCH_HEAD': Read-only file system
```

The capture unit runs `ProtectSystem=strict` with `ReadWritePaths=/srv/tepna /opt/tepna/capture-host`,
so `/opt/tepna/.git` is read-only to anything the daemon spawns. `tepna-update.service` sets
`ProtectSystem=no`, which is exactly why the timer has always worked and an in-process call never could.

**Sudo would not have fixed it, and that is the part worth remembering:** a mount namespace is not
escaped by privilege — a root child of the daemon hits the same read-only mount. What escapes is asking
PID 1 for a *new* unit, and PID 1 is reachable from inside the sandbox (the `reload` verb's
`daemon-reload` proves it; only the filesystem is restricted, not the bus). So `tepna-restart.sh` gains
a `deploy` verb that runs `systemd-run --quiet --pipe --wait --collect --uid=vigil`, which starts the
updater outside the namespace, keeps it unprivileged, and returns its output *and* exit code.

**A test asserted a proxy and would have passed through this entire bug.**
`test_deploy_runs_WITHOUT_sudo_because_the_updater_is_unprivileged` checked `"sudo" not in argv`. The
reasoning was right — the updater refuses to install `/etc` precisely so it never needs root — but
"uses no sudo" is not "does not run as root", and only the second claim matters. `--uid=vigil` keeps it
true while the invocation is now privileged. The replacement asserts it where it is actually decided,
in the helper's source.

⚠️ **And that replacement had to strip comments to mean anything.** The arm's header explains why
`--uid=vigil` matters, so a bare substring check is satisfied by the PROSE and passes while the command
says `--uid=root`. Caught by mutating exactly that. A source-scanning test that reads comments is
asserting the documentation, not the code.

**Every classless button in `monitor.html` was one this work added.** The page defines `.btn`,
`.btn-primary` and `.btn-destructive` with hover/active/disabled states; of 29 buttons, the 6 without a
class were all from the daemon-control card, and the other 23 were consistent. Worst of it: **Reboot
box**, the most destructive control on the page, rendered as a browser-default grey rectangle while
`.btn-destructive` — already used by `Forget` — sat unused. `Stop capture` and `Reboot box` now take
it; the rest take `.btn`; and the three rows share a fixed-width label so the button columns align
instead of stepping in and out. Verified by rendering the card, not by reading the diff.
