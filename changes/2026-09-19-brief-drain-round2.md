---
bump: patch
type: changed
brief: none
---

Round-2 drain of the five stalest capture-host briefs — and the headline is not a stamp: **the ~17 days
of CPAP spool data is recovered.**

Docs-only. Three stamped, two verified unchanged.

## 🔴 The spool backlog was retrieved, 2026-09-19 10:00

`CPAP-SPOOL-ACQUISITION`'s header was written when the spool had two committed rounds and had been
stuck since 2026-09-01. The ledger now has **four**:

| row | from | status | bytes |
|---|---|---|---|
| 2 | `2026-09-01T16:00` → cursor `2026-09-17T16:00` | MORE_DATA_PENDING | 3434 |
| 3 | `2026-09-17T16:00` | NO_MORE_DATA | 424 |

That range **begins at exactly the address the loop discarded on 22 consecutive pulls**.

**Attributed by reading the deployed file, not by inferring from behaviour:**
`/opt/tepna/capture-host/cpap_spool.py` carries `next_from != cursor` with mtime **2026-09-18 21:49** —
before the 10:00 advance. The #2647 fix is live and did what it was built to do.

The brief's blocker is unchanged in kind — no fragment log is committed and the pull was not attended —
but item 2 ("the assembler fed those real fragments") now **has real fragments**, which it did not on
2026-09-02.

## ⚠️ Line citations into `capture.py` rot faster than triage can re-stamp them

Two of the three references in `CPAP-SPOOL-ACQUISITION` drifted **again in 17 days**:
`_maybe_start_cpap_spool_pull` 7277 → **9445**, import 6956 → **9060**. Only `cpap_spool_caller.py:64`
held — that file did not churn. And the header already records one prior drift (6474 → 7277), so this is
the **second**.

Same in `POLAR-ONBOARD-BACKUP-FOLLOWUPS`: `capture.py:1791` → **2278**, while the value it cites
(`drop_not_worn_sec` = 180) is still correct.

**So: cite the symbol, not the line.** `_maybe_start_cpap_spool_pull` has not changed once. A citation
that rots while the fact it cites stays true is worse than none — it teaches a reader to distrust a
correct header.

## ⚠️ A guessed token returning zero is not an absence

Earlier tonight I searched `webmon.py` for the §4 probe as `rr_accept`/`rr-accept`, got **0**, and
explicitly declined to conclude it was gone. Correct call: the endpoint is **`POST /api/polar/recording`**
(`webmon.py` `polar_recording`, over `polar_psftp.recording_control`), landed in #2042 and present now.
Both Polar briefs are stamped with the real identifier so the next picker-up does not repeat my grep.

## Verified unchanged — the third outcome, and the correct one here

- **`VIGIL-COEXISTENCE-FOLLOWUPS`** — the one open item is a **physical** walk-away test with no code on
  either side. **Not checkable from the code at all**; no landing could alter it.
- **`SPORT-CAPTURE-ANDROID`** — new lane, gated on an owner greenlight, no unit startable from the repo,
  untouched since creation.

Both are parked on something a git log cannot see, so "nothing landed" would have been the wrong shape
of answer — the honest one is that the code is not where their blockers live.

## Surfaces checked, stated per brief

`CPAP-SPOOL-ACQUISITION`: `capture.py`, `cpap_spool_caller.py`, `cpap_spool.py`, plus the box ledger and
the **deployed** file. `POLAR-ONBOARD-BACKUP` + `FOLLOWUPS`: `webmon.py`, `polar_psftp.py`,
`settings_schema.py`, `capture.py`, and #2042's own diff. `VIGIL-COEXISTENCE` / `SPORT-CAPTURE-ANDROID`:
no code surface — stated rather than searched.
