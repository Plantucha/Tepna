<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
§8's first item: `functionRange` could not resolve arrow consts — `const rmssd = (a) => {…}` was
invisible, so those functions' survivor families claimed nothing in every battery. All THREE copies
of the resolver (probe-equivalence, killcheck, mutation-worklist's whole-file scanner) now recognise
`const/let/var NAME = (…) =>` (async and single-param-no-parens included) and
`const NAME = function`, keeping the three in agreement as their shared comment promises.

A CONCISE arrow (`=> expr`, no braces) resolves to its own single line — the brace counter would
otherwise swallow the rest of the file into a fake range. A multi-line concise body under-claims to
one line rather than over-claiming; recorded in code as the accepted miss.

probe-equivalence's copy also inherited the full metacharacter escaping killcheck already carried
(it still escaped `$` alone). En route, `resolveSweeps` was found forcing directory-grain resolution
back into the freshly per-file `sweepPathFor` — the §1 bug resurrected through the back door one
commit later — and fixed with the reasoning attached.

11 new selftests; planted removal of the arrow alternative reds each copy's own tests, verified as
assertion failures rather than crashes.
