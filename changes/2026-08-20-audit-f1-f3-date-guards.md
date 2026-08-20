---
bump: patch
type: fixed
brief: SIGNAL-PATH-AUDIT-2026-08-20-BRIEF.md
---

**Audit F1 + F3: the two Dex-lane date/clock divergences fixed and gated.**

**F1 (GlucoDex):** `_ckDateOnly` — the ONE stamp path in the file that skipped `_ckMk`'s round-trip —
built nutrition dates with bare `Date.UTC`, so a corrupt Cronometer date silently ROLLED
(`2026-13-45` → 2027-02-14, Feb 30 → Mar 2) and fed the meal↔glucose join a fabricated day (Clock
Contract §2.7). Both the ISO and DMY/MDY branches now route through `_ckMk` → NaN on a non-round-trip
date; the §5.5 nutrition group gains the corrupt-date cases (impossible rows DROPPED, valid siblings
survive).

**F3 (Integrator):** `reconstructEventTMs`'s comment claimed the pinned-anchor reconstruction was
"EXACT for any recording ≤ 24 h" — false: the parser's 12 h roll slack refused the day-roll for t-only
events 12–24 h after t0Ms, landing them 24 h EARLY (executed reproduction: t0 20:00, `08:00:00` →
−12 h from start). Fixed with a pure post-correction — the event window is [t0 − 60 s, t0 + 24 h), a
below-window candidate advances exactly one day — preserving order-independence; the false comment is
rewritten to record the defect. Four regression cases in the integrator group (the +12 h/+15 h band,
the 60 s grace, the past-grace boundary). Latent on the current corpus (every emitter writes absolute
`tMs`); bites legacy/external t-only exports on >12 h recordings, which §6 requires consumers to accept.

Both fixes re-bundle GlucoDex + Integrator (+ orchestrators/analysis/docs); full `npm run check` green;
`verify-fixtures` re-ran and stamped 10 fixtures — of which the GlucoDex legs + the Integrator golden
are this change's own debt, and the PpgDex/HRVDex/ECGDex/OxyDex/PulseDex re-stamps discharge
PRE-EXISTING `verifiedUnder` debt from earlier merges today (#1587 moved the shared clock/ppgdex
closure), discharged here by the corpus holder per house practice.
