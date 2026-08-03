<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
The LINK sidecar reader looks its columns up by NAME — now asserted — 77 % → 82 % of mutations killed.

`timeline.py` measured 639 mutants, 141 surviving. Forty-three sat in `read_link_samples`, the reader of
the sidecar whose WRITER was hardened in the 2026-08-02 `writers.py` pass — and a reader and writer that
disagree about a column produce a night that looks fine and is not.

The instructive part is which tests worked. Six aimed at the visible guards (`len(p) > i_c`, the
connected polarity) killed **4**: most of those bounds are unreachable behind the `len(p) <= i_c` filter
and are genuinely equivalent. The **22** that mattered were `idx.get("Phone timestamp", 0)` mutants,
invisible for a subtler reason — every fixture wrote the standard header in the standard order, which is
the one input where a name lookup and a positional fallback AGREE. A reordered header and a legacy
nameless header separate them, and the fallbacks (`0,1,2,3`) are the pre-header column order that lets
an old sidecar still read.

Also pinned: the connected column's polarity (inverted, a night that held its link renders as one
continuous dropout), a row torn mid-write by a power cut, a blank rssi, and the name→address fold that
stops one physical sensor being reported as two devices for a night.
