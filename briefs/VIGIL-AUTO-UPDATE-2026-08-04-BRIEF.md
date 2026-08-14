<!--
  VIGIL-AUTO-UPDATE-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-14 · **Created:** 2026-08-04

> **§1–§5 BUILT 2026-08-04; §6 CLOSED 2026-08-14 ON MEASURED BOX EVIDENCE.**
> `capture.publish_recording` publishes the predicate `alert_loop` was discarding;
> `capture-host/tepna-update.sh` + `tepna-update.service`/`.timer` implement §4; the units are on
> `check-system-files.sh`'s manifest and `install-services.sh` enables the timer.
>
> **The blocking item was "one real cycle observed on the box", and it has now happened 41 times.**
> Read from the box's own journal on 2026-08-14 — `journalctl -u tepna-update.service`:
>
> | | |
> |---|---|
> | cycles that pulled new code | **88** |
> | cycles that **deferred** because a device was recording | **47** |
> | cycles that **restarted the daemon unattended** | **41** |
>
> Both halves are therefore witnessed, not just the happy one: the interlock fires roughly as often as
> the restart does, which is the property §4 exists for. Two cycles were watched live during the
> 2026-08-14 session (`updated 42566ded → 935fb09b`, `updated 935fb09b → da81d63d`), each correctly
> reporting `deferred — a device is recording`.
>
> **One failure mode was also observed, and behaved as designed:** a cycle died on
> `fatal: unable to access github.com … Connection timed out after 300039 ms`, the unit went `failed`,
> and the next tick recovered. §5's whole argument is that a nonzero exit is what makes drift VISIBLE on
> a box nobody logs into; this is that working.
>
> ⚠️ **§6's second checkbox was mis-worded and is corrected below rather than ticked as written.** It
> asked for `tepna-update.sh` on the MANIFEST at `0755`. That file is never installed to a system path —
> the unit runs it in place (`ExecStart=/opt/tepna/capture-host/tepna-update.sh`), which is the whole
> point of §3: it must stay vigil-owned and unprivileged. Its two UNITS are managed, at `0644`, which is
> correct for units. Managing the `.sh` would mean root-owning it, contradicting the brief's own design.
>
> **What is NOT closed here** is carried to `VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md`: the
> root-owned HELPERS still need a human, because the NOPASSWD wildcard grants EXECUTE on
> `/usr/local/lib/tepna/*` and never WRITE to it — so #914's eight-day-drift class is reported, not
> fixed.

# A capture box that cannot finish its own deploy runs stale code — automate to the blast radius of the daemon, and *report* the rest

> **The rule this brief is built on** is already written, in `tepna-restart.sh`'s own header: *"A NOPASSWD
> grant must name something the granted user CANNOT rewrite, and it must not be a general-purpose tool."*
> Most of the design below is that sentence applied honestly to an unattended timer.

## 1 · Three measured staleness events, one class

