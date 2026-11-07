---
bump: patch
type: fixed
brief: SEAM-SIDECAR-CONSUMPTION-2026-11-03-BRIEF.md
---

The MotionDex signal-quality helper returns a confidence of zero for a stream it could not score. Fewer than ten rows read `no-data`, and magnitudes of unknown scale read `unit-unknown`. Inside the node those reasons travel beside the number, so the summary stays honest.

The export projected the bare confidence. A consumer read a quality of zero. It could not tell an unscored stream from the worst quality this node measures, because the computed score also reaches zero.

The export now states an unscored stream as null and names the node's own reason beside it. A measured confidence keeps its number, a measured zero included, and reports no reason. Both reason fields ship on every export, so a reader never infers a state from an absent key.
