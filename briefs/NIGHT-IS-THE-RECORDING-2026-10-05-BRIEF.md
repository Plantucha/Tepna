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

**(b) THE COMPOSE RAN OVER A LIVE SESSION, AND THE REPLACEMENT LEFT NO RECORD.**

⚠️ **Corrected by Magpie, and verified here before folding it in — my first reading blamed the wrong
mechanism.** I wrote that "E9's principle — a verdict on disk outranks — did not protect the 19:37 file".
That is a misattribution twice over: **E9 governs `history`'s READ preference**, not this write path, and
the rewrite was the poller's own write guard firing **legitimately**. `capture.py:9428`:

```python
if os.path.exists(spath) and os.path.getmtime(spath) >= os.path.getmtime(vpath):
    return  # composed since the audit last changed
```

Re-compose happens exactly when the loss audit is NEWER than the solid verdict — which it was on every
pass, because the night's data was growing. The guard did what it says. Nothing failed to protect
anything.

So the two real defects in this half are:

- **composing over a LIVE session at all.** The eligibility test admitted a night that had not begun, six
  times, and each pass published a verdict about it. The guard's job is "has the audit moved since I last
  composed", not "is this night finished" — no layer asked the second question;
- **no WITHDRAWAL RECORD on replacement.** The final verdict is the right one, so the harm is not a wrong
  answer: it is that the trail from six UNKNOWNs to one FAIL is unrecoverable from the artefacts and
  survived only in the journal. **This is the defect worth planting a test against**, and it generalises
  past this night: a pass that replaces a published verdict should withdraw it with a reason.

