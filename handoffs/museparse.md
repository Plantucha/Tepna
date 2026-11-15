<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: read the raw device frames into EEGDex

**state:** IN-PROGRESS (held)
**unit:** Part 1 of 4 — the shared frame reader and the EEGDex raw ingest.
**bird:** magpie
**branch:** claude/museparse-mg
**worktree:** ../wt-museparse-mg
**doc-search:** `read a raw device notification frame stream into a node and write NaN at the sample indices a lost frame took` — reranker best 0.222 over the floor 0.105.
**stopping-point:** I wrote the reader and the ingest, wired both into the two test lanes, and committed them as the branch head.
**held:** this part opens NO pull request yet (decision #6385, finding #6388).
**next-step:** when #5049 lands, rebase, re-run the differential battery, re-draft the PR body, and open the draft.


## 0 · Why this part is held, and what the search line got wrong

The frame layout this reader reads has no producer on `main`. The capture daemon's own reader lives
only in draft #5049. A gate over my own constants would examine nothing about that layout. A layout
change in that review would keep every assertion green while this reader stopped matching the file.

The top hits of the search above are `capture-host/cpap_ingest.py:44-64 · classify_frame` and
`capture-host/radioclock.py:267-283 · pmd_fields`. Both are host-side readers in Python, and no JS
node reads this dump. I took two rules from them: count an unreadable frame under its own kind
rather than under loss, and refuse a frame whose tag the reader does not know.

⚠ An earlier line in this file scored one query at 0.214 and recorded it as “no prior work”. The
floor is 0.105, so 0.214 means the search DID find candidates and nobody opened them. Read the floor
beside the score.

## Gate

Green over the committed state: 70 of 70 steps at `EXIT=0`, 18965 assertions over 964 groups, and
the browser lane at 15084 passed with 193 skipped of the budget 193.

## 1 · What this part does

The capture-host writes one notification per line of `<base>_RAW.txt`. A line holds the host stamp,
the device stamp, the notification counter, the payload length and the payload as hex. The payload
holds records of several kinds. EEGDex wants one kind and PpgDex wants another, so the reader is a
shared module rather than a copy in each node.

`muse-frame.js` is a port of the capture-host's own Python reader. It keeps that reader's refusal
words, and a differential battery holds the two to the same answers.

`EEGDSP.ingestMuseRaw(text)` returns the frame `compute` already takes from `ingestEDF`. So two readers reach
the analysis path below it, and that path exists once.

## 2 · The three decisions a reviewer should check

**The reader counts the gap from the record index, not from the notification counter.** One notification
carries records of several kinds. A gap of three notifications is therefore not a gap of three EEG
records. Each record carries its own index, which steps by one from one record of that kind to the
next. That index is the only counter that answers how many EEG records are absent.

**A lost record becomes NaN, and the position advances.** The samples inside a dropped notification
were never measured. `epochBands` already refuses an epoch that holds one non-finite sample, and
`epochAbsence` already answers `partial-hole`. So a dropout reaches the node's existing words and
needs no new reason key. A 23 ms gap costs its own epoch and leaves the other epochs scored, which
is the owner ruling of 2026-09-17: a discontinuity refuses and reduced coverage annotates.

**The reader measures the rate, and it only reports the host axis.** The rate comes from the median interval
between records on the device clock. It reads 256 Hz, which agrees with the device reader's own note
of 78 125 ticks per record at 128 records each second. ECGDex corrects its rate above a 2400 s span,
but that span is a measurement of the H10 crystal over H10 fragments. Nobody has measured this
device, so the axis rides the answer as a diagnostic and never moves the rate.

## 3 · What part 1 changed

| file | change |
|---|---|
| `muse-frame.js` | new — the shared frame and row reader |
| `eegdex-dsp.js` | `ingestMuseRaw`, and the stale note that said this node needs no clock |
| `EEGDex.src.html` | co-loads `clock.js` and `muse-frame.js`, so the bundle carries both |
| `tests/dex-tests.js` | three groups: the reader, the ingest and every named refusal |
| `tests/run-tests.mjs` | the new source in the scan list, the executed realm and the env table |
| `Dex-Test-Suite.html` | the script tag, the source list and the env table, for the same reasons |

`EEGDex.html` carried no clock before this. The bundle now carries one, so the EEGDex
`manifestHash` moves, and the compute closure holds the clock, so `computeHash` moves too.

## 4 · What is left

- Part 2: the optical records in `ppgdex-dsp.js`, on this reader.
- Part 3: the fold in OverDex and the pulse leg of the arterial pages.
- Part 4: the deploy field on the EEGDex row, alone. Heron carries that question to the owner.
- One committed synthetic frame fixture, written by the capture-host and read by both decoders. It
  waits for the Python reader to land on main.
