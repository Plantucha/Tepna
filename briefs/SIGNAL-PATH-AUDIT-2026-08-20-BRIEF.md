<!--
  SIGNAL-PATH-AUDIT-2026-08-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-20 · **Follows:** `AUDIT-PROMPT.md` (the charter this ran under), `DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md`

# Whole-signal-path audit (owner-requested) — three date/clock divergences, one shared root pattern

> **Scope:** the full path, one hop earlier than the suite per the charter: capture-host writer seam →
> DSP parse boundary → node compute → export/Integrator fusion. Four parallel auditors under
> AUDIT-PROMPT's discipline (invariant + counterexample, reproduction required, §✅ excluded); every
> surviving finding **re-verified by execution** in the main session before entering this brief.
> **Method note:** the charter's precedent (6 of 14 candidate findings dead on execution) held — the
> auditors self-refuted most of their own candidates; the three below survived execution.

## 0 · Verdict

The health-number-producing path is clean and hard — every high-severity class came back defended and
regression-locked (§4). The residual is a cluster of three **date/clock edge-case divergences**, all
latent or low-severity, sharing one root: a site re-implements date/roll validation and diverges from
the guarded canonical pattern the codebase otherwise uses (`clock.js:_ckMk` round-trip;
`polar_psftp.get_local_time`'s try/except datetime). Three failure modes of one missing discipline:
F1 rolls to a wrong value, F2 throws and vanishes, F3 mis-dates.

## F1 · `glucodex-dsp.js` `_ckDateOnly` — bare `Date.UTC`, silent calendar roll (LOW)

The nutrition **date-only** parser (Cronometer daily export: Date column, no Time) builds `tMs` with a
bare `Date.UTC(+m[1], +m[2]-1, +m[3])` — the ONE stamp path in the file that skips `_ckMk`, the guard
created (DEEP-AUDIT-II §12.3) precisely to reject out-of-range components.

- **Reproduction (executed):** `Date.UTC(2026, 13-1, 45)` → 2027-02-14; `Date.UTC(2026, 2-1, 30)` →
  2026-03-02. A corrupt date lands a meal on a fabricated day, which feeds the meal↔glucose join.
- **Reach:** low — real exports carry valid dates; the CGM value path is untouched.
- **Fix:** route both branches through `_ckMk(...,0,0,0)` → NaN on non-round-trip (the file's own
  pattern); add a `2026-13-45 → NaN` assertion to the glucodex group. Gate cost: GlucoDex re-bundle +
  suite + provenance; no fixture output moves (committed corpus dates are valid).

## F2 · `capture-host/oxyii.py` `parse_get_info` — per-field day check accepts Feb 31; consumer throws, telemetry silently stops (LOW, a #1543 regression)

The RTC guard `1 <= d <= 31` is per-field, not calendar-aware. **Reproduction (executed):** payload
bytes `[24:31]` = 2026-02-31 → `rtc` returned non-None; `capture.ring_clock_offset_s` then does
`datetime(2026,2,31,…)` → `ValueError: day is out of range for month`, swallowed by the BLE callback →
the ring-vs-host offset telemetry **silently stops publishing** for that read. A battery-event-mangled
RTC — exactly when the telemetry matters — is the plausible trigger.

- **Correct sibling (the fix source):** `polar_psftp.get_local_time` round-trips through `datetime()`
  in try/except → None. The existing §2.7 test covers month-13/day-32/hour-24 but no
  calendar-impossible date — extend with Feb-31/Apr-31/Feb-30 + a valid-date control.
- **Status:** fix + tests built and verified (Feb-28 still decodes; ruff clean) on branch
  `claude/oxyii-rtc-calendar-guard-v4q` — committed, **deliberately unpushed pending owner go-ahead**.

## F3 · `integrator-dsp.js` `reconstructEventTMs` — t-only events at +12–24 h mis-dated by −24 h; the "EXACT ≤ 24 h" comment is FALSE (LATENT)

The fallback reconstruction (legacy t-only `ganglior_events`) pins `prevTMs` to `t0Ms`; the parser's
day-roll fires only when the candidate sits > 12 h BEFORE `prevTMs` (`CK_ROLL_SLACK_MS`). An event whose
true offset is in **[12 h, 24 h)** yields a same-date candidate 0–12 h before `t0Ms` — inside the
slack — so the roll is refused and the event lands **24 h early** (before the recording started).

- **Reproduction (executed):** `t0Ms` = 2026-06-17 20:00; `t:"08:00:00"` (+12 h) → 06-17 08:00
  (−24.00 h); `"09:00:00"`/`"11:00:00"` likewise. +11 h 59 m reconstructs correctly.
- **Reach:** latent — every current emitter writes absolute `tMs`, which the fast-path returns before
  any roll. Bites: legacy/external t-only exports (which Clock Contract §6 REQUIRES consumers to
  tolerate) on a > 12 h recording (24 h ambulatory ECGDex per AMBULATORY-MODE).
- **The comment is the sharper defect:** it asserts the reconstruction is "EXACT for any recording
  ≤ 24 h" and warns maintainers not to change it. The true exact domain is ≤ 12 h.
- **Fix options:** (i) pick the candidate day minimising |candidate − t0Ms| given Δ < 24 h (stays a
  pure, order-independent function of (`ev.t`, `t0Ms`)); or (ii) at minimum correct the comment to
  ≤ 12 h. Gate: a failing assertion from the reproduction above in the integrator group; Integrator
  re-bundle; no fixture moves for the tMs-carrying corpus.

## 4 · Verified negatives (executed or line-verified — recorded so they are not re-hunted)

- **HRV differential parity:** rMSSD (÷N), SDNN (÷N−1), pNN50 definitions byte-identical across
  ECGDex/PulseDex/PpgDex; HRVDex ingests, never recomputes. No drift.
- **Spectral honesty:** the `hf≈rmssd²` proxy is gone; LF/HF from real Lomb–Scargle, `hf>0` guarded on
  every surfaced path; the one legacy `lfHf` helper has zero surfaced consumers.
- **Fabricated absence (compute):** hardened across HRVDex composites, CPAP AHI/ODI, GlucoDex
  ADRR/GRADE. The OxyDex `meanSpo2 … : 0` seeds are DEAD branches (rows ≥ 60 + the line-672 band
  filter guarantee a non-empty array) — normalize on touch, not a live defect.
- **Fabricated redundancy (fusion):** TCH refuses non-distinct corners and disambiguates repeated
  `schema.node`; `timingSource:'none'` filtered; noisy-OR/PB posterior sources are physically distinct
  and collapse to a distinct-node count. No confidence inflation found.
- **Writer seam:** the O2Ring 1-column pleth (no 3-channel fan-out), PI/motion byte order, PPI column
  order, blank-not-zero fills, `_now()` DST/backward-step discipline — all fixed and regression-locked.
- **Refuted candidates (do not re-chase):** glucose auto-detect boundary (`med < 30`) physiologically
  safe both directions; `parseDeviceRR` last-column read correct for `_RR.txt`; oxydex headerless-
  semicolon fallback degrades to an honest empty; `offsetMin` overlap math converts correctly;
  `_dig` `||`-chains unreachable for a legitimate 0.

## Done when

- [ ] F1 fixed + gated (`2026-13-45 → NaN` assertion) — GlucoDex lane.
- [ ] F2 landed (branch exists; owner go-ahead) — capture-host lane.
- [ ] F3 fixed (option i) or the false comment corrected to ≤ 12 h (option ii), with the reproduction
      as a gate either way — Integrator lane.
- [ ] The three fixes reference this brief; §4's negatives stand as the record for the next audit.
