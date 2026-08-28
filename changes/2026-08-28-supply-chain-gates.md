---
bump: patch
type: added
brief: none
---

Supply-chain gates for the Python capture host and the Actions themselves: a `dependabot.yml`, a
dependency-review job, and a secrets scan against a committed, **eyeballed** baseline.

## 🔴 Findings are advisory; blindness is fatal

A new finding prints and does not fail — the same flip discipline mypy is under. But a **missing or
unparseable baseline exits 2**, because that is not *"no secrets found"*, it is *"the scanner could not
run"*. The two produce the same silence and mean opposite things.

All three paths dry-run locally before pushing: a valid baseline → 0, a wrong-shaped JSON → refuse, a
corrupt file → refuse.

## The baseline was generated AND read, which is the point

First pass: **499 findings across 33 files**, dominated by base64 blobs inside the generated bundles and
hex hashes in the release manifest. **A baseline nobody can eyeball is a baseline nobody eyeballed**, so
the generated artifacts are excluded and the committed baseline is **49 findings across 17 files** — a
set a person can actually read.

**Every `Secret Keyword` hit was opened and read. All five are benign:**

| site | what it is |
|---|---|
| `RESMED-AS11-PROTOCOL-REFERENCE` brief | the word *"passwordless"* in protocol prose |
| `tepna-restart.sh` | a comment about an *interactive password* prompt |
| `test_webmon_alerts_contract.py` | a placeholder webhook — `T00000000/B00000000/XXXX…` |
| `test_webmon_api.py` | `"password": "hunter2"` in a rejection test |
| `webmon.py` | a comment stating it stores **no** secret |

The eight high-entropy hits in `as11_link.py` are the **RFC 5054 SRP group parameters** — published
constants. **Zero real secrets.**

## Cadence

Monthly, not weekly: §👥.5b measured a runner-pool saturation at 11 open PRs, and the WIP cap is 4
repo-wide. Weekly bumps across two ecosystems would spend that cap on version bumps and starve the work
units. Dev tooling is grouped into one PR rather than five.

⚠️ **The runtime tree has nothing to bump** — the bundles are 100 % local by construction, no CDN and no
fetch. The only surfaces that can carry a supply-chain change are the Python capture host and the
Actions, which is exactly what is configured.

**Flip condition, pre-stated:** the secrets job becomes blocking once the baseline is *audited*
end-to-end (every entry marked true/false positive). Today it records what was **found**, not what was
**judged**.
