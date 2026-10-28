<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — the cryptography floor now matches the venvs

**state:** DONE
**unit:** Measure `cryptography` in each capture-host venv, decide the floor, and close row `2026-10-18-the-cryptography-floor-is-met-by-neither-venv`.
**bird:** wren
**branch:** claude/cryptofloor-wrn
**worktree:** ../wt-cryptofloor-wrn
**doc-search:** `cryptography floor 50.0.1 venv requirements capture-host`
**stopping-point:** `capture-host/requirements.txt:6` reads `cryptography>=50.0.0`, and the row reads `fixed #PRNUM`.
**next-step:** None in the repo. The optional OpenSSL step below is an owner-deploy item.
**done-when:** `git show origin/main:capture-host/requirements.txt` declares `cryptography>=50.0.0`.

## Measurement

Wren measured read-only on 2026-10-27. There was no pip install, no deploy and no restart.

| interpreter | `cryptography` | linked OpenSSL |
|---|---|---|
| production venv on the capture box | 50.0.0 | 4.0.1 |
| primary checkout venv on rig | 50.0.0 | not read |

1. The floor `>=50.0.1` came from the dependency bot in #3250. The human floor was `>=42`, from #1638.
2. The 50.0.1 changelog entry names one change. Its wheels link OpenSSL 4.0.2.
3. The code imports `Cipher`, `algorithms`, `modes`, `AESGCM`, `ec`, `serialization`, `hashes` and `Prehashed`. All of these are older than 42.
4. All of these imports succeed on the box under 50.0.0.

So no code path needs 50.0.1. The floor was wrong, and the owner ruled at board #1189 to lower it to `>=50.0.0`.

## Owner-deploy item

Upgrade `cryptography` in the production venv to 50.0.1 or later if OpenSSL 4.0.2 fixes a defect that matters here. The box has no network, so Wren did not read the OpenSSL advisories.

## Open questions

- The bot raised a floor that `>=42` already allowed. It can raise the floor again on the next release. The `dependabot.yml` file sets no `versioning-strategy` for `/capture-host`.
