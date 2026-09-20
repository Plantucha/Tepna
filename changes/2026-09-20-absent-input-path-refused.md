---
bump: patch
type: fixed
brief: none
---

**Three corpus tools reported a finding when their input directory did not exist.** Each defaults
to a path on a removable volume that is not currently mounted, and each treated its absence as an
empty dataset:

- `tools/eqc-run.mjs` printed `⊘ INSUFFICIENT: 0 pooled epoch-pairs. Pre-registered floor is ~1000`
  and exited **0** — a missing directory reported as a scientific result about the data
- `tools/tch-reference-validation.mjs` printed `no data`, exit **0**
- `tools/pulse-agreement.mjs` named the path it could not find, but still exited **0**

All three now refuse with **exit 2** and say which flag or variable to set, following the
convention `tools/hostaxis-estimator-bakeoff.mjs` already uses — it was the only one of the four
that already distinguished the two states.

⚠️ The distinction is preserved, not flattened: a directory that **exists and holds no matching
files** still exits 0, because that is a real result. Only a non-existent path refuses. This is §∅
one layer out — absence stays visible instead of being reported as a value of zero.

Also corrected, because it is what surfaced this: `CONTRIBUTING.md` §6.1 said the primary checkout
lives on that volume. Re-verified 2026-09-20 on rig-x870 — it is `/home/michal/Tepna` on **ext4**,
the volume is unmounted, and the one checkout still on an NTFS mount was last committed
2026-07-22. The section is kept as a conditional warning rather than a description of the main
working copy. The exFAT label in `DEEP-AUDIT-III-FOLLOWUPS §3` — which `CONTRIBUTING` has cited as
wrong since 2026-07-28 without the correction ever reaching the brief — now carries it.

Fleet-Session: Magpie
