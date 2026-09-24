---
bump: patch
type: fixed
brief: none
---
Two CPAPDex absences both resolved to the **best possible value**, which is the direction that hides a fault.

**An unassessable mask seal is not a perfect one.** `leakSqi` returned `1` when `largeLeakPct` was null or NaN — which is what it is when there is no leak channel, or the mask was never on. So a session whose quality was never measured published the highest quality obtainable, silencing exactly the warning the index exists to raise. A *measured* zero-leak session still returns 1; only the unmeasured one is now null.

**`Math.round(null)` is `0`, and `STR_MODE = { 0: 'CPAP', 1: 'APAP' }`.** A day whose Mode sample sat past the end of the STR signal therefore rendered a badged device-mode chip reading **CPAP** for a device that reported no mode at all. The line's own neighbouring comment already states the intent — *"unknown → null (deviceModeCode is preserved for the caller either way)"* — and rounding an absent sample defeated it before the check could run. The two sibling reads on the next lines (`rin`, `csr`) never round, and the session loop directly above null-checks *before* it rounds: this was the only one of the three that did not.

⚠️ **Tracing the consumers changed the scope, and fixing only the producer would have changed nothing.** `cpapdex-fusion.js` substituted `1` twice more — once per emitted event (`s.sqi != null ? s.sqi : 1`) and once in the night aggregate, which averaged unassessable sessions in as 1. Measured on a two-session night where only one was assessable: `quality.sqi` reported **0.8** against an honest **0.6**, so absence was diluting a genuinely leaky night toward "good". The night now averages the sessions it assessed and publishes `sqiSessions` as the basis.

Emitting null is contract-legal, checked rather than assumed: `docs/EVENT-LEXICON.md` already documents `sqi null` on an emitted event, and `integrator-dsp.js:139` already reads null and weights such an event **neutrally**. That is the fusion layer declining to *penalise* unknown quality — a different act from CPAPDex *asserting* it measured a perfect seal.

Additive on the corpus: all five fixtures moved by `sqiSessions` + the `sqiBasis` wording only. **No `sqi` value moved in any fixture**, because every committed fixture's sessions are assessable — the unassessed path exists only in the twin, which is why the twin carries it.

The twin drives the real functions and pins all three layers with pre-stated numbers: `leakSqi` NaN/null → null while 0 % → 1 and 40 % → 0.6; one `parseStrSummary` call yields the control day (`APAP`) and the absent day (`null`) together; event sqi `[0.6, null]`; night `{sqi: 0.6, n: 1}`. Reverting both files reds 5 of the 8, including `got {"c":0,"m":"CPAP"}` verbatim, with the three controls passing on both sides.
