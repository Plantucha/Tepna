<!-- SPDX-License-Identifier: Apache-2.0 -->
# Per-unit session launcher

**state:** RUNNING
**unit:** Build the handoff contract and `tools/unit-launch.sh`, so one session runs one unit and exits.
**bird:** heron
**branch:** claude/unit-launch-hrn
**worktree:** ../wt-unit-launch-hrn
**doc-search:** per-unit session launcher handoff file start a bird on a unit herdr pane
**stopping-point:** tools/unit-launch.sh written; shellcheck green; one real launch tested
**next-step:** Read `handoffs/README.md`, then read `tools/unit-launch.sh --help`.
**done-when:** `shellcheck tools/unit-launch.sh` is green, `--dry-run` touches nothing, and one real launch has run.

## Open questions

- The launcher splits a pane by default, as ordered. Measured on 2026-10-11, the fleet tab is 120x40
  and already holds four 60x20 panes. A fifth split yields 60x10 or 30x20, and no Claude session can
  use that. So the split step refuses below a floor and names `--tab` as the remedy. The owner decides
  whether a unit should get its own tab by default.
- A session that calls this script bypasses the doc-search gate. The hook matches the text
  `herdr agent prompt`, and that text now sits inside the script. The script requires a non-empty
  `doc-search` field for this reason, but a field is a weaker check than the hook. The gate's own
  wording is the owner's to change.
- Nothing cleans up `~/.local/state/tepna/units/*.json`. A finished unit leaves its record. That is
  deliberate for now, because the record is the only trace of which session held which pane.
