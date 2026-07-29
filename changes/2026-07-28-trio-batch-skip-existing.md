<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
---
`tools/trio-batch.mjs` gains **`--skip-existing`**: a night already computed **from the same inputs by the same code** is not recomputed.

**Why.** Re-running a corpus to add one night recomputed every night. Measured on the 2026-07-27 night: **39.8 s → 0.03 s** for a night already on disk, byte-identical. Over a 20-night corpus that is the entire run spent to add one night of sleep — the exact shape of the nightly incremental workflow.

**Why it is not just "the folder exists".** A skip is a CLAIM that recomputing would change nothing, and an unchecked claim of that shape is how a stale artifact ships — this repo has been bitten twice (a served bundle a day behind a green gate; a fixture re-stamped as reproducible under code that no longer reproduced it). So the claim is checked on both halves, recorded in a `.trio-stamp` sidecar written **only after all three exports land**:

- **inputs** — every planned file's basename + size + mtime. A new session appended to a night, or a re-pull replacing a truncated file, moves the digest and the night recomputes.
- **code** — the DSP sources the child loads (`clock`/`kernel-constants`/`dex-export`/`oxydex-util`/`oxydex-dsp`/`ecgdex-dsp`/`ppgdex-dsp`) **plus `trio-batch.mjs` itself**, whose merge/clip/nocturnal-gate logic shapes the output as much as the DSPs do. Edit any of them and every night recomputes — a stale export no current code reproduces is the defect, not the saving.

Neither digest stores a filename or a serial, only a hash, so the module's privacy contract (§PRIVACY — no serial ever leaves the source folder) is unchanged. The sidecar is deliberately **not** `*.json`: `tch-multinight --dir` globs `/\.json$/i` and the "complete trio" count tests `=== 3`, so a fourth JSON would corrupt both.

A night an OOM-kill left half-written stays **unstamped** and is always redone — the 2026-07-06 case, which kept only its ECGDex export, would not be mistaken for done.

**Opt-in.** Without the flag behaviour is byte-for-byte what it was; existing callers are unaffected.

Gated by 7 new known-answer cases in the tool's own `--selftest` (the verdict is factored into a pure `redoReason()` so it is testable with no corpus and no I/O): skip only on same-inputs+same-code+3-exports, and redo on each of no stamp, unreadable stamp, 2-of-3, 4-of-3, inputs moved, code moved. Verified end-to-end against the real 2026-07-27 night for all four live paths (cold, warm, DSP edit, input touch).

Orchestration only — no bundle, no `manifestHash`, no fixture. `build --check` clean (11 owned), `run-tests.mjs` green, `biome ci` exit 0.
