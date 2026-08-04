<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: VIGIL-AUTO-UPDATE-2026-08-04-BRIEF.md
---
Vigil finishes its own deploy — unattended, and only into an idle box.

Three measured staleness events share one cause: a deploy step that needs a person does not happen. The daemon served the pre-fix build on 2026-07-30 because the restart wanted a password nobody was awake to type; it ran **four days** of stale code on 2026-08-03 because the pull had happened and nothing restarted the unit; and #914's root helpers sat eight days behind the checkout. **Automating `git pull` alone fixes none of the three** — the pull was never the missing step.

`tepna-update.sh` runs hourly as `vigil`: refuse a dirty tree or a non-`main` checkout, `fetch` + `merge --ff-only`, `sync-apps.sh` (a git pull is only half a deploy), then restart through the **existing** narrow `tepna-restart.sh` grant. `/etc` and root-helper drift is **reported, never installed** — putting `sudo check-system-files.sh --install` on a timer would be root-executes-freshly-pulled-repo-code, failing both halves of the rule already written in `tepna-restart.sh`'s header, since `vigil` can rewrite `/opt/tepna` and `--install` writes arbitrary repo bytes into `/etc` including the granted helpers themselves. Reporting still closes the first two events outright and makes the third visible, which is what was missing — #914's drift was silent for eight days, not unfixable.

**The interlock is the load-bearing part.** `capture.py` already computed `alerts.device_is_recording()` each alert tick and threw it away; `status.json` published `connected`, which that function's own docstring exists to distinguish (*"four 'recovered' notices, and NOT ONE BYTE written after 23:48"* — an unbonded H10 reads connected inside each doomed 1–2 s connect). An updater gated on `connected` would restart mid-night on a flapping bond. So `publish_recording` surfaces the boolean rather than have shell re-derive it, and it lives in `status_loop` — which runs every 10 s unconditionally — because a safety interlock published only when *alerting* happens to be enabled is not an interlock. Missing, stale, malformed, or a daemon predating the field all read **unknown**, and unknown blocks: the cost of guessing wrong is a destroyed night, the cost of waiting is one hour.

24 tests; four mutants killed — treating `unknown` as safe, falling back to `connected`, dropping the dirty-tree refusal, and keying `publish_recording` on `connected`. Two source-inspection tests hold the escalation surface to one substitutable seam and the git verbs to `status`/`rev-parse`/`fetch`/`merge`.