**What my first pass did get right** stands: one recording still produced **two verdict sets** (10-04's
five at 04:31–04:50 and 10-05's three at 05:01), the later judging a 23-minute fragment — which is why
`04:41:48 qc: 2026-10-05 missing stream(s): Wellue O2Ring-S:spo2` reports a stream missing for a night it
ran 22:00 → 04:39. And 10-04's `SHORTFALL` is a third, separate thing: a session excluded over a 162-min
gap, the multi-recording folder of ①.

**Method note, since it cost a round trip:** I searched the journal for the CONSUMER's name (`qc`) rather
than the PRODUCER's (`solid-night`), then read a single artefact and treated its content as the history of
that artefact. A file is a snapshot; the journal is the record. Kestrel's two-reads-disagree reasoning is
what recovered it.

## ②″ THE MEASURED HARM — the folder's verdict judged three recordings as one

Kestrel's numbers, verified on the box, with the arithmetic worked through — because the arithmetic is
what proves the claim, not the statuses.

**SOLID-VERDICT: FAIL**
```
Polar Sense 0C301E3F — completeness: 2,538,420 rows against  5,489,055 expected at  55 Hz = 46.25 %
Polar H10   02849638 — completeness: 6,014,297 rows against 13,004,420 expected at 130 Hz = 46.25 %
```

**The identical ratio at two different sample rates is the tell, and the denominators say why:**

| device | expected | implied span | actually recorded | ratio |
|---|---|---|---|---|
| Polar Sense | 5,489,055 @ 55 Hz | **27.72 h** | 12.82 h | 46.25 % |
| Polar H10 | 13,004,420 @ 130 Hz | **27.79 h** | 12.85 h | 46.25 % |

The folder's own span — first session 10-04 00:26:20 to last write 10-05 04:17 — is **27.84 h**. So the
expected count is the **folder-wide** span for both devices, while each actually recorded ~12.8 h. Two
devices at different rates land on the same percentage because they are divided by the same wrong number.
**This is the harm stated as arithmetic: the judge's population is the FOLDER, not the recording.**

**LOSS-VERDICT: FAIL** — `77.5% of the worn span unrecorded (bar 1.0%); worst Polar H10 02849638: 896.3
min, top cause daemon:pull paused live`. And 896.3 min = **14.94 h** against 27.84 − 12.85 = **14.99 h**:
the "lost" time IS the daytime gap between recordings, charged to the daemon. Nothing was lost; two
recordings were joined by a hole, and the hole was attributed to a pull pause.

So all three verdicts of ② are one defect seen three ways.

## ②′ THE BAND SPLIT IT TOO — and that is the measured case for 18:00

The owner ruled **"18:00 as ruled"**, and it is not a new rule: `nightqc.night_band(ts)` already exists
with `_NIGHT_BEGIN_H = 20`, so scope (1) cites **`night_band` as the recording's definition** and the
change is one constant, 20 → 18. `_SESSION_GAP_SEC = 3600` stays the doff threshold.

**Measured, because the justification is in last night's own data: the band split the recording as well as
the folder, and split it differently.** Last night's FIRST donning was the Verity at **19:08**:

| session | `_NIGHT_BEGIN_H = 20` (today) | `= 18` (as ruled) |
|---|---|---|
| Verity 19:08 | band **10-03** 20:00 → 10-04 10:00 | band **10-04** 18:00 → 10-05 10:00 |
| ring 22:00 | band **10-04** 20:00 → 10-05 10:00 | band **10-04** 18:00 → 10-05 10:00 |
| H10 22:02 | band **10-04** 20:00 → 10-05 10:00 | band **10-04** 18:00 → 10-05 10:00 |

So under the current constant **the recording's first device is assigned to the previous night** while the
other two are assigned to this one. A third split, at a different layer from ① (folders) and independent
of the 21-minute outage: 19:08 is after 18:00 and before 20:00, so the band boundary falls INSIDE the
recording.

Under 18:00 all three land in one band. **This is the arithmetic that makes 18:00 the right constant, and
it is last night's rather than a hypothetical** — which also names the control: any night whose first
donning fell in 18:00–20:00 is mis-banded the same way today, and the 28-night refit must show those
re-banded and no others moved.

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

## ④′ A CAPTURE-LANE FACT, CLASSIFIED — 0-byte stream files are buffered headers

Ring session `…20261005043917` carries a **389 KB and growing** `_PMDARRIVAL.csv` and a **330 KB**
`_OXYFRAME.txt` beside **0-byte** `_PPG.txt`, `_PLETHA.txt`, `_PPG2W.txt`, `_ACCRAW.txt` and their RUNS
sidecars. Classified in this lane, measured rather than inferred:

**The 1 Hz vitals path worked; the waveform path delivered nothing.** OXYFRAME holds decoded 0x04 frames
and PMDARRIVAL is still growing, so the ring is connected and answering — and no PPG, PLETHA, PPG2W or
ACCRAW sample was written at all.

**The 0 bytes are headers still in the writer's buffer, not missing files.** `StreamWriter.__init__` writes
the header at CONSTRUCTION (`if not self.resumed: … self._fh.write(self.HEADERS[stream])`), and
`_maybe_flush` is called from `_row` **alone** — there is no flush between the header write and the end of
`__init__` (checked). With zero rows nothing ever flushes, and the session is still open: the daemon is
running, and `_PPG.txt`'s mtime (05:41) is later than the session's 04:39 start, consistent with repeated
reconnect opens each buffering a header that never lands.

**∅ The consequence worth fixing in this lane:** a 0-byte stream file is **not distinguishable by size from
one that was never opened**, so a consumer reading "0 bytes" as "no data" is right by accident. Flushing
the header at construction would make the file on disk say *"opened, no samples"* — the honest absence —
rather than being indistinguishable from *"not created"*. That is the same distinction Magpie's scope-(2)
item draws one layer out for sidecars (*"a sidecar without a header belongs to a session still being
written"*), and the two should share one rule.

**Not claimed:** which frame types the ring did or did not send. Wren is measuring that; this item is only
about what the files on disk mean.

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
verdict written over a fragment is not a verdict on the recording.

⚠️ **E9 is a neighbour, not the citation.** E9 names a verdict SURFACED without its reason (`state.solid`
→ `null` with no explanation) and governs `history`'s read preference; ②(b) is a verdict REPLACED without
its reason, one layer out on the write side. Related in shape, different in mechanism — and conflating
them is what sent my first reading looking for a protection that was never on that path.

Dry-run first, on the rig corpus copy; **the box run is owner-authorized** and waits.

## Acceptance (pre-stated)

- [ ] The Verity/ring/H10 sessions of 10-04 22:00 and 10-05 04:38 are judged as **one** recording with
      **one** verdict.
- [ ] The `spo2 missing` line of 04:41:48 does not recur: no stream present in the recording is reported
      missing for it.
- [ ] Controls: the last three nights' verdicts are **unchanged** — byte-identical where the recording did
      not straddle a boundary.
- [ ] The superseded fragment verdict is withdrawn **with its reason recorded**, never deleted silently.
- [ ] A row for whichever of ⑤'s two cases the owner does not rule on now — in a **RESIDUE-only PR**, per
      the 2026-10-05 stopgap: main takes rows every ~30 min, so a code PR carrying one goes DIRTY on each
      merge and loses its CI dispatch (#3277 thrashed three times in three hours; #3286 hit it today and
      was split, #3289 carrying its rows).
- [ ] The 28-night refit shows every night whose first donning fell in 18:00–20:00 re-banded, and no other
      night's band moved.
- [ ] ②(a): a judge pass over **zero nights** emits `NOT_RUN`, never `UNKNOWN` — §🧾's own distinction,
      planted so a pass that examined nothing cannot publish an undecided verdict.
- [ ] ②(b): a judge pass that REPLACES a published verdict withdraws it with a reason; the six-UNKNOWNs
      → one-FAIL trail of 2026-10-04 is reconstructible from the artefacts, not only from the journal.

**MINOR** if the folder assignment moves (route (a) — a contract change); **PATCH** under route (b), which
changes no layout. Nothing here is claimed about a night that has not been re-judged.

## Lane split (settled 2026-10-05, after Magpie corrected the seam)

Magpie's header check lands in **`solid_night_inputs.validity`** (the band), not in `active_nights` /
`newest_data_mtime` — so those three seam functions are mine and there is no collision there. But route
(b) touches `compose` / `pending_verdict` / `score_devices` / `history` / `write_night`, all Magpie's
files, and **both defects of ② live there too**. So, by lane and on disjoint files:

| who | what |
|---|---|
| **Magpie** | route (b)'s judge scope + ②(a) `NOT_RUN` over an empty population + ②(b) the withdrawal record, in one PR after its URGENT one, **from this brief** |
| **Heron** | this brief (owner of the acceptance items), the daemon seam, and the fragment-withdrawal migration tool for 10-04/10-05 |

## The seam, named so it stays disjoint

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
