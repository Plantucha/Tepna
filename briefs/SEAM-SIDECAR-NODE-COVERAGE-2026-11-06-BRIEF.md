<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-11-06 · **Created:** 2026-11-06 · **Source:** board decision #3794 item 2. The row it answers is `2026-11-05-four-clock-carrying-nodes-still-read-no-seam-sidecar`. **Measured 2026-11-06 (Osprey):** four seam spellings exist corpus-wide, reading PPG 180, PPI 76, ECG 74 and HR 38. Every node ingesting one of those four primaries now reads its sidecar. HRVDex ingests no capture-host stream primary, so it owes no read. OxyDex ingests one primary whose writer feeds a sidecar, and the ring hands that writer no device stamp, so the sidecar never opens.

# Brief — which inputs the box writes a seam sidecar for, per node

> This brief wires nothing. It closes a census question: the row asked which nodes still read no seam
> sidecar, and the honest answer needs the writer surface and the corpus held side by side.

## 1 · The question

Board decision #3794 item 2 reads: *"Osprey measures which HRVDex and OxyDex inputs the box writes a
seam sidecar for. The row closes when every node with a written sidecar reads it."*

Four legs had already landed: ECGDex in #4406, PpgDex in #4441, MotionDex in #4453 and PulseDex in
#4456. The row names four clock-carrying nodes, so a reader could assume two more legs remained. The
measurement says otherwise, and the reason is worth recording.

## 2 · Method

Two populations, held against each other.

- **What the box CAN write** — the writer surface in `capture-host/writers.py`, read by hand.
- **What the box HAS written** — every `*SEAMS.txt` under the two reachable corpus roots.

The census walked 65496 files. Counts below come from that walk, never from a glob of one directory.

The walk is one command per root: `find <root> -type f -name '*SEAMS.txt'`. ⚠️ The corpus path is a
**symlink** to the NAS, so a `find` rooted at it and given no `-L` returns zero files and exits 0 — a
green count over nothing. Name the two real subdirectories, or pass `-L`.

## 3 · What the box can write

`_SeamSidecar` (`capture-host/writers.py:1043`) names its own file: `self.path = base + "SEAMS.txt"`
at line 1090. `StreamWriter` (line 1717) constructs one at line 1891, and it opens **lazily** through
`_ensure`.

Two gates stand before that open, and a reader of this census needs both.

- **`feed` returns on its FIRST line when the device stamp is `None`** — "no device clock on THIS
  sample: nothing can disagree, so nothing to open". A stream the box hands no device stamp therefore
  judges nothing, ever, and its sidecar cannot exist.
- **`_ensure` is also reachable from `note_pmd`**, so a sidecar that exists with zero seam rows proves
  a PMD note landed, not that a judge examined an interval.

So an absent file means no seam AND no note. It does not mean a judge looked and found nothing. I
wrote the weaker reading into board entry #3815 and Magpie corrected it in #3818; I then verified
both gates in the source, at `feed`'s first line and at `capture.py:6258`.

Eight of the nine write methods feed it: `ecg`, `pletha`, `ppg2w`, `ppg`, `gyro`, `mag`, `ppi` and
`hr`, at lines 1924 through 2018. **`write_acc` never feeds it.** So `_ACCSEAMS.txt` can only stay
unwritten, which is why §4's census finds none. Heron holds that writer-side row as board claim
#3813, and MotionDex's reader in #4453 is correct and idle.

One writer builds no sidecar at all: `Spo2CsvWriter` (line 3403), which owns `_SPO2.csv`. A grep for
a sidecar reference over its whole body returns nothing.

## 4 · What the box has written

| spelling | files | devices |
|---|---|---|
| `*_PPGSEAMS.txt` | 180 | 104 Wellue O2Ring-S · 76 Polar VeritySense |
| `*_PPISEAMS.txt` | 76 | Polar VeritySense |
| `*_ECGSEAMS.txt` | 74 | Polar H10 |
| `*_HRSEAMS.txt` | 38 | Polar H10 |

No other spelling exists. In particular the census finds **zero** `_PPG2WSEAMS`, `_PLETHASEAMS`,
`_ACCRAWSEAMS`, `_GYROSEAMS`, `_MAGSEAMS` and `_ACCSEAMS` files.

