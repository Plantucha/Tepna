<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED — 2026-10-05 · **Created:** 2026-10-05

# NIGHT-IS-THE-RECORDING — one recording, one night, one verdict; and why the folder boundary is the wrong lever

> **Owner, 2026-10-05 07:1x (relayed by Kestrel):** *"The recording defines the night."* Today a night is
> the calendar-day folder, so tonight (donned 22:00) was split at midnight.

Rule 0: `node tools/doc-search.mjs --read "night folder is the calendar day, a session split at midnight,
the recording defines the night, judge stamped before the ring connected"` → `capture-host/writers.py`
(0.703), `capture-host/nightqc.py` (0.696), `ext:memory/kestrel-state-2026-09-29-evening` (0.693).

**The goal is right and is not in question: one recording must be one night with one verdict.** What
follows is what the box actually recorded last night, and what the repo already decided about the lever
the scope proposes to pull.

## ① What last night actually was — measured on the box, read-only

`/srv/tepna/captures/2026-10-04` holds **seven** sessions from **three** different recordings:

| stamp | device | what it is |
|---|---|---|
| `20261004002620` · `20261004002801` · `20261004003220` | ring · H10 · Verity | the **10-03** night's tail, past midnight |
| `20261004095250` | ring | a **daytime** session, 09:52 |
| `20261004190825` · `20261004220023` · `20261004220206` | Verity 19:08 · ring 22:00 · H10 22:02 | **last night's donning** |

`/srv/tepna/captures/2026-10-05` holds **two**: `20261005043815` (Verity 04:38) and `20261005043917`
(ring 04:39) — reconnect tails of the same recording.

So the recording IS split, and one calendar folder currently mixes three recordings.

## ② RECONCILED — I was wrong, and the overwrite is the finding

**My first pass asserted "there is no 19:37 verdict". That was wrong, and the error is instructive.** I
grepped the journal for `qc` and found one line; the unit logs as **`solid-night`**. Kestrel's direct read
at box 04:31 saw `SOLID-VERDICT.json` carrying `status: UNKNOWN`, `at: 2026-10-04T23:37:37Z`. My later read
saw `FAIL`. Both reads were correct: **the file was overwritten between them.** I read the survivor and
reported the absence of what it replaced.

**The journal, searched for the right unit, settles it — and there were SIX, not one:**

```
2026-10-04T12:30:09  INFO solid-night: 2026-10-04 UNKNOWN — 0 solid of 0 nights over 0 days
2026-10-04T13:34:57  …  15:37:01  …  17:35:11  …  18:47:00  …
2026-10-04T19:37:37  INFO solid-night: 2026-10-04 UNKNOWN — 0 solid of 0 nights over 0 days
2026-10-05T04:50:40  INFO solid-night: 2026-10-04 FAIL   — 0 solid of 0 nights over 0 days
```

**(i) The clock is CORRECT — there is no Clock Contract defect here.** `2026-10-04T23:37:37Z` is exactly
`19:37:37 EDT` on a `-0400` box, so the `at` is a true UTC stamp of a 19:37-local write, not a local time
mislabelled `Z`. That question is closed.

**(ii) And the 19:37 pass was not special: it was the sixth of six.** Every pass from 12:30 onward
published `UNKNOWN` over `0 solid of 0 nights over 0 days` — a night that did not exist, hours before the
ring connected at 22:00 — and each overwrote the last. The surviving `FAIL` at 04:50:40 local is a real
judgement (`checked: 3`, with per-device completeness: Polar Sense 46.25 % of 5,489,055 rows expected at
55 Hz).

**So the defect is two defects, and neither is the one originally described:**

**(a) THE JUDGE PUBLISHES A VERDICT ON A NIGHT THAT HAS NOT BEGUN, with the wrong status.** `0 solid of 0
nights over 0 days` is the examined-nothing shape, and §🧾 is explicit that **`NOT_RUN` examined nothing
while `UNKNOWN` means examined and undecided**. Six `UNKNOWN`s over zero nights are six status errors, not
six judgements — and a reader at 20:00 could not tell "the night has not started" from "the night is
unjudgeable".

