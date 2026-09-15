---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

The rerun brief told the next session to build six DOM scrapers for a capability five of the six tools
already have.

It asserted: *"These tools expose NO `window.__*` result surface … a driver must scrape per tool. This
is the bulk of the remaining work."* Measured the same day, before any work was done on that premise:

| tool | result global |
|---|---|
| `nights-icc-analysis.html` | `window.NIGHTS_ICC` |
| `cgm-hrv-coupling-analysis.html` | `window.CGM_HRV_COUPLING` |
| `qrs-equiv-analysis.html` | `window.QRS_EQUIV` |
| `qrs-yield-analysis.html` | `window.QRS_YIELD` |
| `treatment-response-analysis.html` | `window.TREATMENT_RESPONSE` |
| **`hrv-confound-analysis.html`** | **none — the only one needing a surface added** |

Each is assigned once, at the end of its analysis. So the driver reads one global per tool, five tools
need no source change at all, and the re-cut numbers become machine-checkable against the brief's
delta table by construction rather than by eye.

**The error is the repo's dominant defect class, committed by the author of two rows about it.** The
grep behind the claim was `grep -oE "window\.__[A-Za-z]+"` — it tests a **naming convention**, a
leading double underscore copied from `trio-power-headless`'s `__trioResult`, and not the
**capability**. Every real surface here is `window.SHOUTY_CASE`, so the query could not have returned
a hit however many existed, and its empty result was read as absence. Same shape as §4b's *"reported
success about something it never examined"* and as CLAUDE.md §✅'s `clock.js` "every bundle" claim.

**When a query returns nothing, check that it could have returned something.** One
`grep -oE 'window\.[A-Z][A-Z0-9_]{2,}'` would have.

The brief now carries the table and the post-mortem in place of the wrong paragraph. Nothing else
repeated the claim — #2528's changeset was checked and does not.
