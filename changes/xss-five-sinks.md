---
bump: patch
type: security
brief: none
---

**Five of the seven CodeQL `js/xss-through-dom` sinks escape their untrusted value.**

Each escape is at the **untrusted value**, not at the sink — `row()` cells and hero templates carry
markup by design, so the fix is to escape what the user supplied:

- `glucodex-app.js` — a meal's `category` (twice, once inside a `class` attribute) and its `label`
- `pulsedex-overview.js` — `cssColor` in a `style` attribute, plus `dateStr` and `modeLabel`
- `pulsedex-render.js` — `modeLabel`, `modeWhy`
- `pulsedex-app.js` — `lastResult.modeLabel`
- `resp-acc-analysis-app.js` — the **uploaded filename**, escaped once inside `nightLabel` so both
  call sites are covered and neither double-escapes

Three analysis bundles gained `dex-escape.js` so every `escapeHTML` call is reachable:
`resp-acc-analysis`, `odi-bias-analysis`, `cohort-harness`. The last two carried `oxydex-util.js`'s
`escHTML`, whose own comment claims the canonical escaper is *"loaded first in the OxyDex shell"* —
true in OxyDex, **false in those two**, so that delegation would have thrown. A live latent bug,
independent of this change.

⚠️ **Two of the seven are deferred, each blocked on a measurement pin** whose closure contains the file:
`oxydex-profile.js` is in the treatment-response yield pin, and `dex-profile.js` is in
`measurement-walk`'s. Re-cutting the yield needs `analysis-rerun` at paper scale, which fails at
`worker boot failed` because playwright's **browser binaries** are absent (the package is present at
1.48.0). Installing them is not this PR's call. So this PR closes **5 of 7**, with the remaining two
named rather than bundled in.
