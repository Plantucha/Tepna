<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
brief: ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md
---

Re-check the Acquisition Evidence Contract's §21 acceptance list **against shipped code** now that all
three phases have landed, and record the result in the brief.

**21 of 22 met. One genuinely open:** *"O2Ring LIVE acquisition can produce it."*
`acq_evidence_o2ring` exposes `assemble_dat` and nothing else, and `SOURCE_LIVE` is referenced only by
the CPAP adapter. The live OXYFRAME path is real and writes a real artifact, and emits no envelope —
`acq_evidence` appears in `capture.py` only on the CPAP branch. Spec §10 requires BOTH O2Ring paths;
Phase A took the stored half.

The brief stays **IN-PROGRESS**. Three phases shipping is not the contract being complete, and
flipping to DONE with a §21 criterion unmet would be the false-completion this contract exists to
prevent.

Also checks the versioning box, which was met and unrecorded: one canonical `AcquisitionEvidence` at
schema 1.1.0, MINOR-bumped when `ClockOffset` was added — while a new VALUE (`SOURCE_STORED_SPOOL`)
correctly did not move it.

Audited by code, not by checkbox: this repo's boxes go stale inside DONE briefs, so the code is the
authority.
