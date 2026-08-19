---
bump: patch
type: removed
brief: DEAD-FIELD-HINTS-FLEET-2026-08-19-BRIEF.md
---

**25 of 42 dead field-hint writes removed — and the brief that proposed it was wrong three times.**

`computeHints()` wrote field hints to `lbl_*` ids that **no `.src.html` defines**. Removed for PpgDex (9)
· ECGDex (11) · GlucoDex (5). The three corrections matter more than the deletion:

**1 · The `DP()` guard was load-bearing against a CRASH, not an early exit.** PpgDex/ECGDex's bodies read
`$('ppgHeight').value` — and `ppgHeight` does not exist either, so the body would have thrown a
`TypeError` had it ever run. `if (DP()) return;` was the only thing preventing it. That makes deleting
the body strictly safer than leaving it guarded, which is the opposite of the usual "it's guarded, leave
it" instinct.

**2 · GlucoDex is NOT the twin, and the brief's Done-when would have broken it.** It has **no** `DP()`
guard and reads `$('calibRow')`/`$('calibState')` — **both ids EXIST**. It runs, and it is the only thing
that shows/hides the lab-A1c calibration row and writes its state text. *"Remove the three bodies"* would
have deleted working user-visible behaviour. Only its 5 dead `set('lbl_glu…')` writes came out; the
calibration block stayed. **A shared function NAME is not a shared shape** — the brief's own caveat
(*call graphs unread, check per node*) is what caught it.

**3 · The fleet map was scoped by the wrong thing, and the sweep that fixed it was ALSO blind.** The
brief counted nodes with a function literally named `computeHints` — 3 nodes, 26 writes. Sweeping by the
PROPERTY instead (*a `set('lbl_X')` whose id exists in no `.src.html`*) finds **5 nodes**: HRVDex and
PulseDex too, the latter's living in `computeProfileHints`. ⚠️ And the first property sweep used
`lbl_[A-Za-z]+`, which is **blind to digits**, so it silently missed `lbl_vo2gt`. Corrected to
`lbl_[A-Za-z0-9_]+`. True fleet total: **42 writes**, 25 removed here, **17 remaining** (HRVDex 6,
PulseDex 11).

**The 17 are deliberately NOT in this PR.** Both remaining nodes are the GlucoDex shape, not the PpgDex
shape: HRVDex's writes sit inside a live `updateProfile()`, and PulseDex's `computeProfileHints` needs
its call graph read. Removing them by pattern is exactly the mistake corrections 2 and 3 just caught.
The brief stays **IN-PROGRESS** with the corrected map rather than being stamped DONE at 60 %.

**Export-inert — computed, not claimed:** `verify-fixtures` reports **0 stamped, 14 already current**.
`npm run check` with `DEX_UPLOADS`: EXIT=0, **7815 assertions, 499 groups**.

A gate for this class is now viable and is recorded in the brief: **no `lbl_` id is created dynamically
anywhere** (checked), so a static *"`set('lbl_X')` whose id is in no `.src.html`"* rule cannot
false-positive. Not built here — it belongs with the last 17, so it can be seen to RED before it passes.
