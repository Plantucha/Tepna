---
bump: patch
type: added
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

**`tools/guide-directive-audit.mjs` — #1529's four numbers now have a re-derivation instead of a
citation, and committing the tool immediately found 2 defects it had missed.**

#1529 published *186 lower-tier cards / 76 carrying a band / 53 using verdict words / 3 issuing a
clinical directive* from a script that lived only in `/tmp`. `PPGDEX-ALGORITHM-DEEP-DIVE` §5 records
exactly that failure — a jitter bound became unverifiable because "the apparatus was never committed".
The tool reproduces 186 / 76 / 53 exactly.

**Found on its first committed run**, both OxyDex, both `heuristic`, both matching `urgent` — a word
the scratch pattern lacked: **Nadir Depth Bins** (*"Severe — urgent"*) and **LCSP** (*"Persistent
hypoxemia — urgent evaluation"*). Both directives dropped, both given a `no-norm-note`. The fleet is
back to a single directive-bearing lower-tier band: **MOS**, declared in the tool with its disclaiming
text quoted.

**What it deliberately does NOT measure: citation presence.** Four such proxies were built and all
four were wrong (135, 68, ~26, 69) because the proxy measures citation *locality* and this suite
centralises citations by design. The discriminator is *does the band issue a clinical directive it has
not earned*.

Carries the guards tonight's work argued for: an **entry guard** (#1530 found five tools executing on
import, one of them `release.mjs`), a real **`--help`** that does not run the audit, and an
**anti-vacuity refusal** — fewer than 7 guides or zero banded cards exits 2 rather than reporting a
well-formed zero. Seen to RED first (exit 1 on the two undeclared hits) before being believed.
