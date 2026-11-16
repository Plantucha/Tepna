---
bump: patch
type: fixed
brief: none
---

Refuse a MotionDex respiratory rate and a posture distribution that nothing measured.

The ridge tracker gave the estimator a rate on a still chest, and every caller
outside the summary published it. The posture distribution read zero for each
posture over zero covered epochs, so the supine KPI drew a met target over an
unread night. Both fields now answer null, and each names its own cause.
