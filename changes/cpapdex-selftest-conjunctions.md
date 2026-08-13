---
bump: patch
type: changed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

CPAPDex: every compound `ok('…', A && B)` in `cpapdex-dsp.js`'s `selfTest` is now one assertion
per claim. The compound form asserts less than it reads as — mutating `&&` to `||` leaves it
passing on A alone, which kept 32 mutants alive across 25 assertions. Guards that were welded to
a value check became their own assertion, with the value read through a self-killing `(x || {})`
default. Self-test assertion count 82 → 107, pinned deliberately.
