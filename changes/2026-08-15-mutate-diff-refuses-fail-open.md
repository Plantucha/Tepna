---
bump: patch
type: fixed
brief: PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md
---

`capture-host/tools/mutate_diff.py` **refuses instead of reporting green when it cannot actually run
mutants**. The mutation gate was failing open: with mutmut unavailable every `run_one` returned
`{"error": …}`, the loop printed each one and continued, `blocking` ended up empty, and the run
printed *"every mutant on the changed functions was killed"* with `survivors: []` and **exit 0** — a
green verdict about zero mutants. Same family as a `-k` filter that matches nothing or a `pytest`
line without `--cov`: the check reported success about something it never examined.

**Two guards, because one does not cover it.** A **preflight** (`refusal_reason` — pure, pinned by
`--selftest` alongside `classify`) refuses when the venv or mutmut is absent. A **post-loop** guard
refuses when every invocation errored, which an import check structurally cannot see; on this repo's
own venv, importable-but-unusable is a real state rather than a hypothetical.

**Exit 2**, distinct from 1 (survivors found), and deliberately **not** suppressed by
`--report-only`. That flag's contract is "never exit non-zero" about *findings*; the tool being
unable to look is not a finding, and hiding it there would rebuild the false green being removed.

**Verified in both directions on a real changed function** (`alerts.validate_webhook_url`), rather
than asserted: with the venv absent the pre-change code printed the success line at exit 0 and the
new code refuses at exit 2; with mutmut importable it proceeds and mutates, emitting no refusal. A
guard that traded a false green for a false red would not be an improvement.

⚠️ **The obvious probe is wrong and nearly shipped.** `-m mutmut --help` exits 1 on this repo's venv
while mutmut 3.7.0 is installed and imports cleanly (a broken `safe_setproctitle` import; the console
script also exits 1, on a missing `source_paths`). A `--help` probe would refuse on a working
machine. The probe is `python -c "import mutmut"`, with the measurement recorded at the function.

No bundle, DSP or ledger is touched — `capture-host/` is out-of-suite, so no `manifestHash` moves.
