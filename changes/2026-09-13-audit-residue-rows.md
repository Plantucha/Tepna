---
bump: patch
type: changed
brief: none
---

Three confirmed findings from the 2026-09-13 capture-to-Integrator signal audit recorded in
`briefs/RESIDUE.md`: the Integrator's beat check carries no rate (I4), the OxyDex self-ingest
absence-to-zero remainder (O3, self-ingest leg), and PpgDex's non-idempotent Malik pass on an
unexported series (P3, validation-lane leg).

Each was re-verified against `origin/main` at write time rather than transcribed from the audit
card — the cards' line numbers are already stale, and two of the three are PARTIAL remainders whose
sibling halves landed the same day, so a row copied from the card would describe code that is half
fixed.
