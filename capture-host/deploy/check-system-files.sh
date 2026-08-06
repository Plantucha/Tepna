#!/usr/bin/env bash
# tepna-capture — deploy/check-system-files.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# IS WHAT /etc IS RUNNING THE SAME AS WHAT THE REPO SAYS?
#
#   bash check-system-files.sh            report drift, exit 1 if any MANAGED file differs
#   sudo bash check-system-files.sh --install    copy the MANAGED files into place (never the rest)
#
# ── WHY ────────────────────────────────────────────────────────────────────────────────────────────
# Three files are copied by hand into system directories and then nothing ever compares them again.
# They rot exactly like /srv/tepna/app did (fixed 2026-07-26 by sync-apps.sh, same day, one directory
# over): on that date the installed udev rule was TWO fixes behind the repo, and the box had spent the
# evening with a hot-plugged adapter unprotected because of it. Nothing said so — `systemctl status`
# was green, the file was present, and its content was a day old.
#
# ── WHY IT ONLY INSTALLS WHAT THE REPO OWNS ────────────────────────────────────────────────────────
# This started life with two classes, MANAGED and TEMPLATED, on the belief that `tepna-capture.service`
# could not be installed from the repo because the repo's copy said `User=tepna` and no such user
# exists on this box. That belief was WRONG, and the way it was wrong is the lesson:
#
#     capture-host/systemd/tepna-capture.service   User=tepna    <- what this script was comparing
#                                                                   (DELETED 2026-08-05 — see below)
#     capture-host/deploy/tepna-capture.service    User=vigil    <- what is actually installed
#     /home/vigil/tepna-capture.service            (a day stale) <- what install-services.sh installed
#
# THREE files, one unit. The repo already carried a correct, committed site copy under deploy/, so
# nothing needed templating — and the TEMPLATED comparison, which normalises User/Group/ReadWritePaths
# away, papered over the difference between two SOURCES and reported "same but for site keys" about a
# file nobody installs. A checker watching the wrong source is worse than no checker.
#
# So TEMPLATED is GONE. Every file here is MANAGED: byte-compared against the copy that is actually
# installed, and installable with --install. If a future site genuinely needs different content, it
# edits the deploy/ copy — which is still just a managed file, in version control, byte-checked.
#
# What replaces it is `ambiguous()`: a managed file with a second, DIFFERENT copy anywhere in the repo
# is reported LOUD and exits non-zero, whether or not /etc currently matches. Two files with one name
# is the condition that produced this bug, and it must never be silent again.
#
# ── AND THEN IT FIRED, ON THE REAL BOX, FOREVER (2026-08-05) ───────────────────────────────────────
# `ambiguous()` was right and the repo was wrong: `systemd/tepna-capture.service` (User=tepna, installed
# by nobody) and `deploy/tepna-capture.service` (User=vigil, installed by install-services.sh) were both
# still present, so every run on vigil printed nine ✓ rows and then exited 1 on a permanent condition —
# `9 managed, 1 drifted, 1 AMBIGUOUS` with nothing actually stale. The duplicate is now DELETED and its
# unique documentation merged into the deploy/ copy.
#
# The lesson is about the REMEDY, not the detector: a gate whose red cannot be cleared by any action
# stops being read, which is the same "machinery that exists without exercising anything" failure this
# script was written to end. If `ambiguous()` fires, DELETE A FILE — do not add an exemption.
set -uo pipefail

SRC="${TEPNA_SRC:-$(cd "$(dirname "$0")/.." && pwd)}"          # …/capture-host
ETC_SYSTEMD="${TEPNA_ETC_SYSTEMD:-/etc/systemd/system}"
ETC_UDEV="${TEPNA_ETC_UDEV:-/etc/udev/rules.d}"
ETC_NETWORKD="${TEPNA_ETC_NETWORKD:-/etc/systemd/network}"
# helper_path.SYSTEM_DIRS[0] — the ROOT-OWNED copies that hold the NOPASSWD sudoers grants, and the
# ones `helper_path.resolve()` returns in preference to the in-repo copy.
LIB_TEPNA="${TEPNA_LIB_DIR:-/usr/local/lib/tepna}"
INSTALL=0
[ "${1:-}" = "--install" ] && INSTALL=1

