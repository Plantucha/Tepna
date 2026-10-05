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

## ② 🔴 Three claims in the hand-off do not survive measurement

**There is no 19:37 verdict, and no UNKNOWN on 10-04.** Every verdict in both folders was written
**between 04:31 and 05:01 on 10-05** — after the last stream write at 04:17:

| folder | file | status | written |
|---|---|---|---|
| 10-04 | ADAPTERHCI / BACKCHECK / QC / LOSS / SOLID | PASS · FAIL · **SHORTFALL** · FAIL · FAIL | 04:31–04:50 |
| 10-05 | ADAPTERHCI / BACKCHECK / QC | PASS · **UNKNOWN** · SHORTFALL | 05:01 |

No judge ran at 19:37: the journal for 2026-10-04 18:00 → 2026-10-05 06:00 is readable (11,188 lines) and
contains **exactly one** line mentioning qc — `04:41:48 … qc: 2026-10-05 missing stream(s): Wellue
O2Ring-S:spo2…`. So no verdict was written before the ring connected, and the only `UNKNOWN` is
BACKCHECK's, in the **10-05** folder.

**The real harm is sharper than the one described, and that one journal line is it:** one recording got
**two verdict sets**, and the 10-05 set judges a 23-minute fragment — which is why the judge reports the
ring's `spo2` as a *missing stream* for a night on which it ran from 22:00 to 04:39. A fragment judged as
a night is the defect; a pre-recording verdict is not what happened.

**And 10-04's SHORTFALL is a different defect again**, worth not conflating: *"every stream met coverage,
but a capture session inside the night window was excluded from the judgement: 07:07→09:49 162min gap; 5
later session(s)"* — the multi-recording folder of ①, not the midnight split.

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

## ⑥ Migration, and what it may NOT claim

Scope item (3) asks the migration to remove "the 19:37 verdict as pre-recording". **No such verdict
exists**, so there is nothing to remove on that ground. What the migration must handle instead is the
**two verdict sets** of ②: the 10-05 set judges a fragment, and when the recording is unified that set is
superseded and must be withdrawn with its reason recorded — not silently deleted.

The principle stands as a rule even though this instance does not exercise it, and E9 is its citation: a
verdict surfaced without its reason (`state.solid` → `null` with no explanation) is what E9 names. **A
verdict written before the recording existed is not a verdict on it** — and by the same token a verdict
written over a fragment is not a verdict on the recording.

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

**MINOR** if the folder assignment moves (route (a) — a contract change); **PATCH** under route (b), which
changes no layout. Nothing here is claimed about a night that has not been re-judged.

## Coordination

Scope item (2) folds "a sidecar without a header belongs to a session still being written" into the E8
quiet test, which is **Magpie's URGENT PR**. Messaged before writing any code so we do not both touch the
eligibility test; this brief does not change it.
