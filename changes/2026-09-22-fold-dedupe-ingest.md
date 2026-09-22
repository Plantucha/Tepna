---
bump: minor
type: fixed
brief: none
---

`tools/trio-batch.mjs` refuses to ingest one physical recording twice. A capture basename carries device + stream + full start timestamp, so two files sharing a basename ARE the same recording — same basename and same size keeps one copy (the corpus file, never a staging copy) and reports the dropped paths as a named set; **same basename and different size REFUSES the night**, because which bytes are the recording is then ambiguous and §∅ says a discontinuity refuses rather than guesses. Measured on the real corpus root: **10,932 files across 94 nights** were the same recording ingested twice, and 2026-08-15 is refused because a 38.9 MB Verity PPG also exists as 99–113 byte truncated stubs in three other trees. The walk also skips hidden directories — 11 of them, printed by name, because five staging copies (`.mrr-full-hrn` alone holds 284 capture files) were silently folded as extra sessions — but that is hygiene: a copy in `staging/` carries no leading dot and is caught by the de-dup rule, which is the actual guarantee.
