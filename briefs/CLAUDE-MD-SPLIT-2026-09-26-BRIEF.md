<!--
  CLAUDE-MD-SPLIT-2026-09-26-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — records the split and its ruling; updated as each of the three PRs lands · last-verified 2026-09-26) · **Created:** 2026-09-26 · **Supersedes:** CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF

# CLAUDE.md split — rules stay, narratives move to `docs/CLAUDE-MD-RATIONALE.md`

## 0 · The ruling

Owner, 2026-09-26, verbatim: **"optimize to reasonable minimum usage. move narratives somehere else"**.

This reverses the 2026-08-28 verdict of `CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF.md` (option (a),
convention-only, narratives kept for calibration). What changed between the two rulings is the size
of the file relative to what a session pays per turn:

| when | `CLAUDE.md` | share of the fixed per-turn floor |
|---|---|---|
| 2026-07-01 (`audits/EFFICIENCY-AUDIT-FINDINGS-2026-07-01.md`) | ~6.1k tokens | — |
| 2026-08-27 (redundancy audit) | ~20k tokens | measured 17.8 % extrapolated savings, declined |
| 2026-09-26, before this unit | 126,078 bytes ≈ 31k tokens | ~85 % of ~36k, after the connector/plugin cut |

The file is loaded whole into every session on every turn, so every byte here is multiplied by the
fleet's turn count. The connector and plugin detachment (unit F, same day) removed ~5k; nothing else
left on the floor is comparable to this file.

## 1 · The method — verbatim copy first, then compress

1. **Copy the section VERBATIM into `docs/CLAUDE-MD-RATIONALE.md`** under its original heading, in the
   original order. This step is lossless: a reviewer can diff the compression against the source, and
   the "measured 2026-xx-yy" incidents, PR numbers and "this sentence used to say" corrections survive
   in full.
2. **Rewrite the section in `CLAUDE.md` as rules.** Kept, always: every imperative rule, every command
   block, every table that a rule reads from (the roster, the `clock.js` 5-of-8 table, the
   agent-neutral-enforcement table), every `CLAIM` line (machine-checked by `claude-md-claims`), the brief
   lifecycle and the Clock Contract. Dropped from `CLAUDE.md`: the incident narratives, the measured
   numbers that justify rather than parameterise a rule, and the corrections of earlier wordings.
   Each compressed rule carries `(why → RATIONALE §x)` so the case that made it is one hop away.
3. **Nothing is added.** A compression that introduces a new rule or fact is an edit to `CLAUDE.md`,
   and those remain the owner's regardless of who asks; this unit only moves and shortens.
4. **Three PRs, one per third**, so each diff is reviewable and each lands through Kodiak's serial queue
   independently: (1) §👥 the shared-tree rules · (2) §📌 ∅ 🧾 📏 📜 📚 🎙️ 🧪 · (3) §🔏 🎫 📦 ✅ 🔒.
5. **Target: `CLAUDE.md` ≤ 35 KB** (~9k tokens). Gates on every PR: `claude-md-claims`, `docs-ledger`,
   `npm run typecheck && npm run lint`.

## 2 · Ledger — one row per PR

| PR | sections | `CLAUDE.md` before → after | rationale file |
|---|---|---|---|
| 1 | §👥 (0 · 1 · 2 · 2b · 2b-bis · 2c · 2d · 3 · 4 · 4b · 4c · 5 · 5b) | 126,078 → 99,612 bytes (−26.5 KB, ≈ −6.6k tokens) | 45,378 bytes |
| 2 | §📌 ∅ 🧾 📏 📜 📚 🎙️ 🧪 | 99,612 → 84,774 bytes | 76,909 bytes |
| 3 | §🔏 🎫 📦 ✅ 🔒 | 84,774 → 60,322 bytes | 126,326 bytes |

## 3 · What this does NOT change

- `docs/CLAUDE-MD-RATIONALE.md` is **not a rule source**. On a conflict `CLAUDE.md` wins and the
  rationale is stale. It grows only by moving text out of `CLAUDE.md`; nobody writes new lessons into
  it directly — new lessons still enter `CLAUDE.md` as a rule (owner's edit) or a memory file.
- The `CLAIM` markers, the §📌 lifecycle vocabulary and the Clock Contract text that tests read stay
  where the gates expect them.
- The 2026-08-28 pilot's finding that gate-enforced rules can be trimmed to a pointer stands; this
  unit is the wider pass that verdict declined, taken now on new evidence.
