<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-08-09 (all 8 probed and classified; **0 killable**, and the count itself was wrong — the parent says 14) · **Created:** 2026-08-09 · **Executes:** `MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md` §6, item 6 · **Instrument:** `tools/probe-clock-equivalence.mjs`

# clock.js's parse-family survivors: 8, not 14, and none of them killable

`MUTATION-EQUIVALENCE` scoped itself to the 15 survivors in `hostAxis`/`correctionAt` and left one box
open — *"`parseTimestamp` · `_ckMk` · `resolveDMY` · `_ckP2` (14 survivors) probed the same way"*. That
box was **orphaned**: `JS-DSP-MUTATION-FLEET` covers the DSP fleet and `clock.js` is the spine, so it
is in neither. This closes it.

## 1 · The count was stale

**8, not 14.** Three waves plus `clock.js — wave 9` have landed since the parent was written, and
nobody re-counted. `clock.js` is byte-identical since `4dbe986c`, so the 123-mutant surface is the same
one the parent measured — only the survivor set shrank. A number in a Done-when box is an artifact
claim, and §1 of `GENERATOR-FOLLOWUPS-III` measured what happens to those: it decays silently.

## 2 · The result

**8 survivors, 8 with no distinguishing input, 0 killable.**

| line | mutation | function | why no input separates them |
|---|---|---|---|
| `L45` ×2 | `parseInt(s, 10) → parseInt(s, 0)` | `_ckZoneMin` | radix 0 auto-detects base 10 for `/^\d+$/`; only a `0x`-prefixed string would differ and the regex excludes it |
| `L78` | `i < list.length → i <= list.length` | `resolveDMY` | the extra iteration reads `list[length]` → `undefined`, which fails the stamp regex and `continue`s; no flag can be set |
| `L118` ×2 | `\|\| → &&` (2 of 3 clauses) | `_ckMk` | over-determined validation — the three `!==` clauses are redundant, so disabling one leaves the others to catch Feb 30 / Apr 31 |
| `L120` | `\|\| → &&` | `_ckMk` | the same over-determination in the time band |
| `L147` | `parseInt(s, 10) → parseInt(s, 0)` | `parseTimestamp` | guarded by `/^\d{10,13}$/` — digits only, so both radices agree |
| `L198` | `&& → \|\|` | `parseTimestamp` | `opts.prevTMs != null` and `isFinite(opts.prevTMs)` are true together for every value that reaches the roll; the pair that would separate them (`prevTMs` present but non-finite) is refused upstream |

`L120 cmp > → >=` reads DISTINGUISHABLE in the raw output — that is the mutant **`wave 9` already
killed**, appearing only because the sweep JSON predates that fix. It is a stale record, not a finding.

## 3 · The verdicts didn't change. Their standing did.

The parent's earlier pass already called these "no distinguishing input" — **but on a battery that had
never been shown to reach them.** Its only positive control lived in `hostAxis` (`L396`), which proves
reach *there* and nothing about `parseTimestamp`/`_ckMk`/`resolveDMY`/`_ckDMY`.

Re-probed with controls **inside the parse family** — mutants the sweep actually killed, so a sound
battery must separate them — the first run came back **3 of 14 BLIND**, and both causes were the
battery's own:

- **`_ckDMY(a, b, preferDMY, locked)` was being called with ONE argument**, leaving `locked` undefined,
  so the entire locked branch — where `L56`'s day-range guard lives — never executed.
- **`L94` is `if (b > 12)`.** Separating `>` from `>=` requires `b` **exactly 12**, and no DMY list
  supplied it.

Widening to a real 4-argument `_ckDMY` sweep over the `0/1/12/13/31/32` boundaries and adding `b == 12`
lists took the controls to **14/14**. Only then were the survivor verdicts worth reading.

## 4 · The rule this earns

**A probe's positive control must live in the same function as the mutant it is clearing.** A control
elsewhere in the file proves the realm loaded, not that the battery reached the code — and the failure
is silent and flattering, because an unreached mutant and an unkillable one produce identical output.

This is the third instance of the same defect in one session, which is why it is worth a rule rather
than a note: a falsifier whose regex anchor matched nothing (reported PASS), a falsifier that replaced
1 of 6 occurrences of a surname and left every citation window intact (reported PASS), and this one.
The difference here is that the control **caught it**.

## 5 · Reproducing

```sh
node tools/mutate.mjs --file clock.js --limit 200 --json > /tmp/sweep.json   # ~60 min, 16 jobs
node tools/probe-clock-equivalence.mjs --sweep /tmp/sweep.json               # seconds
```

The probe enumerates mutants fresh rather than trusting a cached list, prints the control tally first,
and marks the run **BLIND** if any control comes back equivalent.

## 6 · Done when

- [x] All parse-family survivors probed with in-family positive controls; controls 14/14.
- [x] Each classified with the reason recorded (§2).
- [x] The instrument shipped as a tool, not left in a scratch script.
- [x] The parent's stale count corrected (14 → 8).
- [ ] *(parent)* `MUTATION-EQUIVALENCE` §6 item 6 ticked against this brief — deferred until **#1060**
      lands, since it is executing that brief's other two boxes and editing the file underneath it is
      the collision `guard-stale-brief.sh` now denies.

## Cross-references

- Parent: `MUTATION-EQUIVALENCE-2026-08-04-BRIEF.md` §6 (the open box), §3 (the battery lessons).
- `GENERATOR-FOLLOWUPS-III-2026-08-08-BRIEF.md` §1 — artifact claims decay; the stale "14" is one.
- `clock.js — wave 9` (`tests/dex-tests.js`) — the one parse-family mutant that was killable.
