---
bump: patch
type: fixed
nodes: [OxyDex]
brief: REFERENCE-GUIDE-AUDIT-BRIEF.md
---

REFERENCE-GUIDE-AUDIT dimensions 2 and 3, for OxyDex — two sweeps, four ladder defects and two formula
defects, plus one instrument error found in my own sweep. Dimension 3 below; dimension 2 at the end.

Four OxyDex metrics were graded good/warn/bad against cut-points nobody published, and graded
DIFFERENTLY on two screens — so the same night was called two things depending where you looked. All
four are now ungraded, in both sites.

    odi3.rate   smart summary <5 / <15   (ODI-4's band, verbatim)   night detail <15 / <30 (shifted a notch)
    hrSdnn                    >=3 / >=2                                          >=4 / >=2.5
    hrFloor                   <=52 / <=60                                        <=55 / <=65
    hrSlope                   <=0 / <1                                           <0 / <1.5

`tools/severity-ladder-audit.mjs`: 5 conflicting -> 1, and the survivor is the audit's own documented
false positive (`hrvdex - v`, a shared local name colliding across unrelated metrics).

THE BRIEF CALLED THIS AN OWNER CUT-POINT DECISION SINCE 2026-08-03. It is not one, and the way it stops
being one is the finding. `REFERENCE-GUIDE-AUDIT` offered two honest routes — (a) cite a published ODI-3
severity band, or (b) refuse to grade — and said picking between them was the owner's call. Searching the
literature removes the premise instead of answering it: **(a) does not exist.** There is no consensus
ODI-3 severity ladder. What is published are POPULATION-SPECIFIC DIAGNOSTIC CUT-OFFS against AHI, which
scatter by cohort — ODI-3 >= 4.3 /hr for AHI >= 5 (ring oximeter n=164; and >= 4.3 in snoring children
n=112), >= 13.1 for AHI >= 15, > 12 for AHI >= 5 at 100 % specificity but >= 26 for AHI >= 15 (n=1141+1141),
>= 10 in infants. A diagnostic threshold answers "is disease present against this reference", not "how
severe" — a different question, and the numbers do not form a ladder. This disposal is stronger than a
decision would have been: a decision needs re-deciding the moment someone finds a paper.

AND THE BORROW WAS NOT A CONSERVATIVE APPROXIMATION. ODI-3 vs AHI-flow concordance is only FAIR
(kappa 0.32, n=296) with ODI-3 systematically classifying MORE severe, so the site that imported ODI-4's
bands unchanged was biased toward over-calling — in the direction that matters clinically.

THE THREE HR PROXIES REST ON A DIFFERENT AND STRONGER ARGUMENT, kept distinct on a peer's correction:
they are OxyDex-derived 1 Hz statistics with no external literature, so "no published band" is trivially
true and proves little. What condemns them is the INTERNAL contradiction, and the precedent is inside the
same function: `RMSSD` and `Noc. Dip` were ALREADY `neutral` there, commented "1Hz proxy, not true ms",
and `nightDetail` labels the whole section "(relative comparison only)". A relative measure carrying a
good/warn/bad ladder contradicts its own printed label; these three were simply the members that had not
been updated when the block decided.

`odi3` KEEPS `evidence: 'validated'`, deliberately. The tier is for the MEASUREMENT — AASM defines a 3 %
desaturation index and counting it is validated — not for a severity band, which is what has just been
shown not to exist. A metric's evidence tier does not transfer to a ladder applied to it. The findings
name the wrong reconciliation explicitly so a later reader does not restore a ladder because the badge
looks confident; that is the `desatProfile` shape (a tier stranded on something the code declines to
adjudicate). If a band is ever published: cite it and grade BOTH sites at once, never one.

The guide states the same thing at its ODI-selection note, so the surface and the code agree rather than
merely failing to contradict.

Provenance: `oxydex-render.js` is inlined in OxyDex, so this is a real code change, not a doc pass —
manifestHash 892d19621f4b -> a985a5b99362, 3 fixtures re-stamped by the builder. NOT export-inert and not
claimed to be; the equiv legs pass, and OxyDex carries no corpus-backed fixture that this moves.
(Separately noted, NOT discharged here: `PpgDex_2026-06-27_equiv` is UNVERIFIED on clean origin/main —
proved pre-existing with a detached probe worktree, handed to PpgDex's owner rather than silently
re-stamped by a PR that did not earn the claim.)


## Dimension 2 — two formulas the guide printed and the code does not compute

Swept mechanically: every formula block in `OxyDex Reference.html`, its distinctive numeric constants
checked against the whole OxyDex source. **113 formulas, 23 with a distinctive constant, 3 flagged,
2 real.**

`LTHR` — a different FORMULA, not a different constant. The guide printed `HR_rest + HRR × 0.87`, an
HRR/Karvonen fraction, uncited. The code computes `Math.round(hrMax * 0.88)` (`oxydex-dsp.js:6192`), a
fraction of HRmax, cited Seiler 2010. They diverge as a function of the user's resting HR — 164.4 vs
158.4 bpm at HRmax 180 / HRrest 60, ~6 bpm — so no correction to the constant could reconcile them. The
guide now states what the code computes, with the code's citation; the old text is struck, not deleted.

`MAF` — right and INCOMPLETE, which is worse than wrong. Guide: `180 − age`. Code: `180 − age` then
`+5` when readiness ≥ 85, `−10` when readiness < 55 (`oxydex-dsp.js:6180–6188`). A reader computing the
printed formula by hand gets a number the app never shows, up to 10 bpm apart, with nothing on the card
saying an adjustment exists. Now documented inline.

⚠ THE SWEEP'S FIRST RUN SAID 6, AND 3 WERE MY OWN DENOMINATOR ERROR — the corpus was `oxydex-dsp.js` +
`oxydex-render.js` while OxyDex is EIGHT files; Karvonen lives in `oxydex-profile.js` and read as absent
purely because nothing had opened it. Fixing the corpus took 6 → 3. Recorded because it is the same
failure this audit hunts, committed by the instrument built to hunt it.

NOT a finding, recorded so it is not re-investigated: `SpO₂ FFT`'s `0.003` has no matching constant
because the code carries NO fixed probe grid — OXYDEX-FFT-CYCLE-NULL-2026-08-16 replaced the hand-picked
probes with the record's own Fourier bins plus a Mann & Lees (1996) red-noise test. The card describes a
search envelope, not a literal. Inventing a constant to satisfy a sweep would be the defect this audit
exists to catch.


## The sweep shipped as a tool — and the defect it found by refusing to be helpful

`tools/formula-constant-audit.mjs`, dimension 2's sibling to `severity-ladder-audit.mjs`. Fleet: **381
formulas · 67 constant-bearing · 6 flagged**, every one explained (ECGDex's three print exact period
reciprocals of the Hz bands the code uses; OxyDex's FFT has no fixed probe grid; two are citation cards
quoting a paper's cohort and Beer-Lambert wavelengths — described, never implemented).

FIVE UNTERMINATED CHARACTER REFERENCES were live in `OxyDex Reference.html`. `SEE &#xB110.8` is missing
its `;`, so a browser consumes hex greedily: `&#xB110` is U+B110 and renders **널** — a Hangul syllable
where **±** was intended. Also `&#xB11.5`, `&#xB12%`, `&#xB15 events/hr`, and `&#x201CFair&#x201D;`
(an invalid code point where a curly quote belongs). All five fixed.

⚠ AN AD-HOC PYTHON VERSION OF THE SAME SWEEP FOUND NONE OF THEM. It decoded entities with a forgiving
parser, silently repaired `&#xB110.8` into `±10.8`, and reported the card clean. **A parser that fixes
its input cannot report a broken input** — kindness in an instrument is indistinguishable from blindness.
The same script also trimmed trailing zeros from INTEGERS, so `660` became `66` and matched anything,
hiding `Jubran`'s 660/940 nm wavelengths outright. Two silent false negatives, both from being generous;
the shipped tool is strict on both counts and its header says why.

Two further design points, each from a failure rather than a principle: it DROPS `<s>`/`<del>` content
before checking (a guide that corrects itself keeps the withdrawn formula struck, and checking a
retracted claim would flag every honest correction forever — making deletion of the evidence the cheapest
way to go green), and its self-test COUNTS its legs rather than printing a literal, after a hardcoded
`8/8` survived a ninth leg being added.
