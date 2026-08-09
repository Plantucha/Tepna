---
bump: patch
type: fixed
brief: none — found while reporting gate coverage on two other PRs
---

`biome ci` refuses any file above `files.maxSize`, reports the refusal as a WARNING, and exits 0.
The default cap is 1 MiB; `tests/dex-tests.js` reached 2.28 MiB. So the repo's sole lint+format gate
had been green on its largest file without opening it — `Checked 0 files in 2ms.` with exit 0 — and
because CI is `biome ci --changed` and that file is touched by nearly every PR, the blind spot was
being hit constantly.

`files.maxSize` is now explicit at 4 MiB and the file is formatted. Measured before deciding: the file
had ZERO error-level lint violations (94 non-blocking warnings), so the only blocker was a 7050-line
reformat, and only 2 open PRs touch the file.

The cap alone just moves the cliff, so a `tooling · biome · coverage` group compares every includable
file against the CONFIGURED cap and reds the day one crosses it. It carries a leg proving the
comparison fires — at the 1 MiB default this repo still has an over-size file — so it cannot pass
merely because the cap is generous. Shown red before green: it named `tests/dex-tests.js 2.28 MiB >
cap 1.00 MiB`.

The reformat is behaviour-neutral, verified against a baseline taken first: 6209 assertions / 416
groups before, 6215 / 417 after — exactly the +6/+1 the new gate adds.

Making biome read the file also made CodeQL re-attribute 9 pre-existing `js/bad-tag-filter` /
`js/incomplete-multi-character-sanitization` alerts as "new in this PR", because the reformat moved
their lines. All 9 are already open on main. One of them is real and mine: the `render()` added in
#1088 stripped `<\/script>` without `\s*`, so `</script >` left the script BODY in what that gate
calls rendered text — a false positive out of the honesty gate. Matched to the sibling stripper in the
same file, which already uses that form and documents the rule as accepted for trusted local markup.
