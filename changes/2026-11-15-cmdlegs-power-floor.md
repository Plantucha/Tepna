---
bump: patch
type: changed
brief: none
---

Give `tools/suite-determinism.mjs` a second selector and a power floor. It can now repeat any command, not only one test group. A caller states the event rate it wants to see, and agreement over fewer legs than that rate needs reads UNDERPOWERED with the floor named. A `--cmd` caller also declares the units its command must report, because this tool cannot infer the population of a command it does not know.
