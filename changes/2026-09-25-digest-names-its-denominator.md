---
bump: patch
type: fixed
brief: none
---

`qc_digest` now says which denominator its percentage came from: a union-span figure reads `52%~session`
and an unlabelled one `52%~basis?`, while a device-basis figure stays bare as before.

#3067 stopped the VERDICT object presenting a session-basis coverage as the device's. **This line is the
same conflation for a human reader** and still printed a bare percentage. `summarize` divides by the
device's own extent where it can bound one and by the session span — the union across every device —
where it cannot, so on a night whose directory holds two capture sessions a device that recorded
perfectly through one of them reads ~52 %. `H10 52%` is indistinguishable from packet loss, which is the
decision this digest exists to inform. `span_basis` is uniform per device (one `dev_span` each), so one
suffix is honest for the whole segment.

⚠️ **THE UNIT AS ASSIGNED WAS AIMED AT THE WRONG CONSUMER, AND CHECKING FIRST IS WHY THIS IS SMALL.**
It was to make `solid_night.py` / `solid_night_inputs.py` read device-basis coverage only. **They do not
consume nightqc's coverage at all** — zero references to `QC-SUMMARY`, `QC-VERDICT`, `nightqc` or
`qc_verdict` in either file. `solid_night_inputs.completeness` computes its own ratio against the **worn
interval** (`rows_between(p, start, end)` over `rate × (end - start)`), which is a better denominator than
either of nightqc's and is already immune to the multi-session artifact. Enumerating the actual readers of
a nightqc coverage value across the whole tree gives three: `qc_verdict` (fixed in #3067), `qc_digest`
(fixed here), and `nights_index.py:339`, which is a different quantity of its own (`1.0 - gaps/span`).

So instead of a change there, that immunity is **pinned**: a source-keyed guard asserts neither
`solid_night` module reads a QC object, because "does not read it" is a property a behavioural test
cannot observe, and a later refactor could wire the term to QC's coverage for convenience and silently
inherit the union-span artifact. It carries a non-vacuity assertion so the scan cannot pass by matching
nothing.

Two plants (both fail against `origin/main`), one control and the guard (both pass on both sides — the
guard pins a property that already holds, which is what makes it a guard rather than a fix).
