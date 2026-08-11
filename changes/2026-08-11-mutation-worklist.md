<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Add tools/mutation-worklist.mjs and record the owner's ratification of a 99% target.

The target is now 99% OF DISTINGUISHABLE (raised from 90%, 2026-08-11). The arithmetic of that number
is why the tool exists: at ANY kill/classify split, ~98.5% of the outstanding survivors must be
resolved — killed if killable, classified if not.

  equivalents found   kills needed   survivors resolved
       0 %               5497          5497 / 5590   98.3 %
      30 %               3837          5514 / 5590   98.6 %
      60 %               2177          5531 / 5590   98.9 %

Classifying aggressively changes the kill count enormously and the resolved count barely at all, so
the work is every survivor rather than a choice of strategy.

The list is REGENERATED from the sweeps and the ledger on every run, never transcribed — this
programme has already been bitten twice by copied numbers (the fleet map's sampled column; ledger
entries orphaned by a line move). 499 functions hold 5885 unresolved survivors; the top 30 are 37%.

It reports VERIFIED state, not claimed state: it reads the last sweep, so kills from tests written
since do not appear until that file is re-swept. A missing sweep is reported rather than silently
skipped, since an absent file must not read as "no work left".

9 known-answer selftests, including the load-bearing arithmetic that the RESOLVED count moves less
than 1% across equivalence rates from 0 to 60%.

Also reconciles §5 of the brief, which recommended stopping after 50 functions — correct for a 55-60%
target and wrong for 99%, where the tail cannot be skipped. The ordering survives; the stopping rule
does not.
