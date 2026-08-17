---
bump: patch
type: fixed
---

**`npm run check` has been red for every session that is current with `origin/main`.** It dies at step
2 of 12, so nothing after it runs — lint, the suite, the drift guards, provenance. The shared checkout
passes only because it is **235 commits behind**.

`chk_relax` (#1379) asserts a relaxation two ways: the current hook must `allow`, **and
`origin/main` must still `DENY`**. The second half is true on the branch and false one second after it
merges — `$BASE` is `origin/main`, so the moment the loosening lands, base and H agree and the check
fires forever. Measured on a pristine `origin/main` checkout: **FAIL — 3 problem(s)**, all three
reading *"main ALREADY allowed this; the case proves nothing"*.

## This file already solved this, and says so

`relaxed()` sits 140 lines below `chk_relax` and carries the verdict verbatim:

> ⚠ THE ONLY ASSERTION HERE IS `allow`. The first version also FAILED when main allowed the case too
> … That is true on the branch and false one second after it merges … **A case whose expectation flips
> on merge is not a test, it is a fuse.**

That comment was written on **2026-08-05**, after the identical bug ran `npm run check` red on main
from **#991** — and the note beside it records the resolution: the case belongs in the plain-`allow`
list, `relaxed` is "kept for the next genuine, one-line loosening". #1379 then added a second helper
that reinstated the removed half.

So the fix is not a new design: **use `relaxed`, delete `chk_relax`.** The base column stays, printed
for information — `DENY` means the loosening has not landed, `allow` means it has.

## Verified in both directions

    relaxation in effect      PASS — all cases as expected, no regression vs origin/main
    relaxation REVERTED       FAIL — 3 problem(s), each "<-- EXPECTED allow"

The second run neuters the hook's `GIT_INDEX_FILE` exemption and confirms all three cases still red.
Without that check this change would have swapped a fuse for a rubber stamp — the assertion has to
keep catching a genuine revert of CLAUDE.md §👥.2's rescue recipe, and it does.

⚠️ **CI never ran either step**, which is why this survived: `test:guards` and `test:hooks` are in the
local `npm run check` chain only. A gate that only humans run is a gate that goes unnoticed when it
breaks — and this is the second time this exact assertion shape has done it.
