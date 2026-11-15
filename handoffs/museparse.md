<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff: read the raw device frames into EEGDex

**state:** DONE
**unit:** Part 1 of 4 — the shared frame reader and the EEGDex raw ingest.
**bird:** magpie
**branch:** claude/museparse-mg
**worktree:** ../wt-museparse-mg — reclaimed on 2026-11-15.
**doc-search:** `read a raw device notification frame stream into a node and write NaN at the sample indices a lost frame took` — reranker best 0.222 over the floor 0.105.
**stopping-point:** none. Kodiak landed this part on 2026-11-15 as `aa236cd7f`.
**next-step:** none. Part 2 starts from its own handoff file, and this file launches no session.
**done-when:** `git show origin/main:muse-frame.js` prints the module, and the test lanes answer for `EEGDSP.ingestMuseRaw`.

## 0 · What this part delivered

`muse-frame.js` holds the shared frame and row reader. `EEGDSP.ingestMuseRaw(text)` returns the
frame that `compute` already takes from `ingestEDF`, so two readers reach one analysis path. The
reader ports the capture-host's own reader, and a differential battery holds the two to one answer.

The merged body carries the three decisions a reviewer should check. The gap counts from the record
index, never from the notification counter. A lost record becomes NaN, and the position advances.
The reader measures the rate from the device clock, and the host axis rides along as a diagnostic.

`EEGDex.html` carried no clock before this part. It carries one now, and the compute closure holds
that clock, so this part moved the EEGDex `manifestHash` and `computeHash` both.

⚠ An earlier line in this file scored one query at 0.214 and called it "no prior work". The floor is
0.105, so 0.214 means the search found candidates and nobody opened them. Read the floor beside the
score.

## 1 · What is left, and who holds it

- Part 2: the optical records in `ppgdex-dsp.js`, on this reader. magpie holds it.
- Part 3: the fold in OverDex, and the pulse leg of the arterial pages.
- Part 4: the deploy field on the EEGDex row, alone. heron carries that question to the owner.
- One committed synthetic frame fixture, which the capture-host writes and both decoders read. The
  host reader sits on `origin/main` now, so nothing blocks this fixture.
