---
bump: patch
type: fixed
brief: none
---

`mutation_diff.root_reads` no longer scans a virtualenv that lives inside `capture-host/`. A real `.venv/` directory — the layout `check.sh` resolves and the module's own refusal text prescribes — fed every string literal in site-packages into the root-reads population, and the equality pin `test_the_REAL_suite_has_exactly_the_root_reads_we_know_about` went red on any fresh clone (the rig's symlinked `.venv` is not followed by rglob, so the rig never saw it). Two rules, both existing precedents in the repo: a dot-directory is never scanned, and a directory carrying `pyvenv.cfg` is a venv whatever it is called. Closes residue `2026-09-25-root-reads-pin-scans-an-in-tree-venv`.
