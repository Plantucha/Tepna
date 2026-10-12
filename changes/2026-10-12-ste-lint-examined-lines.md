---
bump: patch
type: fixed
brief: none
---

Count the lines the writing rules never read, and refuse a body whose prose all sits in table cells.

`tools/ste-lint.mjs` skips a table row, a code fence, a quote and a heading on purpose — a cell is a
label, not a sentence. Its verdict then counted only the lines it did read. So `eligible` equalled
`checked`, `excluded` was `0`, and the object said nothing about the text it passed over.

A new export, `scan(src)`, returns the prose lines plus the three counts. Every non-blank line the
rules skip now sits in `population.excluded`, and `checked + excluded = eligible` holds as §🧾
requires. Measured on the body of pull request 3480: the old object read `checked 4, eligible 4,
excluded 0`, and the new one reads `checked 4, eligible 28, excluded 24`.

The second half is the refusal. A body whose prose all sits inside table cells earned `0 findings over
0 prose line(s)` and a green check 5. That is a pass about text nobody looked at.

The planted fixture at `tools/pr-compliance.mjs:180-182` exists because one such body hid a pull-request
closure in a cell. Check 5 now fails when the body has lines and the rules examined none of them, and
it names the reason.

No finding moves. `checked` stays at 41 on `briefs/RESIDUE.md`, 88 on `ORIENTATION.md` and 349 on
`CLAUDE.md`, with 13, 5 and 32 findings as before. The selftests go to 49 and 45 cases.
