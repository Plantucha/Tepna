<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
#2034 moved `oracleNight`'s fit/score split onto the **overlap** of the two beat trains — but only
*inside* the function. The split was computed and never returned, so both sibling tools kept
computing the pre-fix midpoint on the **ECG's extent alone**:

    tools/pat-residual-structure.mjs:276   const mid = R[Math.floor(R.length / 2)];
    tools/pat-drift-attribution.mjs:207    const mid = R[Math.floor(R.length / 2)];

Both files were edited by #2052 for refusal naming and the stale split survived the edit. They read
`orc.mode` from the oracle while splitting on a rule the oracle had stopped using — a fix that landed
in one place while its copies survived, which is why the repair is the **return value** and not a
third correct copy.

Two consequences, in opposite directions. Where the PPG covers only the early part of a long ECG
record, the scored half lands after the PPG ends, falls under the 50-lag floor and is silently
`continue`d — those are the same nights #2034 recovered, so they were missing from the denominators
of the ticked §6/§6b boxes. Where the PPG starts later than the ECG, the scored half includes beats
used to fit the mode, breaking the out-of-sample discipline `pat-residual-structure.mjs:20-21`
explicitly claims.

`oracleNight` now returns `lo`/`mid`/`hi`, and both consumers take
`R.filter(t => t >= orc.mid && t <= orc.hi)`. **The `hi` bound is load-bearing and a `mid`-only
substitution would have left the bug half-fixed:** the oracle's own second half is
`rIn.filter(t >= mid)` where `rIn` is already clipped to the overlap, so filtering all of `R` on
`t >= orc.mid` re-admits precisely the after-the-PPG-ends beats #2034 removed.

Selftest 23 → 25: the split travels with the success object (`lo <= mid <= hi`), and a **refusal
carries none of those fields** — the consumers' guard is `orc.refusal`, so a refusal wearing
score-shaped fields would let a caller read a split that was never computed. Anti-vacuous by
construction: `origin/main`'s `oracleNight` returns all three as `undefined`, so the assertion cannot
pass against unfixed code.

Found by Heron's cross-family consumer-trace pass; verified independently here before building.
