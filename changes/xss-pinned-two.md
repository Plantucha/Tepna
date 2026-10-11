---
bump: patch
type: security
brief: none
---

**The last three open `js/xss-through-dom` alerts.**

- `oxydex-profile.js` — the entered `sex` and `age`. Deferred from #3432 because the
  **treatment-response yield pin** holds the file in its `detector.oxy` closure. Re-cut here from a
  real paper-scale run: **the yield is unchanged at 233 tx / 239 flat** and only the closure hash,
  timestamp and commit moved (3 lines).
- `dex-profile.js` — a stored profile value interpolated into a `value="…"` **attribute**. Deferred
  because `measurement-walk` holds it in its closure.
- `resp-acc-analysis-app.js` — a **third** uploaded-filename path into `row()`'s markup-bearing cells,
  at line 1175. #3432 escaped two and **alert #188 stayed open**; the CodeQL control is what caught it.

A **fourth** filename path (`perNightMae` → `drawPerNight`) is deliberately left unescaped: it renders
to a **canvas** via `fillText`, so it is not an XSS path, and escaping it would put `&amp;` into a
chart label.

⚠️ **The ratchet is NOT lowered, and the measurement says why.** In the gate's own words, before and
after this PR: *"314 innerHTML sink(s) in the tree · 210 with an unescaped identifier, in 42 file(s)"*.
The baseline counts **files**; the work closes **sinks**, about five per file. So a file leaves the
list only when its last sink is escaped, which makes a file-count baseline insensitive to exactly the
work that closes real alerts. Clearing 210 sinks is a programme, not a PR — and the backlog's "42
files" is the wrong unit to size it by.
