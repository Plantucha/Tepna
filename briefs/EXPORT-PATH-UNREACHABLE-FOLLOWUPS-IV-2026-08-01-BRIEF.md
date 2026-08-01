<!--
  EXPORT-PATH-UNREACHABLE-FOLLOWUPS-IV-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `EXPORT-PATH-UNREACHABLE-FOLLOWUPS-III-2026-08-01-BRIEF.md` · **Affects:** `ppgdex-app.js`, `tests/dex-tests.js`

# PpgDex exported an O2Ring finger night as a wrist-worn Polar Verity.

The last unfixed defect from the end-to-end Chrome run that opened this brief family. Driving the real
O2Ring finger pleth through PpgDex's UI produced an export whose own provenance contradicted its own
source field:

```json
"recording": {
  "source": "Wellue_O2Ring-S_S8AW2100_20260726214133_PPG.txt",
  "device": "Polar Sense",
  "channel": 0
}
```

`ppgdex-app.js` hardcoded that string. Every PpgDex export ever taken from the app names a Polar
Verity Sense, whatever the instrument actually was — and the DSP had already worked out the truth: it
sets `site: 'finger'` for a single-channel pleth precisely because *"a 1-column pleth IS an O2Ring
ring"*.

**A provenance field that names the WRONG instrument is worse than an absent one.** An absent field
prompts a question; a confident wrong one ends the enquiry. It also mislabels the body site, and the
morphology tiers this node grades are site-dependent — wrist literature does not license a finger
reading.

## 1 · Two builders, one export — again

The same shape as every other defect in this family. `ppgdex-dsp.js`'s `buildNodeExport` gained
`site` + `siteSource` in **#626** ("say whether the optical site was observed or assumed"). The app's
own `recording` block never got them, and nothing noticed, because **nothing executes the app's
builder**: the equivalence legs run `PpgDex.compute`, which is the DSP's.

Fixed by making the app's block say what the DSP's says:

| field | before | after |
|---|---|---|
| `device` | `'Polar Sense'` — hardcoded | follows `r.site`, the optical layout the DSP read |
| `site` | *(absent)* | `r.site \|\| 'wrist'` |
| `siteSource` | *(absent)* | `r.siteSource \|\| 'device-default'` |

`siteSource` is the honesty carrier and is why no new inference is invented here: `'device-default'`
means *inferred from the layout, not observed*; `'declared'` means the wearer said so. Emitting a
device name without it would restate an inference as a fact.

**Verified on both real instruments, through the UI:**

| input file | `device` | `site` | `siteSource` |
|---|---|---|---|
| `Wellue_O2Ring-S_…_PPG.txt` | `O2Ring-class single-channel finger pleth` | `finger` | `device-default` |
| `Polar_VeritySense_…_PPG.txt` | `Polar Verity Sense (3-LED)` | `wrist` | `device-default` |

## 2 · Gated by source scan, because nothing else can see this builder

There is no dynamic leg that runs `ppgdex-app.js`'s export path, so the only lane that can observe it
is the source scan — the same reasoning that makes `verifiedUnder`'s forbidden-writer rule a source
scan. Four assertions: no hardcoded device string, the device derives from `r.site`, the app emits the
site pair, and a **control** that the DSP sibling still emits the same pair (so the gate fails if the
thing being matched moves).

> **Negative-controlled, twice, and one was an accident worth keeping.** The scan first went RED
> against the *fixed* source — because the explanatory comment quoted the offending literal. That is
> the gate proving it can see the string at all; the comment was reworded. Then the `site`/`siteSource`
> pair was deliberately deleted and the suite re-run: exactly that assertion reds. Restored, green.

## 3 · Not taken

- **`recording.device` has no machine consumer.** Searched `integrator-dsp.js`, `overdex-app.js` and
  `data-unifier-app.js` — nothing reads it, so this is a human-facing provenance string and the fix
  moves no fusion arithmetic. Recorded so the next reader does not assume it is load-bearing.
- **Back-filling `site`/`siteSource` into exports already taken** — impossible and not attempted; an
  old export simply carries the old claim.

## 4 · Done when

- [x] No hardcoded device string survives in the app's export builder.
- [x] The device follows the same evidence as the site, with `siteSource` stating how strong it is.
- [x] The app's `recording` block matches its DSP sibling on the site pair.
- [x] Verified through the UI on a real finger recording **and** a real wrist recording.
- [x] Source-scan gate added and negative-controlled · 4804/4804 zero skips on the real corpus ·
      browser suite green · all three drift guards current.
