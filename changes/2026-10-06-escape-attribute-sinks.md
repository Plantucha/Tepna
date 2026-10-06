---
bump: patch
type: security
brief: none
---

Escape untrusted strings at three ATTRIBUTE sinks: OverDex's local escaper now delegates to the canonical `dex-escape.js` one (it omitted the quote, so a folder name closed a `title="…"`), and OxyDex's night-detail `aria-label` and flag pill escape `n.date`, `f.sev` and `f.code`.
