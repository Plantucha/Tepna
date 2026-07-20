<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [PpgDex]
brief: PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md
---
Ingest the Wellue O2Ring finger-site PPG: `parsePPG` gains a single-optical-column branch tagged
`site:'finger'` (the Verity's 3-LED layout is unchanged and still tags `wrist`), and the O2Ring's
in-band `156` `PPG_INVALID` sentinel is rejected by ISOLATION rather than by value — a
trend-consistent 156 is real signal and is kept. A rejected sample is a gap: never median-filled,
never interpolated, and every beat whose foot→peak span touches one is dropped. With one LED there
is no 2-of-3 vote, so `ledAgreementPct` reports null (never a fabricated 100) and per-beat
confidence falls back to an inter-beat cadence axis, surfaced as `beatConfidenceAxis`. Finger
morphology enters at `experimental` via site-scoped registry ids rather than inheriting the wrist
site's grades — the ring AC-couples on-device, so an unknown vendor transfer function sits in the
chain. Adds a committed adversarial twin (`uploads/synthetic_ppgdex_o2ring_finger.txt`) carrying
both sentinel classes, so the finger leg gates in CI from bytes rather than a gitignored night.
