# Magpie — unit `drawnppm`

**Row:** `2026-09-29-thirty-five-of-ninety-folded-ring-nights-publish-an-impossible-ppm` (OPEN at origin/main)
**PR:** #3914 (DRAFT) · **Branch:** `claude/drawnppm-mg` @ `11234a8f6` · **Worktree:** `wt-drawnppm-mg` (sibling of the primary checkout) · **Base:** `f0fe42f87`
**Rule 0:** `PpgDex drawn axis deviceDrawn spelling consumer refusal` → `briefs/RESIDUE.md:112`
(`2026-09-05-drawn-remedy-is-relabel-not-refuse`), `briefs/KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md:497-509`,
`tests/dex-tests.js` chunk 547.

## What the row said and what the corpus says

The row holds, and it names its population and its mechanism wrongly.

| rail | exports | drawn | publish a ppm | impossible | worst |
|---|---|---|---|---|---|
| `PpgDexFinger_*` (ring) | 74 | 74 | 38 | 35 | −8119.72 |
| `PpgDex_*` (Verity) | 99 | 0 | 54 | 0 | −44.51 |

- Not "35 of 90 folded ring nights". It is the finger rail, whole and alone.
- Not "one rate quoted across an offset STEP". The ring synthesises its device column on the host.
- Not a 61 GB re-fold. The remedy is a key.

## The defect

`clock.js` publishes `deviceDrawn`; `ppgdex-dsp.js` published `drawn` and nothing else.
`tools/pat-drift-attribution.mjs:310` reads `PPGDSP.parsePPG(pTxt).hostAxis`, and `:359` hands it to
`ppmContribution`, whose drawn refusal tests a key PpgDex never wrote. The `independent` backstop
cannot catch it either, because all 74 finger exports read `independent: true`. So the axis reaches the
last line and returns `ppm: 0` — "drift fully absorbed" about a counter with no oscillator. §∅.

## The fix, and the trap inside it

