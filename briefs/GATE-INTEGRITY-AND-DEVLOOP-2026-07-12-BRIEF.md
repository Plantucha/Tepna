<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 · **Created:** 2026-07-12 · **Executes:** `audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-12.md` §G1 + §D1 + §D2

# The gate's blind spot, the single-threaded local loop, and the two files that killed CI

Three findings from the efficiency audit, landed as one work-unit (all three are tests/tooling — no
runtime file, no bundle, no `manifestHash`).

## §G1 — a skip is neither pass nor fail, so the gate could shrink in silence

The raw recordings live in a **gitignored `uploads/`**, so a fresh clone — CI, *and* the worktree
`CLAUDE.md` §👥 mandates — simply does not have them. Every leg that needs one degraded to a `⊘ SKIP`,
and a skip counts as **neither pass nor fail**, so the gate went green having never run it:

| | local (real corpus) | **real CI** |
|---|---|---|
| assertions | 2113 · **2 skipped** | **2093 · 11 skipped** |
| GATE B fixtures | **23 reproducible** | **10 reproducible · 13 skipped** |

**All eight real-recording equivalence legs — the entire GATE-C surface, the thing `CLAUDE.md` §🔏 says
"closes the loop" — have never run on the merge path.** And nothing pinned the skip count
(`grep -rn "skipBudget\|expectedSkips" tests/` → 0 hits), so a *new* skip was invisible: rename an input
and its leg silently stops being checked, with the suite still green.

**Shipped:**
1. **`tests/expected-skips.json`** — every skip the suite emits must be **declared** here (11 today: 9
   `corpus-absent`, 2 `known-drift`). An **undeclared skip is now a FAILURE**. Shrinking the gate became a
   deliberate, reviewable act: you have to add a line, in a diff, in a PR. Verified by removing one entry:
   the run reds with `▸ SKIP BUDGET — 1 UNDECLARED skip(s)` and names it.
   Fail-closed: a missing/corrupt allow-list yields an EMPTY list, so *every* skip is undeclared and the
   run reds — a lost allow-list must not silently re-open the door it was added to close.
2. **The shared checker `auditSkips()`** lives in `tests/dex-tests.js` (one implementation, both lanes).
   Shard-safe by construction: it judges only the groups that ran in **this** process, so each shard
   validates its own skips.
3. **A COVERAGE report.** A run that skipped corpus-dependent legs now says so, loudly:
   *"▸ COVERAGE — 9 leg(s) NOT verified: the raw recording is absent … This run is NOT the full gate."*
   The whole finding existed for want of one line of output.
4. **`DEX_UPLOADS=<path>`** points the runner at a real corpus, so a worktree can run the gate it claims
   to run. It is also how CI's exact coverage is now **reproducible locally** — point it at a directory
   holding only the tracked fixtures and you get CI's 11 skips exactly. That is how the allow-list was
   derived, rather than guessed.

**Not fixed here (deliberate):** CI still cannot run those 8 legs — the inputs are personal medical data
and stay gitignored. What changed is that the gate no longer *pretends* otherwise. Actually running them
in CI needs an encrypted corpus or a self-hosted runner; see the follow-up.

## §D1 — `--jobs=N`: your laptop was slower than CI at the same work

Sharding shipped (CI 4m05s → 78 s) but only CI used it — the local gate was still single-threaded.

| invocation | wall |
|---|---|
| `npm test` (serial) | **100.7 s** (103% CPU — one core of six) |
| `--jobs=4` (the partition CI uses) | **28.4 s** (391% CPU) |
| `--jobs=auto` | **24.9 s** (448% CPU) |

Identical verdict in every case — 2113 assertions, 2 skipped, 135 groups. Correctness rides entirely on
the partition proof (`verify-shard-union.mjs`): every group lands in exactly one shard, so merging the
children's results reconstructs the full run. A child that dies without parseable JSON is a **hard
failure**, never a silent gap — a lost shard would be a silently shrunken gate, the exact failure class
§G1 is about.

New: `npm run test:par` (`--jobs=auto`), `npm run test:shard`, `npm run verify:shard-union`; **`npm run
check` now uses the parallel runner** (it was 98% the serial suite).

## §D2 — two generated files were a conflict engine, and a conflicted PR gets NO CI AT ALL

`tests/docs-ledger-list.json` + `tests/changes-list.json` are the browser lanes' only way to "list a
directory", so they are committed — and **every** doc/brief/changeset-touching PR rewrites them. Measured:
touched by **62 of 139 commits (45%)**, with **ten merge commits in 48 h** existing purely to re-resolve
them.

The conflict was **structural, not behavioural**: each carried scalar `count` and `generated: <date>`
fields that change on **both sides** of any concurrent add — so the hunks conflicted **even when the
arrays were disjoint**.

**And the failure is silent.** GitHub builds `pull_request` runs against the **merge commit**; when that
merge cannot be created it dispatches **nothing**. The PR sits with **zero checks** and no error anywhere.
This is not theoretical — it hit **PR #43 and again PR #46 in a single session**, each costing a debug
cycle before the cause was found.

**Shipped:** both are now line-oriented text (`tests/docs-ledger-list.txt`, `tests/changes-list.txt`) with
**no volatile scalars**, and `.gitattributes` marks them `merge=union`. Parsing/serialising is
single-sourced in **`tests/list-format.js`** (dual-export, the `manifest-gate.js` precedent — one source,
Node runners *and* `Dex-Test-Suite.html`, so the lanes cannot drift on it).

**Proved, not asserted** — two disjoint concurrent additions, in a scratch repo:
- **new format → AUTO-MERGED**, no conflict, all four briefs present;
- **old JSON, same scenario → CONFLICT** (the exact failure that gave #43 and #46 zero checks).

Union merge may emit duplicate/unsorted lines, or resurrect a deleted one. Both are handled:
readers sort+dedupe, and the existing Node-lane `list == fs` **staleness assertion is the backstop** —
verified: a resurrected line reds with *"list is STALE vs fs … regen via tests/gen-docs-ledger-list.mjs"*.
**So the worst case of a bad union is a RED you fix with one command, instead of a silent no-CI PR.**

## Gates
Suite **2113/2113 (135 groups)**, via `--jobs=auto` · GATE A **8/8** · GATE B **23/23** ·
`build --check` clean · shard-union sound · biome clean.
**No runtime file touched — no `manifestHash` moved, no fixture re-recorded.**
