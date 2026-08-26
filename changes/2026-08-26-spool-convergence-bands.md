<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: CPAP-SPOOL-ACQUISITION-2026-08-25-BRIEF.md
---

Pre-state both §11 convergence band sets in the spool brief, **before** the attended pull, so the
hardware answer SELECTS a band set rather than shaping one.

Set B (summary, on the existing #1781 `attachStrSummary`/`csrPbCrossCheck` path) is primary — the
documented Summary spool carries session statistics, which have no paired samples and so cannot feed
the v1.1 sample-pair comparator. Set A (waveform) is conditional on a positive detail-spool hit.

Two points recorded because they are the ones most likely to be lost:

* **The branch selector is a POSITIVE HIT ONLY.** A `-32602` on a guessed spool-type name refutes one
  string, never the branch — the same error answers a malformed address. Failed guesses are not
  evidence of absence.
* **The AHI band is SYMMETRIC while #1781's CSR band stays ASYMMETRIC**, resolving item 4's "asymmetric,
  per #1781's pattern" rather than inheriting it silently. #1781 is asymmetric because CSR ⊂ PB — two
  different quantities, so one exceeding the other is not the same finding as the reverse. AHI-vs-AHI is
  the same quantity from two scorers; neither direction is privileged.

Magnitudes are derived, not picked: the 0.5 /h AHI floor is ~10× the 0.05 /h agreement CPAPDex already
shows against STR.edf scoring; the 0.02 waveform slope band is ~7× the two shipped n=1 pins (0.9977,
0.99798) and still ~7× tighter than the shipped 0.15 alarm; `excursionFrac ≤ 0.10` is twice the ~5 %
that sits outside the LoA by construction.
