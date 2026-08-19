---
bump: patch
type: removed
brief: DEX-METRIC-REMOVAL-FOLLOWUPS-II-2026-08-09-BRIEF.md
---

**The three dead-code residues of removed metrics, cleared in ONE re-bundle instead of three.**

`DEX-METRIC-REMOVAL-FOLLOWUPS-II` §2 deliberately deferred these — *"each costs a re-bundle, so none
was done here … they should ride the next behavioural change to their node"*. Batching all three across
PpgDex · OxyDex · PulseDex costs one build/provenance/verify cycle rather than three.

- **§2.1 `ppgdex-profile.js` — `ansAge()` deleted.** It computed an "HRV-estimated autonomic age", a
  metric the audit judged indefensible, and could not reach a screen: its label writes to `lbl_ppgAge`,
  and `PpgDex.src.html` contains **zero** `lbl_` ids. Live source inlined into `PpgDex.html` and the
  served copy, so a future edit restoring a hint node would have silently resurrected it.
  ⚠️ **The brief listed three sites; there are FOUR.** It missed `const aa = ansAge(...)`, which feeds
  the `ansAge: aa` assignment it did list. Removed by identifier, not by line number, and asserted to
  zero occurrences afterwards.
  The export's `ansAge: null` **stays** — node-export back-compat, a different surface.
- **§2.2 `oxydex-fusion.js` — dead `BP projection` row removed.** `bpProj` has been hard-null in
  `oxydex-dsp.js` since 2026-06-21 (external-review WP-A: cuffless BP from sleep oximetry is
  indefensible), so `if (n.karv || n.vo2est || n.bpProj)` could never open on `bpProj` alone and the row
  it guarded was unreachable. The `bpProj: null` the EXPORT writes stays, same reason.
- **§2.3 `pulsedex-overview.js` — the stale comment corrected.** It claimed *"pxAnsAge() is still used
  for the KPI delta"* while line 70 of the same file said the tile and its composite were deleted.
  `pxAnsAge` has no call site anywhere in the tree; line 70 was right.

**Every death claim was re-verified by identifier before deleting**, not inherited from the brief — line
numbers drift, and one claim was already off by a site.

⚠️ **`computeHash` is not RECORDED in `provenance/*.json`** (those fragments carry `manifestHash` and
`verifiedUnder` only), so §🔒's export-inertness proof could not be used here; settled empirically by
`verify-fixtures` instead — 4 re-stamped, 10 already current, suite green.

> 🔴 **CORRECTION 2026-08-19:** this paragraph originally said `computeHash` "DOES NOT EXIST under that
> name in this checkout". False — `manifest-gate.js` defines `computeHashFromText` and mentions
> `computeHash` 11 times. **`grep` is blind to that file**: one deliberate NUL at offset 10629 (the
> `logicalName \0 sha256(assetText)` separator §🔏 mandates) makes `file` classify it as `data`, and the
> shell's `grep` wraps `ugrep -I`. Use `git grep`.

`npm run check` with `DEX_UPLOADS`: EXIT=0, **7815 assertions, 499 groups**, equivalence legs RUN
(PpgDex 12/12 + 3/3). Registry tiers untouched — removal of dead render code, not a re-grading.
