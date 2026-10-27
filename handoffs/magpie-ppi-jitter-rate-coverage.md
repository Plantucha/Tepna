<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the PPI-jitter endpoint reports its own coverage (Magpie)

**Unit:** residue row `2026-10-19-the-ppi-jitter-endpoint-cannot-see-a-2x-harmonic`, claimed on the
board at #361. **Branch:** `claude/jitrate-mg` in `~/wt-jitrate-mg`.
**Doc-search query that found the prior work:** `ppi jitter versus ecg endpoint beat match rate cannot
see a doubled rate harmonic acceptance bar` → `memory/an-endpoint-that-only-scores-paired-beats-cannot-see-a-harmonic.md` ·
`tools/ppi-jitter-vs-ecg.mjs:16-34` · `briefs/PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md:24-43`.

## Where this stopped (2026-10-20 05:05Z)

DRAFT **#3740** at head `b93aadfd0`, with the row closed inside the PR. `npm run check` passed all 39
steps on that head. The brief gains a third acceptance clause in §4, and the endpoint prints the three
figures the two medians cannot carry.

## Carry these forward

🔴 **The row's own diagnosis was incomplete, and the probe is what corrected it.** The row said the
jitter scores only paired beats, which is true. The mechanism is worse: `ppiJitterMs` REFUSES a window
in which no two matched pairs are consecutive, and the corpus loop drops that epoch. A doubled
detector therefore leaves the population rather than scoring badly, so the match rate that was meant
to guard the jitter never records it either. Take the figure that guards another figure BEFORE the gate
that can remove the window.

🔴 **On the real corpus the drop tally reads 0 and 0 and 0 over 810 epochs.** The gate never fired on
nine Verity sleep nights, so the blindness is latent here rather than an active loss. The honest word
is tripwire, and saying so is what separates a bound from a repair.

🔴 **The worst single epoch reads 1.85 and sat inside both medians the whole run.** The per-night
figure is a median, so one near-doubled epoch moves neither headline number. The covered reference
rate runs 41.6 to 133.6 bpm with a median of 49.4, so a variant that only misbehaves outside that
range moves nothing in this endpoint.

⚠️ **One depth-1 fetch grafts the whole shared object store.** Every worktree shares one store, so
`npm run check` refuses at step 3 of 39 and the other 36 steps never run. `git fetch --unshallow
origin` in the primary checkout cures it and downloads nothing when the history is already there.
Heron owned the fetch on the board at #395.

⚠️ **`ste-lint` has no flag that lists every finding, and `--json` carries counts only.** To prove
added lines are clean on a long legacy doc, lint the committed copy and compare the two counts.

⚠️ **`residue-ids.mjs` prints `none mutated` for a legal state-cell edit, and it diffs committed
state.** Run it after the commit, never before.

## Next step

Unit 4, assigned on the board at #374: half (b) of
`2026-09-22-filename-stamp-still-wrong-for-other-consumers`. The JS consumers that group, sort or date
capture files by their filename stamp must read the first data row when they need the stream start. The
population was never enumerated, so it opens as a sweep. Cite #373 for half (a), which owes no code.
