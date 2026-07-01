<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Inliner shell — patch list (cosmetic-only)

**Scope:** the bundler/loading shell the inliner emits at the top of every `Foo.html`
(identical across OxyDex / PulseDex / ECGDex / PpgDex). These are the **only** items from the
84-issue "OxyDex Bundler" brief that are real. All 7 are cosmetic / a11y polish — **none affect
function**; the shell works as shipped.

**Where to apply:** in the **inliner template**, not in any committed `Foo.html`. Editing a bundle
directly is wiped on the next re-bundle and shifts its `buildHash` (breaks provenance). After
patching the inliner: re-bundle each app, then run `Dex-Test-Suite.html` (all green) and
`verify-provenance.html` (no red mismatches — expect new hashes, that's fine).

**Explicitly NOT included** (and why): #1 template-missing (present, line ~176 — false),
#3 escape "fix" (would break the `<\/script>` guard), #58/#74 SRI (no external resources — local
only, stripping is correct), #6 decompression fallback (target browsers always have
`DecompressionStream`), #21/#75 readyState/DOMContentLoaded (harmful read-only hack), and the ~9
self-admitted duplicates. See chat triage for the full rundown.

---

## CSS block (in the shell `<style>`)

### Patch 1 — #34: drop no-op `object-fit` on inline SVG
`object-fit` does nothing on an inline (non-replaced) `<svg>`; `preserveAspectRatio` already
letterboxes. Keep the sizing, drop the dead property.

```css
/* FIND */
#__bundler_thumbnail svg { width: 100%; height: 100%; object-fit: contain; }
/* REPLACE */
#__bundler_thumbnail svg { width: 100%; height: 100%; }
```

### Patch 2 — #44: remove dead rule (no such element)
Nothing in the shell has `id="__bundler_placeholder"`.

```css
/* FIND — delete this line entirely */
#__bundler_placeholder { color: #999; font-size: 14px; }
```

### Patch 3 — #52: remove inert flex centering on body
The only children (`#__bundler_thumbnail`, `#__bundler_loading`) are `position: fixed`, so they
don't participate in `body`'s flow — the flex centering does nothing.

```css
/* FIND */
body { background: #faf9f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
/* REPLACE */
body { background: #faf9f5; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
```

---

## `<noscript>` (in `<head>`)

### Patch 4 — #67: dim the thumbnail when JS is off
Currently only the loading pill is hidden; the splash icon stays at full opacity behind the
"requires JavaScript" message.

```html
<!-- FIND -->
<style>#__bundler_loading { display: none; }</style>
<!-- REPLACE -->
<style>#__bundler_loading { display: none; } #__bundler_thumbnail { opacity: 0.3; }</style>
```

---

## Markup

### Patch 5 — #37: explicit SVG dimensions (avoid 300×150 default flash)
Give the splash `<svg>` an intrinsic size so it doesn't render at the spec default before CSS
applies. CSS `width/height:100%` still governs final size; this only fixes the parse-time flash.

```html
<!-- FIND -->
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<!-- REPLACE -->
<svg viewBox="0 0 100 100" width="100" height="100" xmlns="http://www.w3.org/2000/svg">
```

### Patch 6 — #71: ARIA on the loading pill
```html
<!-- FIND -->
<div id="__bundler_loading">Unpacking...</div>
<!-- REPLACE -->
<div id="__bundler_loading" role="status" aria-live="polite">Unpacking...</div>
```

---

## Error overlay (in the `window.addEventListener('error', …)` handler)

### Patch 7 — #71 + #73: add `role="alert"` and a dismiss button
The current handler reassigns `d.textContent` on every error, so it can't host a child button
(it'd be wiped). Restructure once: build a container with a close button + a `<pre>` text node,
then append to the `<pre>` on subsequent errors. Behavior (accumulating messages) is preserved.

```js
/* FIND */
window.addEventListener('error', function(e) {
    var p = document.body || document.documentElement;
    var d = document.getElementById('__bundler_err') || p.appendChild(document.createElement('div'));
    d.id = '__bundler_err';
    d.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;font:12px/1.4 ui-monospace,monospace;background:#2a1215;color:#ff8a80;padding:10px 14px;border-radius:8px;border:1px solid #5c2b2e;z-index:99999;white-space:pre-wrap;max-height:40vh;overflow:auto';
    d.textContent = (d.textContent ? d.textContent + String.fromCharCode(10) : '') +
      '[bundle] ' + (e.message || e.type) +
      (e.filename ? ' (' + e.filename.slice(0, 60) + ':' + e.lineno + ')' : '');
  }, true);

/* REPLACE */
window.addEventListener('error', function(e) {
    var p = document.body || document.documentElement;
    var d = document.getElementById('__bundler_err');
    if (!d) {
      d = p.appendChild(document.createElement('div'));
      d.id = '__bundler_err';
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:99999;background:#2a1215;border:1px solid #5c2b2e;border-radius:8px;padding:10px 34px 10px 14px';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Dismiss');
      btn.textContent = String.fromCharCode(10005); // ✕
      btn.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:0;color:#ff8a80;font:14px/1 ui-monospace,monospace;cursor:pointer;padding:4px';
      btn.onclick = function() { d.remove(); };
      var pre = document.createElement('pre');
      pre.id = '__bundler_err_text';
      pre.style.cssText = 'margin:0;font:12px/1.4 ui-monospace,monospace;color:#ff8a80;white-space:pre-wrap;max-height:40vh;overflow:auto';
      d.appendChild(btn);
      d.appendChild(pre);
    }
    var t = document.getElementById('__bundler_err_text');
    t.textContent = (t.textContent ? t.textContent + String.fromCharCode(10) : '') +
      '[bundle] ' + (e.message || e.type) +
      (e.filename ? ' (' + e.filename.slice(0, 60) + ':' + e.lineno + ')' : '');
  }, true);
```

---

## After applying
1. Re-bundle every app from its `*.src.html` via the inliner.
2. `Dex-Test-Suite.html` → all green.
3. `verify-provenance.html` → no red **mismatches** (new `buildHash` per app is expected; pre-R1
   fixtures showing "no provenance" is fine).

These touch only the loading shell — no DSP/app/render code changes, so behavior and exports are
unaffected.
