<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# LEXICON — the Dex Suite naming system

> A **guide, not a rename.** `Ganglior` is FROZEN (see `CLAUDE.md`); the parked
> `Ganglior → Fascia` rename stays parked behind its single constant. Nothing in
> this document renames anything. It exists so the suite *reads* as one system
> instead of separate inventions — and so the next node (CPAPDex, EEGDex, …)
> slots in without a naming debate.

---

## 1. The metaphor: one nervous system

The suite is an **autonomic-nervous-system analogue**, and the names already encode it.
Read end to end it is a literal **reflex arc**:

```
   afferent          relay            integration           efferent
   receptors    →    bus         →    centre          →     insight
   ─────────         ───────          ──────────            ────────
   the -Dex          Ganglior         the Integrator        "Tepna"
   nodes             event bus        fusion layer          (the read-out)
```

- **-Dex nodes = afferent receptors.** Each senses exactly **one** signal and reports it
  inward. OxyDex senses oxygen; ECGDex senses cardiac electrical activity; PulseDex senses
  raw beat-to-beat timing; GlucoDex senses glucose; HRVDex summarizes variability. A receptor
  does one transduction well — that is why a node is single-signal.
- **Ganglior = the relay bus.** *Ganglia* are the nerve junctions where signals are routed and
  relayed. Ganglior is where node exports converge as events. The name fits the role exactly;
  it is frozen and untouched. (The `fascia` input alias is read for back-compat only.)
- **The Integrator = central integration.** Afferent signals converge here and become a single
  coherent percept — the longitudinal, cross-signal picture no single receptor can produce.
- **"Tepna" = the tagline, not a sibling brand.** It names *what the system produces*
  (an autonomic read-out), not a fourth product next to the -Dex nodes. Never capitalize or
  package it as a node.

This is the same arc a knee-jerk follows: receptor → relay → integration → response.

---

## 2. Role language (use these words)

When you describe any part of the suite, name its **role in the arc**, not just its file:

| Part | Role word | Say | Don't say |
|---|---|---|---|
| A `*Dex` app | receptor / node | "the OxyDex **node** senses SpO₂" | "the OxyDex **app/tool/product**" |
| `Ganglior` | relay / bus | "emit onto the **Ganglior** bus" | "the Ganglior **format/file**" |
| Integrator | integration centre | "the Integrator **fuses** afferent nodes" | "the Integrator **dashboard**" |
| Tepna | the read-out | "surfaces **ANS-intelligence** insight" | "the Tepna **app**" |

A node **senses** and **emits**; the bus **relays**; the Integrator **fuses** / **integrates**;
the system **surfaces insight**. Keep the verbs afferent → efferent.

---

## 3. Capitalization & typographic rules

- **Node names are one closed compound, capital-D:** `OxyDex`, `HRVDex`, `PulseDex`, `GlucoDex`,
  `ECGDex`, `EEGDex`. Never `Oxydex`, `oxy-dex`, `Oxy Dex`, or `OXYDEX` in prose. The signal stem
  is title-case (`Oxy`, `Pulse`, `Gluco`); an **acronym stem stays all-caps** (`ECG`, `HRV`, `EEG`).
- **`Ganglior`** — capital G, never pluralized, never abbreviated. It is a proper noun for the bus.
- **`Integrator`** — capital I when it means the fusion layer specifically.
- **`-Dex`** as a class — when referring to the family, write "the **-Dex** nodes" (leading hyphen,
  capital D). "Dexes" is acceptable casual plural in dev notes only.
- **"Tepna"** — title-case as a tagline; **"ANS-intelligence"** (hyphen, lowercase i)
  when used adjectivally ("an ANS-intelligence read-out").
- **Export schema strings stay lowercase-dotted:** `ganglior.node-export`, `ganglior.crossnight`.
  Code identifiers are not prose — do not title-case them.
- **Evidence + depth vocabulary is fixed** (see the Metric Registry): depth tiers are
  **Core · Advanced · Research**; evidence classes are **Validated · Emerging · Experimental ·
  Heuristic**. Always those words, in that order (the order is the confidence ladder).

---

## 4. Recipe — naming a NEW node

When a new signal earns a receptor, name it deterministically:

1. **Pick the signal stem.** The shortest unambiguous name of the *one* signal it transduces.
   - Common word → title-case it: `Pulse`, `Gluco`, `Oxy`, `Sleep`.
   - Established acronym → keep it all-caps: `ECG`, `EEG`, `EMG`, `CPAP`.
2. **Append `Dex`** (capital D, closed compound): `CPAPDex`, `EMGDex`, `TempDex`.
3. **One signal per node.** If you are tempted to sense two signals, that is two nodes. (Fusion is
   the Integrator's job, never a node's.)
4. **Declare its metric registry** (`<node>-registry.js`) with the two axes for every surfaced
   metric — `depth` (Core/Advanced/Research) and `evidence` (Validated/Emerging/Experimental/
   Heuristic) — plus `label`, `unit`, `goodDirection`, `cite`. Mirror the shape; keep data local.
5. **Emit onto Ganglior** using the frozen export contract (`ganglior.node-export`,
   `recording.startEpochMs` = floating `t0Ms`, `ganglior_events:[{t, impulse, node, conf, …}]`).
6. **Inherit the Clock Contract verbatim** (`CLAUDE.md`). A receptor that lies about time poisons
   the relay.

If steps 1–6 hold, the node is already coherent with the system — no branding review needed.

---

## 5. One-line glossary

- **-Dex node** — single-signal afferent receptor; senses one physiological signal, emits events.
- **Ganglior** — the relay/event bus where node exports converge (frozen name).
- **Integrator** — central integration layer; fuses afferent nodes into a longitudinal percept.
- **Tepna** — the tagline for the system's autonomic read-out (not a node).
- **Metric registry** — the per-node declarative map giving each metric a depth + evidence axis.
- **Depth** — how *much* you see: Core · Advanced · Research (progressive disclosure).
- **Evidence** — how *trustworthy* a metric is: Validated · Emerging · Experimental · Heuristic
  (a non-hue badge; the fill ladder is the confidence ladder).

---

*Branding becomes systematic through this document, not through risky renames. The metaphor was
already latent in the code; this just makes it explicit and repeatable.*
