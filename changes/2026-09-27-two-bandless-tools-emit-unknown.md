<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [analysis]
brief: none
---
Two band-less tools now emit exactly one `tepna.verdict/1` each, with their criteria pre-stated at the top of
the file and their sources named — and in both cases the honest status is **UNKNOWN**, which is more than the
bare number each printed before.

`tools/o2ring-finger-validate-batch.mjs` printed `N/M pairs PASS` with no aggregate criterion, deciding per
pair while looking as though it judged the batch. The per-pair rule is exact and cited; the **aggregate bar
does not exist** — `docs/O2RING-FINGER-ROUNDTRIP-2026-07-20.md` records 88/92 as a measurement of one sweep
and attributes each non-pass to the reference side individually. Inventing a bar would be a threshold derived
from the data it judges, and an all-pairs rule would convict the run that doc ratified.

`tools/stmt-delete.mjs` reported a pseudo-tested statement count with no threshold. The ratchet its residue
row proposes needs a stable population, and measurement says there isn't one: no committed statement baseline
exists, the caller supplies `--file` so there is no fixed set, and the candidate targets churn 23–107 commits
per 90 days. Its **refusals become machine-readable** instead — a red baseline suite is `NOT_RUN`, no eligible
statement is `NOT_APPLICABLE` — and the count is `UNKNOWN` with the reason.

Both carry a seam (`aggregateBar`, `baseline`) that is never a default and never inferred, with plants proving
that a clean batch cannot talk itself into a bar, that one newly pseudo-tested statement reds against a
baseline, and that given a bar each tool does decide. Per-pair output is byte-identical. The adoption census
moves 70 → 72 adopted (validated), 4 → 2 pending, with zero de-adoptions.
