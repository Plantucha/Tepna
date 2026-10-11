---
bump: patch
type: security
brief: none
---

**Two of the last three open `js/xss-through-dom` alerts, plus six tool realms that lacked the escaper.**

- `dex-profile.js` and `resp-acc-analysis-app.js` are fixed here. **`oxydex-profile.js` is still
  deferred** — see below.
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

⚠️ **`oxydex-profile.js` (alert #164) is still deferred, and the reason is a RACE, not a blocker.** Its
escape moves the treatment-response yield pin's closure, so the pin must be re-cut from a paper-scale
run. I did re-cut it — **yield unchanged at 233 tx / 239 flat** — and then main moved `oxydex-dsp.js`,
which is *also* in that closure, making my fresh pin stale again. A second re-cut then contended with
another session's paper-scale run already holding Chrome.

So a pin whose closure contains a hot DSP goes stale on **every** merge that touches it, and a PR
carrying a re-cut races every other PR. That is a serialisation question, not something to force: the
escape and the re-cut belong in one quiet-window PR.
