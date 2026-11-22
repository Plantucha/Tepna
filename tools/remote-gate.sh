#!/bin/bash
# remote-gate.sh — Tepna
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
#
# Runs capture-host/check.sh for THIS checkout in a gate container on another box, so a long gate does
# not load the rig. The container holds a clone of the public repo and a venv at /opt/venv.
#
#   tools/remote-gate.sh            # capture-host gate on HEAD + the uncommitted diff
#   tools/remote-gate.sh --dry-run  # print the base commit and the files it would send
#
# Where the container lives is local config, never tracked: ~/.config/tepna/remote-gate.env holds
#   REMOTE_GATE_SSH=<ssh host alias of the Proxmox node>   REMOTE_GATE_CT=<container id>
#
# The result is ADVISORY. The required gates stay on the rig until the two places agree for a week
# (Finch's review, board #7879). The run prints the tool versions beside the verdict, so a split
# between the two places can be traced to a version and not guessed at.
#
# Exit code: the remote gate's own code; 2 when it could not look (no config, no ssh, no container).
set -uo pipefail

ENV_FILE=${REMOTE_GATE_ENV:-$HOME/.config/tepna/remote-gate.env}
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"
if [ -z "${REMOTE_GATE_SSH:-}" ] || [ -z "${REMOTE_GATE_CT:-}" ]; then
  echo "⏱ UNEXAMINED remote-gate: set REMOTE_GATE_SSH and REMOTE_GATE_CT in $ENV_FILE" >&2
  exit 2
fi
case "${1:-}" in
  '' | --dry-run) ;;
  *) echo "✗ tools/remote-gate.sh: unknown argument \"$1\" (accepted: --dry-run)" >&2; exit 2 ;;
esac

ROOT=$(git rev-parse --show-toplevel) || exit 2
cd "$ROOT" || exit 2
BASE=$(git merge-base HEAD origin/main) || exit 2
mapfile -t UNTRACKED < <(git ls-files --others --exclude-standard -- capture-host)

echo "remote-gate: base $(git rev-parse --short "$BASE"), $(git diff --name-only "$BASE" | wc -l) changed file(s), ${#UNTRACKED[@]} untracked under capture-host/"
if [ "${1:-}" = --dry-run ]; then
  git diff --name-only "$BASE"
  printf '%s\n' "${UNTRACKED[@]}"
  exit 0
fi

# ssh joins its arguments into ONE line for the node's shell, so quote each word for that shell.
# Without it, a redirect inside `sh -c '...'` runs on the Proxmox node and not in the container.
RUN_AS=${REMOTE_GATE_USER:-gate}
rx() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_GATE_SSH" "pct exec $REMOTE_GATE_CT -- $(printf '%q ' "$@")"; }
rx true || { echo "⏱ UNEXAMINED remote-gate: cannot reach container $REMOTE_GATE_CT via $REMOTE_GATE_SSH" >&2; exit 2; }

# One run at a time in the container. Each run unpacks the base commit into a NEW directory, so no
# run ever deletes or resets files in the clone. The tests read uploads/, tools/ and git ls-files, so a run
# is a shared local clone (about 600 MB of files). Under the lock, a run deletes the previous run directory.
# The container needs rsync, node and sudo beside the venv, or those steps exit 127 or FileNotFoundError.
# The gate runs as an unprivileged user (REMOTE_GATE_USER, default gate) that owns /work: as root,
# the permission and ownership tests read a different answer than on the rig.
# shellcheck disable=SC2016
REMOTE='set -e
cd /work
exec 9>/work/remote-gate.lock
flock -w 3600 9
git -C /work/tepna fetch -q origin
find /work -maxdepth 1 -name "run.*" -type d -exec rm -r {} +
D=$(mktemp -d /work/run.XXXXXX)
git clone -q --shared --no-checkout /work/tepna "$D"
cd "$D"
git checkout -q --detach "$1"
git apply --binary --allow-empty /work/remote-gate.diff
tar -xf /work/remote-gate.tar
echo "versions: base=$(git -C /work/tepna rev-parse --short "$1") dir=$D $(/opt/venv/bin/python --version 2>&1)"
/opt/venv/bin/python -m pip freeze 2>/dev/null | grep -iE "^(pytest|pytest-cov|ruff|mypy|coverage|mutmut)==" | tr "\n" " "; echo
cd capture-host
set +e
PYTHON=/opt/venv/bin/python ./check.sh
echo "EXIT=$?"'

git diff --binary "$BASE" | rx runuser -u "$RUN_AS" -- sh -c 'cat > /work/remote-gate.diff' || exit 2
printf '%s\n' "${UNTRACKED[@]}" | sed '/^$/d' | tar -cf - -T - | rx runuser -u "$RUN_AS" -- sh -c 'cat > /work/remote-gate.tar' || exit 2
LOG=$(mktemp)
rx runuser -u "$RUN_AS" -- sh -c "$REMOTE" remote-gate "$BASE" 2>&1 | tee "$LOG"
CODE=$(grep -oE '^EXIT=[0-9]+' "$LOG" | tail -1 | cut -d= -f2)
rm -f "$LOG"
if [ -z "$CODE" ]; then
  echo "⏱ UNEXAMINED remote-gate: the remote run printed no EXIT line" >&2
  exit 2
fi
exit "$CODE"
