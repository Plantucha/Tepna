---
bump: patch
type: changed
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

`REFERENCE-GUIDE-AUDIT`'s browser/interaction box driven headless (Playwright + Chromium) across all 7
authored guides: 0 console errors, theme toggle / quick-jump toggle / quick-jump search / abbr search /
mobile drawer each exercised and observed changing state, 0 px horizontal overflow at 390 px. Records that
three of four probe failures were the probe's selectors, not the pages — a UI probe reporting "broken" is
more likely wrong than the page. `nav-highlight` scroll-spy remains the one unproven part.
