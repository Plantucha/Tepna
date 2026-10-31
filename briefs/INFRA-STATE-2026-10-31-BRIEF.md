<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-10-31) · **Created:** 2026-10-31

# Infrastructure state — what changed, what the owner still owes, what stays open

The owner asked on 2026-10-31 for one place that records infrastructure changes, so that none is
forgotten. Muse's infra audit (F1–F8, board #2441) and the vigil audit (V1–V3, board #2445) started this
round. **Append each later change as a dated section at the bottom, and tick the boxes in place.**
Change `last-verified` when you re-check the state.

Scope: the rig (`rig-x870`), vigil, the network hosts (scale, moxie, CT104), the board, ntfy and the
user timers. Out of scope: app code, DSP and fixtures.

## 1 · Landed in the repo (2026-10-31)

| PR | change | why |
|---|---|---|
| #4163 | `bge-reindex-driver.sh` passes `--semantic`. The new `--board` lane runs `xerj-load.mjs --only ext:agent-board/ --newer-than 10`. New units `tepna-board-search.{service,timer}` run every 5 min (`OnCalendar`). `XERJ_DISABLE_FEEDBACK=true` goes into `tepna-hybrid-index.service` and `.claude/settings.json`. | The hourly index tick had embedded nothing since 10-11, because the hybrid default exits before the embed. Board posts took up to an hour to reach search. |
| #4165 | `qwen-idle-driver.sh` runs in the primary checkout. | The driver pointed at a retired worktree, so it failed 564 times from 10-26 09:48 and the idle Qwen lane did no work. |
| #4168 | `tools/unit-health.mjs`, plus `tepna-unit-health.{service,timer}` every 15 min. It posts to board thread 7 only when the finding set changes. | Four rig jobs had stopped silently (audit F2): qwen-idle, corpus-tier, nightly-triage and disk-watch. |
| #4169 | The capture-host CI matrix adds Python 3.14 and keeps 3.12 and 3.13. | Audit F1: prove a version in CI before the box moves to it. |

## 2 · Changed outside the repo (2026-10-31; Muse unless named)

These changes live on hosts, not in git. Muse took a backup beside each edited file.

