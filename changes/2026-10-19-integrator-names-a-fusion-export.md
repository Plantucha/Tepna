---
bump: patch
type: fixed
brief: none
---

The Integrator page now names a dropped fusion export. Before, a file from the Integrator's own Export or from the OverDex "download fused" button read as "unrecognized format, no events found". The new message says the file is a fusion export with no events to fuse. It also lists the node exports that the file was built from.

The "Load bundled samples" button now gives a clear message when the host returns a web page in place of a sample file. Before, the page showed a raw JSON parse error that started with `Unexpected token '<'`. The served copy in `docs/` has no `uploads/` folder beside it, so the samples load only from the source page.
