---
bump: patch
type: changed
brief: OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md
---

`briefs/OXYII-PRESENCE-MODEL-2026-08-23-BRIEF.md` §5b — the 2026-08-24 doff window, recorded with the
error I made reading it, because the error is the more transferable half.

**The poller is healthy and phase-exact.** It fired at 05:45:52 — 1 h 0 m 08 s after its 04:45:44
enable — and pulled the whole night in 13 s (`54991 bytes → …_20260823233104_STORED.dat`). Nothing was
lost or stranded.

🔴 **I first wrote the opposite.** Checking at **05:21** I saw no pull and concluded *"the night's
recording is stranded and the poller cannot retrieve it"* — while my own evidence table in the same
section said the next tick fell at **~05:45**. That is not a measurement of a miss; it is a
measurement of *"the scheduled event has not happened yet"*, published as an outcome. **An absence in
a log is bounded by where and when you looked.**

**What survives, and is still G6's case:** the 04:45:42 restart severed the still-awake ring's link,
and an unworn ring never re-advertises — so link-holding is presence MAINTENANCE, not observation
(pull first, restart after). Wake-dependence remains a demonstrated RISK rather than a realised miss:
the 05:45 tick landed after the owner's wake by luck of phase, which is exactly why presence-aware
scheduling must be *measured* against the poller rather than assumed to beat it.

⚠️ Two frame errors met in one morning: the daemon is a **system** service, so `journalctl --user` is a
partial view; and the journal prints **local** time while `date -u` prints UTC. The load-bearing claim
is now anchored to the **file on disk** rather than to a log line's absence.
