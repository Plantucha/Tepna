#!/usr/bin/env bash
# tepna-update.sh — Tepna Vigil
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Finish a deploy without a human. Runs UNPRIVILEGED, as `vigil`, on a timer.
#
# WHY THIS EXISTS. Three measured staleness events, one class — a deploy step that needs a person does
# not happen (VIGIL-AUTO-UPDATE §1):
#   • 2026-07-30  the daemon served the pre-fix build; the restart wanted a password nobody was awake to type
#   • 2026-08-03  the daemon ran FOUR DAYS of stale code — the pull had happened, nothing restarted the unit
#   • 2026-08-04  #914's root helpers sat eight days behind the checkout, unnoticed
# Note that automating `git pull` ALONE fixes none of the three. The pull was never the missing step.
#
# WHY IT DOES NOT RUN AS ROOT, AND WILL NOT INSTALL /etc. `deploy-vigil.sh` runs
# `sudo bash $DEST/…/check-system-files.sh --install`, which is fine when a human types it after a pull
# they initiated, and is a root-executes-freshly-pulled-repo-code path on a SCHEDULE. It fails both
# halves of the rule already written in tepna-restart.sh's header — a NOPASSWD grant must name something
# the granted user CANNOT rewrite, and must not be general-purpose — because `vigil` can rewrite
# /opt/tepna, and `--install` writes arbitrary repo bytes into /etc and /usr/local/lib, including the
# unit file and the granted helpers themselves. A compromise of the capture user would become root by
# waiting for the next tick.
#
# So: this automates only what fits through the ONE narrow grant that already exists (tepna-restart.sh,
# which names a single unit), and REPORTS everything whose blast radius is root. That still closes the
# first two events outright and makes the third visible — which is what was missing, since #914's drift
# was silent for eight days, not unfixable.
set -uo pipefail

