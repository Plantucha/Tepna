<!--
  VIGIL-AUTO-UPDATE-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-04

> **§1–§5 BUILT 2026-08-04.** `capture.publish_recording` publishes the predicate `alert_loop` was
> discarding; `capture-host/tepna-update.sh` + `tepna-update.service`/`.timer` implement §4; the units are
> on `check-system-files.sh`'s manifest and `install-services.sh` enables the timer. 24 tests, four
> mutants killed (fail-open on `unknown`, falling back to `connected`, dropping the dirty refusal, keying
> `publish_recording` on `connected`).
>
> **It stays IN-PROGRESS deliberately.** §6's last item is *one real cycle watched happening on the box*,
> and that has not happened yet — the units are not deployed. Stamping DONE on machinery whose only
> untested property is "does it work unattended" would reproduce this brief's own §5 in the act of
> closing it.

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

- [ ] `status.json` carries `recording` (per device + top level), test-gated, single-sourced on
      `alerts.device_is_recording`.
- [ ] `tepna-update.sh` + its timer are on `check-system-files.sh`'s MANIFEST at **mode `0755`** (the mode
      column exists as of 2026-08-04 — before it, a managed executable was installed `0644` and unrunnable).
- [ ] A test proves the updater **defers** rather than restarts while a device is recording, and another
      proves it refuses on a dirty tree.
- [ ] `capture-host`'s 100 % statement+branch floor still holds.
- [ ] **One real cycle observed on the box:** a commit lands, the box picks it up unattended, the daemon
      restarts, and the report says so. Until that is watched happening, this is untested machinery — which
      is the same failure it exists to fix.