| when | what was stale | why it stayed stale |
|---|---|---|
| **2026-07-30** | daemon serving the build from before the fixes on disk | the restart needed a password nobody was awake to type (recorded in `tepna-restart.sh`) |
| **2026-08-03/04** | daemon ran **4 days** of stale code | the code *had* been pulled; nothing ever restarted the unit |
| **2026-08-04 (#914)** | root helpers in `/usr/local/lib/tepna` **8 days** older than the checkout; `tepna-usbreset.sh` never installed at all | they were not on any drift manifest |

One class: **a deploy step that requires a human does not happen.** Note the second row especially — the
*pull* is not the missing piece and never was. Automating `git pull` alone would have fixed **none** of
these three.

## 2 · The privilege boundary — this is NOT "put `deploy-vigil.sh` on a timer"

`deploy-vigil.sh` runs `sudo bash $DEST/capture-host/deploy/check-system-files.sh --install`. That is
fine when a human types it after a pull they initiated. On a timer it is a **root-executes-freshly-pulled-
repo-code** path, and it fails both halves of the rule quoted above: `check-system-files.sh` lives in
`/opt/tepna`, which `vigil` **can rewrite**, and `--install` writes arbitrary repo bytes into `/etc` and
`/usr/local/lib` — including the unit file and the sudoers-granted helpers themselves. A compromise of
the capture user would become root by waiting for the next tick.

**So the updater automates only what it can do through the existing narrow grant, and reports the rest:**

| step | automated? | blast radius |
|---|---|---|
| `git fetch` + `--ff-only` | **yes**, as `vigil` | the checkout |
| `sync-apps.sh` (serve the bundles) | **yes**, as `vigil` | `/srv/tepna/app` |
| restart the daemon | **yes**, via the existing `tepna-restart.sh` grant | one unit |
| `/etc` + root-helper drift | **NO — report only** | **root** |

This is not a limitation; it is the boundary. And it still addresses all three events: rows 1 and 2
fully, row 3 by making it **visible**, which is precisely what was missing — #914's drift was silent for
eight days, not unfixable.

## 3 · The recording guard — publish the predicate, do not re-derive it

`capture.py` already computes `alerts.device_is_recording(connected, last_data, now, grace)` per device
each alert tick — and **throws the answer away**. What `status.json` publishes is `connected`, which the
docstring of that very function proves is *not* recording:

> *"Four 'recovered' notices, and NOT ONE BYTE written after 23:48."* — the 2026-07-29 H10 bond failure,
> where an unbonded strap read `connected: True` inside each doomed 1–2 s connect for four and a half hours.

An updater that gated on `connected` would therefore **restart the daemon mid-night on a flapping bond** —
the same 2026-07-29 failure, one level up, and now destroying the night instead of merely mis-reporting it.
Re-deriving the predicate in shell would be a second source of a rule this repo has already paid to learn.

⇒ **Step one is to surface the boolean that already exists** into `status.json` (`devices.<name>.recording`,
plus a top-level `recording`). The updater then reads published state and there is exactly one definition.

## 4 · What the updater does

A `vigil`-owned systemd timer running `tepna-update.sh` (hourly; the guard, not the clock, decides when it
is safe):

1. **Refuse** if the checkout is dirty or not on `main` — never clobber a hand-edit made on the box.
2. `git fetch` + `git merge --ff-only origin/main`. **No move ⇒ exit 0 quietly.**
3. `sync-apps.sh` — *a `git pull` is only half a deploy; the bundles are served separately.*
4. `check-system-files.sh` **without** `--install`. Drift ⇒ **report loudly, do not install** (§2).
5. **Restart only if `status.json` is fresh (< 60 s) and no device is `recording`** (§3). Otherwise defer
   to the next tick — a deferral is normal and must not be an error.
6. Confirm it came back. `tepna-restart.sh` already does this (`sleep 3`, then `is-active`) and reports a
   failed restart as a failure rather than a success.
7. Report through the existing notifier.

## 5 · The failure modes this must not have

- **Silent success** — the class that caused all three events in §1. A run that changed nothing is quiet;
  a run that **failed**, or that found `/etc` drift, is loud. *A gate nobody has seen fail is not evidence.*
- **Restarting mid-recording** — §3.
- **Clobbering work done on the box** — `--ff-only` plus the dirty-tree refusal.
- **Root executing freshly-pulled code** — §2.

## 6 · Done when

- [x] `status.json` carries `recording` (per device + top level), test-gated, single-sourced on
      `alerts.device_is_recording`. — present in `alerts.py` and `capture.py`.
- [x] **CORRECTED:** the two UNITS are on `check-system-files.sh`'s MANIFEST at `0644` (correct for
      systemd units). `tepna-update.sh` itself is deliberately NOT managed: `ExecStart` runs it in place
      from the checkout, and managing it would root-own the one helper §3 requires to stay unprivileged.
      The `0755` mode column is exercised by the five helpers that ARE installed under `$LIB_TEPNA`.
- [x] A test proves the updater **defers** rather than restarts while a device is recording, and another
      proves it refuses on a dirty tree. — `test_it_DEFERS_while_a_device_is_recording` and
      `test_a_dirty_checkout_is_never_touched`, plus 19 more in `tests/test_vigil_update.py`.
- [x] `capture-host`'s 100 % statement+branch floor still holds. — 3598 passed, 100.00 %, 2026-08-14.
- [x] **One real cycle observed on the box.** 88 pulls, 41 unattended restarts, 47 correct deferrals,
      and one transient-network failure that surfaced as a `failed` unit and self-recovered. See the
      header block for the journal counts.

