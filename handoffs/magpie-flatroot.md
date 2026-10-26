# Magpie — unit `flatroot`

**Row:** `2026-10-25-a-refused-night-shaped-directory-reads-as-a-flat-root` (OPEN at the ref)
**Branch:** `claude/flatroot-mg` · **Worktree:** `wt-flatroot-mg` (sibling of the primary checkout) · **Base:** `80543e376`
**Rule 0:** `oracle flat root policy refused night directory mixed layout` → `briefs/RESIDUE.md:890`,
`tools/pat-window-oracle.mjs:708` (`rootLayoutVerdict`), `tools/corpus-scope.mjs:230`
(`snapshotNights.rejectedNightShaped`). Score 0.983. Claim #1543 on thread 7.

## The defect, reproduced before it was fixed

`rootLayoutVerdict` keyed its MIXED refusal on `nightDirs.length`. This tool's own night rule is
`/^2026-/`, so it refuses `2027-01-02/` and drives that count to zero. The guard then goes quiet
exactly where the rule reopens the hazard, and the tool scores the loose files alone.

A planted root carrying `2027-01-02/` plus one loose `_ECG.txt` entered SESSIONS MODE and exited 0.
Its twin carrying `2026-06-11/` refused as MIXED. One directory vanished without a word.

## What changed

`snapshotNights` already measures the refusals. Its `rejectedNightShaped` now travels to
`rootLayoutVerdict` as a third argument, and three branches read it.

| tree | before | after |
|---|---|---|
| refused night dir + loose files | SESSIONS, directory dropped | MIXED, names the directory and the rule |
| no census taken + loose files | SESSIONS | LAYOUT UNDECIDABLE, its own reason |
| no night-shaped name + loose files | SESSIONS | SESSIONS, unchanged |
| admitted night dirs + loose files | MIXED | MIXED, now naming both censuses |

The decided flat-root policy (`2026-09-02-oracle-flat-root-policy`) stands. What moved is which
roots count as flat. A name the RULE hid is not a name the TREE lacked.

## 🔴 MY OWN DEFAULT REPUBLISHED THE DEFECT, AND ONLY THE END-TO-END PLANT SHOWED IT

The third parameter started as `= []` for back-compat. Planting the two-argument call site then
printed `ZERO night-shaped names the rule refused` over a root holding `2027-01-02/`.

An empty default asserts a census nobody took. That is §∅ at the parameter layer, and it is the
same defect the unit exists to fix, one level up. The default is now `null`, so an
argument-less caller refuses instead of scoring. Nothing outside this file calls the function, so
the narrowing costs no caller; three pre-existing selftest legs now state `[]` explicitly, which is
what they always meant.

## Evidence

- `--selftest` 80/80. Seven new legs, three of them controls.
- **Plant 1** — restore the pre-fix function body: 4 of 80 red, and the three controls stay green.
- **Plant 2** — restore `= []` as the default: 1 red, the fail-closed leg.
- **Plant 3** — drop the third argument at the call site: the planted root now exits 3 UNDECIDABLE.
  Under the `[]` default the same plant exited 0 and dropped the directory.
- Three end-to-end roots: refused dir exits 3 MIXED, admitted dir exits 3 MIXED, flat root exits 0.
- Biome clean. The one remaining warning sits at line 321 and a control at the base carries it too.
- `npm run typecheck` EXIT=0 · `--group=release-ledger` 9 assertions.

## The population today is ZERO, and that is the point

Osprey measured it on the row: 327 nights across six night-shaped directories, every one 2026. No
tree in the corpus triggers this today. The rule turns on 2027-01-01, which is 67 days out, so this
lands as a tripwire ahead of the date rather than a repair after it.

## Closure

This PR writes no verb. The row wants `fixed #3985` on the next RESIDUE-only PR, which Kestrel
sequences, and the ask sits on thread 8 as #1548.

---

## FINISHED 2026-10-26 18:35Z — head `dd5df69ed`, PR #3985 DRAFT, all 41 steps pass

`npm run check` EXIT=0, suite 14446 assertions over 830 groups. `pr-compliance.mjs` passed its nine
checks before `gh pr create`, which is the habit that holds. Branch 0 behind at push time.

⚠️ **The undraft ask cleared `long-sentence` and then surfaced `long-paragraph`.** The second rule
only appears once the first is clean, so lint twice before posting.
