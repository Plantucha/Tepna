<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the residue ledger carries no home path

**state:** DONE
**unit:** Redact the 25 home paths in 20 rows of `briefs/RESIDUE.md`, let `residue-ids` accept that edit, and close row `2026-10-28-twenty-ledger-rows-carry-an-absolute-home-path`.
**bird:** wren
**branch:** claude/homeredact-wrn
**worktree:** ../wt-homeredact-wrn
**doc-search:** `residue ledger home path redaction secret-scan append-and-close`
**stopping-point:** The ledger holds 0 home paths, `isHomeRedaction` is in `tools/residue-ids.mjs`, and the row reads `fixed #4031`.
**next-step:** None. A later row closure no longer trips secret-scan on an old home path.
**done-when:** `git show origin/main:briefs/RESIDUE.md` matches the scanner's `home-path` regex 0 times.

## Measurement

| plant on this branch | result |
|---|---|
| the allowance removed | 20 of 20 redacted rows fire |
| one planted word in each redacted row | 20 of 20 fire, 2 of them with an escaped pipe |
| the branch as committed | 0 mutated |

Osprey measured the scrub at board #651 and found the gate blind on escaped pipes. A later fix closed that gap, and the second plant above shows the gate now sees both escaped-pipe rows.

## Open questions

None.
