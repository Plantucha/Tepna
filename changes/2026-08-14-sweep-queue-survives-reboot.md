---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

The mutation programme's work queue took its only input from eight hard-coded `/tmp` paths. `/tmp` is
a tmpfs. A box restart on 2026-08-14 wiped all eight at once, and **the loss presented as
completion**:

    ⚠ NO SWEEP for 8 file(s) — their work is NOT counted below.
    ▸ FLEET  0/0 distinguishable = NaN%   0 survivors unresolved   target 99%
    0 functions hold 0 unresolved survivors.

It exited 0, so nothing downstream could tell the difference either. `NaN` is not a small number —
it is the absence of a measurement wearing the shape of one, printed beside `target 99%` where a
reader sees a finished programme. CLAUDE.md §👥.4b's family exactly: the check ran and reported
success about something it never examined.

**Sweeps now live in `.mutation-sweeps/`** — repo root, gitignored, beside the `.mutation-crawl/`
that already follows this convention. Not committed (a sweep is a measurement, not a source) but it
survives a reboot, which is the property that was missing. `DEX_SWEEP_DIR` / `--sweep-dir` override
it for a scratch volume elsewhere.

**The paths are now DERIVED, not hand-maintained.** `ppgdex-dsp.js` -> `.mutation-sweeps/ppgdex-dsp.json`.
Three of the eight had accreted ad-hoc suffixes (`-fresh`, `2`) from whoever last re-swept that file
— the usual sign that a hand-written path list has begun to rot, and a second way to silently read
the wrong inventory. A derived name cannot drift. `SWEEPS` keeps its exact shape, so
`tools/killcheck.mjs` is unaffected.

**An absent inventory now REFUSES** — `🔴 NO SWEEP DATA — the queue is UNKNOWN, not empty`, exit 2,
naming the directory searched and the regeneration command, and stating that the equivalence ledger
is committed and unaffected so only the survivor inventory needs rebuilding.

**Two failures, not one — and testing the HAPPY path is what found the second.** The first guard was
`dis > 0`, which conflates "no sweep was read" with "a sweep was read but its denominator is not
positive". A synthetic sweep claiming `tested: 100` against ppgdex's 129 committed equivalents gives
`dis = −29`, and the tool blamed an absent file that was sitting right there. That is a real
condition with a different cause and a different fix — a sweep taken before the ledger grew past it —
so it gets its own verdict, `DEGENERATE DENOMINATOR`, reporting the arithmetic that produced it.

A tool that behaved correctly only when there was nothing to read would have been its own hollow
gate, which is why the fix was exercised in all three states rather than the one that prompted it:

| state | verdict | exit |
|---|---|---|
| realistic sweep (1204 tested, 464 killed, 15 invalid) | `464/1060 = 43.8%` | 0 |
| sweep present, ledger ≥ tested | `DEGENERATE DENOMINATOR` | 2 |
| sweep absent | `NO SWEEP DATA` | 2 |

The healthy case reproduces MUTATION-PROGRAM-FOLLOWUPS §1's published ppgdex figure of **43.8 %**
exactly from its recorded `tested`/`killed`, which exercises the arithmetic path end to end rather
than only the refusals.

23 selftests, up from 9. The new ones pin the *decision* rather than the message: that a derived path
never lands in `/tmp`, that the retired suffixes cannot come back, and that `ABSENT` and `DEGENERATE`
are never the same verdict.
