---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---
mypy session-lane batch 2: four signatures that were NARROWER THAN THEIR SHIPPING CONTRACTS. Each
declared a type the function does not actually require, while the body already handled the wider
case — so every correct call read as a type error. `pulse_prominence`/`pulse_prominence_worn` take
`fs: float | None` (the body's first line returns None for a None rate); `_abs_path` takes `object`
(it exists to reject non-str and raises StorageError); `read_link_samples` takes `str | Sequence[str]`
(the body fans a sequence out via isinstance, and both callers always passed lists). Every widening
cites the guard that proves it, so the change reads as the documentation fix it is rather than as
laziness. capture-host mypy 189 -> 183. No Any, no ignores.
