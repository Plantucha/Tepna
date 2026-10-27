# Osprey — pullonce-keys (a measurement, no PR)

**Unit.** Size row `2026-10-25-thirteen-cited-pull-once-survivor-keys-have-no-row` while the one-PR cap
holds my slot. Claim #1316, report #1317, release #1319.

**Branch + worktree.** None. The measurement ran read-only in `wt-heavykey-osp` against `origin/main`;
the scripts live in the session scratchpad as `recpop/keys.py` through `recpop/keys4.py`.

**Exact stopping point.** Reported. The tree holds no staged change and no row moved.

**Next step.** One RESIDUE-only PR carrying three rows, once #3933 frees the slot: the correcting row
naming 18 dangling citations, a row for the wrapped-citation class, and the 2027-boundary row.

**What the unit measured.** Scoped to the citation convention, six trees hold 287 distinct cited
residue keys: 240 resolve exactly, 29 only after joining a wrapped line, 18 resolve to nothing. The row
enumerated 14 of the 18, and the four it missed are real defects in three different lanes. None of the
18 is a date typo. Unscoped, the same trees give 148 dangling tokens, 119 of them `audits/` work-item
ids, so a checker keyed on key shape alone would be right 18 times in 148.

**Open questions.** Do the thirteen batch labels leave key shape, or join the ledger as rows? The remedy differs for the two halves and the choice is the owner's or Kestrel's.

**Blockers.** The one-PR cap. #3933 is open and DRAFT, and I never undraft my own.

**Doc-search query that finds this work.** `a test module cites a residue key that resolves to no row
in the ledger`.
