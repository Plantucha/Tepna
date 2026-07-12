<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, OxyDex]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Lock a file's DMY/MDY date order once, up front, instead of deciding it per row — an MM/DD-configured O2Ring night no longer flips order mid-file, run its clock backward, and report a negative duration with ODI-4 = 0.

`clock.js` gains `DexClock.resolveDMY(stamps, preferDMY)`, which scans a file's stamps once: a row whose
first slash field exceeds 12 proves DMY, a row whose second field exceeds 12 proves MDY, a file carrying
both proofs is contradictory and is refused rather than guessed, and a genuinely ambiguous file falls back
to the caller's `preferDMY`. `parseTimestamp` accepts the resulting `opts.dmyLocked`; when the order is
locked it is applied unconditionally, so no single row can flip it, and a row the lock cannot explain
returns `null` instead of a fabricated date. `oxydex-dsp.js parseCSV` resolves the order before parsing any
row, and `computeStats` now reports `durationMin: null` + `clockNonMonotonic` rather than a negative number
if rows ever run backward again.

Implements Clock Contract §3 ("lock that order for the whole file … Never switch order mid-file"), which
was specified but never enforced. Back-compatible: `opts.dmyLocked` is optional and defaults off, so an
un-scanned caller keeps the previous per-row behavior. All 39 committed O2Ring nights (all DMY) parse
byte-identically; no fixture output moves.
