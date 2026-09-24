---
bump: patch
type: fixed
brief: none
---

`test_schema_defaults_match_the_daemon_fallbacks` compared capture.py's `.get("leaf", <literal>)`
fallbacks against the schema by keying on the **bare leaf**, which cost two things. It blamed the wrong
section — adding `heap_probe.enabled: False` (#2999) red **`watchdog.enabled`**, in a PR that never
touched the watchdog, because both leaves are `enabled`. And the only way past that failure was to
**delete the literal**, after which the scan could not see the new section at all: a gate satisfied by
removing the evidence it compares trains the next author to remove it.

The scan is now an AST walk attributed by **section**, and the binding is resolved **inside the
enclosing function** — which is not a nicety. A function-blind version of this same scan reported
`seal.poll_sec` holding both 600 and 300 and `archive.poll_sec` holding both 3600 and 60: `scfg` is
`cfg.get("storage")` in one function and `cfg.get("seal")` in another, `acfg` is `alerts` in one and
`archive` in another. **Four real paths rendered as two conflicts that do not exist** — a false finding
that was one commit away from being filed as a defect in capture.py. Scoped, it separates them cleanly:
storage 300, seal 600, alerts 60, archive 3600, and **zero** paths in capture.py hold two literals.

Effects, measured:

| | leaf-keyed | section-attributed |
|---|---|---|
| schema defaults verified from source | 8 (partly by over-matching) | **16** |
| paths the scan resolves at all | leaves only | 65 |
| `heap_probe` keys checked | 0 — the section was invisible | **5** |
| paths falsely reported as holding two literals | n/a | 0 (3 under a function-blind walk) |

`heap_probe`'s five keys join `settings_schema.SETTINGS`, so the window can be set without editing code,
and capture.py's `hcfg.get("enabled", False)` writes its literal out again now that a literal is safe.

⚠️ **The population is an EQUALITY, not a floor.** `>= 8` cannot notice a key falling out of the scan's
reach — which is precisely what the leaf-keyed workaround did. `SOURCE_CHECKED_PATHS` pins it, and it
earned that on its first run: adding the five `heap_probe` keys moved it 11 → 16 and the assertion said
so, where a floor would have absorbed the change silently.

The plants fail against a leaf-keyed implementation for the stated reasons — it returns
`{'enabled': {'True','False'}}` for two sections sharing a leaf and `{'poll_sec': {'300','600'}}` for one
variable name bound to two sections — and two further tests pin that a chained `(cfg.get(x) or {}).get(…)`
is attributed without a variable, and that a `.get` on something which is not a config section is ignored
rather than invented into a section.

Closes the residue row `2026-09-24-schema-default-scan-keys-on-the-leaf-alone` (filed in #3000); the row's
state cell is changed once both are on main.
