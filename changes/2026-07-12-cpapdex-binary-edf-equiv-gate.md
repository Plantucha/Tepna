<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [CPAPDex, suite]
brief: CPAP-REAL-CORPUS-2026-07-11-BRIEF.md
---
Give CPAPDex a binary multi-file EDF equivalence leg — and, with it, the suite's first `compute() ≡ committed export` gate that actually runs in CI.

`FIXTURE-PROVENANCE.json` asserted that CPAPDex *"can't join the Phase-9 compute() ≡ committed export
equivalence gate (its real input is a BINARY multi-file EDF set, not a `{text}`/CSV)"*. That was false.
An input is just bytes — `readEDF` takes an `ArrayBuffer` — so a binary EDF set joins the gate exactly
like a CSV. CPAPDex was the only node whose GATE-C leg was synthetic-only, and the existing golden
sidesteps `readEDF` entirely (it feeds `_synthEdfSet`, which hands the DSP already-DECODED structures),
so the **binary parser and the EDF+ TAL annotation reader were never in the gated path at all**.

**The bigger problem this surfaced.** Every one of the fleet's eight equivalence legs **skips in CI**:

    ⊘ OxyDex / PulseDex / HRVDex / GlucoDex / PpgDex / ECGDex / HRVDex(events) / PulseDex(events)
      "committed input absent — uploads/ is gitignored (personal data); this leg runs locally"

Their inputs are real recordings, so they are gitignored, so CI never executes the diff. The gate that
CLAUDE.md §🔏 relies on to catch "a code change that moved a fixture's output" has been running **only
on the maintainer's machine**. A regression that moved an export would go green through CI.

Committing a real night's EDFs is not an option either: the EDF+ header `recording` field carries a
persistent **device serial**, and this repo is public (brief §F3).

**So synthesize the input instead.** `tools/make-synthetic-edf.mjs` emits a deterministic five-file
ResMed EDF set (BRP/PLD/SA2/EVE/CSL) — real `.edf` bytes with closed-form waveforms calibrated to a real
corpus's *distributions* (median pressure ~9 cmH₂O, RR ~16/min, TV ~0.35 L, EPR 3, central-dominant
events), containing **no recording of any person** and no device identifier (header identity fields
blank). Being personal-data-free, it can be **committed** — so its diff has teeth everywhere:

    ✓ CPAPDex (binary EDF).compute() ≡ committed export   — byte-identical

It drives the full chain the `_synthEdfSet` golden skips: `readEDF` (binary parser + TAL annotations) →
`buildSessionFromEdf` → `buildNight` → `cpapBuildExport`. Equivalence group: 17 → 20 assertions.

It is also the **first fixture in the repo whose INPUT bytes are themselves committed and
content-addressed** — GATE B now verifies real `inputHashes` over real committed bytes, not just an
output hash. The generator is deterministic (no RNG, no `Date.now()`), so re-running it reproduces the
five files byte-for-byte and the hashes stay stable.

**Bonus — it covers §F6.** The real corpus reports `oximeter-not-connected` on 217 of 222 sessions, so
the SA2 oximetry lane (`selfGateDesat` / `detectDesats` / `oximetryLane`) had **never run on any gated
input**. The synthetic set ships a working SpO₂ channel with genuine desaturations, so that dead lane is
finally covered (ODI 1.6, nadir 87.1%, 4 desats, self-gate active).

The retired "can't join" claim is annotated in place rather than deleted, so the record of what was
believed — and why it was wrong — survives.

Same-shape synthesis would give **every other node** a CI-executable equivalence leg. That is the obvious
follow-up and is worth doing: right now the fleet's strongest correctness gate does not run in CI.
