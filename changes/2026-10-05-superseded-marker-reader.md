---
bump: minor
type: added
brief: none
nodes: [analysis]
---

`trio-batch` reads a `.superseded` marker before refusing a night as ambiguous (owner ruling 2026-10-04).

Two copies of one basename at different sizes is an ambiguity the fold refuses on, and rightly — which
bytes are the recording cannot be inferred from a length. But when the SHORTER copy carries a dated
`<file>.superseded` marker naming the keeper and a reason, the question has already been answered: the
keeper folds and the other is reported in a new `excluded` channel with the marker's own reason.

⚠️ The superset check reads BYTES, not sizes, because that is the owner's earlier ruling:
CORPUS-TIER-30-NIGHTS §4 records that the same-size-different-bytes case is why full hashing was ordered
— "a size-only check passes it… the shape of every rsync failure that leaves a file behind: right length,
wrong content." Streaming at 1 MiB, stopping at the first difference, so the 8 GB rule is respected.

Three outcomes and only one folds: verified → fold and exclude with the reason; marker present but the
keeper is missing, is a different file, is not a byte-superset, or the marker is unreadable or missing its
`kept`/`reason` → UNKNOWN, carried INTO the refusal so a reader learns the marker was tried; no marker →
the refusal is unchanged.

`excluded` is a separate channel from `dropped`: a dropped file was byte-identical to what was kept, an
excluded one is a shorter DIFFERENT file set aside by a ruling, and its exclusion is legitimate only
because the reason travels with it.
