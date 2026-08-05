<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [capture-host]
---

`blind_spots.py` + `tools/find_blindspots.py` — find, by reading the TESTS, the arguments a double
accepts and throws away. Mutation testing asks which mutants the suite misses, at minutes per mutant;
this asks which arguments the doubles structurally cannot see, and answers for all 58 test files in
0.39 s. First run: 690 arguments unobservable across 661 doubles, 302 of which swallow `**kwargs`.

Validated by mutation, not asserted: swapping `free_gb`/`free_pct` in capture.py's "disk low" alert
body survived the ENTIRE suite (2851 passed), so an alert reading "Only 3 GB free (87%)" on a box at
87 GB / 3% was unobservable. Fixed by one shared `AlertRecorder` fixture rather than by writing tests
per mutant — 13 ad-hoc notifier doubles all dropped `message` the same way — and five previously
surviving mutants now die.
