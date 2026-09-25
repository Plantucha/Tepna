---
bump: patch
type: fixed
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---

The ACC companion's `…_ACCRUNS.txt` sidecar reaches `parseDeviceACC`, and an epoch whose window
intersects a recorded blanking run refuses its posture (`unknown` + `positionReason: 'blanking-run'`)
instead of stamping a confident wrong one.

Posture is the MEDIAN gravity vector over a 5-minute window, so a held ACC does not produce an absent
label — it produces a definite one. **Measured on a planted night: a blanked 5 minutes in the middle
of a supine night reported `lateral`**, a posture change the wearer never made, which propagates into
every event's `meta.position` and weights OSA confidence downstream.

⚠️ The sidecar gets its OWN companion kind, `accruns`, never `runs`. A kind IS the slot name in
`pairCompanions`, so a shared `runs` would put `_ACCRUNS` and `_ECGRUNS` in one slot on the SAME
device, where nearest-stamp decides between two identical stamps — the ECG's own sidecar silently
replaced by the ACC's, looking exactly like a working pairing. A test pins that both survive.

No sidecar ⇒ byte-identical: 0 non-provenance lines moved across all ten ECG and PpgDex goldens.
