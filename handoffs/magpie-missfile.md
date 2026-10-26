# Magpie — unit `missfile`

**Row:** `2026-10-26-the-missing-file-bin-counts-paths-this-repo-never-carried` (OPEN at the ref)
**Branch:** `claude/missfile-mg` · **Worktree:** `wt-missfile-mg` (sibling of the primary checkout) · **Base:** `81d094bca`
**Rule 0:** `residue cite drift missing file bin counts paths the repo never carried` → board #1407,
#1467, #1422 (Osprey's three findings on this tool), `tools/residue-cite-drift.mjs:141` and `:194`.
Score 0.783. Claim #1556, registered as #1557 on thread 7.

## The defect

`missing-file` meant only that a path resolved neither as given nor under the nine other spellings.
A row citing the Python standard library, an installed package or a vendor daemon config therefore
landed in the bin a reader reads as rot, and `--strict` counted it.

## Why the obvious repair is the wrong one

The row warns that a basename lookup misbins the Data Unifier citation. I measured why, and the
warning reaches further than it says. An exact-basename rule misses `Unifier.html`. A suffix rule
that catches `Data Unifier.html` also claims `ecg_parity_harness.py` for bleak's `harness.py`, and
two `test_*_isolation.py` for its `isolation.py`. A rule fitted to one example is not a rule.

## The instrument instead

`git log --all` over the SAME ten spellings the reader tried answers the row's own question: did
this repo ever carry the path. The tracked basenames at the ref answer the second question: is this
a repo file cited under the wrong directory. Either answer keeps the citation a defect, and only
two empty answers together score `off-tree`.

| at the ref | before | after |
|---|---|---|
| `missing-file` | 17 | 3 |
| `off-tree` | — | 14 |
| `--strict` sum | 78 | 64 |

The three that stay are `Unifier.html:412`, the mutmut temp copy of `mutation_diff.py`, and
`tch-pooled-hat-2026-10-03.json` cited without its directory.

## ⚠️ One answer is right for an accidental reason, and the PR says so

`Unifier.html` hits the history at `9d93ca3ac`, and that commit DELETES a 0-byte stray file of that
name at the repo root. It is not the Data Unifier bundle the row meant. The bin is right and the
citation is a defect, but an existence probe answers about the PATH, never about the file the author
had in mind.

## Fail-closed, twice

A shallow clone cannot answer, so the probe returns nothing and every unresolved path stays a
defect. A caller that passes no probe gets the same reading. `carried: null` is the question nobody
asked, and it is not `false`.

## Evidence

- `--selftest` 32 of 32, with ten new legs. One is the control that keeps the no-probe sweep at two
  defects, so the split cannot pass by emptying the sum.
- **Plant 1**, `null` reading as `false`: 5 red, two of them pre-existing legs.
- **Plant 2**, the candidate branch removed: 1 red.
- **Plant 3**, a second hand-written prefix list: 1 red, the one-list tripwire.
- **Shallow-clone control, end to end.** A `--depth 1` clone with this tool copied in reports 17
  `missing-file`, 0 `off-tree`, and prints the probe-not-run banner.
- Biome clean, `npm run typecheck` EXIT=0.

## Cost

The probe adds about 11 s to a full sweep and runs only for paths that already failed to resolve.
The gate's `test:tools` step runs `--selftest` alone, which reads no git, so it pays nothing.

## Closure

This PR writes no verb. The row wants `fixed #NNNN` on the next RESIDUE-only PR, which Kestrel
sequences.
