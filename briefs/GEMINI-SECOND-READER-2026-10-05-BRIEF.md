<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-10-05 · **Created:** 2026-10-05

# Gemini as the second mutation reader — a scored trial, and a prompt-shape finding

**Why.** Codex's free tier is exhausted until 2026-11-03 (owner ruling 2026-10-05; it died on Wren's
7th batch having read 110 survivors that day, 4 misses, all caught by verification). The owner chose to
try Gemini's free tier on **exactly the Codex form**, with a scored trial on known answers as the
acceptance.

**Model.** `models/gemini-3.8-flash`, version string `3.0` as the API reports it — pinned, not an
alias, because `gemini-flash-latest` cannot satisfy "state the version": the thing it names changes
under the scorecard. Recorded in every jsonl record. Free tier, ~1,500 req/day.

## The rule does NOT point at Gemini on the strength of the grouped prompt

| shape | score | Codex, same set |
|---|---|---|
| **grouped** (the Codex prompt verbatim) | **31 / 42** strict, 33 generous | **40 / 42** |
| **one id per line** (same mutations, re-labelled) | **38 / 41** | **40 / 42** |

Both tables are scored the same way: a claim counts only when **Gemini's own stated input, executed
against original and mutant, actually distinguishes them** — or, for an equivalence claim, when a
battery shows them identical. Nothing is scored from reading the answer.

**The grouped shortfall was almost entirely one structural choice, not model weakness.** The prompt
asks for ONE input per id; Gemini answered per GROUP, and a single input per group only distinguishes
the members whose value has enough decimals to survive a rounding change — digit-count 2 of 8,
round-mode 4 of 6. Given one id per line, **the same ids went 6/14 → 13/13.**

**What it is good at.** All five recorded equivalences, both shapes, verified identical by battery —
`span = 0.0` → None/1.0 over 6 sample shapes, `set_local_time_ack` default over 10 cases, and the
`diff` `or`→`and` over 8 input shapes. It volunteered exactly the five the ledger records and invented
none, each with a line-citing argument.

**Where it still misses, after the shape fix (3 of 41).**
* **`closest_fraction` 4→5 digits** — missed by BOTH shapes, and **the same mutant Codex missed.** Its
  per-line input `125.0001` gives `8e-07`, which rounds to `0.0` at five places as well as four; the
  mutant needs six decimals. A genuinely hard boundary, missed by both readers independently.
* **`_settings` F1/F2, twice, differently.** The mechanism and discriminator are right both times (an
  sid absent from `SETTING_NAME`), and the literal bytes are wrong both times: first `0xFE` at the
  moreFlag index, so it parses as sid `0x01` which IS in the table; then a reply with no `0xF0`
  header, which the parser rejects outright. **Byte-level literals are its weak point**, and that is a
  different failure mode from Codex's (boundary arithmetic).

**Where it beat Codex.** `summarize_fs` `<0` vs `<=0` — Codex's miss #1. Gemini's input
`[("/other/zero.bin", 0, False)]` distinguishes both `<= 0` and `< 1`, verified.

## Recommendation

Usable as a second reader **with the one-id-per-line prompt and the standing verification rule** —
38/41 is near Codex's class, and every error it made was caught by verifying claims before writing
tests, which is the rule that already governs this work. It is **not** `>= 40/42`, so by the
pre-stated acceptance the rule does not point at it yet; the owner decides whether near-class with a
known weak spot is enough. Wren stays on self-derived inputs until the owner has seen this.

## ⚠️ The trial's own controls — three prep catches that would each have scored the reader wrong

1. **The prompt's numbers are mutmut MUTANT INDICES, not line numbers.** They run to 180 while the
   file positions are 111–125. "Citing line numbers" is what the ANSWER must do. Read as file lines,
   every citation would have been checked against the wrong place.
2. **The export ref is the squash `9d999d4e`, not its parent.** #3298 introduced that code, so the
   `diff` or-line and `int(size) < 0` exist only at the squash. An export of the parent would have
   shown the reader source the mutations do not apply to — unanswerable, and scored as the model's
   failure.
3. **The ledger holds SIX entries across those modules, not five.** The extra is a
   `getattr(cl, "services", [])` entry absent from this prompt, from another batch. Scoring against
   six would have made the equivalence denominator wrong before the first request.

## ⚠️ And three defects in MY OWN instruments, all biasing the same way

Recorded because the scorecard's credibility rests on them, and because a harness whose errors all
push one direction is worse than no harness.

1. **I compared TRUNCATED reprs** — `repr(...)[:70]` before the comparison instead of after — so any
   difference past 70 characters read as "identical", which is exactly what an equivalence claim wants
   to hear. It hid that three mutants DO differ and made every equivalence check through that path
   untrustworthy. Redone with full-value comparison.
2. **I read `closest_fraction` at the wrong nesting level** (top of the verdict object instead of
   `["result"]`), which nearly scored a correct claim as wrong in the other direction.
3. **My `maxOutputTokens` starved the answer.** THINKING TOKENS COUNT AGAINST THE OUTPUT BUDGET: the
   first per-line run spent 15,739 thought tokens and emitted 654 visible ones inside a 16,384 cap,
   truncating mid-sentence with `finishReason: MAX_TOKENS`. A short answer reads like a weak model and
   was a starved one. **Always read `finishReason` before scoring.** Raised to 65,536; the same prompt
   then returned 13,229 bytes and `STOP`.

**And the blind canary.** A minimal "Reply READY" request succeeded on one model at 22:07:40Z and the
real 29k-token request 503'd one second later — so my first availability probe declared success and ran
a trial that failed. **A minimal request is a blind canary for a real one**; the trial is its own probe.
Re-armed that way, it succeeded two minutes later.

## The one place this cannot copy Codex literally

**Gemini has no cwd.** Codex ran `codex exec --sandbox read-only -C <export>` and READ THE FILES
ITSELF; an HTTP reader cannot, so the source must be SENT. Same information, different delivery — but
it moves where the corpus boundary is enforced, from a sandbox to `tools/gemini-review.mjs` refusing to
read a byte from anywhere except a `tools/codex-export.mjs` output, verified by the export's marker and
by the ABSENCE of the data trees. Pointing `--src` at the live checkout is refused with
*"carries uploads/ — that is a checkout, not an export"*.

**Key contract.** `GEMINI_API_KEY` from the environment or `~/.config/tepna/gemini.env` at mode 0600;
named refusals for absent, group- OR world-readable, missing line, and empty value. The value is never
logged and is scrubbed from every error text including stack traces, because an exception that
interpolates a request URL is the leak. The key file was verified with `stat -c '%a'` and never `cat`.

## Next

**One id per line, no grouping** is the shape to use. The remaining gap is byte-level literals, which
suggests giving the reader a worked example of the wire format when a prompt involves raw bytes. The
`closest_fraction` boundary is a standing hard case for both readers and should be drained by hand.

**Evidence.** `tools/gemini-review.mjs`; prompts `cx_g6.txt` (Wren's, verbatim) and the per-line
expansion; jsonl transcripts with model and version per record; truth from #3298's squash `9d999d4e`
(37 killed + 5 equivalent, kill tests in `tests/test_probe_{oxyii_0x03,pmd_surface,polar_onboard,verity_survey,opcode_sweeps}.py`).

`Fleet-Session: Osprey`