`ppgdex-dsp.js` now publishes `deviceDrawn` / `drawnShare` / `drawnReason` in both parse arms, and on the
export only when drawn (ECGDex's discipline, so a clean Verity export keeps its bytes).

🔴 **THE ALIAS IS `axisSynthetic`, NOT `hostAx.deviceDrawn`, AND THE CORPUS DECIDES THAT.** Forwarding the
spine's own verdict is the obvious fix and it fixes nothing: 63 of the 74 finger exports carry
`quantizedShare < 0.67`, and all 35 impossible ones sit in that 63 near 0.0001. Segment re-anchoring
unconcentrates the deltas, so the statistic goes blind exactly where the provenance rule still sees.
`axisSynthetic = axisDrawn || site === 'finger'` is the union that answers a consumer's real question.

**Measured outcome:** 38 of 173 exports move from `ppm: 0` to a named refusal, every one on the ring rail.

## Gates

1. Producer behaviour through the real parser (slew = layout rule, rounded = share rule, wrist = control).
2. The export path, which no committed fixture reaches: `PpgDex.html` inlines no `clock.js`, so
   `hostAx.ok` is false in the shipped realm and the finger fixture has no `hostAxis` at all. The block is
   live only where the analysis tools co-load the spine — which is where the 659 trio exports came from.
3. 🔴 **A PRODUCER RATCHET, NEW.** The existing ratchet watches CONSUMERS gating on `.independent` and
   could never see this: the file HAD no gate to audit. The new leg takes every source that builds a spine
   axis and republishes its own `ppm` (6 files) and requires `deviceDrawn` beside it, or a pin naming the
   discriminator used instead (`tools/device-stability.mjs` on `DRAWN_MODAL_SHARE`).

⚠️ **The ratchet's first classifier matched the bare identifier and PASSED the pre-fix file**, because the
export block still READ the key. Publication is an object key or an assignment; a read is not one.
Eight discrimination cases pin that. Planting the full pre-fix state reds it and names `ppgdex-dsp.js`.

⚠️ **The export-path control first asserted nothing.** The group's `ha` is built from `devMs: m * 100` — a
perfectly uniform device column, so the spine reads it `deviceDrawn:true`. The clean case needs its OWN
jittered axis; an ANTI-VACUITY assertion now pins `false` on it.

## Provenance and the gate

`manifestHash` 481f3deaf8f9 → b2e94d5304c7 · `computeHash` 1a761ec4074e → 214c6a1a4958. Both moved, so
this owes re-verification and is not export-inert. `build-docs.mjs` rebuilt the served copy;
`build-analysis.mjs` rebuilt 11 of 14 tools — that is where the trio folds run, so the export change
reaches the fold path. Five fixtures regenerated; all five moved only the four hash fields.

**38 of 40 gate steps PASS.** Suite 14,197 passing / 826 groups, 3 failing. The 2 red steps are
`test:par` and `verify:fixture-currency`, and both red on the SAME single fixture,
`uploads/PpgDex_2026-06-27_equiv.node-export.json`, which still names the pre-change bundle.

**UPDATE 2026-10-25 15:50Z — THE CORPUS IS BACK AND EVERY FIXTURE INPUT HASHES CLEAN.**
`/srv/data/tepna-corpus` resolves again. All 393 `uploads/` symlinks resolve (389 files, 4
directories). I hashed every input named by an `inputHashes` record across all `provenance/*.json`
fragments with the gates' own sha16: **51 records, 48 distinct files, 51 MATCH, 0 DIFFER, 0 ABSENT.**
This fixture's input, `Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt`, reads `289ef2aac9fd3d66` on
disk against `289ef2aac9fd3d66` committed, 5,285,126 bytes. Board #1206.

⚠️ **I AM STILL GATED, AND NOT BY THE CORPUS.** Kestrel's relayed owner ruling (board #1205, item 2)
says to wait for Finch's copy verdict before running `regen-ppgdex-goldens.mjs`, and Finch has posted
none. I asked on #1206 whether the hash above discharges that wait. Run nothing until he answers.

The paragraph below records what the outage looked like while it lasted.

🔴 **THE NAS CORPUS IS UNREADABLE, AND IT BLOCKS EVERY PpgDex / ECGDex / OxyDex BUNDLE PR.** All 393
symlinks in `uploads/` resolve through `/srv/data/tepna-corpus`, now a symlink to `/mnt/nas/tepna-corpus`.
All three NFS directories under that mount stat as `d?????????` Permission denied, unsandboxed too; the
server pings and `showmount -e` returns an EMPTY export list. Heron measured the box side independently
and found the same (board #1148). Osprey's #3891 regenerated this very fixture on 2026-10-22, so access
worked then and broke after.

**I did not hand-edit the stamp.** CLAUDE.md forbids it, and typing a hash claims a reproduction that
never ran. The one command that finishes this unit, once the export returns:

    node tools/regen-ppgdex-goldens.mjs && node tools/verify-fixtures.mjs

## Next step

The row's closure does not ride this PR. A RESIDUE-only PR owes: this row closed against the merge, plus a
new row for the corrected population and for the 659 already-folded exports that no checkout here can
re-fold (61 GB corpus, unmounted). Tell Kestrel on the board before opening it.

---

## FINISHED 2026-10-25 18:55Z — head `490613812`, all 40 steps pass, PR #3914 still DRAFT

Finch posted the copy verdict on thread 8, which cleared ruling #1205 item 2. My own consumer-side
read agreed with it: 51 of 51 `inputHashes` records MATCH over 48 distinct files and 18.3 MB. A
truncated file cannot match its recorded hash, so that verdict needs no server access.

Then, in order, in `wt-drawnppm-mg`:

1. `node tools/rebase-safe.mjs` — EXIT=0, head `b46f9538d`, 0 behind, no artifact moved.
2. `DEX_UPLOADS=… node tools/regen-ppgdex-goldens.mjs` — EXIT=0, 1 fixture moved, 11 fields.
3. The **control**: the same regen at `origin/main` in a throwaway worktree moves **7** fields and
   no hash field. So main owns contentId, `spreadMs` → null and `spreadReason` on hr and rmssd, and
   the two evidence inputHashes; this PR owns only manifestHash and computeHash on hr and rmssd.
4. `node tools/verify-fixtures.mjs` — EXIT=0, 1 stamped, 18 already current, `verifiedUnder`
   214c6a1a4958 written by the tool after a green suite.
5. `npm run check` — `✓ check — all 40 steps passed`, suite 14,245 assertions over 826 groups.

🔴 **RUN THE CONTROL BEFORE ATTRIBUTING A REGEN.** Eleven fields moved and only four were mine. A
regen re-records whatever the ref already owed, so a PR that quotes its own diff as its own work
takes credit for someone else's correction and hides the ref's debt. One throwaway worktree at
`origin/main` and one regen run separate the two, and it costs about two minutes.

⚠️ **A STALE `commitmsg.txt` IN THE SCRATCHPAD COMMITTED THE WRONG STORY.** The file left over from an
earlier unit described `tools/realm-manifest.js` work that this diff does not contain, and
`git commit -F` accepted it without complaint. Caught by reading `git log -1` after the commit, and
amended. Name a message file after its unit, and read the subject back before pushing.

Reported as board #1227.

## Still owed, and it is NOT in this PR

The RESIDUE-only PR Kestrel sequences carries four rows: close
`2026-09-29-thirty-five-of-ninety-folded-ring-nights-publish-an-impossible-ppm`, a new row for the
corrected finger-rail population, a row for the 659 already-folded exports, and
`2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible`, which this PR's `spreadMs` correction
discharges. I hold one PR, so it starts when #3914 clears.