REPO_DIR="${TEPNA_REPO_DIR:-/opt/tepna}"
STATUS_JSON="${TEPNA_STATUS_JSON:-/srv/tepna/captures/status.json}"
RESTART_SH="${TEPNA_RESTART_SH:-/usr/local/lib/tepna/tepna-restart.sh}"
# WHAT THE RUNNING DAEMON IS ACTUALLY ON.
#
# 🔴 NOT /run — THIS SERVICE RUNS AS `vigil`, AND /run IS root-OWNED 0755.
# The first version of this line used /run/tepna-deployed-sha and reasoned about ProtectSystem=strict
# making /run read-only. That reasoning is TRUE OF THE CAPTURE DAEMON and irrelevant here:
# `tepna-update.service` has ProtectSystem=no and no sandbox at all. The real reason /run failed is far
# more ordinary — plain Unix permissions — and the effect was that the marker was never written, so the
# debt was never recorded and the deferred-restart fix was INERT. Measured on vigil 2026-08-30, on the
# very first deploy after it shipped:
#
#     /opt/tepna/capture-host/tepna-update.sh: line 209: /run/tepna-deployed-sha: Permission denied
#     WARN: could not record the deployed SHA at /run/tepna-deployed-sha
#
# It degraded safely — the warning fires and the script behaves as it did before — which is exactly why
# it could have gone unnoticed: nothing broke, a fix simply did not work.
#
# `/srv/tepna` is this service's own data root and is vigil-writable. The tradeoff is that the marker is
# now PERSISTENT rather than tmpfs, so it survives a reboot that the daemon also survived — costing at
# most ONE redundant restart into identical code, which `test_A_STALE_MARKER_FROM_AN_OUTSIDE_RESTART…`
# already bounds. A wrong restart that is bounded beats a fix that never runs.
#
# ⚠️ It must NOT live inside $REPO_DIR: §1's cleanliness check (`git status --porcelain`) would see it
# and refuse to update at all. That part of the original reasoning was right and still applies.
DEPLOYED_MARK="${TEPNA_DEPLOYED_MARK:-/srv/tepna/.tepna-deployed-sha}"
# CONSECUTIVE-FAILURE STATE — what makes a 9.3-hour outage look different from a blip.
#
# `systemctl status` shows `failed` identically for "failed once, the next tick recovered" and "failing
# every tick since Tuesday". Measured over 30 days of `journalctl -u tepna-update` (2026-08-18):
# 38 failure events against 300 success/defer, in consecutive runs of [30, 5, 3] — the longest spanning
# 2026-08-04 22:00:37 → 07:20:44, i.e. 9.3 hours in which the box could not update. Nobody noticed,
# because there was nothing to notice: every tick logged exactly what a single transient failure logs.
#
# Same directory and the same reasoning as DEPLOYED_MARK above — vigil-writable, NOT /run (root-owned
# 0755, which is what made the deployed-SHA marker inert), and NOT inside $REPO_DIR (§1's cleanliness
# check would see it and refuse to update at all).
FAIL_MARK="${TEPNA_FAIL_MARK:-/srv/tepna/.tepna-update-fails}"
# A recording that has not been heard from in this long means the DAEMON is gone, not that the box is
# idle — see the fail-safe in `recording_state`.
MAX_STATUS_AGE="${TEPNA_MAX_STATUS_AGE:-60}"
BRANCH="${TEPNA_BRANCH:-main}"
# The privilege seam, named so a test can substitute it. `sudo -n` NEVER prompts: an unattended timer
# that blocks on a password is the 2026-07-30 failure wearing a different hat, so a missing grant must
# fail loudly and immediately rather than hang until the timeout.
read -r -a SUDO <<<"${TEPNA_SUDO:-sudo -n}"

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- consecutive-failure accounting (see FAIL_MARK) ---------------------------------------------
# 🔴 KEYED ON THE EXIT STATUS, NOT ON `die`. The foot of this script does `exit "$drifted"`, so a run
# can leave the unit `failed` without ever calling `die` — and that path, "cannot establish whether the
# box is recording", is precisely the one that can persist for a whole night. A counter hung off `die`
# would have counted every kind of failure except the longest-running kind.
#
# The marker holds `<count> <epoch of the FIRST failure in the streak>`. Malformed content reads as
# "no streak" rather than aborting the update: this is an observability aid, and it must never be the
# reason the box stops updating.
# shellcheck disable=SC2329  # reached through the EXIT trap below, which shellcheck's
# reachability analysis does not follow (nor into the calls this makes).
_streak_read() {
  local n first
  read -r n first < "$FAIL_MARK" 2>/dev/null || { printf '0 0\n'; return; }
  case "$n"     in ''|*[!0-9]*) printf '0 0\n'; return ;; esac
  case "$first" in ''|*[!0-9]*) printf '0 0\n'; return ;; esac
  printf '%s %s\n' "$n" "$first"
}

# Timestamps are rendered in the box's LOCAL civil time on purpose: journalctl stamps its own lines the
# same way, and these lines exist to be read against them in one view. (The Clock Contract's floating-
# UTC rule governs recorded SIGNAL time, where a viewer's zone must not change what is displayed; this
# is an operator log line about this box, compared only against this box's own journal.)
# shellcheck disable=SC2329  # reached through the EXIT trap below, which shellcheck's
# reachability analysis does not follow (nor into the calls this makes).
_streak_stamp() { date -d "@$1" '+%F %T' 2>/dev/null || printf 'unknown'; }

