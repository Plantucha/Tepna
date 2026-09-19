<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: []
brief: RESIDUE.md
---

The blind spot reported for `@property` is mutmut's rule for every decorated function, not a property
rule: it mutates by replacing a function with a trampoline, which a decorated function cannot be
rebound to, and it exempts only a lone `@staticmethod` or `@classmethod`. Measured across capture-host,
50 functions are skipped — 45 properties, 4 `@asynccontextmanager`, 1 `@middleware` — so the five
non-properties were reporting "cause not established" for a cause that is known and documented
upstream. The check now mirrors mutmut's own rule and names the decorator responsible.
