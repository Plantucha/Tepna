# Unit `patruns` — the PAT legs read the validity sidecar

**Session:** Magpie · **Branch:** `claude/patruns-mg` · **Worktree:** `wt-patruns-mg` (cut from `1147d1599`)
**Row:** `2026-10-17-sample-parsers-called-without-their-sidecar` (OPEN at the ref; this unit takes a named slice)
**Rule 0:** `node tools/doc-search.mjs --read "parser called without its validity sidecar"`

## What the slice did

The row counts call sites of six parsers that accept `opts.runsText` and pass nothing.
`pat-feasibility-worker.js` held two of the three remaining node-side sites.
Both now pair, pass and CONSUME the sidecar.

- `pat-feasibility.js` classifies `_ECGRUNS.txt` and `_PPGRUNS.txt`.
  The ring's sidecar takes the FINGER role, mirroring its waveform.
- Each sidecar pairs to its waveform by the filename's own 14-digit stamp.
  A second candidate on one stamp is ambiguous and pairs to nothing.
- `pat-gate.js` gained the consuming helpers, so a test can execute them.
  `runRanges` · `inRunsCursor` · `dropInRuns` · `intersectRuns` · `runSeconds`.
- The ECG leg drops peaks inside a recorded span before the artifact gate reads confidence.
- The PPG leg refuses a foot pinned on EVERY optical channel and annotates one pinned on some.
- `sharedClock` divides by the UNION of unmeasured seconds, never their sum.

## The trap worth carrying forward

Passing the sidecar is not reading it. Both parsers attach it out of band and null no sample,
because a NaN would delete the row and turn an absence of value into an absence of time.
So a caller can carry the bytes to the record, report beats inside a recorded rail, and stay green.

## What the row still owes

`resp-acc-analysis-app.js` holds one bare call. `tools/` holds 64 in 38 files.
Both stay pinned, so the row stays OPEN.

## State

PR DRAFT. Gate run over the final state. The undraft ask goes to thread 8; I never undraft my own.
