#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# unit-launch.sh — start one Claude session on one work unit, from a handoff file.
#
# One session runs one unit. The session reads its handoff, does the unit, writes the handoff back
# with `state: DONE`, and exits itself. This script only starts it. It never stops a session, and it
# never touches a pane that already holds an agent. A restart is the owner's call.
#
# Read `handoffs/README.md` for the handoff contract.
set -euo pipefail

MIN_COLS=80   # a Claude session below this width wraps its own UI unusably
MIN_ROWS=20   # and below this height it cannot show a tool result and a prompt at once
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tepna/units"
HERDR="${HERDR_BIN:-$HOME/.local/bin/herdr}"
[ -x "$HERDR" ] || HERDR="$(command -v herdr || true)"

# A unit opens in its OWN TAB at full size (owner ruling 2026-10-11). The bird panes stay as they are.
DRY=0; WANT_TAB=1; WANT_PANE=""; WANT_DIR=""; KIND="claude"; DO_PROMPT=1; HANDOFF=""

die()  { printf 'unit-launch: %s\n' "$1" >&2; exit "${2:-2}"; }
note() { printf '  %s\n' "$1" >&2; }

usage() {
  cat <<'USAGE'
usage: tools/unit-launch.sh <handoffs/slug.md> [options]

A unit opens in its own tab, at full size. The bird panes stay as they are.

  --dry-run            print every command and touch nothing
  --split              split the calling pane instead of opening a tab
  --pane <ID>          start in this existing empty pane
  --direction <d>      with --split, split `right` or `down` instead of reading the layout
  --no-prompt          start the session but do not send the first prompt
  --kind <k>           agent kind (default: claude)
  -h, --help           print this

Exit codes: 0 launched · 2 bad usage or bad handoff · 3 refused · 4 started but not prompted.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY=1 ;;
    --split)     WANT_TAB=0 ;;
    --tab)       WANT_TAB=1 ;;
    --no-prompt) DO_PROMPT=0 ;;
    --pane)      shift; WANT_PANE="${1:-}"; [ -n "$WANT_PANE" ] || die "--pane needs an ID" ;;
    --direction) shift; WANT_DIR="${1:-}"; WANT_TAB=0; case "$WANT_DIR" in right|down) ;; *) die "--direction takes right or down" ;; esac ;;
    --kind)      shift; KIND="${1:-}"; [ -n "$KIND" ] || die "--kind needs a value" ;;
    -h|--help)   usage; exit 0 ;;
    -*)          die "unknown option: $1" ;;
    *)           [ -z "$HANDOFF" ] || die "give exactly one handoff file"; HANDOFF="$1" ;;
  esac
  shift
done

[ -n "$HANDOFF" ] || { usage >&2; exit 2; }
[ -f "$HANDOFF" ] || die "no such handoff file: $HANDOFF"

# jq is not assumed; python3 is already a hard dependency of this repo's tooling.
jget() { python3 -c 'import sys,json;d=json.load(sys.stdin)
for k in sys.argv[1].split("."):
    d=d.get(k) if isinstance(d,dict) else None
    if d is None: break
print(d if d is not None else "")' "$1"; }

# A handoff field is one line, `**name:** value`. Take the first match only.
field() { sed -n "s/^\*\*$1:\*\*[[:space:]]*\(.*[^[:space:]]\)[[:space:]]*$/\1/p" "$HANDOFF" | head -1; }

SLUG="$(basename "$HANDOFF" .md)"
case "$SLUG" in
  README) die "README.md is the contract, not a handoff" ;;
  [a-z]*) ;;
  *) die "handoff slug must start with a lower-case letter: $SLUG" ;;
esac

# Every field is load-bearing, so a missing one refuses here rather than halfway through a launch.
MISSING=""
for f in state unit bird branch worktree doc-search stopping-point next-step done-when; do
  [ -n "$(field "$f")" ] || MISSING="$MISSING $f"
done
[ -z "$MISSING" ] || die "handoff is missing fields:$MISSING (see handoffs/README.md)"

STATE="$(field state)"; BIRD="$(field bird)"; BRANCH="$(field branch)"
WT="$(field worktree)"; QUERY="$(field doc-search)"
[ "$STATE" = "READY" ] || die "handoff state is $STATE, not READY — a launch needs READY" 3

# Rule 0 travels in the handoff, because the hook that gates `herdr agent prompt` cannot see the
# call once it sits inside this script. A placeholder query is the same as no query.
case "$QUERY" in
  *"<"*|TODO*|todo*) die "doc-search field is a placeholder, not a query" ;;
esac

# The agent name is an ADDRESS. Herdr requires it unique among live agents, so a unit session can
# never be named after a live bird. The `bird` field, not this name, says who owns the work.
AGENT="$(printf '%s-%s' "$BIRD" "$SLUG" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-' | cut -c1-32)"
AGENT="${AGENT%%-}"
printf '%s' "$AGENT" | grep -qE '^[a-z][a-z0-9_-]{0,31}$' || die "derived agent name is not legal: $AGENT"

