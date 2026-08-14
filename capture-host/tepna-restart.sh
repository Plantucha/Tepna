#!/usr/bin/env bash
# tepna-restart.sh — Tepna Vigil
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The ONLY thing this does is restart (or report on) the capture daemon. It exists so a deploy can be
# completed without an interactive password: `git pull` puts new code on disk, but the running process
# keeps serving the old code until something restarts it, and `vigil` cannot call systemctl.
#
# That gap is not theoretical. On 2026-07-30 the box sat on `63a0703` — new code pulled, fixes on disk,
# daemon still running the build from before them — because the restart needed a password nobody was
# awake to type. A capture box that cannot complete its own deploy is a box that silently runs stale
# code all night.
#
# WHY A SCRIPT AND NOT A SUDOERS LINE FOR systemctl. A NOPASSWD grant must name something the granted
# user CANNOT rewrite, and it must not be a general-purpose tool. `NOPASSWD: /usr/bin/systemctl` would
# hand `vigil` every unit on the box — including masking the very services that constrain it. This
# script is root-owned 0755 under /usr/local/lib/tepna, takes a fixed verb, and names ONE unit, so the
# blast radius is exactly "restart the capture daemon".
#
# Same reasoning, and the same deploy shape, as tepna-clock.sh / tepna-rssi.sh (enable-clock-control.sh).
set -uo pipefail

UNIT=tepna-capture.service
# Where the checkout lives, for `deploy`. A constant, not derived from the caller.
REPO_DIR="${TEPNA_REPO_DIR:-/opt/tepna}"

