---
bump: patch
type: fixed
brief: none
---

`mutmut` pinned to 3.8.0 in both places it is installed — `requirements-dev.txt` and the CI
mutation job's inline `pip install`, which never reads the requirements file. `>=3.7.0` let CI run
3.8.0 against every local venv at 3.7.0, and the two generate different mutant sets: a gate that can
disagree with its own local run by version.
