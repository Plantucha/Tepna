---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

`gate-tightness.mjs` escaped only `$` when building its symbol pattern. That was **correct** — today
`assertedIdentifiers` yields only `[A-Za-z_$]`-shaped tokens, so `$` is the sole reachable
metacharacter — but correct *by a coupling to another function* rather than by anything local, which
is the fragile kind. A CodeQL `js/incomplete-sanitization` warning named it. If the extractor ever
admits a dot or a bracket, a partial escape silently builds a pattern matching the WRONG thing rather
than throwing.

Now a shared `escapeRegex`, exported so it can be tested on inputs the extractor does not currently
produce — the point being to stop depending on that. Four controls, including that a dotted token
cannot become a wildcard.

⚠️ **The first attempt corrupted the file, and the mechanism is worth recording**: the replacement
string passed to `String.replace` contained `$&`, which expands to the MATCHED TEXT — so the anchor was
substituted into the middle of the new regex literal, producing a file whose imports then read as a
syntax error thirty lines earlier. Every splice in the redo uses a replacer FUNCTION, where `$&` has no
special meaning. A find-and-replace that silently rewrites its own replacement is the same family as
everything else this week: the operation succeeded and did something other than what it said.
