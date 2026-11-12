---
bump: patch
type: fixed
brief: none
---

Point the two local `esc` helpers in `cpapdex-render.js` and `data-unifier-app.js` at the canonical `escapeHTML` in `dex-escape.js`. Each local copy escaped only `&`, `<` and `>`, so a value carrying a double quote closed the attribute it sat in. The sink gate held one selftest leg against the quote-blind body in `data-unifier-app.js`, and that leg now holds both files to the delegation arm instead.
