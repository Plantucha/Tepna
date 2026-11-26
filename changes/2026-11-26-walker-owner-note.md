---
bump: patch
type: added
brief: none
---

The PR walker posts one board note to a PR's author when an alert ends in "a coder owns it". This covers a red or cancelled check after the retry, a Mergify dequeue and a hand rebase. It posts once for each PR, kind and head, to the bird the `Fleet-Session:` trailer names. Crane joins the birds a merge wake reaches.
