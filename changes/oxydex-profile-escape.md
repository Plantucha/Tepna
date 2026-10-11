---
bump: patch
type: security
brief: none
---

**The last open `js/xss-through-dom` alert (#164), with its yield pin re-cut.**

`oxydex-profile.js` interpolated the entered `sex` and `age` into an `innerHTML` sink. Three lines,
now escaped. Expect **1 → 0** on main.

It waited for a serialised window because the file is in the **treatment-response yield pin**'s
`detector.oxy` closure: an earlier re-cut was staled when main moved `oxydex-dsp.js`, also in that
closure. Re-cut here from a real paper-scale run with every other OxyDex merge held —
**yield unchanged at 233 tx / 239 flat**, and only `oxydex-profile.js`'s closure hash moved.

⚠️ **The XSS ratchet does not move, and that is correct.** Under #3441's new sink unit the gate reads
*"210 with an unescaped identifier, in 42 file(s)"* both before and after. The same sink still
interpolates `pop.wt`, `pop.ht` and `ideal` — **computed NHANES numbers, not user input** — and the
scanner is a heuristic that cannot tell those from a tainted value, as its own header says. Escaping
them would be escaping to satisfy a detector rather than a threat, so they are left alone.
