<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

Two honesty fixes from the Python deep audit. `writers.polar_ns_to_t_ms` documented PSL's
`timestamp [ms]` column as ABSOLUTE ms since the Polar epoch; it is relative to the recording's first
sample and fractional, as `_rel_ms` states and a byte-for-byte diff against the vendor corpus confirms.
It had no production callers and two tests pinning the wrong semantics, so it read as validated —
removed rather than corrected. And `rec_to_psl.write_psl` now REFUSES a stream whose real layout is
unknown instead of writing it under a guessed `;v0;v1;v2` header that no PSL reader can parse.
