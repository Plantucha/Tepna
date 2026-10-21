---
bump: patch
type: fixed
brief: none
---

Every tool's unknown-argv refusal now runs behind `IS_CLI`. Importing one of the eleven module-scope adopters no longer refuses the IMPORTER's flags. A suite tripwire reds the next call written at module scope.
