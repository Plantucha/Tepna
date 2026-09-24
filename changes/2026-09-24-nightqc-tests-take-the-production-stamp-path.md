<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
17 tests in `test_nightqc.py` planted an 8-digit DATE where production writes a 14-digit
`YYYYMMDDHHMMSS`, so `_session_of` took its mtime fallback and their session-grouping assertions
verified the legacy branch rather than the one every real file takes. They now carry the production
filename shape with mtimes derived from the stamp, and the `_tz` parametrization that shape requires:
tests taking the fallback fall 21 → 2, and the 2 are the tests that claim the legacy path. No
assertion changed value.
