<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: none
---
The shared-tree guard's checkout rule keyed on a FILE EXTENSION, so `git checkout <ref> -- briefs/X.md`
denied while `git checkout <ref> -- briefs` — which restores every file in the directory, including other
sessions' in-flight work — was allowed. The narrow operation was blocked and the wide one waved through.
Directory tokens after `--` are now collected and treated as source unconditionally; `provenance` is
deliberately not exempt, since restoring it wholesale discards `verifiedUnder` stamps only a corpus run
can re-earn. Seven deny cases added, all verified allowed on main before the fix.
