---
bump: patch
type: fixed
brief: PYTHON-TYPES-AND-FORMAT-2026-08-27-BRIEF.md
---
mypy session-lane batch 3: two heterogeneous result dicts given TypedDicts. mypy infers a dict
literal's value type from its initial entries, so every later key of a different type reads as an
error — 11 of them across `as11_clock.analyze` and `rec_to_psl.parse_header`. Both are RECORDS with
fixed known keys, not mappings, so declaring the keys is the accurate description as well as the
fix. Both are `total=False`, deliberately: each has a real early-return path that yields a subset.
Typing `settings` precisely also exposed `(tlv.get(k) or [None])[0]` — an idiom that reads as
"first, else None" but cannot type, since `[None]` is not a `list[int]`; replaced with a named
helper of identical behaviour. No Any, no ignores. check.sh's baseline is deliberately NOT touched
here — three PRs already contend for that line and it is set once, from a measurement, after they
settle.
