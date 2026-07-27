<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: NODE-EXPORT-RECORDING-DURATION-2026-07-24-BRIEF.md
---
Closes `NODE-EXPORT-RECORDING-DURATION` §4 — its last two follow-ups — and flips it DONE (test-only; no bundle, no `manifestHash`, no fixture).

**§4.3 the class gate.** `integrator-dsp.js adaptEnvelopeNode` derives a node's `endMs` from `recording.endEpochMs` → `durationMin`/`durMin` → `durationSec`/`durSec`, else the last event's `tMs`. A node declaring none collapses to a POINT at t0Ms on an event-sparse night and drops out of the fold — silently, because it presents as "no temporal overlap". That has shipped THREE times: CPAPDex (confirmed live failure 2026-06-11), PpgDex and PulseDex as latent siblings, then HRVDex (a 29-day export that overlapped nothing and dragged every OTHER node's `intersectionMin` to 0). New group **Every node declares a recording length the Integrator can read** (13 assertions, both lanes) brace-matches all 8 node-export builders for a duration key, AND pins the five keys against `integrator-dsp.js` itself so the gate cannot silently under-test if a sixth is added. Structural on purpose: every instance of this class was invisible until a real night happened to be event-sparse. Mutation-checked — deleting `durSec` from `motiondex-dsp.js` reds it with "NONE — this node collapses to a point at t0Ms on an event-sparse night".

**§4.2 refuted, not fixed.** The brief suspected the Polar RR export's timestamp column was not parsed by `parseRRInput`, leaving PulseDex un-anchored. Run against a real capture-host `Polar_H10_02849638_20260726005143_RR.txt` (672 KB, `Phone timestamp;RR-interval [ms]`): `t0Ms 1785027114806` → `2026-07-26T00:51:54`, matching row 1's `2026-07-26T00:51:54.806` exactly, 23655 stamps anchored, `usable true`. It parses the column through the Clock-Contract `parseTimestamp`. The observed `startEpochMs: null` was §2.6 refusing to fabricate a stamp it could not parse — correct behaviour. No fix was needed and the refutation is recorded so it is not re-investigated.

Fleet at close: `ECGDex endEpochMs+durSec · PpgDex durSec · OxyDex durationMin · PulseDex durationMin · HRVDex durSec · GlucoDex durSec · MotionDex durSec · CPAPDex durMin+durSec`.

Also links the two duration briefs `Follows:`/`Followed-by:` — **not** `Supersedes:`: the 07-24 brief asks whether a node declares a length at all, the 07-27 one asks what that length MEANS. Sequential, not a replacement.

`run-tests.mjs` 4098 green · docs-ledger 16/16 · release-ledger 9/9.
