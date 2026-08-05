<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
---

`blind_spots.py` shipped in #965 with 44 mutants CI's diff-scoped gate could see and I could not — I
merged past a red mutation job. Every one of its 18 tests ran on a two-line synthetic snippet, which is
the exact hole that let the JS sibling pass a 6/6 self-test while returning zero on the real 33k-line
suite. Adds a canary that plants a known blind spot in a REAL 3000-line test file, a floor so `[]`
cannot read as "clean", and a control so the floor cannot be met by a scanner that flags everything.
The canary alone killed 24 of the 44; three further tests killed the five behavioural survivors. The
remaining 15 were predicted as equivalent/unobservable before the run and confirmed still surviving.
