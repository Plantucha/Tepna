---
bump: minor
type: added
nodes: [ECGDex]
brief: residue 2026-09-12-ecgdsp-analyze-mixes-seconds-and-ms
---

`ECGDSP.analyze()` returned seconds and milliseconds on one object with no field naming its unit.

`times` and `tt` are seconds, `nn` is milliseconds and is derived from `tt`, `peaks` is an integer
sample index and `refIdx` a fractional one — while every scalar beside them already carried its unit
(`durSec`, `durMin`, `spanMin`, `artifactSec`). A consumer comparing `times` to a ms timebase is off
by 1000x, and #2413's own end-to-end selftest shipped that exact bug and PASSED, because it asserted
only that both beat trains were non-empty. Non-emptiness survives a 1000x scale error intact.

The published names are a consumer contract and an export surface, so nothing is renamed
(CLAUDE.md §📦). Added instead: a frozen `units` map, and unit-suffixed aliases sharing the SAME array
reference as the legacy name — one converted array, two names, so they cannot drift.

⚠️ A DECLARED UNIT THAT IS WRONG IS WORSE THAN NO UNIT, so the map holds only fields the gate PROVES
from the data. `corrected`, `nnCorrected` and `nnConf` are deliberately outside it: the first two are
per-beat masks and the third a [0.5, 1] confidence. The key set is pinned as an equality, so widening
it is a deliberate act that must bring its own proof.

Every leg is a RELATION between fields in different units — `nn` against consecutive `tt`, `times`
against `refIdx / fs` — which a scale error cannot satisfy. Three plants caught: `times` emitted in ms
while the map says seconds (the #2413 bug), a map that lies about `nn`, and an alias turned into a
copy that could drift.

⚠️ The obvious relation `nn[i] === (tt[i] − tt[i−1]) × 1000` is NOT universally true, and asserting it
would have been a gate that convicts working code. Two legitimate populations break it, both found by
PRINTING THE OUTLIERS rather than widening a tolerance until they fit: `tt` skips where the confidence
filter dropped a beat, and `nn` is the MALIK-CORRECTED series while `tt` is raw beat times. All 22
shorter-than-interval gaps carry `nnCorrected = 1`, with no exceptions — which identifies the
population rather than guessing at it. The exact leg therefore runs over the uncorrected beats with
the exclusions counted and named by cause, and that is also the first written statement of a real
contract: `nn` is corrected, `tt` is not.

Compute-path: ECGDex re-bundled, 4 fixtures re-stamped, `regen-ecgdex-goldens` 0 moved (the export
reads named fields and gains none), `verify-fixtures` green.
