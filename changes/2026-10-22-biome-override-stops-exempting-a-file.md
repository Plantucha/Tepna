---
bump: patch
type: removed
brief: none
---

Hold every file to one lint standard. `biome.json` no longer lowers `noUnusedVariables` for `synth-gen.js`, and this drops the two sites that exemption covered. The suite reds any override that lowers a rule the top level makes an error.