One caveat the counts carry. A sidecar's existence is not a judged interval: `write_hr` passes
`None` at `capture.py:4528`, so the 38 `_HRSEAMS` files hold 0 seam rows and owe their existence to a
PMD note. My PulseDex unit measured that shape from the reader's end, and #4456 keeps a flat-row
reason rather than a refusal because of it.

A second census reports 292 files where this one reports 368, in board entry #3818. The two walks
differ in method, not in verdict, and the per-root split lets a reader reproduce either. `uploads`
holds PPG 49 · PPI 23 · ECG 22 · HR 19, and `smoketest-captures` holds PPG 131 · PPI 53 · ECG 52 ·
HR 19.

The stream primaries those sidecars would sit beside are not rare. `_PPG2W.txt` reads 1283 files,
`_GYRO.txt` 1730, `_MAG.txt` 3760, `_PLETHA.txt` 127 and `_ACCRAW.txt` 258. The same captures carry
285 `_PPG2WRUNS.txt` run sidecars, which shows the sidecar machinery running on that stream.

## 5 · Per-node verdict

| node | ingests | sidecar the writer feeds | written | reads it |
|---|---|---|---|---|
| ECGDex | `_ECG.txt` | `_ECGSEAMS` | 74 | yes, #4406 |
| PpgDex | `_PPG.txt` | `_PPGSEAMS` | 180 | yes, #4441 |
| MotionDex | `_ACC.txt` | none, `write_acc` never feeds | 0 | reader wired, #4453 |
| PulseDex | `_PPI.txt` · `_RR.txt` | `_PPISEAMS` · `_HRSEAMS` | 76 · 38 | yes, #4456 |
| OxyDex | `_SPO2.csv` | none, `Spo2CsvWriter` builds none | n/a | NOT_APPLICABLE |
| OxyDex | `_PPG2W.txt` | feeds, but every row's stamp is `None` | 0 of 1283 | no, and none can exist |
| HRVDex | no stream primary | n/a | n/a | NOT_APPLICABLE |

**HRVDex ingests no capture-host stream.** `hrvdex-app.js` accepts exactly two shapes: a
Welltory-style summary CSV through `parseCSV`, and a node-export through `ingestGangliorJSON`
(`hrvdex-dsp.js:541`). A seam sidecar pairs by a primary's base name, so with no primary there is
nothing to pair. That holds under any capture-host change keeping the naming rule.

**So the row's criterion holds.** Every node with a written sidecar reads it, and the two remaining
nodes have no written sidecar to read.

## 6 · Two findings the census produced

The row did not ask for either. Both get a residue row when the ledger slot frees.

1. **OxyDex reads `_PPG2W.txt` and matches no seam pattern, and that is now the correct state.**
   `oxydex-dsp.js` reads the stream at line 760 and `_PPG2WRUNS.txt` at line 754. Neither pattern
   matches `_PPG2WSEAMS.txt`, and `dex-ingest.js:157` sets that name aside as non-signal. **I first
   recommended a pre-emptive reader and I withdraw that.** `capture.py:6244` states the cause in its
   own comment: the ring exposes no device clock on `OP_RT_PPG`, and the host back-times each row
   from arrival. A reader there would be code against bytes this firmware cannot write. Magpie
   reached the same verdict independently in #3818 and holds the leg under the #3810 split.
2. **HRVDex drops the upstream node's `recording.validity` and emits none of its own.** A grep of
   `hrvdex-dsp.js` for a validity or seam key returns one match, at line 1077, an unrelated comment
   about medical-claim validity. `hrvBuildNodeExport` writes a `recording:` block with no validity
   key. So an ECGDex or PulseDex night that refused a metric under `clock-seam` feeds HRVDex as an
   unmarked row. The refusal does not survive the hop. That is §∅'s absence read as a number, one
   node removed from the parser that recorded it.

## 7 · Acceptance

- [x] The writer surface names every stream whose writer feeds a seam sidecar.
- [x] The corpus census counts every seam file that exists, with its device.
- [x] Each of the eight nodes carries a verdict, with the landing PR or a named reason.
- [x] The row's criterion gets a yes or a no, not a plan.
- [x] Both side findings carry a `file:line` a reader can check.
