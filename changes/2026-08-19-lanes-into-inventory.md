<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
§4 executed: the mutation inventory now reports all three lanes, each in its own unit — operators in
**mutants**, pseudo (XMT/Descartes) in **functions**, statement deletion in **statements** — with no
cross-lane total anywhere by construction, because summing them would be meaningless.

`parseLaneLedger` reads the persistent ResumeLedger JSONL the lanes write under `--resume` (last
record per key wins, torn final line skipped); `laneLedgerCandidates` finds ledgers across both §1
state locations, delete-lane per file+group with every group counted and other files' ledgers
excluded. A lane with no recorded run prints an explicit refusal — "absent INPUT, NOT a clean bill"
— rather than zeros, which is also today's live state: no `--resume` ledger survived the reboot, and
the regenerated inventory says exactly that instead of implying clean lanes.

12 selftests; 3 planted mutations (first-record-wins, cross-file leak, empty-lane-as-clean) all
killed. Recorded limit: a lane run without `--resume` leaves no persistent record, so only resumed
runs can ever appear here.