# file | destination | class | mode (optional, default 0644)
#
# ⚠️ THE MODE COLUMN IS LOAD-BEARING, added 2026-08-04. The four root helpers below are EXECUTABLE
# scripts reached through scoped NOPASSWD sudoers grants (`sudo -n /usr/local/lib/tepna/<x>.sh …`).
# Both install sites used to force `install -m 0644`, so the moment any helper drifted, `--install`
# would "repair" it into a NON-EXECUTABLE file and break every one of those grants — including
# tepna-restart.sh, the one thing that lets a deploy finish itself without an interactive password.
# That is strictly worse than the drift it repairs, and it became reachable the moment these files
# were made MANAGED. A file that is installed must be installed with the mode it needs to work.
MANIFEST="
systemd/99-tepna-btdongle.rules|$ETC_UDEV/99-tepna-btdongle.rules|MANAGED|0644
systemd/tepna-usb-autosuspend.service|$ETC_SYSTEMD/tepna-usb-autosuspend.service|MANAGED|0644
deploy/tepna-capture.service|$ETC_SYSTEMD/tepna-capture.service|MANAGED|0644
systemd/tepna-update.service|$ETC_SYSTEMD/tepna-update.service|MANAGED|0644
systemd/tepna-update.timer|$ETC_SYSTEMD/tepna-update.timer|MANAGED|0644
tepna-clock.sh|$LIB_TEPNA/tepna-clock.sh|MANAGED|0755
tepna-restart.sh|$LIB_TEPNA/tepna-restart.sh|MANAGED|0755
tepna-rssi.sh|$LIB_TEPNA/tepna-rssi.sh|MANAGED|0755
tepna-usbreset.sh|$LIB_TEPNA/tepna-usbreset.sh|MANAGED|0755
tepna-btreset.sh|$LIB_TEPNA/tepna-btreset.sh|MANAGED|0755
"

# A managed file with a second, DIFFERENT copy somewhere else in the repo means "which one is the
# source?" has more than one answer — exactly the condition that made this script's first green a lie
# (see the header). Reported per file, always, whether or not /etc currently matches.
ambiguous() {
  local rel="$1" name twin found=""
  name="$(basename "$rel")"
  while IFS= read -r twin; do
    [ "$twin" = "$SRC/$rel" ] && continue
    cmp -s "$SRC/$rel" "$twin" || found="$found $twin"
  done < <(find "$SRC" -type f -name "$name" 2>/dev/null)
  if [ -n "$found" ]; then
    printf '      \u26a0 AMBIGUOUS SOURCE — a different copy of %s also exists:%s\n' "$name" "$found"
    return 1
  fi
  return 0
}