**(b) A VERDICT IS OVERWRITTEN WITHOUT WITHDRAWAL.** E9's principle — a verdict on disk outranks — did not
protect the 19:37 file, and nothing records that it ever existed. The final verdict happens to be the
right one, so the harm is not a wrong answer: it is that the trail from six UNKNOWNs to one FAIL is
unrecoverable from the artefacts, and only the journal preserved it. **This is the defect worth planting a
test against**, and it generalises beyond this night: any judge pass that replaces a published verdict
should withdraw it with a reason, not silently replace it.

**What my first pass did get right** stands: one recording still produced **two verdict sets** (10-04's
five at 04:31–04:50 and 10-05's three at 05:01), the later judging a 23-minute fragment — which is why
`04:41:48 qc: 2026-10-05 missing stream(s): Wellue O2Ring-S:spo2` reports a stream missing for a night it
ran 22:00 → 04:39. And 10-04's `SHORTFALL` is a third, separate thing: a session excluded over a 162-min
gap, the multi-recording folder of ①.

**Method note, since it cost a round trip:** I searched the journal for the CONSUMER's name (`qc`) rather
than the PRODUCER's (`solid-night`), then read a single artefact and treated its content as the history of
that artefact. A file is a snapshot; the journal is the record. Kestrel's two-reads-disagree reasoning is
what recovered it.

## ③ 🔴 The folder boundary was already proposed and rejected, with named failure modes

`capture-host/writers.py:766`, section **"WHY NOT MOVE THE BOUNDARY (the noon-to-noon proposal)"**:

> Rolling the folder at noon also closes the seam, and was rejected. It changes where every future file
> lands while the existing corpus keeps the old layout, **so every reader would carry two conventions
> permanently**; and it silently re-points the folder-name-derived dates in `nightqc._midnight_of` /
> `_prev_day_dir` and `timeline.build`'s pooling gate, **none of which would fail loudly** — they would
> just quietly stop matching.

Scope item (1) — *"everything it writes until then goes to the folder of the evening date"* — is that
proposal with the boundary at 18:00 instead of noon. The objections are unchanged by the hour chosen.

**And there is already a midnight fix**, from the same section: a set reconnecting across the boundary
**adopts the folder it already lives in** (*"A resumed set must be appended to WHERE IT LIVES"*), because
writing yesterday's stamp into today's folder would put one set name in two directories — *"strictly
worse than the fragmentation being fixed"*. Measured driver: 16 of 29 sub-5-minute seams straddled a
folder boundary.

**Why it did not catch last night:** adoption is gated on a window (default 300 s) judged on the newest
member's mtime. The H10's last write was **04:17** and the reconnect **04:38** — a **21-minute** gap, and
the design deliberately refuses to resume across a true outage because *"that fragmentation is
information (the 37/75-minute wedges must stay visible)"*. So last night's split was caused by a 21-minute
outage, **not** by midnight, and moving the boundary would not have prevented it: a 04:38 reconnect lands
in the evening folder under an 18:00 rule, but the two sets still differ and the judge still sees two.

## ④ The recommendation: honour the ruling at the JUDGE, not at the folder

The ruling is about what a night IS, and that is a question about judgement, not about storage. Both
routes satisfy it; only one carries the two-conventions cost:

| | changes | cost |
|---|---|---|
| **(a) move the boundary** (scope as written) | every future file's folder | two permanent layout conventions; three named consumers re-point silently |
| **(b) the judge spans the recording** | no layout, no folder name, no filename | the judge must learn to group sessions into a recording |

Under **(b)**: a *recording* is the maximal chain of sessions separated by less than the doff threshold,
beginning at the first donning after 18:00 and ending at the morning doff + quiet — exactly the owner's
definition — and the judge emits **one** verdict for it, in the folder of its FIRST session, with the
later folder carrying a pointer rather than a second verdict set. `writers.py`'s own fix already looks
across folders for this reason; the judge does not yet.

**This is the owner's call and the brief does not pre-empt it.** (b) is recommended because it delivers
the stated goal while keeping the property `writers.py` paid for, and because it is the only one of the
two that would also have fixed last night, whose split was an outage rather than a calendar artefact.

## ⑤ Two cases the ruling does not yet cover

- **A daytime session** (`20261004095250`, 09:52) is not a night under "first donning after 18:00", but it
  exists and is currently filed in a night folder. Where does it go, and is it judged at all?
- **The 10-03 tail** (`…00262*`–`…00322*`) belongs to the 10-03 recording. Under (b) it is grouped there
  with no file moved; under (a) it must be re-filed, which is migration over the whole corpus rather than
  two folders.

## ⑥ Migration, reworded by ② (scope (3))

**There is no "pre-recording verdict" left to remove** — the six 19:37-and-earlier UNKNOWNs were already
overwritten by the 04:50 FAIL before anyone could act on them, which is itself defect ②(b). So the
migration's removal step has no target, and inventing one would be deleting a verdict that is already gone.

What it must do instead, confirmed with the owner's deputy:

- **withdraw the superseded FRAGMENT verdict** — 10-05's three, judging the 23-minute tail — **with its
  reason recorded**. Nothing is deleted; the withdrawal is a record, which is exactly the property ②(b)
  shows the judge currently lacks;
- **judge the recording once, in its FIRST session's folder**, leaving the later folder a pointer.

**And the principle the original wording reached for still holds, so the brief states it as a rule rather
than as this night's event:** a verdict written before the recording existed is not a verdict on it, and a
verdict written over a fragment is not a verdict on the recording. E9 is the citation — a verdict
surfaced without its reason (`state.solid` → `null` with no explanation) is what E9 names, and ②(b) is the
same failure one layer out: a verdict replaced without its reason.

Dry-run first, on the rig corpus copy; **the box run is owner-authorized** and waits.

## Acceptance (pre-stated)

- [ ] The Verity/ring/H10 sessions of 10-04 22:00 and 10-05 04:38 are judged as **one** recording with
      **one** verdict.
- [ ] The `spo2 missing` line of 04:41:48 does not recur: no stream present in the recording is reported
      missing for it.
- [ ] Controls: the last three nights' verdicts are **unchanged** — byte-identical where the recording did
      not straddle a boundary.
- [ ] The superseded fragment verdict is withdrawn **with its reason recorded**, never deleted silently.
- [ ] `briefs/RESIDUE.md` row for whichever of ⑤'s two cases the owner does not rule on now.
- [ ] ②(a): a judge pass over **zero nights** emits `NOT_RUN`, never `UNKNOWN` — §🧾's own distinction,
      planted so a pass that examined nothing cannot publish an undecided verdict.
- [ ] ②(b): a judge pass that REPLACES a published verdict withdraws it with a reason; the six-UNKNOWNs
      → one-FAIL trail of 2026-10-04 is reconstructible from the artefacts, not only from the journal.

**MINOR** if the folder assignment moves (route (a) — a contract change); **PATCH** under route (b), which
changes no layout. Nothing here is claimed about a night that has not been re-judged.

## Coordination — the exact seam Magpie and I both touch

Scope item (2) folds *"a sidecar without a header belongs to a session still being written"* into the
eligibility test. Named precisely so it can be sequenced rather than guessed at:

- **`capture._current_night(captures, settle_sec)`** is the entry point. It calls
- **`diskguard.active_nights(captures, settle_sec)`** — which #3252 (E8) changed, excluding lifecycle
  sidecars by RULE rather than by failing to parse — and
- **`nightqc.newest_data_mtime(night_dir)`**, which ranks the active folders by where the DATA is.

A header check on a sidecar lands in one of the last two. **Magpie's URGENT PR goes first**; this brief
changes neither function, and the route-(b) work touches the verdict's SCOPE rather than the eligibility
test, so the two need not collide at all once sequenced.

⚠️ **And `_current_night` is itself prior work on this brief's subject**, which strengthens route (b): its
comment already records that *"a cross-midnight session leaves TWO folders active… at 00:00 the LINK/CLOCK
sidecars roll into a fresh date dir while every sensor keeps appending to the session's START-date
folder"*, and that ranking by folder NAME judged two sidecars and reported nine missing streams against
942 MB of healthy recording on 2026-07-28. The reader already knows a recording spans folders and ranks on
data to cope. **The verdict writer does not.** That asymmetry is the bug route (b) closes, and it is
confined to the judge.
