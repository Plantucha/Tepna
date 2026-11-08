---
bump: patch
type: fixed
brief: none
---

Read a cite-drift identifier only where it stands on its own. A substring test let `file` anchor a citation on `fileURLToPath`, and let `fixture` anchor on `fixtureNames`. The tail of a path-like token is no longer an identifier, so `json` no longer anchors a line that names any JSON file.
