---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

`T.eq` — the comparator behind 2384 of this suite's assertions — compared NINE classes of genuinely
different values as EQUAL. #1215 closed one of them (NaN/±Infinity collapsing to `null`); the other
eight were still live, and were found by asking what else `JSON.stringify` is not injective over
rather than by waiting for the next one to bite.

    function · undefined · symbol   -> undefined    ANY two functions compared equal, and a function
                                                    compared equal to a MISSING value
    {p:1, q:undefined}              -> {"p":1}      an undefined-valued property is DROPPED
    [undefined]                     -> [null]
    -0                              -> 0            a sign flip that lands on negative zero

**The function case had a live call site, and it was a back-compat gate.** `ppgdex-dsp.js` exposes
`markO2Sentinels` as an alias of `markO2BeatMarkers` so no consumer breaks, and the assertion guarding
it read `T.eq('the retired name still resolves to the same function', P.markO2Sentinels,
P.markO2BeatMarkers)`. Both sides serialised to `undefined`, so it passed whether the two were the
same function, two different functions, or **the retired name not existing at all** — the one thing it
existed to catch. Measured both directions rather than argued: with the alias deleted, the old
comparator reports `all 8 assertions passed` and the new one reports
`got "@undef" · want "@fn#1"`.

Functions compare by IDENTITY (a WeakMap id), not by name or source text. "Is this the same function?"
is the only question a test asks of a function value, and two distinct functions with identical bodies
are different answers to it. That also fixes the call site above IN PLACE — it becomes a real identity
check without being rewritten, which is what the PpgDex/Allan delegation work (#1232) had to hand-roll
as `T.ok(... === ...)` after hitting the same blindness asserting a node exposes the SPINE's function
object rather than a lookalike wrapper.

Tagging `undefined` rather than returning it is what keeps a dropped PROPERTY visible: the replacer is
consulted before the key is removed, so the `{p:1,q:undefined}` case closes at every depth as a
consequence of closing the top-level one. A mutant that deletes a field assignment is now visible to
every `T.eq` in the file.

**The group that guards the comparator was itself hollow, and that is the more transferable finding.**
It re-declared its own private copy of the serialiser and asserted against THAT, so it could not have
failed for any change to the comparator `T.eq` actually uses — MUTATION-PROGRAM §8's headline shape
("the check ran, and reported success about something it never examined") sitting inside the guard
against that very shape. The serialiser is now one hoisted function with two callers.

The FAILURE TEXT now uses the same serialiser as the verdict. A bare `JSON.stringify` there renders
every newly-visible difference as `got undefined · want undefined` — a failing assertion whose message
says the two sides are identical, which reads as a broken harness and sends the reader after the wrong
bug. Caught on the `markO2Sentinels` kill above: the verdict was right and the message was unusable.

Hardening reds NOTHING — 7376 assertions, 470 groups, all green — so nothing was relying on any of the
eight conflations, the same result #1215 measured for the first one. Ten assertions pin the new
classes, each naming the mutant it unblinds, and each keeps the existing pattern of first asserting the
hazard is real (`JSON.stringify(fnA) === JSON.stringify(fnB)`) so the group tells a future reader to
simplify it rather than quietly becoming decorative.

Directly serves MUTATION-PROGRAM-FOLLOWUPS §4, which tested and REFUTED the hypothesis that the JS
fleet kills fewer mutants because it is under-covered — Python 100 % branch -> 74.6 % kill against JS
77.3 % -> 38.5 % — and concluded the suite "executes the code and does not check the result". A
comparator that cannot separate two functions, a dropped field, or -0 from 0 is that diagnosis in its
purest form: every assertion downstream of it was weaker than it read.
