---
bump: patch
type: fixed
brief: none
---

Withdraw a canonical escaper name from the sink gate's strip pattern in the file that shadows it. The gate credited `escapeHTML` and `esc` by name at every call site. So a file declaring a quote-blind local `esc` had its calls stripped out of their sinks, while the census reported the same name as unverified. The decision is static inside the one file the gate reads. A file that imports the canonical helper declares nothing and is untouched. The tree count holds at 206, so no baseline moves here.
