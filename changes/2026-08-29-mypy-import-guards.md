---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---
mypy session-lane batch 4a: four unguarded dynamic-import sites. `spec_from_file_location` returns
None when it cannot determine a loader, and `ModuleSpec.loader` is itself optional; both were
dereferenced unchecked in the mutation tooling and one test. The existing failure mode was an
AttributeError on None a line or two later, blaming the wrong statement — the guards raise ImportError
naming what could not be loaded. Fixes both the arg-type and the union-attr at each site: 140 -> 128.
Baseline deliberately not written here; it is set once from a measurement after the final rebase.
