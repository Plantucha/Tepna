---
bump: patch
type: fixed
---

**`probe_equivalence` declared a mutant EQUIVALENT when it had destroyed two thirds of the output** — the
suite's signature failure, inside the tool built to detect exactly that.

`_differences(base, variant)` counted mismatches with `sum(... for x, y in zip(a, b) ...)`, and `zip`
stops at the shorter list. A variant that DROPPED results had them silently ignored; if the surviving
prefix matched, the count came back **0** — which is the caller's verdict for `no-distinguishing-input`,
i.e. *equivalent, unkillable, harmless*.

Demonstrated before the fix:

    base 3 results, variant 3 identical   -> 0    equivalent, correct
    base 3 results, one value changed     -> 1    killable, correct
    base 3 results, variant 1 result      -> 0    ⇐ 2 results vanished, reported harmless

A length mismatch is a difference — the largest one — so missing and extra entries are now counted.
Seven regression tests; removing the length term again fails five of them.

**The module was UNMEASURED until this landed, and that is why the bug lived.** Nothing imported
`tools/probe_equivalence.py`, so it contributed zero statements to the 100 % floor and its absence was
invisible — coverage read 100 % with the whole file unexamined. Adding one test pulled 94 statements into
the denominator and dropped the suite to 99.12 %, which is the honest number for what was actually being
checked. It is now at **100 %** across 21 tests: the battery, `observe`'s exception-as-outcome path,
`_run_variant`'s anchor and subprocess failures, and all four `main()` verdict paths including the
fail-closed *"battery too narrow"* refusal.

Found by a `ruff --select B905` sweep (`zip()` without `strict=`), which is the same class as this repo's
documented `| tail` trap: a truncated view read as the whole. 23 sites were flagged; this is the one that
mattered, and `oxyii.py`'s XOR key was checked and refuted (`_LEPU` is a 16-byte MD5 against a 16-byte
key — equal lengths).

**Also refuted in the same sweep, recorded so nobody re-finds them:** no mutable default arguments, no
`== None`, no bare `except:`, no asserts in production code; the 100 exception handlers that record
nothing are best-effort cleanup where swallowing loses nothing (checked the `OSError` ones in write
paths — they remove header-only files); `allan.py`'s divisions by `k-2`, `sxx` and `tau0` are all guarded
by early returns; the two `# pragma: no cover` branches in `daemon_control.py` are documented
defence-in-depth re-assertions that `coerce_minutes` already makes unreachable.

⚠️ **One systemic weakness found and NOT fixed here:** `tests/_srcscan.module_source()` returns raw text
including comments, so the 26 test files that scan source can be satisfied by a comment quoting the code
they assert. Proven — deleting `await auto_sync_clock(name, addr)` and leaving it in a comment left
`test_the_first_sync_still_happens_before_the_loop` green. In that instance a behavioural test caught the
deletion, so it was not load-bearing; whether that backstop exists for every such assertion is unaudited.
