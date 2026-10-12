---
bump: patch
type: fixed
brief: none
---

A provenance fragment that never arrived is now reported by name instead of wearing the reason of a
ledger that was read and found incomplete.

`ProvenanceLedger.loadNode` throws on an absent `provenance/<App>.json`; `loadBrowser` filtered the
null out and assembled the smaller view, so `verify-provenance.html` told the reader that bundle had
"no committed manifestHash" — and prescribed the remedy for that cause, regenerating
`BUILD-MANIFEST.json`, which from a tree missing the fragment would commit the absence. The verdict
was never wrong: `gateACompare` scores the bundle `missing-committed`, `ok` is false and the page
already refuses by name. What was wrong was the reason, which is the §∅ line — an absence gets its
own named reason, not the nearest one.

`loadBrowser` now computes `missing` BEFORE the null-filter, because filtering destroys the position
that identifies which app was empty, and the field is additive: the assembled view, the result keys
and both gate verdicts are unchanged. The banner (`provenance-banner.js`, the one source of the
page's GATE-A text) appends the absent paths with their own remedy, keeping whatever reason the run
already had; the table pill and the reconciliation lines name the file; `window.__missingFragments`
carries it programmatically.

Measured in Chrome over the served tree on loopback, with `provenance/PpgDex.json` moved away: the
page reports `__missingFragments: ["provenance/PpgDex.json"]`, the banner names the file as an ABSENT
FILE, and `__gateA_ok` / `__provenanceOK` stay false exactly as they were before the change. Restored,
the page returns to GATE A PASS over 9 bundles.

Three plants, each red: the loader stops reporting (`missing` undefined, five assertions); the count
is taken AFTER the null-filter (names the last app instead of the one that is gone — the probe uses a
MIDDLE app for that reason); the banner drops the clause (four assertions). The positional case is why
`fragmentFileFor` is single-sourced beside `fragmentFiles` and the two are asserted to agree: a present
fragment names its own bundle, which is exactly what is gone here.

None of the four changed source files is inlined into any bundle, so no `manifestHash` and no
`computeHash` move.
