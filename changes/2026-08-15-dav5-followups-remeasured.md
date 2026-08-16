---
bump: patch
type: changed
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

`DEEP-AUDIT-V-FOLLOWUPS` §4 listed nine items as *"still open from DEEP-AUDIT-V"*. **Eight are closed.**

Verified by reading the code each one cites, not by trusting a status header:

| item | state | evidence |
|---|---|---|
| F17 O2Ring drawn-axis `timingSource` | DONE | `ppgdex-dsp.js:564`, `:675` |
| …and its three retractions | **all landed** | `O2RING-SYNTHESISED-AXIS` §3 · `WEARABLE-HOST-AXIS-FOLLOWUPS` *"RETRACTED IN PART"* · `PAT-PROXIMAL-DISTAL-PAIR` §2a *"PROVENANCE CORRECTION"* |
| F12 gyro unit oracle | **REFUTED** | this brief's own §F12 |
| F16 PulseDex present-gates | DONE | `pulsedex-dsp.js:241` |
| F4 TCH AMBIGUOUS verdict | DONE | `integrator-dsp.js:2613` |
| F5 collapsing corner labels | DONE | `integrator-tch.js:318` |
| F7 longitudinal sleep-date join | DONE | `integrator-longitudinal.js:231` |
| F13 `hostAxis.independent` at the export boundary | DONE | `ppgdex-dsp.js:696` |
| F20+F21 ECGDex worker clock | DONE | `ecgdex-app.js` |
| **F8** coupling bout-clustering | **OPEN — data-blocked** | needs a real OSA stream; the trio corpus is a healthy sleeper |

**F8 is not waiting on code.** It waits on a recording this machine does not have, which is a different
kind of open from the rest and should not be ranked beside them.

⚠️ **A stale "still open" list costs more than a stale DONE.** A reader who trusts this section spends a
day re-fixing eight closed findings — and those eight were closed by people who then did not return to
update the list they had been working from. Same asymmetry as a false refutation: a false green is
eventually caught by the thing it gates; a false *"there is work here"* is caught by nobody.

The brief stays **IN-PROGRESS**: §1's three decisions are owner calls (writing 68 rows means asserting 68
evidence tiers) with the `no-fabricated-tier` ratchet holding meanwhile, and §4's Tier-4 coverage debt —
the browser lane, `mutate.mjs`/`mutmut`, the E2E fold, `cohort-worker.js` — stands untouched.

Docs only: no code, no bundle, no fixture.
