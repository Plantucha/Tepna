<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host, docs]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04-BRIEF.md
---

docs: scope the remaining capture-host mutation survivors. The cheap half of the 2026-08-02 audit is
done — 65 mutants across four PRs, all in pure functions. What is left is 77 mutants in eight functions
that all reach the outside world through two call sites, so it needs a recording subprocess fixture
rather than more boundary cases. Also corrects the runbook's DOCS-INDEX row, which still said §1 lists
four failure modes after two were added.
