#!/usr/bin/env bash
# tepna-capture — deploy/tepna-fold.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# FOLD THE BOX'S OWN NIGHTS. Production vigil has no dev-box access, so folding and QC run here
# (VIGIL-SELF-SUSTAINED-FOLDING-2026-09-01-BRIEF, acceptance 2).
#
# ⚠️ CONTAINMENT, NOT DETECTION. This script does NOT try to decide whether a recording is live. The
# protection is three mechanisms that cannot be wrong about it:
#   tepna-fold.service  MemoryMax=4G + MemorySwapMax=0   — the fold cannot grow into capture's RAM
#   tepna-fold.service  OOMScoreAdjust=500               — under host pressure the kernel picks the fold
#   tepna-capture.service OOMScoreAdjust=-500            — and never the recording
#   tepna-fold.timer    a daytime OnCalendar             — it starts long after any night has closed
# A live-recording detector would be a fourth claim that can read wrong in exactly the window where
# being wrong costs a night. The acceptance line is "tonight's fold is absent", never "tonight's
# recording is lost", and a cgroup delivers that without asking a question it might misanswer.
#
# EXIT 4 IS NORMAL, not a failure: there is nothing this box can fold right now. The unit declares
# `SuccessExitStatus=0 4` for the same reason tepna-report.service does.
set -euo pipefail

# Overridable for the test harness ONLY — production reads the box's own tree.
ROOT="${TEPNA_FOLD_ROOT:-/opt/tepna}"
SRC="${TEPNA_FOLD_SRC:-/srv/tepna/captures}"
OUT="${TEPNA_FOLD_OUT:-/srv/tepna/trio}"
NODE="${TEPNA_FOLD_NODE:-node}"

say() { printf 'tepna-fold: %s\n' "$*"; }

# `node` is ABSENT on vigil as shipped (measured 2026-09-24, re-read 2026-10-17). Installing a runtime
# on the production box is the owner's call, so this exits 4 and says which step is owed — never
# non-zero, which would mail a failure every single day for a decision nobody has taken yet.
if ! command -v "$NODE" >/dev/null 2>&1; then
  say "no node runtime on this box — the fold is owed a Node install (owner). Nothing folded."
  exit 4
fi
if [ ! -d "$SRC" ]; then
  say "no captures directory at $SRC — nothing to fold."
  exit 4
fi
if [ ! -f "$ROOT/tools/trio-batch.mjs" ]; then
  say "no fold tool at $ROOT/tools/trio-batch.mjs — this tree is not a full checkout."
  exit 4
fi

mkdir -p "$OUT"
# NO `--jobs`. The planner probes, and since VIGIL-SELF-SUSTAINED-FOLDING it also reads this unit's own
# `memory.max`, so the cgroup fence lowers the probe instead of killing the children it started.
# `--skip-existing` makes a daily timer idempotent: a night already folded from the same inputs by the
# same code is left alone.
say "folding $SRC -> $OUT"
exec "$NODE" "$ROOT/tools/trio-batch.mjs" --src "$SRC" --out "$OUT" --skip-existing
