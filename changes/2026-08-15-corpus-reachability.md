---
bump: patch
type: fixed
brief: FIXTURE-CORPUS-REACHABILITY-2026-08-09-BRIEF.md
---

The fixture tools now SEARCH for the corpus instead of assuming it is in the checkout you are standing
in, and print that search when they refuse.

Two of this repo's own mandates were mutually exclusive. `CLAUDE.md` §👥.1 says always worktree when
you touch a DSP; §🔏 says a DSP change moves `computeHash` and owes a `verify-fixtures` re-run. Those
are the same work — and a worktree does not contain the corpus that re-run needs. `uploads/` is 777
files of which **435 are gitignored**, so a fresh worktree off `origin/main` gets the tracked fifth and
none of the recordings.

`corpusSearch(repo)` in `tools/regen-goldens-core.mjs` resolves `$DEX_UPLOADS` → the **primary
checkout**'s `uploads/` → this checkout's, and returns every candidate with its verdict.
`git rev-parse --path-format=absolute --git-common-dir` names the primary checkout's `.git` from
inside any linked worktree, so its parent is the corpus root; outside git the candidate simply does
not exist rather than being guessed. `resolveCorpus` is now a thin front for it, so the whole regen
family inherits the search with no call-site change and there is still exactly ONE search.

Verified from inside a worktree with `DEX_UPLOADS` unset: **all 41 ledger inputs resolve**, against 0
before.

**The expensive part was the message, not the mechanism.** The old refusal said *"Point DEX_UPLOADS at
the corpus: `/path/to/uploads`"* — a placeholder, read by someone standing in a checkout that HAS an
`uploads/`. The natural reading is *the corpus is genuinely absent from this machine*: wrong, and wrong
in the direction that stops you looking. Measured in the brief — the corpus was present the whole time,
one directory up, and was reported absent. A refusal now shows the three places it looked.

**Refusal behaviour is unchanged, and that was run rather than reasoned about.** Pointed at a corpus
genuinely missing inputs, the tool still exits 2 and stamps nothing. Its refusal is the whole design
(`FIXTURE-VERIFICATION-GATE`: a verification you didn't run is precisely the false claim being
abolished); only the message moved.

⚠️ **One real behaviour change, and it fails closed.** Preferring the primary checkout means a
git-TRACKED input can be read from a checkout at a different commit than the one you are standing in.
That input is hashed by GATE B and re-run by the node's equiv leg, so a mismatch reds the suite and
`verify-fixtures` refuses to stamp. The alternative was not running at all.

`docs/CORPUS-LOCATIONS.md` records the four places the data actually lives, re-measured 2026-08-15 —
and three of the four had **grown** in the six days since the brief measured them (777 / 11,646 / 1,980
/ 6,827 across 28 nights), which is why that file states its counts as scale with a `last-verified`
date rather than as a checksum. It also carries the two things nothing else says: `Ecg nightly`
contains a **space**, so an unquoted path yields a false empty corpus rather than an error; and the
freshest nights are only on `vigil`, so regenerating a fixture against recent data may be an `ssh` job.

The gate for this grew a leg it was missing. `every consumer names resolveCorpus` tested the raw
source, so a helper named only in a **comment** satisfied it — the hollow-scan failure that group's own
anti-vacuity legs exist to prevent. It now requires an actual `import` from the core. Three mutants
were applied and each was killed by the intended assertion: hiding the search, using the git dir
instead of its parent, and having `resolveCorpus` stop delegating.
