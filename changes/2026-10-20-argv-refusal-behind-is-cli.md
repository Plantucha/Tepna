---
bump: patch
type: fixed
brief: none
---

Every tool's unknown-argv refusal runs behind `IS_CLI`, so importing one of the eleven module-scope adopters no longer refuses the IMPORTER's flags, and a suite tripwire reds the next call written at module scope.