drift=0 managed=0 missing=0 installed=0 ambig=0
printf '  %-38s %-10s %s\n' "file" "class" "state"
while IFS='|' read -r rel dest cls mode; do
  [ -n "$rel" ] || continue
  mode="${mode:-0644}"
  src="$SRC/$rel"
  name="$(basename "$rel")"
  if [ ! -f "$src" ]; then
    printf '  %-38s %-10s %s\n' "$name" "$cls" "✗ MISSING FROM REPO"
    missing=$((missing + 1)); drift=$((drift + 1)); continue
  fi
  if [ ! -f "$dest" ]; then
    printf '  %-38s %-10s %s\n' "$name" "$cls" "✗ NOT INSTALLED  → $dest"
    missing=$((missing + 1)); drift=$((drift + 1))
    if [ "$INSTALL" = "1" ] && [ "$cls" = "MANAGED" ]; then
      install -D -m "$mode" "$src" "$dest" && { echo "      installed"; installed=$((installed + 1)); }
    fi
    continue
  fi

  managed=$((managed + 1))
  # An ambiguous source counts as drift (below) and forces exit 1 — so it MUST NOT also print
  # "in sync". Until 2026-08-04 it did: the table said ✓ for a file the summary counted as drifted,
  # which on the real box read as "3 managed, 1 drifted" with EVERY ROW GREEN and nothing to point at.
  amb=""
  ambiguous "$rel" || { ambig=$((ambig + 1)); drift=$((drift + 1)); amb="  ⚠ ambiguous source"; }
  if cmp -s "$src" "$dest"; then
    printf '  %-38s %-10s %s\n' "$name" "$cls" "✓ content in sync$amb"
  else
    printf '  %-38s %-10s %s\n' "$name" "$cls" "✗ STALE — /etc differs from the repo"
    drift=$((drift + 1))
    if [ "$INSTALL" = "1" ]; then
      if install -D -m "$mode" "$src" "$dest"; then
        echo "      installed"
        installed=$((installed + 1))
      else
        echo "      ✗ install failed (need root?)"
      fi
    fi
  fi
done <<< "$MANIFEST"

echo
if [ "$INSTALL" = "1" ] && [ "$installed" -gt 0 ]; then
  # Reload only what was actually replaced. Both are safe while capture runs: udev rules apply to
  # FUTURE events, and daemon-reload re-reads unit files without restarting anything.
  #
  # ...AND ONLY WHEN WE INSTALLED INTO THE REAL HOST PATHS (CAPTURE-HOST-DEEP-AUDIT §E6). These ran
  # unconditionally on any install, while TEPNA_ETC_SYSTEMD/TEPNA_ETC_UDEV exist precisely so a caller
  # can install SOMEWHERE ELSE — which is exactly what tests/test_deploy_sync_apps.py does. So the test
  # suite installed into a tmpdir and then reloaded the developer's OWN systemd; on a desktop that is a
  # blocking polkit password dialog, hidden from pytest output by the `2>/dev/null` below. Measured: 14
  # prompts in 20 minutes, pytest blocked on each until cancelled.
  #
  #   polkitd: Operator of unix-session:3 FAILED to authenticate to gain authorization for action
  #   org.freedesktop.systemd1.reload-daemon ... [systemctl daemon-reload] (owned by unix-user:michal)
  #
  # A redirected install has no business touching host state. Each reload is gated on ITS OWN path so a
  # partial redirect cannot leak either.
  if [ "$ETC_UDEV" = "/etc/udev/rules.d" ]; then
    udevadm control --reload-rules 2>/dev/null && echo "  udev rules reloaded"
  else
    echo "  udev NOT reloaded — installed to $ETC_UDEV, not the host path"
  fi
  # networkd only re-reads .network files on reload, and reloading it does NOT disturb an established
  # link — the wired uplink keeps its lease. Gated on the real host path for the same reason as the
  # other two: a redirected install has no business touching host state.
  if [ "$ETC_NETWORKD" = "/etc/systemd/network" ]; then
    networkctl reload 2>/dev/null && echo "  networkd config reloaded"
  else
    echo "  networkd NOT reloaded — installed to $ETC_NETWORKD, not the host path"
  fi
  if [ "$ETC_SYSTEMD" = "/etc/systemd/system" ]; then
    systemctl daemon-reload 2>/dev/null && echo "  systemd units reloaded"
  else
    echo "  systemd NOT reloaded — installed to $ETC_SYSTEMD, not the host path"
  fi
  echo "  $installed file(s) installed — nothing restarted, so a running capture is untouched"
fi
echo "  $managed managed, $drift drifted$([ "$ambig" -gt 0 ] && echo ", $ambig AMBIGUOUS")"
[ "$drift" -eq 0 ] || exit 1
exit 0
