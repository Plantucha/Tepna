<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [GlucoDex, suite]
brief: DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md
---
Add the GlucoDex adversarial gap twin — a committed synthetic Lingo CSV with a 14 h sensor-change gap — closing the coverage hole that let `DEEP-AUDIT-2026-07-14 §1` ship a moved export as "export-inert". The clean synthetic Lingo trips no `FLAG.GAP_LONG`, so no committed input exercised the long-gap path at all; the only leg that did was the real-recording equiv leg, which **skips wherever `uploads/` is absent** (CI, and the machine of whoever lands the change) — so a wrong number reached the served app. The twin is gated both ways, because each catches what the other cannot: a **golden** (`_gap` equiv leg, catching an export that moves by accident) and **invariants** (the drawn interpolation may never be counted as measured glucose, catching the bug class even if a future session regenerates the golden blindly). The control is arithmetic, not a mock — clean daypart n = 864, gapped = 697, and pre-§1 code reported 864 for both. Verified: reverting the fix reds five assertions in a corpus-less tree, i.e. `9bdb9be` would have failed CI on its own PR. Also teaches `tools/regen-glucodex-goldens.mjs` to MINT a first-generation fixture + its ledger record, so standing up a new golden never means hand-writing an export or hand-typing a hash.
