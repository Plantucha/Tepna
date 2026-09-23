#!/usr/bin/env bash
# tepna-capture — tepna-report.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE MORNING REPORT — runs after the night closes, writes one file beside the night, sends one line.
#
# A SEPARATE UNIT ON A SEPARATE TIMER, and the daemon is not touched. `tepna-capture` holds the BLE
# links all night; a reporting bug must never be able to cost a recording, so nothing here runs inside
# it, and this script cannot restart, block or slow it. It only reads what the night left behind.
#
# 🔴 THE WEBHOOK URL IS A SECRET AND IS NEVER PRINTED — not to stdout, not to the journal, not into
# the report file. It is read from the box's gitignored config.yaml inside one python process that
# hands it straight to `alerts.Notifier`, which validates it and never logs it. `night_report.py`
# never sees it at all (asserted by its own test), so the report file cannot carry it even by mistake.
#
# 🔴 EVERY MISSING INPUT IS THE WORD `unknown`, NEVER A NUMBER. A night nobody watched must not read
# like a night that went well. That rule lives in night_report.py; this script only carries its output.
#
#   unit:   systemd/tepna-report.service + .timer (installed by deploy/install-services.sh)
#   manual: tepna-report.sh [YYYY-MM-DD]   → that night; default is the NEWEST night directory
#   exits:  0 wrote and delivered (or delivery is disabled) · 4 nothing to report · 5 could not send
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${TEPNA_CONFIG:-$here/config.yaml}"
# The interpreter seam, named so a test can substitute it — the same pattern as tepna-update.sh's
# `TEPNA_SUDO`. On the box this always resolves to the venv beside the script.
#
# ⚠️ IT IS ALSO WHAT MAKES THIS SCRIPT MUTATION-TESTABLE, which is not obvious and cost a red CI job.
# `tools/mutate_diff.py` rewrites `night_report.py` into a mutants tree under /tmp and runs the suite
# there. This script re-executes that module as a SUBPROCESS, so inside the mutants tree `$here` has
# no `.venv`, the fallback picked the system `python3`, and the mutated module died on
# `ModuleNotFoundError: No module named 'mutmut'` — every mutant crashing rather than being tested.
# The gate correctly REFUSED rather than reporting an empty survivor list as green. With the seam the
# test passes its own `sys.executable`, so the subprocess runs the mutant under the interpreter that
# can load it, and the shell tests actually kill mutants instead of erasing them.
PY="${TEPNA_PYTHON:-$here/.venv/bin/python}"; [ -x "$PY" ] || PY="python3"
log() { echo "tepna-report: $*" >&2; logger -t tepna-report -- "$*" 2>/dev/null || true; }

# The captures root and the sniffer directory come from the same config the daemon reads, so a box
# that moved its storage does not need this script edited too. Printed values are paths, never secrets.
#
# ⚠️ `root` IS THE BASE, AND THE NIGHTS ARE ONE LEVEL DOWN: `writers.night_dir` writes
# `<root>/captures/<YYYY-MM-DD>` and every other consumer joins the same way (`diskguard.py`,
# `status_union.py`, `webmon.py`). Searching `<root>` directly finds no night on any real box and
# exits 4 — a report that says "nothing to report" every morning, which is indistinguishable from a
# box that recorded nothing. Caught before this shipped only because the sniffer path was wrong the
# same way; the tests had encoded the misreading by pointing `root` straight at a captures directory.
ROOT="$("$PY" - "$CONFIG" <<'PYEOF' 2>/dev/null || true
import sys, yaml
try:
    cfg = yaml.safe_load(open(sys.argv[1], encoding="utf-8")) or {}
except Exception:
    cfg = {}
print((cfg.get("root") or "/srv/tepna"))
PYEOF
)"
[ -n "$ROOT" ] || ROOT=/srv/tepna
CAPTURES="$ROOT/captures"
# Same default and same env override as tepna-sniff.sh, so the two units cannot disagree about where
# the verdicts land.
SNIFF="${TEPNA_SNIFF_DIR:-$CAPTURES/sniffer}"

# WHICH NIGHT. An explicit argument wins; otherwise the newest dated directory, which is the night
# that just closed. Deliberately NOT `date -d yesterday`: a box that was off, or a night that ran past
# midnight into a second directory, would then be reported as an empty night that never existed.
night="${1:-}"
if [ -z "$night" ]; then
  night="$(find "$CAPTURES" -maxdepth 1 -type d -name '2[0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' -printf '%f\n' 2>/dev/null | sort | tail -1)"
fi
if [ -z "$night" ]; then
  log "no night directory under $CAPTURES — nothing to report"
  exit 4
fi

# The line is the ONLY thing on stdout, by contract, so it can be handed to the notifier unfiltered.
line="$("$PY" "$here/night_report.py" "$CAPTURES" "$night" "$SNIFF")" || {
  log "night_report failed for $night"
  exit 4
}
log "$line"

# DELIVERY. Disabled or unconfigured is a SUCCESS, not a failure: a box with no webhook still wrote
# its report, and exiting non-zero there would put a permanent red in `systemctl --failed` for a
# choice the operator made. Only a configured send that FAILED is an error.
rc=0
( "$PY" - "$here" "$CONFIG" "$line" <<'PYEOF'
import asyncio, sys, yaml
# argv[1] is the SCRIPT's own directory, passed in: python reading from stdin has argv[0] == "-", so
# deriving the path from argv[0] would resolve to the caller's CWD and `import alerts` would fail
# anywhere but /opt/tepna/capture-host. The unit sets WorkingDirectory there and would have hidden it.
sys.path.insert(0, sys.argv[1])
import alerts
try:
    cfg = yaml.safe_load(open(sys.argv[2], encoding="utf-8")) or {}
except Exception:
    cfg = {}
acfg = cfg.get("alerts") or {}
# The URL enters here and goes no further: it is not printed, not logged, not returned.
n = alerts.Notifier(acfg.get("webhook_url"), bool(acfg.get("enabled")))
if not n.enabled:
    print("tepna-report: alerts disabled or no webhook — report written, nothing sent", file=sys.stderr)
    raise SystemExit(0)
raise SystemExit(0 if asyncio.run(n.send("Tepna: last night", sys.argv[3])) else 5)
PYEOF
) || rc=$?
[ "${rc:-0}" -eq 0 ] || log "the report line could not be delivered (exit ${rc})"
exit "${rc:-0}"
