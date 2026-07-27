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
set -uo pipefail

SRC="${TEPNA_SRC:-$(cd "$(dirname "$0")/.." && pwd)}"          # …/capture-host
ETC_SYSTEMD="${TEPNA_ETC_SYSTEMD:-/etc/systemd/system}"
ETC_UDEV="${TEPNA_ETC_UDEV:-/etc/udev/rules.d}"
INSTALL=0
[ "${1:-}" = "--install" ] && INSTALL=1

# file | destination | class
MANIFEST="
systemd/99-tepna-btdongle.rules|$ETC_UDEV/99-tepna-btdongle.rules|MANAGED
systemd/tepna-usb-autosuspend.service|$ETC_SYSTEMD/tepna-usb-autosuspend.service|MANAGED
deploy/tepna-capture.service|$ETC_SYSTEMD/tepna-capture.service|MANAGED
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
while IFS='|' read -r rel dest cls; do
  [ -n "$rel" ] || continue
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
      install -m 0644 "$src" "$dest" && { echo "      installed"; installed=$((installed + 1)); }
    fi
    continue
  fi

  managed=$((managed + 1))
  ambiguous "$rel" || { ambig=$((ambig + 1)); drift=$((drift + 1)); }
  if cmp -s "$src" "$dest"; then
    printf '  %-38s %-10s %s\n' "$name" "$cls" "✓ in sync"
  else
    printf '  %-38s %-10s %s\n' "$name" "$cls" "✗ STALE — /etc differs from the repo"
    drift=$((drift + 1))
    if [ "$INSTALL" = "1" ]; then
      if install -m 0644 "$src" "$dest"; then
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
  udevadm control --reload-rules 2>/dev/null && echo "  udev rules reloaded"
  systemctl daemon-reload 2>/dev/null && echo "  systemd units reloaded"
  echo "  $installed file(s) installed — nothing restarted, so a running capture is untouched"
fi
echo "  $managed managed, $drift drifted$([ "$ambig" -gt 0 ] && echo ", $ambig AMBIGUOUS")"
[ "$drift" -eq 0 ] || exit 1
exit 0
