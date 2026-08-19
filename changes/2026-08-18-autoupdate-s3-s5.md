---
bump: patch
type: changed
---

**`VIGIL-AUTO-UPDATE-FOLLOWUPS` §3's open question is answered and §5's counter is justified by data.**

**§3 — the CPAP `Read-only file system` errors were FIXED IN CODE, not "the leg stopped being reached".**
The audit note left both possibilities open and explicitly said which was unestablished. A four-commit chain
lands exactly when the errors stop: `76fa742c` *"probe for a writable wpa control dir — /tmp is read-only in
the unit"* (07-28), `3d62a4b6` (07-28), `cb63b31a` (07-28), `aa1ed645` (07-29). Errors ran 07-26 → 07-29.

⚠️ **Both halves were measured, because an error count alone cannot tell a fix from an unreached branch.**
The box logged **358 harvest/wpa lines in the last 7 days with zero `Read-only file system` errors** — the
leg still runs, it simply no longer fails.

**§5 — "failing every tick since Tuesday" is not hypothetical; it happened.** 30 days of
`journalctl -u tepna-update`: **38 failure events against 300 success/defer**, consecutive-failure runs of
**[30, 5, 3]**.

| | |
|---|---|
| longest streak | **30 consecutive failure events** |
| from → to | 2026-08-04 22:00:37 → 2026-08-05 07:20:44 |
| **wall-clock span** | **9.3 hours** |

For 9.3 hours the box could not update, and `systemctl status` showed exactly what a single transient
failure shows — which is the ambiguity §5 names. Nobody noticed. A streak of 3 also occurred, so it is not
one freak event: **the counter would have fired three times in 30 days, once for most of a night.**

⚠️ These are failure *events*, not ticks — 30 is a lower bound on ticks affected and **9.3 h is the reliable
figure**. The §5 box is left unticked: this justifies the counter, it does not build it.

No code change.
