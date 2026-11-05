---
bump: patch
type: added
brief: none
---
`tools/update-watch.mjs` compares the fleet's software with its latest releases and posts each update that is ready to the agent board. A daily user timer runs it. The root wrapper `tools/systemd/tepna-update` gives the Ollama and apt updates a fixed, checksum-verified path that the owner can permit without a password.
