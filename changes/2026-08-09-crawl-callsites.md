<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md
---
The crawl ranks survivors by **count**, and count is not value. On the first file whose work list was read seriously, CPAPDex's two largest killable clusters were **synthetic fixture generators** — `_synthEdfSet` (38 killable) and `_synthRaw` (11), the deterministic night that `regen-cpap-goldens.mjs` and the suite consume; `cohort-gen.js` even calls the first *"test-shaped"* in a comment.

So **49 of that file's 67 "work items" were not production code at all**, and its real list is 18: `_nightFromInput` (8), `prepare` (4), `pressureEnvelope` (2, a shipped metric), plus one each in `detectBreaths`, `buildSessionFromEdf` and `compute`. A summary line reading "67 killable" invites exactly the wrong prioritisation.

Each finding now carries `referencedBy` — where else in the repo the identifier appears, grouped by area (`tests` / `tools` / `adapters` / `dsp` / `root`), counted over a corpus read once and matched on word boundaries so `computeDerivedX` is not counted as a use of `computeDerived`.

**It reports; it never decides.** A `_synth*` heuristic would let the tool classify production code, and that fails silently the day a real DSP function is called `_synthesizeEnvelope` — it would vanish from the work list with nothing to show it had been dropped.

**And it is not a classifier either — measured on the file that motivated it.** It separates the extremes (`compute` 70 refs across root/dsp/adapters; `_synthRaw` 1 ref, tools-only) and **not** the middle: `_synthEdfSet`, a fixture generator, shows 7 refs across four areas while `pressureEnvelope`, production, shows 2. The fixture looks *more* load-bearing than the real code. It is a pointer to the call sites worth opening, not a ranking, and anyone sorting on it automatically will mis-rank `pressureEnvelope`. That limitation is stated in the code beside the feature.

6 new known-answer selftest cases; `biome ci` clean. Tooling only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
