---
bump: patch
type: fixed
brief: none
---

Decode each entity in a guide card label once, so `&amp;lt;` reads as `&lt;` and not as `<`.

The inline-handler scan now also removes a script or style block whose close tag carries a space or an attribute.