usage() { echo "usage: $0 {restart|status|radio|reload|reboot|deploy|stop [minutes]}" >&2; exit 2; }
# Arity is PER VERB: only `stop` takes a second argument. A blanket "1 or 2 args" would quietly accept
# `restart extra`, and a verb that ignores trailing junk is one that will eventually be handed a typo
# for the thing the caller actually meant.
[ $# -ge 1 ] && [ $# -le 2 ] || usage
[ "$1" = stop ] || [ $# -eq 1 ] || usage

case "$1" in
  restart)
    # `restart`, never `start`: an operator asking for a restart on a stopped unit means "make it run".
    # Cancel any pending deadman first — coming back early is the normal case, and leaving the timer
    # armed would "start" an already-running unit later, which is harmless but makes the logs lie about
    # why the daemon came up.
    systemctl stop tepna-capture-deadman.timer 2>/dev/null || true
    systemctl restart "$UNIT" || exit 1
    # Report the outcome rather than assuming it. A restart that failed to come up must not look like
    # a success to whatever automated deploy called this.
    sleep 3
    state=$(systemctl is-active "$UNIT" 2>/dev/null)
    echo "$UNIT: $state"
    [ "$state" = active ] || exit 1
    ;;
  stop)
    # A STOPPED CAPTURE DAEMON IS A DARK NIGHT. This exists because a Polar holds exactly ONE BLE link,
    # so any tool that must talk to a sensor directly (the offline-recording probe) has to take the link
    # off the daemon first. That is a legitimate need and a genuinely dangerous verb: the failure mode is
    # not "the command errored", it is "someone stopped it at 22:00, got distracted, and the night was
    # never recorded" — silent, total, and only discovered in the morning.
    #
    # So this stop is DEADMAN-TIMED and cannot be left indefinitely. It arms a transient one-shot timer
    # that starts the unit again whether or not the caller ever comes back, whether or not their ssh
    # session survives, and whether or not they remember. The window is bounded at 60 minutes because a
    # maintenance task needing longer should be scheduled, not improvised against a live capture box.
    # `${2-15}` not `${2:-15}`: an EMPTY argument is a mistake to reject, not a request for
    # the default. The colon form would turn `stop ""` into a silent 15-minute stop.
    mins="${2-15}"
    [[ "$mins" =~ ^[0-9]+$ ]] || { echo "bad minutes: $mins" >&2; exit 2; }
    [ "$mins" -ge 1 ] && [ "$mins" -le 60 ] || { echo "minutes must be 1..60 (got $mins)" >&2; exit 2; }
    # CLEAR A SPENT DEADMAN FIRST. A transient unit that has already fired stays LOADED, and
    # `systemd-run --unit=` then refuses with "Unit ... was already loaded or has a fragment file".
    # Measured 2026-08-02: the second stop of the evening failed for exactly this reason. The refusal
    # was safe (the guard below kept the daemon running) but it made the verb single-use per boot,
    # which for a maintenance tool is indistinguishable from broken.
    systemctl stop tepna-capture-deadman.timer 2>/dev/null || true
    systemctl reset-failed tepna-capture-deadman.timer tepna-capture-deadman.service 2>/dev/null || true
    # Arm the restart BEFORE stopping: if arming fails we must not have a stopped daemon and no timer.
    systemd-run --quiet --on-active="${mins}min" --unit=tepna-capture-deadman \
      systemctl start "$UNIT" || { echo "could not arm the deadman timer — refusing to stop" >&2; exit 1; }
    systemctl stop "$UNIT" || exit 1
    echo "$UNIT: stopped — automatic restart armed in ${mins}m (tepna-capture-deadman.timer)"
    ;;
  status)
    echo "$UNIT: $(systemctl is-active "$UNIT" 2>/dev/null) since $(systemctl show "$UNIT" -p ActiveEnterTimestamp --value 2>/dev/null)"
    ;;
  reload)
    # RE-READ THE UNIT FILES. `git pull` can bring a new unit definition, and until systemd re-reads it
    # the box keeps the old one — the same stale-config shape `restart` exists for, one layer down. It
    # needed a password, which is exactly the gap this whole script exists to close.
    #
    # ⚠️ A RELOAD IS NOT AN APPLY, and conflating the two is the trap here. `daemon-reload` re-reads unit
    # FILES; it does not push [Service] changes into an already-running process. Measured 2026-08-14:
    # this box had carried the "changed on disk" notice since 2026-08-06 while every one of the 17
    # directives its unit and drop-in set was ALREADY loaded and live. The notice tracks the file's
    # mtime, not the process — so a reader who treats it as "the daemon is running stale config" reaches
    # the wrong conclusion, as one did that day. This verb therefore reports the two facts separately
    # and never implies one from the other.
    #
    # `NeedDaemonReload` is the machine-readable form of that notice. Read the property, never grep
    # `systemctl status` prose for "changed on disk" — that string is localised, reflowed by width, and
    # absent entirely on some versions, so a grep for it fails OPEN.
    owed=$(systemctl show "$UNIT" -p NeedDaemonReload --value 2>/dev/null)
    systemctl daemon-reload || exit 1
    if [ "$owed" = yes ]; then
      echo "$UNIT: unit files re-read — a reload WAS owed; a restart is still required for any [Service] change to reach the running process"
    else
      echo "$UNIT: unit files re-read — none was owed, nothing on disk had changed"
    fi
    # Report the outcome rather than assuming it, as `restart` does. If the flag survives its own
    # reload, something is wrong that a cheerful exit 0 would hide.
    if [ "$(systemctl show "$UNIT" -p NeedDaemonReload --value 2>/dev/null)" = yes ]; then
      echo "still reports NeedDaemonReload after a successful daemon-reload" >&2
      exit 1
    fi
    ;;
  reboot)
    # THE LAST RUNG. Above `radio` (restart bluetoothd) and above an unbind/bind of the adapter — for a
    # controller that survives both, and for a kernel-side wedge no userspace rung can reach.
    #
    # ⚠️ THE GUARD IS NOT HERE, AND THAT IS DELIBERATE — SAY SO RATHER THAN IMPLY IT. "Is a sensor
    # streaming right now?" is a question only the daemon can answer; this script would have to guess it
    # from file mtimes, and the two files that are ALWAYS being written (`status.json` and the LINK log)
    # would make it guess wrong in the direction that refuses forever. A guard that is usually wrong is
    # worse than an honest absence, so the live-capture check lives in the API layer, which reads real
    # device state, and this verb is the mechanism it drives.
    #
    # That is not a hole. The only callers are that API and a shell with `sudo`, and a shell with `sudo`
    # can already run `systemctl reboot` directly — a guard here would constrain nobody it needs to.
    #
    # The unit is `enabled`, so capture comes back by itself; that is what makes this survivable at all.
    echo "$UNIT: rebooting the host now — capture resumes on boot (the unit is enabled)"
    # `systemctl reboot` rather than `shutdown -r`: no wall broadcast, no one-minute delay, and it is the
    # same mechanism the deadman timer path already relies on being present.
    systemctl reboot || exit 1
    ;;
  deploy)
    # RUN THE UPDATER OUTSIDE THE CAPTURE DAEMON'S MOUNT NAMESPACE. This verb exists only because of
    # that namespace; everything else about the deploy already worked.
    #
    # ⚠️ THE BUG THIS FIXES, because it is not the one it looks like. The capture unit sets
    # `ProtectSystem=strict` with `ReadWritePaths=/srv/tepna /opt/tepna/capture-host` — so `/opt/tepna/.git`
    # is READ-ONLY to anything the daemon spawns, and `git fetch` dies on `.git/FETCH_HEAD:
    # Read-only file system`. Measured 2026-08-14 the first time the Deploy button was pressed on the box.
    #
    # SUDO DOES NOT FIX IT, and that is the part worth remembering: a mount namespace is not escaped by
    # privilege. Running the updater as root inside the daemon's namespace hits exactly the same
    # read-only mount. What escapes is asking PID 1 for a NEW unit, which starts outside that namespace
    # — and PID 1 is reachable from inside the sandbox (the `reload` verb's `daemon-reload` proves it;
    # only the filesystem is restricted, not the bus).
    #
    # `--uid=vigil` KEEPS THE UPDATER UNPRIVILEGED, which was always the real invariant. tepna-update.sh
    # refuses to install /etc precisely so it never needs root, and that is unchanged here: this verb is
    # root only long enough to ask systemd for a namespace, and the script itself runs as the capture
    # user exactly as the timer runs it.
    #
    # `--pipe --wait` returns the updater's own output AND its exit code, so the caller gets the report
    # rather than "started". `--collect` reaps the transient unit so a previous run cannot block the
    # next with "unit already loaded" — the failure tepna-restart.sh's own `stop` verb hit on 2026-08-02.
    [ -x "$REPO_DIR/capture-host/tepna-update.sh" ] || exit 1
    systemd-run --quiet --pipe --wait --collect --uid=vigil --unit=tepna-deploy-now \
      "$REPO_DIR/capture-host/tepna-update.sh" --no-restart || exit 1
    ;;
  radio)
    # A DEAF RADIO IS NOT A DOWN RADIO. On 2026-07-30 hci0 reported `UP RUNNING` with 332 MB of
    # lifetime traffic while a 20 s scan saw ZERO advertisements — in a house that always has dozens.
    # Every sensor timed out identically, which `classify_adapter_health` correctly cannot separate
    # from "nobody is wearing them", so the adapter watchdog never fired and ~20 min of a night was
    # lost until a human restarted bluetoothd by hand.
    #
    # Restarting the SERVICE is the cheap rung: it re-initialises the controller without touching USB
    # power, and it is what actually recovered the box that night (0 -> 91 devices seen). A dongle that
    # survives this still needs a physical replug, which no script can do.
    systemctl restart bluetooth || exit 1
    sleep 5
    state=$(systemctl is-active bluetooth 2>/dev/null)
    echo "bluetooth: $state"
    [ "$state" = active ] || exit 1
    ;;
  *) usage ;;
esac
