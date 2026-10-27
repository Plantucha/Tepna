# Heron handoff — unit 22, the cryptography floor

**Row:** `2026-10-18-the-cryptography-floor-is-met-by-neither-venv`, OPEN at `origin/main`.
Board claim #1182, board finding #1183. Measurement only.

## 1 · Unit

I measured why `capture-host/requirements.txt` line 6 demands `cryptography>=50.0.1`, and what the
floor buys the AS11 cipher path.

## 2 · Branch and worktree

None. #3918 holds my one open PR, so this unit opened none and touched no file in the repo.
I read every source at `origin/main` through `git show`.

## 3 · Exact stopping point

Board #1183 carries the finding. The measurement is complete. Four facts stand.

- The floor came from a dependency bot. `#3250` titled it `build(deps)`, and its body says
  it permits the latest version. The human floor was `>=42`, written by `#1638`.
- The 50.0.0 to 50.0.1 step is a wheel rebuild. Its changelog entry names only OpenSSL 4.0.2.
- `as11_cipher.py:21` imports `Cipher`, `algorithms` and `modes`. Both call sites build
  `Cipher(algorithms.AES(key), modes.CBC(iv))`. The path never touches `pkcs7`.
- `devfloors.py` is the tree's only floor comparator, and `REQ` binds it to `requirements-dev.txt`.

## 4 · Next step

The remedy is the owner's call, and the finding states both options. I recommend lowering line 6 to
`>=50.0.0` with the OpenSSL caveat in its comment. Raising the box is a deploy instead.

A separate leg deserves its own row: point `devfloors.py` at the runtime file too. The cost is a
second read plus a `worst()` fold, because `declared_floors(text)` and `survey(text, lookup)`
already take text. One design decision remains, named in part 5.

## 5 · Open questions

- Owner: lower the floor, or raise both venvs. I hold no slot for either edit.
- Owner: does OpenSSL 4.0.1 to 4.0.2 carry a CVE. This box has no network, so I did not guess.
- Design: `check.sh` prints one `advisory-state:` token. Two surveyed files need a folded token,
  or a second line.
- Kestrel: the runtime-floor leg needs a new row, and I hold no slot to log it.

## 6 · Blockers

The row cannot close on measurement. Its remedy changes either a tracked file or both venvs.
A venv change on vigil is a deploy, and deploys stay owner-authorized.

Nothing compares CI against the box. Three CI jobs run `pip install -r requirements.txt`, so CI
resolves 50.0.1 or above while both venvs carry 50.0.0. Every gate stays green across that gap.

## 7 · The doc-search query

`node tools/doc-search.mjs --read "why is the cryptography floor 50.0.1 in capture-host requirements"`
→ `briefs/RESIDUE.md:677` · `capture-host/devfloors.py:1` · `THIRD-PARTY.md:101` ·
`capture-host/tests/test_dev_requirements.py`.

## What a resumer should know

**A dependency bot's floor is not a judgement.** Read the commit that wrote the line before you
defend the number. Here the bot raised a human `>=42` to the newest release on sight.

**A floor comparator binds to one declaring file.** `devfloors.py` surveys the dev requirements, so
the runtime libraries had no instrument at all. Ask which file an existing gate reads.

**A gate that installs fresh cannot see the box.** CI resolves the floor every run, so the version
the daemon actually imports never enters any comparison.

**Name the version a venv HAS, not the one a file demands.** Both venvs carry 50.0.0 and link
OpenSSL 4.0.1. The wheels behind the floor link 4.0.2.
