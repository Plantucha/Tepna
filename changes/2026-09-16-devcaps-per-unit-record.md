---
bump: minor
type: added
brief: BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md
---

capture-host: per-unit device capability records (`devcaps.py`), keyed by BLE address and persisted
across restarts. An unmeasured capability reads `null`, never `false` — "nobody looked" and "observed
not to support it" are different facts, and collapsing them is how one unit's measurement became a
claim about a model.
