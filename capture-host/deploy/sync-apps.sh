#!/usr/bin/env bash
# tepna-capture — deploy/sync-apps.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# COPY THE REPO'S BUNDLED APPS INTO THE DIRECTORY CADDY SERVES.
#
#   bash sync-apps.sh [--check]
#
# ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
# `/srv/tepna/app` is a COPY of the repo's `*.html` bundles, not a symlink and not a checkout. Nothing
# was refreshing it: `deploy-vigil.sh` creates the directory, `install-services.sh` only counts what is
# in it, and the bundles were copied there by hand once. It then rotted silently — on 2026-07-26 the
# served `PpgDex.html` was a full day behind the repo and ELEVEN bundles had never been copied at all.
#
# A stale bundle is the worst kind of wrong, because nothing about it looks wrong: the phone loads an
# app that opens, renders, and computes — with last week's DSP. Every provenance gate in this suite
# operates on the REPO copy, so GATE A can be green on a `manifestHash` that is not the code being
# served. This closes that: the served set is a byte-for-byte copy of the gated one, and `--check`
# says so or exits non-zero.
#
# ── WHY IT DOES NOT DELETE ─────────────────────────────────────────────────────────────────────────
# Files present in the served directory but absent from the repo are LEFT ALONE and merely reported. A
# deploy script that prunes a directory it does not fully own is one rename away from removing
# something an operator put there deliberately. Reporting is enough to notice; deleting is not the
# script's call.
set -uo pipefail

SRC="${TEPNA_SRC:-$(cd "$(dirname "$0")/../.." && pwd)}"
DEST="${TEPNA_APP_DIR:-/srv/tepna/app}"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

[ -d "$SRC" ] || { echo "  ✗ source not found: $SRC"; exit 1; }
if [ ! -d "$DEST" ]; then
  [ "$CHECK" = "1" ] && { echo "  ✗ $DEST does not exist"; exit 1; }
  mkdir -p "$DEST" || { echo "  ✗ cannot create $DEST"; exit 1; }
fi

shopt -s nullglob

