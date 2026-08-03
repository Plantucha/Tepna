<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-03

# The clock.js mutation run costs ~16 hours, and the Python fix does not transfer

## The measurement

`tools/mutate.mjs` runs `node tests/run-tests.mjs --group=<tag>` once **per mutant**. For `clock.js`:

| | |
|---|---|
| one `--group=clock` run | **7 m 49 s** (measured 2026-08-03) |
| groups it selects | 41 (609 assertions) |
| clock.js mutants | 123 (exhaustive baseline, 86 killed = 70 %) |
| **implied full run** | **~16 h** |

`CLOCK-MUTATION-AUDIT-2026-08-02` already named the mechanism — *"clock.js is also the most expensive
module to test … expensive-to-test correlates with under-tested, which is backwards for a spine"* — and
recorded the exhaustive run as taking 40 min at 81 mutants. The cost has grown with the suite.

## Why the Python fixes do not apply

`capture.py`'s 36-day figure came from mutmut generating one 100 MB module and recompiling it per
mutant; that was fixed by letting the bytecode cache persist and reusing the scratch
(`MUTATION-AUDIT-FINDINGS-2026-08-02` § Sixth pass). **Neither applies here.** `mutate.mjs` patches the
file in place and re-runs the suite; there is no giant generated file, and Node's compile cost is not
the bottleneck. **The cost IS the test selection.**

## Why the in-process trick is unsound here — do not try it

The obvious analogue (load the suite once, swap `DexClock.parseTimestamp` per mutant, re-run only the
covering assertions) is **not sound for this module**, and would fail silently:

```
hrvdex-dsp.js:66     parseTimestamp = DexClock.parseTimestamp;
motiondex-dsp.js:27  var parseTimestamp = DexClock.parseTimestamp;
integrator-dsp.js:29 parseTimestamp = DexClock.parseTimestamp;
pulsedex-dsp.js:41   parseTimestamp = DexClock.parseTimestamp;
oxydex-dsp.js:208    parseTimestamp = DexClock.parseTimestamp;
```

Five adopters bind the function at **load time** — the delegation pattern `CLAUDE.md` §✅ describes and
`clock.js`'s own header documents. A post-load swap is invisible to all of them, so every mutant those
DSPs would have killed reports as **survived**. That is a false negative in a measurement tool: it would
claim "nothing tests this" about code that is thoroughly tested, which is worse than not measuring.

## The proposal: find the groups that can actually see a clock mutation

The `clock` tag selects 41 groups. The question nobody has asked is how many of them can **observe** a
mutation of `clock.js` at all — a group that never parses a timestamp cannot.

**Done when:**

1. For a sample of known-killed clock mutants, record WHICH group killed each (`mutate.mjs` already
   knows the failing group). The union over all 123 is the minimal sufficient selection.
2. If that union is materially smaller than 41, add a narrower tag (say `clock-core`) and have
   `mutate.mjs` prefer it for `clock.js`, keeping `--full` as the certainty escape hatch.
3. **Verify by re-running the exhaustive 123 under the narrow selection and requiring the SAME
   86 killed.** A faster measurement that changes the answer is not a faster measurement. This is the
   acceptance criterion; without it the change is unsafe.
4. Record the new per-mutant cost in `audits/MUTATION-AUDIT-FINDINGS-2026-08-02.md`.

**Explicitly NOT in scope:** in-process function swapping (unsound, see above), and lowering the
existing exhaustive baseline. The 70 % figure stands until re-measured.

## Why it is worth doing

`clock.js` is the Clock Contract — *"non-negotiable — every app + every future node must obey"* — and it
is the least-tested module in the suite at 70 %, with the §2.7 component-range guard and the §3 DMY/MDY
boundary among its documented-invariant survivors. A 16-hour measurement is one nobody will run, so the
gap will not close on its own. The cost is the reason, and the cost is fixable.
