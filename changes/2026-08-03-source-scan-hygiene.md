<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Five tests scanned `capture.py`'s source in ways that make the module unmeasurable — now routed through one helper and gated.

A test that reads a mutatable module's SOURCE breaks against mutmut's generated file, which holds every
mutant inline. mutmut reports it as **"failed to collect stats"** — which reads as a broken environment
rather than a test failure — and the whole module comes back unmeasured. `capture.py` had FIVE such
scans; fixing one was enough to get a measurement while four more waited, which is why the audit
recorded the module at 1 %.

Three of the four scan shapes break: `assert X not in src` (mutmut GENERATES the forbidden string),
`len(matches) == 1` (664 copies of one call site, measured), and `src.split(MARKER)[1]` (splits at the
first MUTANT's copy). Only `assert X in src` is tolerant.

All now go through `tests/_srcscan.module_source()` — an ordinary read on real source, a skip on a
generated file. Deliberately NOT `tools/mutate.py`'s `SOURCE_SCANNING_TESTS`, whose per-FILE exclusion
would also drop the real unit tests beside each scan (for `test_oxyii_rtc.py` that is `oxyii_rtc_due`'s
only coverage, whose 10 mutants would then be reported as fake survivors).

`tests/test_mutation_hygiene.py` fails if a new test reads a mutatable module raw. Its first regex
anchored on `open(` and could not cross the `)` in `os.path.dirname(__file__)`, so it passed while a raw
read sat in front of it — found by negative-controlling the gate, and recorded in the file.

The JS side needs none of this: `tools/mutate.mjs` patches in place one mutant at a time, and
`tests/dex-tests.js` has zero `readFileSync` calls.
