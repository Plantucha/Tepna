---
bump: patch
type: added
brief: none
---

- Add `tools/argv-reads.mjs`, which reads every line of a tool that touches `process.argv` and says whether an unknown token could reach the work. It proves 142 of 258 tools blind to a token nobody named, names 7 that could consume one into a path, and abstains on 82 with a reason. The verdict cross-checks those classes against the executable survey's recorded runs, judging each tool on the bytes that run examined.
