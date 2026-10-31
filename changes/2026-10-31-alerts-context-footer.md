---
bump: patch
type: fixed
brief: none
---

Vigil push alerts now carry their Where/Handle footer.
`Notifier` accepts a `context` string that `send()` appends to every message.
With no context set, the message stays byte-identical to before.
capture.py passes a footer built at runtime (hostname, captures root) that names the daemon and the board alert thread.
One glance at a phone alert now says which box, which daemon, and who owns it.
