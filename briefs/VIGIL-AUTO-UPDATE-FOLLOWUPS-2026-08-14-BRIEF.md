<!--
  VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-14

> Spawned by closing `VIGIL-AUTO-UPDATE-2026-08-04-BRIEF.md` (DONE 2026-08-14, §6 met with 41 observed
> unattended restarts). Everything here was found by *running* the machinery that brief built, mostly on
> 2026-08-14 while wiring the monitor's daemon-control card.

# The deploy finishes itself — except for the one file class that needed a person, which is still the one that needs a person

## 1 · The residual gap, stated exactly

`tepna-update.sh` closed the **pull** and the **restart**. It does not close the **root-owned helpers**,
and the reason is a distinction that is easy to state and was still got wrong out loud on 2026-08-14:

> the `NOPASSWD` wildcard grants **EXECUTE** on `/usr/local/lib/tepna/*`. It never grants **WRITE** to
> that directory.

So updating `tepna-restart.sh` — or adding a verb to it, which happened four times in one day — needs
`sudo bash deploy/enable-restart-control.sh` typed by a human. That is exactly the failure class §1 of
the parent brief tabulates: **#914's root helpers sat eight days behind the checkout, unnoticed.** The
parent brief *reports* that drift (`check-system-files.sh` runs every tick) and deliberately does not
fix it. It is still unfixed.

**Measured 2026-08-14:** the box auto-pulled a `reload` verb into the checkout within 30 min, and the
installed helper stayed four verbs behind until a password was typed. The API answered
`unknown verb 'reload'` the whole time, from code that was sitting on disk.

## 2 · Why the obvious fix is a root hole, and what shape a real one has

Granting `NOPASSWD` on `enable-restart-control.sh` would close it in one line and must not be done.
That installer copies **from `/opt/tepna`**, which `vigil` can write, so a compromise of the capture
user becomes root in two granted commands: write a malicious `tepna-restart.sh` into the checkout, have
root install it, execute it via the wildcard. `tepna-update.sh`'s own header already makes this
argument; it is correct and it rules out *installing from the checkout*, not installing at all.

A defensible shape, **not yet built** (a first attempt on 2026-08-14 was blocked pending owner sign-off,
which is the right outcome for a change to a box's privilege model):

- a root-owned installer that clones the **canonical remote** into a root-only `0700` temp dir and
  installs from THAT — never from `/opt/tepna`, never `git remote get-url` (that config is
  vigil-writable);
- an explicit **filename allowlist**, so a new file in the repo does not become root-executable by
  merely existing;
- **`/etc` untouched** — sudoers stays a human act;
- clone → verify → install, so a fetch failure leaves helpers unchanged rather than half-written.

Net: the trust anchor becomes `origin/main`, which is *already* the trust anchor for every line the box
runs. The honest residual is that it converts "root writes there when the owner types a password" into
"root writes there whenever `vigil` asks, from GitHub". **That is an owner decision, not an engineering
one.**

## 3 · `ProtectSystem=strict` means the daemon cannot run the updater in-process

Found by pressing the Deploy button for the first time (#1244, fixed #1249):

```
error: cannot open '.git/FETCH_HEAD': Read-only file system
```

The capture unit sets `ReadWritePaths=/srv/tepna /opt/tepna/capture-host`, so `/opt/tepna/.git` is
read-only to anything the daemon spawns. **Sudo does not fix it** — a mount namespace is not escaped by
privilege. `systemd-run --uid=vigil` does, because PID 1 starts the new unit outside the namespace, and
PID 1 *is* reachable from inside (the `reload` verb's `daemon-reload` proves it).

- [ ] **Audit the other privileged helpers for the same assumption.** `tepna-clock.sh` and
      `tepna-rssi.sh` are invoked from the daemon and write to `/etc/chrony` / `/run/chrony`, which ARE
      in `ReadWritePaths` — so they work today *by having been listed*, not by design. Any new helper
      that writes outside that list will fail the same way, and the failure looks like a permissions bug
      rather than a sandbox one.
- [ ] Consider documenting the writable set in `check-system-files.sh`'s header, where a helper author
      will actually meet it.

## 4 · The interlock ratio is real data, and nobody is looking at it

47 deferrals against 41 restarts over the box's history. That is not a curiosity: it means **the box
spends a large fraction of its life running code that is on disk but not loaded**, bounded only by when
the subject stops wearing a sensor.

- [ ] Decide whether that is acceptable, or whether a deploy should be able to say "restart at the next
      idle moment" rather than waiting for the next 30-minute tick to re-check. The `--force-restart`
      mode added 2026-08-14 covers the impatient case but not the patient one.
- [ ] `deferred` is currently INFO-level prose in a journal. If a deploy matters, nothing surfaces "this
      box has been deferring the same commit for 9 hours".

## 5 · Transient network failure is handled, and is worth a counter

One cycle died on `fatal: unable to access github.com … Connection timed out after 300039 ms`; the unit
went `failed` and the next tick recovered. §5 of the parent brief argues a nonzero exit is precisely
what makes drift visible, so this is working — but a *single* transient failure and a *persistent* one
look identical in `systemctl status`.

- [ ] Distinguish "failed once, recovered" from "failing every tick since Tuesday". A consecutive-failure
      count in the report, or a `RESTART-OWED`-style marker, would do it.

## 6 · Done when

- [ ] The helper-install gap is either closed by §2's design **or** explicitly accepted by the owner and
      recorded here, so it stops being rediscovered.
- [ ] §3's audit is run and its answer written down.
- [ ] §4 and §5 are decided, not merely noted.
