---
bump: patch
type: fixed
brief: none
---
`tools/board.mjs`, from the owner's two reads of the page on 2026-10-12.

- The bird-herder section reads every RUNNING herdr session. The bare call reached only the stopped default session and printed "(no agents listed)" while four birds worked.
- The owner-decisions block accepts one numbered or bulleted line per item. A live eight-item block read as "0 open".
- The Kestrel daily evaluation section shows only entries whose heading date is today.
- The weekly-pool section reads the LAST usage point in `plan.json`. The bar read a 10:35 number beside a 12:28 point. It now shows All, Fable and session with the pace since the previous point.
- The walker order comes from the walker's queue file, with drafts and undrafted PRs marked.
- A release-land answer of "no run recorded" is a measured answer, not an "unreadable" tool.
- The due-timer row renders as next and last, not as the raw systemctl row.
- The model column reads "opus-5 ×1,332". Synthetic rows leave it. Sessions with no bird name fold into one summed row.
