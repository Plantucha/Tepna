<!--
  NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-07-27 · **Created:** 2026-07-27 · **Follows:** `NODE-EXPORT-RECORDING-DURATION-2026-07-24-BRIEF.md` (which asked whether a node declares a length at all; this one asks what it MEANS) · **Decision:** owner-ratified 2026-07-27 (option (c)) · **Builds-on:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` §6.2 (`recording.coverage`, landed `986d17e`) · **Relates:** `INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md` (§5 — the coverage model this ruling completes), `CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24-BRIEF.md` (added the `durSec` key whose meaning this pins down)

# `recording` publishes BOTH a data duration and a clock end — one scalar cannot answer two questions

> **The ruling (option (c), ratified 2026-07-27).** A node-export's `recording` block carries **`durSec`
> — how much signal the node actually has** — *and* **`endEpochMs` — where the recording ends on the
> clock**. Neither replaces the other, and their ratio is the coverage fraction. The alternatives were
> (a) data-seconds alone and (b) wall-span alone; each answers one question and silently mis-answers the
> other.

---

## 1 · Why the question existed

The three trio nodes disagreed, and nothing said which was right:

| node | field | derivation | meaning |
|------|-------|------------|---------|
| ECGDex | `durSec` | `n / fs` (parser) → `nnRes.activeSec` (analyze) | **data seconds** |
| PpgDex | `durSec` | `(n − 1) / fs` over a **gap-filled grid** | **near** wall span — short by up to 6.6 min on a gappy night (§6.1) |
| OxyDex | `durationMin` | `last.tMs − first.tMs` | explicitly **wall span** |

On 2026-07-17 that is ECGDex **8.92 h** against PpgDex **14.54 h** / OxyDex **14.62 h** — for one night.
Both readings are defensible; having both under one name is not.

**The measured consequence** (2026-07-16…26 capture corpus, 11 nights): because ECGDex declares data
seconds and nothing else, `t0 + durSec` lands short of where the recording actually ended by exactly the
dropout time — so **ECGDex's own events fell outside its own declared window on 11 of 11 nights**, by
**+8 min to +326 min**. The node under-declared where it stopped.

## 2 · Why (a) or (b) alone is not enough

- **(a) data-seconds alone** — correct for every *per hour of recording* rate (HRV coverage, beats/hour, quality %) but **is not a position on the clock**: `t0 + durSec` names an instant where nothing happened. This is the state ECGDex was in, and §1 is what it cost.
- **(b) wall-span alone** — bounds the recording correctly on the clock, so windows and overlaps are right, but says nothing about how much of that span is real. That is precisely the defect `INTEGRATOR-GAP-AWARE-OVERLAP` documents: a night that is mostly holes reports full-span coverage.
- **(c) both** — each field answers the question it is actually asked, and `durSec / (endEpochMs − startEpochMs)` is the coverage fraction for free. **No consumer change is required**: `integrator-dsp.js normalizeFile` already prefers `endEpochMs` over every duration key, so a node that gains the field is honoured immediately and a node that has not gained it yet behaves exactly as today.

## 3 · The contract

```
recording: {
  startEpochMs,   // floating wall-clock ms of the FIRST sample (unchanged)
  endEpochMs,     // floating wall-clock ms of the LAST sample — READ, never derived; null if unknown
  durSec,         // seconds of ACTUAL SIGNAL (excludes dropouts); null if unknown
  …
}
```

Two rules, both non-negotiable:

1. **`endEpochMs` is read, not reconstructed.** Deriving it from `durSec` + a gap list is a guess, and Clock Contract §2.6 says a value we do not have is `null`, never fabricated. ECGDex reads the last row's Phone timestamp; the value round-trips that stamp exactly (`2026-06-17T01:12:19.371` → `1781658739371`).
2. **Absent ⇒ today's behaviour.** The field is additive. A `null` is honest and costs nothing: on a gapless recording the Integrator's existing `t0 + durSec` fallback is already exact, which is why no derived fallback was added for the synthetic path.

## 4 · Status per node

| node | `durSec` semantics | `endEpochMs` | state |
|------|--------------------|--------------|-------|
| **ECGDex** | data ✓ | ✓ **shipped 2026-07-27** | **DONE** — parser reads the last stamp, `analyze` carries it (a recording property, not an analysis one, same as `offsetMin`), both goldens regenerated |
| PpgDex | **span** ✗ — needs the coverage model to become data | ✗ | pending |
| OxyDex | **span** ✗ | ✗ | pending |
| MotionDex | `Math.round(durSec)` — data (verify) | ✗ | pending |
| PulseDex · HRVDex · GlucoDex · CPAPDex | unaudited | ✗ | pending |

**Why ECGDex first and alone:** it is the only node where the defect was *measured* (11/11 nights), and
the only one whose `durSec` is already data — so it needed the additive half only, with no change to an
existing field's meaning. The remaining nodes split into two very different jobs:

- **Adding `endEpochMs`** is additive everywhere and can proceed node by node.
- **Making `durSec` mean data** for PpgDex/OxyDex is *not* additive — it changes a published field's meaning,
  and it requires a per-node definition of "present data" (for a gap-filled PPG grid, which slots count?).
  **That definition now EXISTS**: `986d17e` (DEEP-AUDIT-III §6.2) shipped `recording.coverage =
  { kind, spanSec, segments, recordedSec, … }`, which is this ruling in a richer shape — `spanSec` is the
  envelope, `recordedSec` is the data, and they are deliberately separate so neither reads as the other.
  So the remaining nodes should adopt **`coverage`**, not a second convention: `endEpochMs` answers the
  envelope question for a node that records continuously, and `coverage.segments` answers it for one that
  does not. `INTEGRATOR-GAP-AWARE-OVERLAP` §2 shows the three capture nodes are in the second category and
  emit no coverage today — that is the work, and it subsumes the `durSec` renaming rather than preceding it.

## 5 · Cost of the remainder (why it was not done in one pass)

~15 emitters across the DSPs, the apps, `cohort-worker.js` and `synth-gen.js`. Every node-export gains a
key, so **every code-gated fixture's `outputHash` moves** and all 8 regen tools must run; 8 apps plus the
3 orchestrators re-bundle, which **re-stamps every `provenance/<App>.json` fragment at once** — i.e. it
serialises against every other session touching a bundle (`CLAUDE.md` §👥.3). That is a coordinated
work-unit to schedule, not a drive-by.

## 6 · Done when

- [x] ECGDex publishes both; read-not-derived; `null` when stampless; gated (`ecgdex-dsp` group **ECGDex recording bounds**, incl. a dropout stub where data and wall span provably disagree).
- [x] A coverage definition exists (`986d17e` §6.2 `recording.coverage`) — adopt it rather than inventing a second one.
- [ ] `endEpochMs` on the remaining nodes (additive; may land before the coverage model). — **PpgDex
      DONE 2026-08-03 (§6); 6 remain** (OxyDex · MotionDex · PulseDex · HRVDex · GlucoDex · CPAPDex).
- [ ] `durSec` normalised to data-seconds on PpgDex/OxyDex (**not** additive — needs the coverage definition + a CHANGELOG note that the field's meaning changed).
- [ ] `bump: minor` — the export gains a field. The ECGDex-only step is already `minor` for that reason.
- [ ] Per node: regen goldens, re-bundle, `build.mjs --check`, `verify-manifest.mjs` GATE A+B, and — since `computeHash` moves — `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`.


---

## §6 · EXECUTED 2026-08-03 — PpgDex gains `endEpochMs`

### 6.1 · The brief's own table was optimistic about PpgDex, and it is worth correcting

§1 lists PpgDex's `durSec` as *"effectively wall span"*, on the reasoning that the sample grid is
gap-filled — which would make `t0 + durSec` land on the clock end and this field redundant here. That is
why PpgDex was grouped with OxyDex as "span ✗, needs the coverage model" rather than treated as an
additive case like ECGDex.

Measured over the capture corpus, driving the shipped `parsePPG` against the last parseable Phone stamp:

| night | `nGapSpanIntervals` | `t0 + durSec` vs the last stamp |
|---|---|---|
| `20260727221106` | 6317 | **6.6 min short** |
| `20260723013336` | 794 | **1.0 min short** |
| `20260801023357` | 70 | 0.1 min |
| `20260801001305` · `20260731212656` | 57 · 64 | ~0 |
| four largest contiguous nights | — | 0.0–0.1 min |

The gap-fill does **not** recover all lost time; the shortfall scales with gap burden. Far smaller than
ECGDex's measured +8…+326 min, but the same defect class — and exactly why §3 says the field is **read**,
not computed. PpgDex needed the additive half after all.

### 6.2 · What landed

`parsePPG` now carries `endEpochMs`, read from the last row whose stamp parses; `analyze` carries it
through (a property of the RECORDING, not of the analysis — the same reason `offsetMin` needs an explicit
carry); the export publishes it beside `durSec`. §P1's performance win is preserved: the backward scan is
memoised and runs at most once, over ≤40 rows, only where the value is actually read — the per-row
`parseTimestamp` that §P1 removed stays removed.

Gated by `PpgDex recording bounds — endEpochMs is read from the last stamp, never derived`: gapped and
gapless synthetic twins differing only by a 20 s dropout, asserting the stamp is hit to the millisecond on
both, that `t0 + durSec` lands ~20 s short on the gapped one, and that the gapless twin has no such
shortfall (so the gap is what separates them, not the fixture shape). Mutation-verified four ways — the
one that matters is **"simplify `endEpochMs` to `t0 + durSec`"**, the refactor this gate exists to refuse.

**One assertion is deliberately absent.** Clock Contract §2.6 asks that an unknown stamp be `null`, never
fabricated — but for PpgDex that state is **unreachable through `parsePPG`**: a PPG export in which no row
carries a parseable stamp is rejected wholesale, because the layout detector needs the stamp column to
identify the file at all. The `?? null` guard stays (it costs nothing and is the honest default if that
ever changes), but asserting it would assert a branch no input can reach. ECGDex differs — its parser
accepts stamp-less rows — so its sibling gate does pin the null there.

### 6.3 · Compute-path

```
manifestHash  e3b832216694 → f6860a2fd92e   (MOVED)
computeHash   7b7a072ac320 → e38a8746cead   (MOVED ⇒ re-verification owed)
```

The equiv gate reds on sight, which is the GATE-C surface doing its job: the export gained a field, so all
four PpgDex goldens were **regenerated** (never hand-edited) — one field moved in each,
`recording.endEpochMs: undefined → …` — and `verify-fixtures` re-stamped the real corpus fixture
`verifiedUnder → e38a8746cead` after a green run. `bump: minor`, per §5: the export gains a field.
