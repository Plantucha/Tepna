<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md
---

**The O2Ring LIVE acquisition envelope** — the last open §21 acceptance criterion. Spec §10 requires
BOTH O2Ring paths and forbids merging them into one indistinguishable source; Phase A shipped the
stored half, and this is the live one. `assemble_live` sits beside `assemble_dat` and differs in
`source`, so a reader can always tell which path produced a night.

**Wired to its consumer, not just exported.** `run_oxyii`'s close seam calls it and writes the envelope
beside the SpO2 CSV — and only for a KEPT file, since a header-only session is discarded there and an
envelope describing a deleted file is evidence about nothing. `find_unwired` reports 0 unexplained with
no ALLOW entry.

**The gap fields are deliberately UNKNOWN, and that is the point of the adapter.** The live path
carries rich gap accounting, but it belongs to the **PPG stream** while this envelope describes the
**1 Hz SpO2 CSV** — a different stream from the same device. Reporting PPG grid gaps as this artifact's
`transport_gaps` would attribute one stream's losses to another's file: a fabricated measurement
wearing the shape of a real one. The PPG figures ride in `provenance` under their own name, so nothing
is lost and nothing is misattributed.

`validation` is UNKNOWN for the same kind of reason: the live path WRITES bytes, it does not verify
them — no hash, no re-read, no trailer. Claiming VALID would assert a check nobody ran. That is the
honest asymmetry with the stored path, where `verify()` genuinely re-reads.

`session_id` is the 14-digit start stamp the filename already carries, so **OxyDex's existing reader
joins this envelope with no new matching rule** (#1752 matches session_id inside the artifact
filename) — the same discipline that made the CPAP reader reuse `attachStrSummary`'s day rule.

⚠️ **A near-miss recorded because it nearly shipped twice.** The first projection called
`grid.summary()` behind a `hasattr` guard — and neither `O2PpgGrid` nor `O2PpgFrameLedger` has that
method, so it would have written `null` for both provenance blocks while reading as correct code.
Identical shape to the EdfSink `final_path` defect: a guarded call to a missing method degrades into a
SILENT ABSENCE. Replaced with explicit field projections, and pinned by a test that asserts real
values.

⚠️ **Lands INERT.** The box's daemon holds its modules until the next restart, so the first live
envelope comes from whichever capture runs after the box's morning restart — "merged" is not "active
tonight".
