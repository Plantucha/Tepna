---
bump: patch
type: fixed
brief: none
---

Brief drain, DSP/node lane: six briefs whose status headers assert an absence, re-checked against
landings in their own surface since the date each claim was taken.

An absence claim in a header is a measurement with no expiry date. The check is mechanical — read the
claim and its date, then `git log --since=<date>` over the surface it describes.

Five briefs have landings and are stamped with them. One has none and is stamped saying so:
DEEP-AUDIT-V-FOLLOWUPS returns zero landings over the registry surface since 2026-09-05, so its
header stands and the drain records that rather than leaving it ambiguous.

EEGDEX-BUILD is the substantive find and it is HALF stale. The corpus precondition is still true —
re-verified here at 0 files matching `*muse*`/`*eeg*` — so the PARK decision is untouched. But "there
is no `eegdex-*.js` in the tree" was correct when written (verified absent at both the 2026-08-03 and
2026-09-02 commits) and is false since 2026-09-14: `eegdex-dsp.js` is 417 lines on main via #2505,
extended by #2513 #2515 #2517 #2583, with a generated registry and a selftest tool alongside. The
manifest still declares "status":"planned", which no longer matches a shipped DSP.

⚠️ METHOD, CORRECTED MID-UNIT. `Affects:` exists in only ~65 of 514 briefs and sits MID-LINE inside the
status block, so an anchored `^Affects` grep returns zero — the same anchored-pattern failure as a `\bble\b`
that matches "table". My first pass used that anchored grep, concluded none of the six declared a surface,
and derived all six. Re-checked unanchored: OXYDEX-PB-DETECTOR-FOLLOWUPS DOES declare one, and it is WIDER
than what I derived. Its stamp now records the declared surface and which part of it the count covers.

Every stamp names the surface it used, and every derived surface says it is derived. No `git log` was run
with an empty path list — that returns all of main's history and would read as universal staleness.

⚠️ AND THE NEGATIVE IS WEAKER THAN A CLEAN COUNT SUGGESTS. "Nothing landed" is only as strong as the
surface list, and this suite's own BRIEF-CODE-ANCHOR-CHECK-2026-09-11 says why: an existence check cannot
see a behaviour change, and a behaviour change is precisely what lands. DEEP-AUDIT-V's stamp reads "nothing
landed in the surface checked", not "the header is re-verified". PPGDEX-ALGORITHM-DEEP-DIVE's carries the
same caveat for the opposite reason — a deep-dive brief is mostly behavioural claims, which a
commit-existence check cannot adjudicate in either direction.

⚠️ LANDINGS ARE RECORDED, NOT ASSESSED. No done-when is ticked anywhere in this batch. Whether a PR
satisfies a brief's acceptance item is the owner's reading of coverage; deciding it from a commit
title is sizing from a summary instead of the code.

One incidental cross-reference: PPGDEX-ALGORITHM-DEEP-DIVE's stamp notes that #2333 rewrote
`correctRR` across 56 lines, which is the landing residue row
`2026-09-06-brief-header-file-line-citations-rot` records this brief quoting after deletion — so line
citations in it predating 2026-09-07 want re-resolving before they are trusted.
