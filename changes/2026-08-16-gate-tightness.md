---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

A defect class the mutation programme cannot see, reported by a peer session with one confirmed
instance: a source-scan assertion that checks an IDENTIFIER exists using a pattern a SUBSTRING
satisfies. `/def classify\([^)]*se/` stays green against `def classify(sl, se_unused=None` — the gate
passes on a signature that no longer has the parameter the gate exists to require.

⚠️ **Code mutation cannot find it, by construction.** `mutmut` and `tools/mutate.mjs` mutate the CODE
and ask whether a test notices; this defect lives in the TEST. Mutate the code and the gate correctly
reds — the hole only opens under a REFACTOR, which no code-mutation operator generates.

`tools/gate-tightness.mjs` decides it STATICALLY, so it is a lint and not a mutation run: take the
regex, find what it matches in a real source file, rename an identifier inside the match to a longer
one containing it, re-test. Milliseconds per site, no suite run.

Three corrections, each caught by a planted control before the tool was trusted:
- **Rename only identifiers the assertion asserts on** — those written literally in the pattern. The
  first version renamed every identifier in the match and flagged the peer's own FIX via an unrelated
  `sl → sl_unused`; renaming what an assertion says nothing about correctly leaves it green.
- **A prefix of a symbol counts.** Demanding an exact symbol dropped `/CK_AXIS_MAX/` against
  `CK_AXIS_MAX_PPM` — which IS the defect, an assertion already satisfied by a longer name.
- **Prose is not code.** Unfiltered, message-text assertions (`/stable/`, `/fewer than two/`)
  dominated: 302 raw hits, mostly noise. Matches inside comments and strings are excluded, and since
  the one confirmed instance is in `allan.py`, Python needed its own mask rather than none.

**126 of 378 patterns that reach code are substring-satisfiable.** That is a candidate count, not a
defect count — whether each matters depends on whether the assertion's purpose is to pin that symbol,
which is a judgement the tool does not make. The reporting session had one instance and no rate; this
turns that into a reviewable list.

A zero from this tool would mean nothing on its own, so `--selftest` plants both a loose assertion it
MUST find and a tight one it MUST NOT — including the peer's real instance and their real fix.
