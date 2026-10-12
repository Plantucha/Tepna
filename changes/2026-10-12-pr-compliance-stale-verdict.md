---
bump: patch
type: added
brief: none
nodes: [tools]
---
`tools/pr-compliance.mjs` check 8: a `tepna.verdict/1` object quoted in a PR body must come from this PR's current code. The check reads the object's `producedBy.commit` and places it against the base and the head. It fails when a non-Markdown file that the PR changes moved after the run. It also fails when the commit left the PR history, does not resolve, or is absent. A verdict on a base commit is evidence about main and passes. A merge from main does not stale a verdict, because the check reads only the PR's own files.

The verdict population now reads `eligible: 9` from `ELIGIBLE_CHECKS`. Before this change it read `eligible: 7` while eight checks ran, so `--json` threw on every full PR context with `excluded: -1`.
