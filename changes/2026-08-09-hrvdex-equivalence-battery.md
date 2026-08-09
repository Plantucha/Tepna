---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---

hrvdex-dsp.js's 298 survivors are classified — and three instrument defects fell out of running it

`tools/probe-batteries/hrvdex-dsp.mjs`: six families (`computeDerived`, `hrvLoadOwnExport`,
`hrvBuildNodeExport`, `hrvEventsFromRows`, `_hrvParseSummaryRows`, `computeCAMQ`) covering 217 of the
298 survivors. 84/84 same-function controls separated; zero blind, degenerate, realm-fail or hung.
**69 `no-distinguishing-input` entries emitted**, 148 distinguishable deliberately left in the
denominator as debt, 81 unfamilied survivors reported UNCLASSIFIED. The sweep behind it was re-run
from scratch and reproduced the 05:04 crawl exactly — 489/191/0/298, canary PASSED, and the same 298
survivors *by key* against a materially changed `tests/dex-tests.js`.

Three defects, each found by pointing the instrument at real data, none visible by reading:

- **`probe-equivalence` could not read a `mutation-crawl` sweep at all.** `mutate.mjs --json` emits
  NDJSON; `mutation-crawl.mjs:365` pretty-prints the same record. The reader parsed the first
  `{`-line and threw on `{`, under an error saying the file "has no JSON object" when the whole file
  is one. `parseSweep` now reads both and refuses empty/truncated input.
- **A 100-char DISPLAY field was being re-applied as source.** `before`/`after` are truncated for the
  terminal; the executable mutation is a closure JSON drops. `applyMutant` rebuilt the line from
  `after`, so every source line over 100 chars was written back cut mid-expression — 42 of 217
  probed survivors reported "the mutant does not parse" about the reader. `--dry-run --json` now
  emits `mutated` (untruncated) and `applyMutant` refuses rather than guess.
- **`--emit` re-trimmed `before`, orphaning entries it had just written.** The ledger key is
  `line op before` verbatim and `mutate.mjs`'s 100-char cut can land on a space; 6 of the 69 entries
  read as ORPHANED — "excluded from every count" — until the emitter stopped normalising the key.

`before`/`after` keep their truncated shape on purpose: they are the key `findCanary` and
`mutate-equivalence.json` match on, and widening them would orphan every entry already recorded.
30 known-answer selftests (was 20). No runtime source touched; no bundle, ledger or fixture moves.
