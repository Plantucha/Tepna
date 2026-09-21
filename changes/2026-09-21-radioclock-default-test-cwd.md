---
bump: patch
type: fixed
brief: none
---

Run `test_the_config_path_DEFAULTS_when_no_argument_is_given` from an empty directory so its verdict no longer depends on whether the machine carries a gitignored operator `config.yaml` — it failed on a dev box with `radio_clock.enabled: false` while CI's fresh clone stayed green.
