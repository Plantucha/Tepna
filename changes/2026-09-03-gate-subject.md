<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [tooling]
brief: none
---
The gate now says which tree it examined.

`npm run check` reads the WORKING TREE; a PR carries HEAD. No gate in this repo named which one it
looked at, and the two diverge silently. Measured 2026-09-02: a full 14-stage check, a 15-minute
`verify-fixtures` lap and a mutation plant all ran green while HEAD was still a `main` commit with 15
files uncommitted. Every result was true, and none of them was about the commit.

`gate:subject` is the first stage of `npm run check`, so the subject prints even when a later stage
fails. It is a REPORTER, not a gate — it always exits 0, because a dirty tree mid-work is the normal
state and denying on it would fire on nearly every legitimate run.

⚠️ The first draft shipped a bug its own selftest could not see: the pure core was correct and green
while the `git()` helper feeding it called `.trim()`, eating the leading space of `' M package.json'`.
Porcelain is columnar, so every path lost its first character and the tool printed `ackage.json`. A
unit test of a pure function is structurally blind to its own glue. Fixed with a non-trimming `gitRaw`,
a defensive path parse, and a selftest case pinning the malformed shape.
