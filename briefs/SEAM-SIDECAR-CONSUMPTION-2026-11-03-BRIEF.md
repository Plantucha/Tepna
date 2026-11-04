<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (census BUILT, ingest owner-blocked — verified 2026-11-04 (Osprey): `tools/seam-sidecar-yield.mjs` ships, its `--selftest` passes whole, and `tools/verdict-adoption.json` carries it as `decides`/`adopted`. The four census items are met. No `*-dsp.js` names a seam sidecar, and `tools/trio-fold-validity.mjs` holds no seam reader beside `readRunsSidecar`, so the §4 ingest is unstarted. §4.4 waits on the owner) · **Created:** 2026-11-03 · **Source:** residue `2026-11-02-no-node-reads-a-seam-sidecar-or-the-radio-clock` (Wren) · **Discharges** the owner's 2026-09-16 precondition (§1). **Measured 2026-11-03 (Heron):** `tools/seam-sidecar-yield.mjs` reads PASS over the reachable corpus. No reconnect boundary recorded since the seed fix falls outside an examined population, and §3 carries the counts.

# Brief — the seam sidecar is proven on real nights, so a node may read it

> This brief does not wire a node. It states what the box emits, what the census proves, and what a
> consumer owes before the first `computeHash` moves.

## 1 · The precondition, and why it came first

`_SeamSidecar` (`capture-host/writers.py:1029`) carries the owner's 2026-09-16 decision in its own
docstring: the seam is **emitted, not enforced**. Nothing refuses, and no node consumes it. The
docstring states the reason in one line: "consumption is a separate unit", so a real-night
measurement comes before any `computeHash` moves.

So the row Wren logged is two units, not one. This is the first: the proof. The second is the
ingest, sized in §4.

## 2 · The arithmetic that places a sidecar against its stream

A sidecar reports what it looked at, per writer session, on its own `# final` line. A stream of `N`
samples scanned by `S` writer sessions holds `N - 1` adjacent sample intervals. Those two facts
decide the whole question.

- A sidecar that judges **every** reconnect boundary reports `Σ examined = N - 1`.
- A sidecar that skips **every** boundary reports `Σ examined = N - S`.
- The difference IS the number of boundaries that reached an examined population.

A resumed sidecar used to store its first sample and judge nothing, so a boundary fell between two
sessions and no interval was ever read across it. The fix is `#2902`, merged 2026-09-22. Captured
bytes are immutable, so no re-run repairs an earlier file. The criterion therefore binds on the
nights recorded on or after that day, and the census reports earlier boundaries as history.

## 3 · What the census found

`node tools/seam-sidecar-yield.mjs --dir <root>` emits one `tepna.verdict/1`. Over the two reachable
corpus roots on 2026-11-03:

| figure | value |
|---|---|
| sidecars found | 352 |
| measured, placed against their stream | 334 |
| excluded as unplaceable | 18 |
| writer sessions | 1830 |
| sample intervals examined | 500070264 |
| files recorded since 2026-09-22 | 254 |
| boundaries recorded since 2026-09-22 | 144 |
| **boundaries since the fix outside every examined population** | **0** |
| boundaries before the fix, read as history | 1352, none examined |
| files dated from a mutable mtime | 0 |

The split is clean in both directions. Every examined boundary corpus-wide is a post-fix one, and
no pre-fix boundary reached an examined population at all. That is the seed fix, measured from the
bytes rather than from the diff.

57 seam rows sit across 43 measured files. The largest device step reads 247288567844 ms on an ECG
stream dated 2026-11-01, which is 7.84 years. Its host offset sits on the 2000-01-01 firmware
default, so it is the defect class `#4303` landed a reset for. The box recorded it and no node read
it, which is this row in one line.

### 3.1 · The 18 files a census cannot place, and why they are excluded by name

An HR sidecar feeds on every notification while the writer drops rows. Its `examined` count can
therefore EXCEED the intervals the file holds — 29121 against 29117 on one night, 130 against 125 on
another. A count outside `[N - S, N - 1]` means the sidecar and the stream do not count one
population, so the file says nothing about its boundaries.

16 of 38 HR files read that way, plus one ECG and one PPG file. The census excludes each one by name and puts both
counts in its reason. Clamping such a file into the tally would manufacture a result (§∅).

## 4 · What a consumer owes — the sizing for the second unit

A seam is a gap in ONE continuous stretch of signal, so the owner's 2026-09-17 ruling decides the
shape: **a discontinuity refuses and reduced coverage annotates.** A metric window spanning a seam
is not a short window. It is two windows.

1. **One reader, beside the validity reader.** `tools/trio-fold-validity.mjs` already holds
   `readRunsSidecar` for the box validity sidecar. A seam reader belongs there, with the same four
   states — `read`, `absent`, `unreadable`, `unnamed` — so an absent sidecar never arrives as an
   empty string.
2. **`null` plus a named reason over a window that spans a seam**, with the reason `seam` rather
   than a borrowed one. A 0.6 s seam refuses the window; a 120 s dropout keeps the metric with its
   covered span beside it.
3. **The nodes that carry `clock.js`** are the candidates, because a seam is a clock fact. GlucoDex
   and CPAPDex carry no `DexClock`, so they are out by construction (§✅).
4. **Every old night predates the channel.** Whether a seam-free night and a night with no sidecar
   read the same is a ruling, not a measurement — `BLE-TIMEBASE-EDGE-STAMP-FOLLOWUPS-2026-10-25-BRIEF.md`
   §4 holds the same question for the edge stamp, and it is still the owner's.
5. **The gate cost is real.** A seam reader inside any `*-dsp.js` moves `computeHash` for every
   bundle carrying it, so the ingest lands as its own unit with its own fixture regeneration.

## 5 · Acceptance

- [x] The census measures the emission on real nights, with a machine-readable verdict and a
      pre-stated criterion.
- [x] The criterion binds on the population the seed fix can reach, and an empty population reads
      `NOT_RUN` rather than a pass.
- [x] The census excludes a file it cannot place against its stream by name, and clamps none.
- [x] The tool is a gated `decides` producer in `tools/verdict-adoption.json`, with a corpus-free
      `--selftest` and `--verdict-sample`.
- [ ] A node reads the sidecar and refuses a window that spans a seam (§4, a separate unit).
- [ ] The owner rules on item §4.4 — how a night with no sidecar reads.

## 6 · What this brief does not do

It wires no node, moves no `computeHash` and changes no export. The census is read-only and names
its roots on the command line, because a census of a tree nobody named is a census of nothing.
