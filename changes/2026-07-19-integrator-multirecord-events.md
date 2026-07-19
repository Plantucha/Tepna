<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [integrator]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Every event in a multi-record ECGDex / PpgDex / PulseDex export was silently dropped by the Integrator.

The unwrap guard matched exactly one wrapper spelling — `nights[]` + `schema.multiNight` — because its comment's "unwrap ANY multiNight wrapper generically" meant any **node**, not any **carrier key**. The three raw-waveform nodes batch differently: ECGDex and PulseDex emit `recordings[]` + `multiRecording`, PpgDex emits `sessions[]` + `multiSession`. None sets `multiNight`; none uses `nights[]`. All three fell through to the flat envelope adapter, which then read the **wrapper's own** (empty) envelope.

The loss was invisible by construction: the `Unknown`-only skip notice cannot fire for a recognized node, so findings went 2 → 0 with **zero warnings**, while longitudinal trends still rendered and confirmed "the file loaded".

Fixed by keying off the **carrier array** rather than one hardcoded key, with the spellings in a single `MULTI_CARRIERS` table beside the schema contract — a fourth spelling is a line there, not another silent drop. A wrapper that unwraps to nothing now says so, naming the carrier and its length, because an empty result is otherwise indistinguishable from "this file had no events" — which is exactly how this survived.

Also lands the independent mitigation §8.1 asks for: `integrator-app.js` computed `validateNodeExport`'s warnings and **discarded** them, forwarding only `errors`. One of those warnings — *"no ganglior_events[] — nothing to fuse"* — fires on precisely this wrapper shape, so surfacing it would have announced the defect the first time a batched export was loaded. It now does, which also means a future wrapper spelling that slips past the carrier table still announces itself rather than presenting as "no findings".

9 new assertions driven through `normalizeFile()`, the entry point the app uses. Each spelling is asserted separately — a fix that special-cased one key would leave the other two dropping events, and one combined assertion could not distinguish those. Mutation-verified both directions: reverting the table to `nights`-only reds 6; re-discarding `vr.warnings` reds the wiring leg. The residual limitation is recorded rather than papered over — an unknown wrapper still yields one empty record, and the test pins that it contributes 0 events *and* that the validator warns about it.

Export-inert for the committed fixture — proven: the Integrator TCH golden re-ran through the suite and reproduced byte-identical (`verifiedUnder → d3d84da594a9`); no single-record path changed.
