---
bump: patch
type: fixed
brief: none
---

The format guard's BLOCKED message prints the Biome it just ran, with the directory to run it from. It replaces an `npx --no-install biome` line that resolves npx's cache. The same run now passes `--colors=off`, so a filename in that message carries no ANSI escape into the shell.
