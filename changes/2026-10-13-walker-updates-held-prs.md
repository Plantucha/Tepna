---
bump: patch
type: fixed
brief: none
---

The walker now updates a held PR that falls behind main, at once and with no idleness gate. Kodiak never updates a held PR, so there is no race. Before this change the owner's merge button read "out-of-date" on every held PR after each merge to main.