# shellcheck disable=SC2329  # reached through the EXIT trap below, which shellcheck's
# reachability analysis does not follow (nor into the calls this makes).
_streak_finish() {
  local ec=$?
  local n first now elapsed h m
  read -r n first <<<"$(_streak_read)"
  now="$(date +%s)"
  elapsed=$(( now - first )); h=$(( elapsed / 3600 )); m=$(( (elapsed % 3600) / 60 ))

  if [ "$ec" = 0 ]; then
    # The recovery line is the other half of the ask. A per-tick failure line can only say "again";
    # whoever reads the journal AFTER an outage needs to see how long it actually lasted, and by then
    # every failing tick is behind them.
    [ "$n" -gt 0 ] && say "recovered after ${n} consecutive failed run(s) spanning ${h}h${m}m — first failed at $(_streak_stamp "$first")"
    rm -f "$FAIL_MARK" 2>/dev/null || warn "could not clear the failure streak at $FAIL_MARK"
    return 0
  fi

  n=$(( n + 1 ))
  if [ "$n" -le 1 ]; then first="$now"; h=0; m=0; fi
  printf '%s %s\n' "$n" "$first" > "$FAIL_MARK" 2>/dev/null \
    || warn "could not record the failure streak at $FAIL_MARK"
  # A FIRST failure reports nothing extra: it is already visible, and the distinction this exists to
  # draw does not exist yet. From the second onward the streak is named, so the line answers "since
  # when" and not merely "again".
  [ "$n" -gt 1 ] && warn "this is failure ${n} IN A ROW, spanning ${h}h${m}m — first failed at $(_streak_stamp "$first")"
  return 0
}
# Installed before the MODE check, so every nonzero exit counts — including a hand-typed usage error.
# That can only ever OVER-count, and over-counting is the safe direction: the failure being fixed is an
# outage that reported nothing at all, and the very next successful run clears the marker.
trap _streak_finish EXIT

# --- the restart MODE -------------------------------------------------------------------------
# The timer passes nothing and gets the original behaviour. The two explicit modes exist for the
# monitor's "Deploy now" button, which needs the two things a timer never does: to SEE the report
# (so it runs --no-restart and hands the decision back to the operator), and to be able to override
# the recording interlock deliberately (--force-restart) rather than wait up to an hour.
#
# ⚠️ `--no-restart` IS THE BUTTON'S DEFAULT MODE, and that is the point. This script restarts the
# daemon when the box is idle — which would kill the web server serving the button's response, so a
# deploy that WORKED would present as a dropped connection. Reporting "a restart is owed" and letting
# the operator press Restart is two clicks that never lie about what happened.
MODE="${1-auto}"
case "$MODE" in
  auto|--no-restart|--force-restart) ;;
  *) die "usage: $0 [--no-restart|--force-restart]" ;;
esac

# --- the recording interlock -------------------------------------------------------------------
# Prints one of: recording | idle | unknown:<why>
#
# EVERY non-answer is `unknown`, and `unknown` blocks the restart. A missing, stale, truncated or
# unparseable status.json is not evidence of an idle box; it is the absence of evidence, and the cost of
# being wrong is a destroyed night against the benefit of waiting one hour. `capture.py` rewrites this
# file every 10 s unconditionally (not on the alert interval, which is optional), so `stale` really does
# mean the daemon is not running — and a daemon that is not running is one whose state we cannot see.
recording_state() {
  [ -r "$STATUS_JSON" ] || { echo "unknown:no status.json at $STATUS_JSON"; return; }
  TEPNA_MAX_STATUS_AGE="$MAX_STATUS_AGE" python3 - "$STATUS_JSON" <<'PY' 2>/dev/null || echo "unknown:status.json unreadable or malformed"
import json, os, sys, time
p = sys.argv[1]
with open(p) as f:
    d = json.load(f)
age = time.time() - os.path.getmtime(p)
limit = float(os.environ["TEPNA_MAX_STATUS_AGE"])
if age > limit:
    print("unknown:status.json is %.0fs old (> %.0fs) — the daemon is not writing it" % (age, limit))
    sys.exit(0)
devs = d.get("devices")
if not isinstance(devs, dict):
    print("unknown:status.json has no devices map")
    sys.exit(0)
# The top-level flag is what capture.py publishes; the per-device map is the cross-check. Requiring the
# key to be PRESENT is deliberate — an older daemon that predates it must read as unknown, not idle.
missing = [n for n, v in devs.items() if not isinstance(v, dict) or "recording" not in v]
if missing or "recording" not in d:
    print("unknown:this daemon does not publish `recording` (%d device(s)) — deploy the capture fix first"
          % len(missing))
    sys.exit(0)
live = [n for n, v in devs.items() if v.get("recording")]
print("recording" if (live or d.get("recording")) else "idle")
PY
}

