---
bump: patch
type: fixed
brief: DEX-METRIC-REMOVAL-FOLLOWUPS-II-2026-08-09-BRIEF.md
---

**`grep` is blind to `manifest-gate.js`, and it made a false claim ship in #1513.**

```
python  count "computeHash" in manifest-gate.js : 11
git grep -c                                     : 10
/usr/bin/grep -c                                : 10
grep -c   (this shell's wrapper)                : <nothing, exit 1>
```

**Cause.** Offset 10629 is `assets[i].name + '\x00' + sha256hex(...)` — the `logicalName \0
sha256(assetText)` separator `CLAUDE.md` §🔏 mandates for the `manifestHash` projection. That one
deliberate NUL makes `file -b` report **`data`** instead of `JavaScript source`, and this shell's `grep`
is a function wrapping `ugrep -I` (skip binary files), so it skips the file and returns a clean
**no-match**. The file is valid UTF-8 and the NUL is load-bearing — **do not "fix" it**, it would move
every `manifestHash` in the repo. The tooling is at fault, not the file.

**What it cost.** #1513 asserted *"`computeHash` DOES NOT EXIST under that name in this checkout"*, from
a `grep` of `manifest-gate.js` that returned nothing. The accurate claim is narrower: the function
**`computeHashFromText` exists there**; the recorded **value** genuinely does not appear in
`provenance/*.json`, which carry `manifestHash` and `verifiedUnder` only. Half the claim was right, and
the wrong half came entirely from a blind tool. Brief and changeset corrected in place.

**Why it is worth a changeset rather than a footnote.** `manifest-gate.js` defines **both provenance
gates** — `manifestHashFromText`, `gateBEvaluate`, `computeHashFromText`. It is the highest-stakes file
in the tree to be unsearchable, and it fails in the direction that reads as *"this identifier does not
exist"* — the same silent-zero shape as a source-scan with no input or a selftest nobody discovers.

**How to search safely here:** `git grep` (index-driven, no binary heuristic) or `/usr/bin/grep`. A
`grep` zero-result about a tracked file needs a second reader before it is written down; the
discriminator is `file -b <path>` — `data` means the wrapper skipped it.

⚠️ **A hard-link theory was tried first and refuted, recorded so it is not retried:** `manifest-gate.js`
has 39 links, but so do `integrator-tch.js`, `kernel-constants.js` and `metric-registry.js`, and grep
reads all three. 139 root files have >1 link. Only the NUL matters.