REPO="$(git -C "$(dirname "$HANDOFF")" rev-parse --show-toplevel)"
case "$WT" in /*) WT_ABS="$WT" ;; *) WT_ABS="$(cd "$REPO" && cd "$(dirname "$WT")" 2>/dev/null && pwd)/$(basename "$WT")" || WT_ABS="$REPO/$WT" ;; esac

printf 'unit %s · bird %s · agent %s\n' "$SLUG" "$BIRD" "$AGENT" >&2
printf '  branch   %s\n  worktree %s\n' "$BRANCH" "$WT_ABS" >&2

# --- refusals, all before the first mutation ----------------------------------------------------
# A dry run checks every condition it can READ, because "would this work" is the question it answers.
# Only the two herdr checks sit behind the guard, so a dry run still works outside a herdr pane.
if [ "$DRY" -eq 0 ]; then
  [ "${HERDR_ENV:-}" = 1 ] || die "not running inside a herdr pane (HERDR_ENV is not 1)" 3
  [ -n "$HERDR" ] || die "herdr not found; set HERDR_BIN" 3
fi
git -C "$REPO" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null && die "branch $BRANCH already exists" 3
[ ! -e "$WT_ABS" ] || die "worktree path already exists: $WT_ABS" 3
if [ -n "$HERDR" ]; then
  LIVE="$("$HERDR" agent list 2>/dev/null | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for a in (d.get("result") or {}).get("agents") or []: print(a.get("name") or "")' || true)"
  if printf '%s\n' "$LIVE" | grep -qxF "$AGENT"; then
    die "an agent named $AGENT is already live — this script never prompts or restarts one" 3
  fi
else
  note "herdr not found: the live-name check did not run"
fi

# The split floor is a REFUSAL, so it belongs here, before the worktree exists. Measured 2026-10-11:
# resolving it at the pane step left a branch and a worktree behind for a launch that never happened.
SPLIT_DIR="$WANT_DIR"
if [ "$DRY" -eq 0 ] && [ -z "$WANT_PANE" ] && [ "$WANT_TAB" -eq 0 ]; then
  [ -n "${HERDR_PANE_ID:-}" ] || die "HERDR_PANE_ID is unset; pass --pane, or use the default tab" 3
  DIMS="$("$HERDR" pane layout --pane "$HERDR_PANE_ID" | python3 -c 'import sys,json,os
d=json.load(sys.stdin)["result"]["layout"]
me=os.environ["HERDR_PANE_ID"]
for p in d["panes"]:
    if p["pane_id"]==me: print(p["rect"]["width"], p["rect"]["height"]); break
else: print(0,0)')"
  COLS="${DIMS% *}"; ROWS="${DIMS#* }"
  # A split halves one axis, so refuse when the CHILD would fall under the floor, and name the remedy.
  if [ -z "$SPLIT_DIR" ]; then
    if   [ "$COLS" -ge $((MIN_COLS * 2)) ]; then SPLIT_DIR=right
    elif [ "$ROWS" -ge $((MIN_ROWS * 2)) ]; then SPLIT_DIR=down
    else
      die "pane $HERDR_PANE_ID is ${COLS}x${ROWS}; a split gives a child under ${MIN_COLS}x${MIN_ROWS}. Drop --split to open a tab, or pass --pane with an empty pane." 3
    fi
  fi
  note "split plan: $SPLIT_DIR from $HERDR_PANE_ID (${COLS}x${ROWS})"
fi

run() {
  if [ "$DRY" -eq 1 ]; then printf '+ %s\n' "$*"; return 0; fi
  "$@"
}

# --- 1 · the worktree ---------------------------------------------------------------------------
run git -C "$REPO" worktree add "$WT_ABS" -b "$BRANCH" origin/main
# The worktree is cut from origin/main, so a handoff that has not merged yet is ABSENT there. Copy it
# in, or the session is told to read a file that does not exist. The session then edits this copy and
# commits it on its own branch, which is how `state: DONE` travels with the work.
if [ "$DRY" -eq 1 ]; then printf '+ cp %s %s/handoffs/%s.md\n' "$HANDOFF" "$WT_ABS" "$SLUG"
else
  mkdir -p "$WT_ABS/handoffs"
  cp "$HANDOFF" "$WT_ABS/handoffs/$SLUG.md"
fi
# A fresh worktree has no node_modules, and a Node gate there exits 127 before it checks anything.
# Resolve the link target, so a chain through another worktree cannot break when that one is removed.
REPO_NM="$(readlink -f "$REPO/node_modules" 2>/dev/null || printf '%s' "$REPO/node_modules")"
if [ -d "$REPO/node_modules" ]; then
  if [ "$DRY" -eq 1 ]; then printf '+ ln -s %s %s\n' "$REPO_NM" "$WT_ABS/node_modules"
  elif [ ! -e "$WT_ABS/node_modules" ]; then ln -s "$REPO_NM" "$WT_ABS/node_modules"; fi
fi

# --- 2 · the pane -------------------------------------------------------------------------------
PANE=""
if [ -n "$WANT_PANE" ]; then
  PANE="$WANT_PANE"
elif [ "$WANT_TAB" -eq 1 ]; then
  if [ "$DRY" -eq 1 ]; then printf '+ %s tab create --cwd %s --no-focus\n' "$HERDR" "$WT_ABS"; PANE="w?:p?"
  else PANE="$("$HERDR" tab create --cwd "$WT_ABS" --no-focus | jget result.root_pane.pane_id)"; fi
else
  DIR="$SPLIT_DIR"
  if [ "$DRY" -eq 1 ]; then
    [ -n "$DIR" ] || DIR="right (chosen from layout at run time)"
    printf '+ %s pane split --current --direction %s --cwd %s --no-focus\n' "$HERDR" "$DIR" "$WT_ABS"
    PANE="w?:p?"
  else
    note "splitting $DIR from $HERDR_PANE_ID"
    PANE="$("$HERDR" pane split --current --direction "$DIR" --cwd "$WT_ABS" --no-focus | jget result.pane.pane_id)"
  fi
fi
[ -n "$PANE" ] || die "no pane id came back from herdr" 4
note "pane $PANE"

# --- 3 · the session ----------------------------------------------------------------------------
RC_ARGS=""; [ "${HERDR_RC:-1}" != 0 ] && RC_ARGS="--remote-control $AGENT"
STARTED=0
if [ "$DRY" -eq 1 ]; then
  printf '+ %s agent start %s --kind %s --pane %s -- %s\n' "$HERDR" "$AGENT" "$KIND" "$PANE" "$RC_ARGS"
  STARTED=1
elif "$HERDR" agent start "$AGENT" --kind "$KIND" --pane "$PANE" ${RC_ARGS:+-- $RC_ARGS} >/dev/null 2>&1; then
  STARTED=1
else
  note "agent start did not report ready; the name stays readable"
  note "inspect: herdr agent get $AGENT ; herdr agent read $AGENT --source recent-unwrapped --lines 80"
fi

# --- 4 · the first prompt -----------------------------------------------------------------------
# The second sentence is load-bearing. The first smoke run wrote `state: DONE` and committed nothing,
# because only the README carries the exit path and the session was never pointed at it (2026-10-11).
PROMPT="Read handoffs/$SLUG.md and start. Read handoffs/README.md for the exit path."
PROMPTED=0
if [ "$DO_PROMPT" -eq 0 ]; then
  note "--no-prompt: send it yourself with: herdr agent prompt $AGENT \"$PROMPT\" --wait"
elif [ "$DRY" -eq 1 ]; then
  printf '+ %s agent prompt %s "%s" --wait --timeout 120000\n' "$HERDR" "$AGENT" "$PROMPT"
  PROMPTED=1
elif [ "$STARTED" -eq 1 ]; then
  if "$HERDR" agent prompt "$AGENT" "$PROMPT" --wait --timeout 120000 >/dev/null 2>&1; then
    PROMPTED=1
  else
    note "prompt did not settle; it may still have been delivered — read before resending"
  fi
fi

# --- 5 · the record -----------------------------------------------------------------------------
if [ "$DRY" -eq 1 ]; then
  printf '+ write %s/%s.json\n' "$STATE_DIR" "$SLUG"
  printf 'dry run: nothing was created\n' >&2
  exit 0
fi

SESSION="$("$HERDR" agent get "$AGENT" 2>/dev/null | jget result.agent.agent_session.value || true)"
mkdir -p "$STATE_DIR"
AGENT="$AGENT" SLUG="$SLUG" BIRD="$BIRD" BRANCH="$BRANCH" WT_ABS="$WT_ABS" PANE="$PANE" \
SESSION="$SESSION" QUERY="$QUERY" STARTED="$STARTED" PROMPTED="$PROMPTED" \
python3 -c 'import json,os,datetime,sys
e=os.environ
rec={"unit":e["SLUG"],"bird":e["BIRD"],"agent":e["AGENT"],"branch":e["BRANCH"],
     "worktree":e["WT_ABS"],"pane":e["PANE"],"session":e["SESSION"] or None,
     "docSearch":e["QUERY"],"started":e["STARTED"]=="1","prompted":e["PROMPTED"]=="1",
     "at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
sys.stdout.write(json.dumps(rec,indent=2,ensure_ascii=False)+"\n")' > "$STATE_DIR/$SLUG.json"
note "recorded $STATE_DIR/$SLUG.json"

[ "$STARTED" -eq 1 ] || exit 4
if [ "$DO_PROMPT" -eq 1 ] && [ "$PROMPTED" -eq 0 ]; then exit 4; fi
printf 'launched %s on %s\n' "$AGENT" "$PANE" >&2