# --- 1 · never clobber work done on the box ----------------------------------------------------
[ -d "$REPO_DIR/.git" ] || die "no git checkout at $REPO_DIR"
# Measure the TREE, not the ref (CLAUDE.md §2b — a ref comparison read 0 while the tree was 214 files
# stale, and it answers a different question than the one being asked).
dirty="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)"
[ -z "$dirty" ] || die "$REPO_DIR has uncommitted changes — refusing to touch it:
$dirty"
on="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ "$on" = "$BRANCH" ] || die "$REPO_DIR is on '$on', not '$BRANCH' — refusing to update"

# --- 2 · fast-forward only ---------------------------------------------------------------------
before="$(git -C "$REPO_DIR" rev-parse HEAD)"
git -C "$REPO_DIR" fetch -q origin "$BRANCH" || die "fetch failed"
# --ff-only, never merge or reset: this must be incapable of inventing a tree that exists nowhere else.
git -C "$REPO_DIR" merge -q --ff-only "origin/$BRANCH" || die "not a fast-forward — $REPO_DIR has diverged from origin/$BRANCH"
after="$(git -C "$REPO_DIR" rev-parse HEAD)"

drifted=0
if [ "$before" = "$after" ]; then
  say "up to date at ${after:0:12} — nothing to do"
else
  say "updated ${before:0:12} → ${after:0:12}"

  # --- 3 · a git pull is only HALF a deploy: the bundles are served separately ------------------
  if [ -x "$REPO_DIR/capture-host/deploy/sync-apps.sh" ]; then
    bash "$REPO_DIR/capture-host/deploy/sync-apps.sh" || { warn "bundle sync FAILED — the served apps are now older than the code"; drifted=1; }
  fi
fi

# --- 4 · report /etc + root-helper drift; NEVER install it (see the header) --------------------
# Runs on every tick, not only after a move: #914's drift appeared without this checkout changing at all.
if [ -x "$REPO_DIR/capture-host/deploy/check-system-files.sh" ]; then
  if ! out="$(bash "$REPO_DIR/capture-host/deploy/check-system-files.sh" 2>&1)"; then
    drifted=1
    warn "/etc or /usr/local/lib drift — a HUMAN must run check-system-files.sh --install:"
    printf '%s\n' "$out" >&2
  fi
fi

# --- 5 · restart, but only into an idle box ----------------------------------------------------
# 🔴 "RESTART OWED" IS A STATE, NOT AN EVENT, AND THIS LINE USED TO TEST FOR THE EVENT.
# `before = after` means "I merged nothing THIS TICK". It does not mean the daemon is running the code
# on disk, and the difference is the whole failure this script was written to end. A tick that merges
# and then DEFERS (box recording) leaves new code on disk and the old process serving it; every later
# tick then finds `before = after`, concludes "nothing to do", and never comes back. The deferral
# branch's own comment promised the opposite — "the next tick will take it once the night ends" — and
# the next tick could not, because it no longer had any way to know a restart was outstanding.
#
# Measured on vigil 2026-08-30: merged-and-deferred at 00:27 and again at 01:31, then TEN consecutive
# ticks reporting "up to date — nothing to do" while the daemon ran the pre-merge build. It was only
# rescued at 12:30 by the cron WATCHDOG restarting for an unrelated health reason — luck, not design.
# That is the same shape as the 2026-08-03 event in this file's own header (four days of stale code,
# "the pull had happened, nothing restarted the unit"), re-entered through the deferral path.
#
# So the question is now the honest one: is the daemon on the checkout? `$DEPLOYED_MARK` records the
# SHA the daemon is actually running — written on a successful restart, and written on a DEFERRAL too
# (recording `$before`, the code the daemon keeps), so the outstanding restart survives into the next
# tick instead of evaporating with the variable that described it.
# What the DAEMON is on, which is not `$before` once a deferral is outstanding. On a repeat deferral
# `before` equals `after` (nothing merged this tick), so deferring with `$before` would write the DISK
# sha and silently mark the debt paid — re-creating the bug one level down. The marker, when it holds
# anything, is the authority on what the process is running.
running_sha="$before"
if [ -s "$DEPLOYED_MARK" ]; then
  running_sha="$(cat "$DEPLOYED_MARK" 2>/dev/null)"
