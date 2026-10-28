#!/usr/bin/env bash
# tepna-sysfiles.sh — Tepna Vigil
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Install the MANAGED /etc and /usr/local/lib/tepna files without a password — FROM GITHUB, never from
# the checkout. Owner ruling 2026-10-12, option (A) of VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14 §2a:
# "make this script nopasswd sudo so it can run automatically when drifting".
#
# WHY NOT A GRANT ON check-system-files.sh. `vigil` owns /opt/tepna. A NOPASSWD grant on the in-repo
# script lets anything running as `vigil` rewrite it and run it as root. Even a root-owned copy that
# installs FROM /opt/tepna lets `vigil` edit tepna-capture.service in the checkout and have root put it
# in /etc. So this helper never executes or installs a byte of the checkout:
#   1. It reads ONE thing from the checkout, as `vigil`: the commit it is on (40 hex, validated).
#   2. It clones REMOTE (a constant) into a root-only temp dir, and refuses unless that commit is on
#      `main` within the last DEPTH commits. A pull-request commit is fetchable from GitHub by sha but
#      is not on `main`, so the caller cannot choose unreviewed code.
#   3. It runs the CLONE's check-system-files.sh. That script's MANIFEST is the filename allowlist.
#      sudoers is not in it, so a sudoers change stays a human act.
#
# The trust anchor is `origin/main`, which already decides every line the box runs. The residual the
# owner accepted: a bad merge or a stolen push token reaches root here without a person in the loop.
#
# THE OVERRIDES ARE READ ONLY WHEN NOT ROOT. Tests drive this as an ordinary user with a local
# upstream. Under sudo every value is the constant below, whatever the environment says.
set -uo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077

REMOTE=https://github.com/Plantucha/Tepna.git
BRANCH=main
CHECKOUT=/opt/tepna
CHECKOUT_USER=vigil
DEPTH=200
TMP_PARENT=/var/tmp
LOCK=/run/tepna-sysfiles.lock
# HOME=/nonexistent: root's HOME survives sudo, and git as `vigil` dies on an unreadable /root/.gitconfig.
AS_USER=(runuser -u "$CHECKOUT_USER" -- env HOME=/nonexistent)
PASS_ENV=()
if [ "$(id -u)" != 0 ]; then
  REMOTE="${TEPNA_SYSFILES_REMOTE:-$REMOTE}"
  CHECKOUT="${TEPNA_REPO_DIR:-$CHECKOUT}"
  DEPTH="${TEPNA_SYSFILES_DEPTH:-$DEPTH}"
  TMP_PARENT="${TMPDIR:-/tmp}"
  LOCK="$TMP_PARENT/tepna-sysfiles.lock"
  AS_USER=()
  for v in TEPNA_ETC_SYSTEMD TEPNA_ETC_UDEV TEPNA_ETC_NETWORKD TEPNA_ETC_NEEDRESTART TEPNA_LIB_DIR; do
    [ -n "${!v-}" ] && PASS_ENV+=("$v=${!v}")
  done
fi

usage() { echo "usage: $0 {check|install}" >&2; exit 2; }
[ $# -eq 1 ] || usage
case "$1" in check|install) ;; *) usage ;; esac
die() { echo "tepna-sysfiles: $*" >&2; exit 1; }

exec 8>"$LOCK" || die "cannot open the lock $LOCK"
flock -n 8 || die "another run holds $LOCK"

sha="$("${AS_USER[@]}" git -C "$CHECKOUT" rev-parse --verify -q 'HEAD^{commit}' 2>/dev/null)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "cannot read the commit $CHECKOUT is on"

tmp="$(mktemp -d "$TMP_PARENT/tepna-sysfiles.XXXXXX")" || die "cannot make a temp dir in $TMP_PARENT"
trap 'rm -rf "$tmp"' EXIT
src="$tmp/src"
# HOME and GIT_CONFIG_NOSYSTEM: the clone reads no git config but its own.
g() { env HOME="$tmp" GIT_CONFIG_NOSYSTEM=1 git "$@"; }
g clone -q --no-checkout --single-branch --branch "$BRANCH" --depth "$DEPTH" "$REMOTE" "$src" 2>&1 \
  || die "cannot clone $REMOTE — nothing installed"
g -C "$src" cat-file -e "$sha^{commit}" 2>/dev/null \
  || die "$CHECKOUT is on $sha, which is not on $BRANCH within the last $DEPTH commits — nothing installed"
g -C "$src" checkout -q --detach "$sha" || die "cannot check out $sha — nothing installed"

chk="$src/capture-host/deploy/check-system-files.sh"
[ -f "$chk" ] || die "$sha has no capture-host/deploy/check-system-files.sh — nothing installed"
run_chk() { env -i PATH="$PATH" "${PASS_ENV[@]}" bash "$chk" "$@"; }

echo "source: $REMOTE $BRANCH @ ${sha:0:12} (the commit $CHECKOUT is on)"
if [ "$1" = install ]; then
  run_chk --install
  # `--install` exits 1 whenever it FOUND drift, installed or not. The verdict is a second, clean check.
  echo "verify:"
fi
run_chk
