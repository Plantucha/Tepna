---
bump: minor
type: added
nodes: [PpgDex]
brief: DEEP-AUDIT-VI-FOLLOWUPS-2026-09-02-BRIEF.md
---

PpgDex publishes §∅ absence-as-value spans: stretches where the optical stream was PINNED at a
rail and therefore measured nothing. Detection is on the LEVEL and on the stream's own histogram,
never on a value list — 0, 199 and 19600 are facts about one device at one moment, and a rule that
names them cannot see the next device. Per-channel `quality.pinnedCoverage` reports the rail, the
span count and the samples unmeasured; a `null` rail is the honest reading of a clean night and is
distinct from a rail existing with zero spans.

Also adds `settlingWidenSec`: how far a span's damage reaches past its own edges, DERIVED from the
filter's own parameters rather than shipped as a constant, because settling to a fixed threshold is
logarithmic in the artifact's size.