fi

restart_owed=0
if [ "$before" != "$after" ]; then
  restart_owed=1                         # merged this tick
elif [ -n "$running_sha" ] && [ "$running_sha" != "$after" ]; then
  restart_owed=1                         # an earlier tick merged and deferred; still owed
  say "restart still OWED from an earlier tick — the daemon is on ${running_sha:0:12}, disk is at ${after:0:12}"
fi

if [ "$restart_owed" = 0 ]; then
  :                                      # the daemon is on the checkout — nothing to restart into
elif [ "$MODE" = "--no-restart" ]; then
  # A MACHINE-READABLE MARKER, because the caller must branch on this. Prose alone would make the API
  # parse an English sentence — the coupling that breaks the next time the wording improves.
  say "RESTART-OWED — new code is on disk and the daemon is still running the old build"
else
  state="$(recording_state)"
  forced=0
  if [ "$MODE" = "--force-restart" ] && [ "$state" != idle ]; then
    # Say what is being overridden rather than silently calling the box idle. A forced restart during a
    # recording is a legitimate operator decision; hiding which interlock it stepped over would make
    # the log unreadable afterwards — and this log is the only witness on a box nobody logs into.
    #
    # `forced` is carried SEPARATELY from `state` even though setting state=idle alone would reach the
    # right branch. It would also make the next line print "box is idle" about a box that is recording —
    # a log that contradicts the line above it, in the one record of why a night was cut short.
    say "forcing a restart despite: $state"
    forced=1
    state=idle
  fi
  case "$state" in
    idle)
      [ -x "$RESTART_SH" ] || die "new code is on disk but $RESTART_SH is missing — cannot complete the deploy"
      if [ "$forced" = 1 ]; then
        say "restarting the daemon — FORCED, the box was not idle"
      else
        say "box is idle — restarting the daemon"
      fi
      # tepna-restart.sh already confirms the unit came back (it sleeps, then checks is-active) and
      # reports a failed restart as a failure, so this does not need to re-check and must not assume.
      "${SUDO[@]}" "$RESTART_SH" restart || die "restart FAILED — the box is now running NEW code on disk with the OLD process, which is the exact state this script exists to prevent"
      printf '%s\n' "$after" > "$DEPLOYED_MARK" 2>/dev/null || warn "could not record the deployed SHA at $DEPLOYED_MARK"
      say "daemon restarted on ${after:0:12}"
      ;;
    recording)
      # NOT an error, and must never be reported as one: deferring is this script working. The code is
      # on disk and the next tick will take it once the night ends.
      # Record what the daemon is STILL on, so the next tick can see the debt. Without this write the
      # deferral is indistinguishable from having nothing to do, which is precisely how it was lost.
      printf '%s\n' "$running_sha" > "$DEPLOYED_MARK" 2>/dev/null || warn "could not record the deployed SHA at $DEPLOYED_MARK"
      say "deferred — a device is recording; the daemon keeps the old code until the box is idle"
      ;;
    *)
      printf '%s\n' "$running_sha" > "$DEPLOYED_MARK" 2>/dev/null || true
      warn "deferred — cannot establish whether the box is recording (${state#unknown:}); refusing to restart blind"
      drifted=1
      ;;
  esac
fi

# A nonzero exit puts the unit in `failed`, which is the whole point: it is the one thing that makes
# root-level drift VISIBLE on a box nobody logs into. Silent success is the failure class this replaces.
exit "$drifted"
