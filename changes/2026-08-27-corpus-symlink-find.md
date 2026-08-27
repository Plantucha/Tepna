---
bump: patch
type: fixed
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---

`docs/CORPUS-LOCATIONS.md` — row 2 (`/home/michal/tepna-smoketest/captures`, the box-capture corpus) is
a **symlink**, and `find` does not follow a symlinked start point by default. It therefore matches
nothing and **exits 0 with no error**, which reads as *"the box captures are not on this machine"* — a
claim about the corpus that is actually a claim about `find`.

Measured 2026-08-27 while establishing the closure precondition for
`CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT: bare `find` → **0** `*_ECG.txt`; `find -L`, a trailing slash, or
a shell glob → **505**, across 49 box nights (plus 2,155 Verity and 1,754 O2Ring PPG files). I recorded
"the corpus lacks raw files" before catching it.

The tell is that a **child** directory searches fine while its **parent** returns zero, and `ls`
disagrees with `find` on the same tree. Also warns against diagnosing with `2>/dev/null`, which hides a
missing binary so that one `0` can mean "no matches", "not a directory", or "command not found".

Same class as the existing `Ecg nightly` space warning — a silent empty result standing in for an error
(`CLAUDE.md` §👥.4b) — and it belongs in the file whose whole purpose is that the corpus is not
discoverable from a checkout.
