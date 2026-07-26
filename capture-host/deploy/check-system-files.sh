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
# ── WHY IT IS A CHECKER AND NOT A FIXER ────────────────────────────────────────────────────────────
# Because syncing one of these files would BREAK THE BOX, and that is not hypothetical:
#
#     repo  tepna-capture.service :  User=tepna  Group=tepna  ReadWritePaths=/srv/tepna
#     box   /etc/systemd/system/  :  User=vigil  Group=vigil  ReadWritePaths=/srv/tepna /opt/tepna/capture-host
#
# `id tepna` on this box: no such user. Installing the repo copy would leave capture unable to start,
# and would revoke the write access webmon needs to save config.yaml. install-services.sh does not even
# read the repo copy — it installs from $HOME, which is where the working version was hand-edited.
#
# So the files are classified, and the classification is the whole value of this script:
#
#   MANAGED    identical everywhere, no site-specific content. Drift is a BUG. --install copies them.
#   TEMPLATED  deliberately site-specific (user, group, writable paths). Byte-equality is the WRONG
#              test; it is compared with those keys normalised away, so a genuine change to the rest
#              of the unit is still caught while the intended customisation is not reported as rot.
#              NEVER written by this script.
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
systemd/tepna-capture.service|$ETC_SYSTEMD/tepna-capture.service|TEMPLATED
"

# Keys a site is EXPECTED to set for itself. Normalised before comparing a TEMPLATED file so the
# intended customisation is invisible and everything else still shows.
norm() {
  sed -E 's/^(User|Group|ReadWritePaths|ExecStart|WorkingDirectory|Environment)=.*/\1=<site>/' "$1" \
    | sed -E '/^\s*#/d; /^\s*$/d'
}

drift=0 managed=0 templated=0 missing=0 installed=0
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

  if [ "$cls" = "TEMPLATED" ]; then
    templated=$((templated + 1))
    if diff -q <(norm "$src") <(norm "$dest") >/dev/null 2>&1; then
      printf '  %-38s %-10s %s\n' "$name" "$cls" "✓ same but for site keys"
    else
      printf '  %-38s %-10s %s\n' "$name" "$cls" "✗ DRIFTED beyond the site keys"
      diff <(norm "$src") <(norm "$dest") 2>/dev/null | head -8 | sed 's/^/        /'
      drift=$((drift + 1))
    fi
    continue
  fi

  managed=$((managed + 1))
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
echo "  $managed managed, $templated templated, $drift drifted"
[ "$drift" -eq 0 ] || exit 1
exit 0
