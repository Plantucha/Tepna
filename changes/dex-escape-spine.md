---
bump: patch
type: changed
brief: none
---

**SPINE: `dex-escape.js` into the six bundles that lacked it.**

`escapeHTML` was reachable in only 5 of the 11 owned bundles. `dex-profile.js` — a shared module with
an open `js/xss-through-dom` alert — lands in 7 bundles, four of which (HRVDex, GlucoDex, ECGDex,
PpgDex) carried it **without** the escaper, so escaping that sink would have thrown a `ReferenceError`
at module evaluation there. CPAPDex and MotionDex need it for their own node-local sinks.

Carriage only; no escaping and no behaviour change. Lands **before** the node-local XSS work per
CLAUDE.md §3 — anyone re-bundling these six rebases onto this first.

An added inlined asset is inside the compute closure (the denylist fails closed), so **both** hashes
moved on all six and all six were re-verified: 9 fixtures stamped, 10 already current, suite green.
ECGDex (4) and PpgDex (6) goldens regenerated for code identity only; no output changed.
