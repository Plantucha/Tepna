<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
`trio-batch`'s CPAP clock fit ran in each `--only-node` child, so it read whichever sibling exports happened to exist — the same night printed three different answers. Plus `--cpap` now accepts the card root.

## The race

The fit consumes **all three** node-exports off disk. Under `node-split` (on whenever nights < job slots — i.e. every single-night run) each node computes in its own child, and the fit ran in every one of them. The first child has no siblings yet, so on 2026-07-30 the run printed:

```
▸ 2026-07-30 · OxyDex   ⏱ CPAP clock offset: unresolved — no channel could be estimated
▸ 2026-07-30 · ECGDex   ⏱ CPAP clock offset: -21.82 min … [19 apnea events]
▸ 2026-07-30 · PpgDex   ⏱ CPAP clock offset: -21.82 min … [19 apnea events]
```

Three answers, one night, same code and same data — which you get depends on child scheduling. The `unresolved` line is the dangerous one: it reads as *this night has no usable channel*, a claim about the data, when it is really *I ran too early*.

**The fix is the one the file already documents ten lines away.** The stamp block solves the identical problem — *"enforced here because no single child can see its siblings"* — by doing it in the parent once every node returns 0. The fit now does exactly that: `printClockFit()` is extracted, children with `--only-node` skip it, and the parent calls it after the last node lands. Non-split runs are unaffected (`ONLY_NODE` is null, the child still owns it), so there is no path that prints it twice.

The fuller input also changes the output: the racy ECGDex run saw 10 channels, the parent-side run sees 11 — `PpgDex/autonomic_surge` was simply not on disk yet. The fit itself is unchanged at **−21.82 min, NOT corroborated**.

**A TDZ trap came with it.** The parent calls this from a child-exit callback and then `process.exit()`s, so module evaluation never reaches the bottom of the file — a `const cpapApneaTimes = …` is still in its temporal dead zone. It threw *"Cannot access 'cpapApneaTimes' before initialization"* straight into the fit's own `try/catch` and surfaced as a generic `clock-fit failed`. Now a hoisted `function` declaration, with the reason written down.

## `--cpap` takes the card root or DATALOG

The lookup is `join(CPAP_DIR, '20260730')`, so pointing it at the mirror `cpap_harvest` actually writes (`SETTINGS/`, `STR.edf`, `DATALOG/`) silently produced **"no CPAP events for this night"** — indistinguishable from *the CPAP did not record*. If `<dir>/DATALOG` exists that is unambiguously what was meant, so it resolves. Verified against the real card root: 19 apnea events, previously 0.

**Not a bug, recorded so it is not re-reported:** `--src` already recurses (`readdirSync(…, {recursive:true})`). A night that spans midnight lands in *two* capture dirs (`captures/2026-07-30` + `captures/2026-07-31`), and pointing `--src` at one of them yields a truncated night — 1.9 h of three-way overlap instead of 6.5 h — with every node still reporting success. Point it at the parent.

**No test.** There is no harness for `trio-batch` — it is a tool, referenced in `dex-tests.js` only from comments — and building one at this size is scope I did not take. Both fixes are verified by hand against the real 2026-07-30 corpus; the invariants (`!ONLY_NODE` guard, hoisted declaration, card-root resolution) are stated in-code so a future reader has the reason, not just the shape.

Gates: suite **4442 passed** / 12 skipped · `build --check` clean (11 owned) — a tool moves no bundle · biome clean.
