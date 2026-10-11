---
bump: patch
type: fixed
brief: none
---

**A verdict path that never executed under a green selftest.**

`reviewVerdict({ finish: fin })` in `tools/gemini-review.mjs` referenced `fin`, which was **never
defined anywhere in the file**. `--json` therefore threw a `ReferenceError` immediately *after* the
answer text printed — for **every provider, every run**, since the flag existed. §🧾 makes the object
the API and the prose the explanation; the API had never once been produced. Fixed to `finish`.

Found by the first real scored run rather than by review, along with the second defect: the Claude row
sent `temperature: 0`, which that model class rejects outright (HTTP 400, *"`temperature` is
deprecated for this model"*), so it would have failed on every call. It had selftested green because
the generic assertion checked only that temperature was **pinned**. The row now sends none and
declares why in a `noTemperature` field, and the assertion reads "pinned to 0, **or** the row says why
it cannot be", with a second case asserting such a row then sends no temperature at all.
