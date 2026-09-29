---
bump: patch
type: fixed
brief: none
---

`tools/corpus-tier.mjs` resolved `../verdict.js` from `dirname(import.meta.url)`, which is this file's
directory when run as a file and the CWD when run from stdin — so the documented
`git show origin/main:tools/corpus-tier.mjs | node --input-type=module -` invocation died with
`Cannot find module '<cwd>/../verdict.js'` before doing anything. The checkout root is now found by
search — `TEPNA_ROOT`, else a walk up from this file's parent and from the CWD to the first directory
holding both `verdict.js` and `package.json` — and refuses naming everything it tried rather than
falling back to a path that might belong to a different checkout.
