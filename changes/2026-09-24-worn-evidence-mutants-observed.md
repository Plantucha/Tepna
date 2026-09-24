<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Four mutants on `_has_worn_evidence`'s changed lines are now observed by assertions: an empty file
must not end the search for wear evidence, a 1 ms interval is still a measured value, and a byte that
is not valid UTF-8 must not lose the night (without `errors="replace"` the decode raises
`UnicodeDecodeError`, which is not an `OSError` and escapes the handler).