- **ntfy topics split by domain** (#2447, #2455). Vigil stays on its topic and the rig stays on the lab
  topic. A new network topic carries moxie lab-watch, scale scale-watch and CT104 nebula-sync.
- **The CT104 nebula-sync timer moved from :00 to :07.** This avoids the Synology 20:00 auth reset. It
  failed 2 of 336 runs in 14 days, both at that event.
- **Muse removed the dead nebula docker cron on the scale host.** Its compose file retired 2026-09-17,
  and the job had errored hourly since then.
- **ntfy→board bridge**: user unit `ntfy-board-bridge.service` on the rig. Board threads: #12 vigil,
  #13 rig, #14 network. Routing: vigil → @wren, rig → @kestrel, network and disk → @finch.
- **Rich-alert schema v1** (#2456, #2465). Every alert carries What, Where, Evidence, Impact, Handle and
  an episode ID. The vigil Notifier footer is draft PR #4166.
- **Escalation chain** (#2472, owner decision). The domain owner acts first. After 30 min the bridge
  escalates to @kestrel on the board. After 90 min un-acked, the bridge pages the owner topic with
  "ESCALATION – Kestrel unresponsive". `ntfy-owner` on the rig is Kestrel's channel to the owner.
- **PTP timing, phase 2, on scale and moxie** (#2471). linuxptp `ptp4l` uses L2 transport and hardware
  timestamps. Scale is the grandmaster, and moxie is slave-only and feeds chrony as a PHC refclock.
  Chrony stays the system-clock authority on both hosts.
- **Kestrel ran `systemctl --user start disk-watch.service` by hand once** (2026-10-31). The timer had
  had no next elapse since 2026-10-18 17:23.
- **Kestrel cleared 8 failed transient `run-*.scope` units** with `systemctl --user reset-failed`.

## 3 · Owner steps still owed

- [ ] Install the board-search and unit-health units on the rig. The service headers hold the commands.
      `cp` both pairs into `~/.config/systemd/user/`, run `daemon-reload`, then
      `enable --now tepna-board-search.timer tepna-unit-health.timer`.
- [ ] `systemctl --user restart tepna-hybrid-index.service`, so that the feedback-off flag applies.
- [ ] Add `OnCalendar=*-*-* *:00/15:00` to the rig-local `disk-watch.timer`. A timer with only
      `OnBootSec` and `OnUnitActiveSec` loses its next elapse when the user manager restarts before
      the service runs again.
- [ ] corpus-tier: someone disabled its timer, and its service failed on 10-20 (row
      `2026-10-22-the-corpus-tier-timer-no-longer-fires-on-the-rig`).
- [ ] Vigil V1: reboot for the pending kernel (`/var/run/reboot-required`; up since 10-23). This needs a
      daytime window.
- [ ] Vigil V2: the two-night `tepna-update` hold is NOT in effect. The hourly timer still deploys main.
      Heron holds the #2428 actions until the owner speaks to Heron directly.
- [ ] Give the owner ntfy topic to Wren and Finch directly, never on the board (Wren asked in #2473).
- [ ] Decide whether `test (py3.14)` becomes a required context (Heron, #2492).
- [ ] An external dead-man's switch (healthchecks.io class). It is the only layer that reports a loss
      of house power or internet.
- [ ] Decide whether to re-enable `tepna-archive-pull.timer` on the rig. Someone disabled it and systemd has not loaded it, so
      `unit-health` cannot see it. The last pull ran on 10-29, and nights 10-30 and 10-31 have no archive copy
      (Muse, #2509). The disable reason is unknown.
- [ ] Audit F6 (NAS action) stays with the owner. F7 is Muse's own host.

## 4 · Open defects

- [x] **Escalation chain defects** (fixed by Muse, #2508) (Kestrel → Muse on board thread 7, 2026-10-31):
  1. The drill page carried no TEST label, so the owner's phone showed a real escalation.
  2. The page claimed that Kestrel ignored a 30 min escalation that the bridge never posted.
  3. A network urgent waits for @finch only. Finch runs on demand, so each real network alert pages
     the owner at 90 min, and an ack from @kestrel does not clear it.
- [ ] **The hybrid-index merge competes with stage-lab jobs for box memory** (Finch, #2491). The global
      OOM killer took three 8 GB lab jobs on 10-31 at 12:46, 13:15 and 13:56. Ask: schedule the
      reindex away from 16 GB lab jobs, or bound its memory.
- [ ] **nightly-triage hit its 8 h timeout once, on 10-30.** The runs on 10-27, 10-28 and 10-29
      finished, so this is a single observation. Watch it through `unit-health`.
- [ ] **Vigil `UNSPOOLED-CARD-NIGHT` fires on 292 of 292 nights**, so it separates no real gap. Wren
      sizes it (2026-10-31).
- [ ] **Tools/turn sits under the target of 2** for every bird (0.89–0.95 on 10-31). The planned fix is a
      per-unit view in `fleet-turns.mjs` and a `CLAUDE.md` §6 line on line-range reads.

## 5 · Checked and closed

- **Vigil V3, the CPAP spool cursor stuck at 2026-10-20T16:00Z** (Wren, #2483): PASS. New data arrives
  every night (about 211 B per Summary record), and the cursor moves only at a block end, about every
  16 nights. The next move is near 2026-11-05.
- **Audit F3, unsupervised services**: wrong. XERJ runs in `tepna-hybrid-index.service`, the reranker
  in `tepna-rerank.service`, and the board views are units.
- **sudo**: none owed on the rig. No root-owned file exists in any worktree on 2026-10-31.

## Log

- 2026-10-31 · Muse fixed the three escalation-chain defects (#2508): a TEST prefix, true page text, and a
  Kestrel ack that closes a network escalation.
- 2026-10-31 · Kestrel decided that Muse starts item 3a, the rig copy-time hash manifest, as a draft PR (#2510).
- 2026-10-31 · Kestrel created this brief from audits #2441 and #2445 and from the day's board record.
