<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: CPAPDEX-STR-SUMMARY-INGEST-2026-08-21-BRIEF.md
---

`acq_evidence.ClockOffset` — the numeric companion to `clock_status` on the acquisition envelope
(schema **1.1.0**; a new FIELD moves the version, unlike `SOURCE_STORED_SPOOL`, which added a value to
an open vocabulary).

`clock_status` says WHICH clocks were involved; this says **by how much they differed, when, and
against what**. The provenance (`measured_at_ms`, `reference`, `method`) is a field rather than a
comment because an offset without it is a bare number nobody can responsibly apply — a device crystal
drifts, so last week's offset is not tonight's.

It DECLARES, it does not correct: the envelope carries the measurement and a consumer decides whether
to apply it, emitting corrected values beside raw device-time ones (INV3/INV4).

Two planted controls, both verified to fail when the invariant is relaxed:

* **Absent ≠ zero.** An unmeasured offset is `None`, never `0.0` — a zero would assert an agreement
  nobody checked, and a consumer would apply 0 s of correction believing it had been verified.
* **A measured ZERO is measured.** `0.0 s` is a real result (the clocks agreed) and is falsy, so
  callers gate on `.measured`, never on truthiness. `if offset_sec:` would silently discard it.

Also narrows the §4 acquisition-⟂-science control to scan VALUES rather than the raw JSON blob: a tier
leaks in as a GRADE, whereas a KEY may legitimately contain a tier word (`measured_at_ms` is a
timestamp, not a claim of `measured` tier). A guard-the-guard test pins that the narrowed scan still
catches a tier appearing as a value, so the narrowing cannot silently disable the control.

Records the full STR clock chain in that brief with per-link status — the box is BLOCKED on a CPAP-side
envelope reader, not unstarted.