# ── WHAT GETS SERVED (CAPTURE-HOST-DEEP-AUDIT §C7) ────────────────────────────────────────────────
# This selected on EXTENSION — `bundles=("$SRC"/*.html)` — not on "is a self-contained bundle". `$SRC`
# is the repo root, where `*.html` matches 65 files: the owned bundles, but also 11 `*.src.html`
# EDITING SOURCES, the gate pages and ~30 analysis harnesses. None of their `.js`/`.css`/`adapters/`
# siblings were ever copied, so 34 served pages had 100 % of their references missing:
#
#   CPAPDex.src.html      19/19 refs MISSING   e.g. cpapdex-app.js, ans-design.css
#   Data Unifier.src.html 27/27 refs MISSING   e.g. adapters/coospo-rr.js
#   Dex-Test-Suite.html   57/57 refs MISSING
#
# And `--check` compared `*.html` only, so it reported GREEN on exactly that state.
#
# The served set is now the OWNED bundle set — the provenance-gated apps (one `provenance/<App>.json`
# fragment each, so this cannot drift from the gate) plus the two orchestrators — together with an
# explicit whitelist of the pages index.html links to AND the assets they need. Anything else in the
# repo root is deliberately not served.
apps=()
for pf in "$SRC"/provenance/*.json; do
  a="$(basename "$pf" .json)"
  case "$a" in _*|index) continue;; esac
  apps+=("$a.html")
done
[ ${#apps[@]} -gt 0 ] || { echo "  ✗ no provenance/<App>.json fragments in $SRC — wrong source directory?"; exit 1; }

# Owned but NON-provenance (build.mjs ORCHESTRATORS), plus the doc pages index.html links to.
PAGES=("Data Unifier.html" "OverDex.html" "index.html" "Architecture.html" "How to Collect Data.html"
       "Science.html" "Why This Exists.html"
       "CPAPDex Reference.html" "ECGDex Reference.html" "GlucoDex Reference.html"
       "HRVDex Reference.html" "OxyDex Reference.html" "PpgDex Reference.html"
       "PulseDex Reference.html")
# Sibling files those pages actually reference. A page without its assets is not a served page — it is
# a blank screen that looks like a deployed one, which is the failure this section exists to stop.
ASSETS=("dex-badges.css" "manifest.json" "licensing/dex-license.css")
ASSET_DIRS=("assets" "how-to-collect" "papers")

# ANALYSIS TOOLS — the third generated tree, and the one with no provenance fragment.
#
# `apps` is DERIVED from provenance/*.json and PAGES is hand-typed, so a generated artifact that has
# neither is invisible to this script: never copied, and never reported, because `extra` counts files
# present in DEST that should not be there and says nothing about files that were never considered.
# Measured on the box 2026-08-09: ten `*-analysis.html` were serving code four days stale — pre-#1011
# `accFs`, pre-#996 ECGDex clock — while every app bundle was current and the summary read clean.
#
# So ASK THE BUILDER, the same rule `tools/rebase-safe.mjs` uses: the list comes from
# `tools/build-analysis.mjs`'s own TOOLS array, never from a glob and never from a second hand-typed
# copy here (a copy is what goes stale — it is this section's own bug, one level up).
# Parsed in shell on purpose: this runs on the capture host, which is not guaranteed to have node.
ANALYSIS_SRC="$SRC/tools/build-analysis.mjs"
analysis=()
if [ -f "$ANALYSIS_SRC" ]; then
  while IFS= read -r t; do [ -n "$t" ] && analysis+=("$t"); done < <(
    sed -n '/^const TOOLS = \[/,/^\];/p' "$ANALYSIS_SRC" | grep -oE "'[^']+\.html'" | tr -d "'"
  )
  # FAIL LOUDLY, NOT SILENTLY. An empty parse means the builder changed shape, and the failure mode of
  # carrying on is exactly what this block fixes: a deploy that looks complete and ships stale code.
  [ ${#analysis[@]} -gt 0 ] || { echo "  ✗ could not read TOOLS from $ANALYSIS_SRC — refusing a partial deploy"; exit 1; }
else
  echo "  ✗ $ANALYSIS_SRC not found — refusing a partial deploy"; exit 1
fi

bundles=()
for b in "${apps[@]}" "${PAGES[@]}" "${analysis[@]}"; do
  if [ -e "$SRC/$b" ]; then
    bundles+=("$SRC/$b")
  else
    echo "  · not in this checkout, skipped: $b"
  fi
done
[ ${#bundles[@]} -gt 0 ] || { echo "  ✗ nothing to serve from $SRC — wrong source directory?"; exit 1; }

changed=0 added=0 same=0 failed=0
# ASSET COUNTERS ARE SEPARATE FROM BUNDLE COUNTERS. They were shared, while the summary printed
# ${#bundles[@]} — bundles only — as the total, so refreshed assets pushed the parts past the whole:
# an observed run read "23 bundle(s): 16 already current, 13 refreshed", i.e. 29 of 23. The sync was
# correct; the line describing it was not, which is worse than a wrong sync because it is the line
# people read to decide whether the deploy worked.
aChanged=0 aAdded=0 aSame=0 aFailed=0
for f in "${bundles[@]}"; do
  b="$(basename "$f")"
  if [ -e "$DEST/$b" ]; then
    if cmp -s "$f" "$DEST/$b"; then
      same=$((same + 1))
      continue
    fi
    [ "$CHECK" = "1" ] && { echo "  ✗ STALE  $b"; changed=$((changed + 1)); continue; }
    if cp -p "$f" "$DEST/$b"; then changed=$((changed + 1))
    else echo "  ✗ failed to copy $b"; failed=$((failed + 1)); fi
  else
    [ "$CHECK" = "1" ] && { echo "  ✗ MISSING $b"; added=$((added + 1)); continue; }
    if cp -p "$f" "$DEST/$b"; then added=$((added + 1))
    else echo "  ✗ failed to add $b"; failed=$((failed + 1)); fi
  fi
done

# ASSETS. `--check` covers them too: it compared `*.html` ONLY, which is why it reported green while
# every served page was missing its stylesheet (§C7).
for a in "${ASSETS[@]}"; do
  [ -e "$SRC/$a" ] || continue
  d="$DEST/$a"
  mkdir -p "$(dirname "$d")" 2>/dev/null
  if [ -e "$d" ] && cmp -s "$SRC/$a" "$d"; then
    aSame=$((aSame + 1))
    continue
  fi
  if [ "$CHECK" = "1" ]; then
    if [ -e "$d" ]; then echo "  ✗ STALE  $a"; aChanged=$((aChanged + 1))
    else echo "  ✗ MISSING $a"; aAdded=$((aAdded + 1)); fi
    continue
  fi
  if cp -p "$SRC/$a" "$d"; then aChanged=$((aChanged + 1))
  else echo "  ✗ failed to copy $a"; aFailed=$((aFailed + 1)); fi
done
for a in "${ASSET_DIRS[@]}"; do
  [ -d "$SRC/$a" ] || continue
  if [ "$CHECK" = "1" ]; then
    if diff -rq "$SRC/$a" "$DEST/$a" >/dev/null 2>&1; then
      aSame=$((aSame + 1))
    else
      echo "  ✗ STALE/MISSING $a/"; aChanged=$((aChanged + 1))
    fi
    continue
  fi
  if mkdir -p "$DEST/$a" && cp -pr "$SRC/$a/." "$DEST/$a/"; then aChanged=$((aChanged + 1))
  else echo "  ✗ failed to copy $a/"; aFailed=$((aFailed + 1)); fi
done

# Present in the served set, absent from the repo — reported, never removed (see the header).
extra=0
for f in "$DEST"/*.html; do
  b="$(basename "$f")"
  [ -e "$SRC/$b" ] || { echo "  · extra (left alone): $b"; extra=$((extra + 1)); }
done

if [ "$CHECK" = "1" ]; then
  echo "  ${#bundles[@]} bundle(s): $same current, $changed stale, $added missing, $extra extra · assets: $aSame current, $aChanged stale, $aAdded missing"
  [ $((changed + added)) -eq 0 ] || exit 1
  exit 0
fi
echo "  ${#bundles[@]} bundle(s): $same already current, $changed refreshed, $added added, $extra extra, $failed failed · assets: $aSame current, $aChanged refreshed, $aAdded added, $aFailed failed"
[ "$failed" -eq 0 ] || exit 1
exit 0
