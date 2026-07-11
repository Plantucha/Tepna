/*
 * tools/build-core.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * OWN-THE-BUILD-2026-06-30-BRIEF Part A — the deterministic, dependency-free build CORE.
 *
 * WHAT THIS IS. A pure string -> string bundler. Given a `.src.html` plus the text of every
 * external `*.js` / `*.css` it references, it returns a standalone PLAIN-INLINE `Foo.html`:
 * each `<script src="X">` becomes `<script data-inline-src="X">…code…</script>` and each
 * `<link rel="stylesheet" href="Y">` becomes `<style data-inline-src="Y">…css…</style>`, in
 * the SAME source order. No gzip, no base64, no random UUID keys, no unpack bootstrap — the
 * code ships as readable text, so the output is byte-deterministic and trivially auditable, and
 * a plain-inline bundle is behaviourally identical to the served `.src.html` (the app's dev form).
 *
 * WHY A CORE (A.1b). The agent executing the brief has NO Node in-session; it drives JS in a
 * browser sandbox. CI drives Node. So ALL transformation + hashing lives HERE (no fs / path /
 * require / import, no DOM, no crypto.subtle) and two THIN runners wrap it — `tools/build.mjs`
 * (Node CLI, does file IO) and `tools/build.html` / run_script (browser, does file IO). Both call
 * this same core, so the agent-built and CI-built bundles are byte-identical by construction
 * (the manifest-gate.js dual-runner pattern). Hashing is a PURE-JS synchronous SHA-256 (no
 * crypto.subtle — it is async and absent from the opaque-origin sandbox / node:vm), so the core
 * runs anywhere a plain JS engine does.
 *
 * manifestHash (A.3). The plain-inline executed-code identity = SHA-256[0:12] over the SORTED
 * list of `logicalName \0 sha256(assetText)` for EVERY inlined block — external assets AND the
 * inline shell <script>/<style> blocks (tagged `data-inline-src="inline:script:N"` etc.), so it
 * is a true whole-executed-code fingerprint (it also absorbs the retired buildHash's job). It is
 * computed by re-extracting the FINAL bundle text with the SAME extractor manifest-gate.js uses,
 * so page + Node + this core cannot disagree. Deterministic: a pure function of the shipped
 * JS/CSS, moving ONLY on a real code change.
 */
(function (root) {
  'use strict';

  /* ── Pure-JS SHA-256 (synchronous; UTF-8) ─────────────────────────────────────────────────
     Classic FIPS-180-4 implementation over bytes. Returns lowercase 64-hex. The manifestHash
     convention slices to 12. Byte-identical to crypto.subtle('SHA-256', utf8Bytes) — the browser
     driver cross-checks this against manifest-gate.js's async path before any hash is trusted. */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    // Encode a JS string to UTF-8 bytes without TextEncoder (present in Node+browser, but keep
    // the core dependency-free and identical everywhere). Handles the full BMP + surrogate pairs.
    var out = [],
      i,
      c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function sha256words(str) {
    var bytes = utf8Bytes(str);
    var h0 = 0x6a09e667,
      h1 = 0xbb67ae85,
      h2 = 0x3c6ef372,
      h3 = 0xa54ff53a,
      h4 = 0x510e527f,
      h5 = 0x9b05688c,
      h6 = 0x1f83d9ab,
      h7 = 0x5be0cd19;
    var l = bytes.length,
      bitLenHi = Math.floor(l / 0x20000000),
      bitLenLo = (l << 3) >>> 0;
    // pad
    bytes = bytes.slice();
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((bitLenHi >>> 24) & 0xff, (bitLenHi >>> 16) & 0xff, (bitLenHi >>> 8) & 0xff, bitLenHi & 0xff);
    bytes.push((bitLenLo >>> 24) & 0xff, (bitLenLo >>> 16) & 0xff, (bitLenLo >>> 8) & 0xff, bitLenLo & 0xff);

    var w = new Array(64),
      a,
      b,
      c,
      d,
      e,
      f,
      g,
      hh,
      t1,
      t2,
      i,
      j;
    function rotr(x, n) {
      return (x >>> n) | (x << (32 - n));
    }
    for (i = 0; i < bytes.length; i += 64) {
      for (j = 0; j < 16; j++) {
        w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
        w[j] = w[j] >>> 0;
      }
      for (j = 16; j < 64; j++) {
        var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      a = h0;
      b = h1;
      c = h2;
      d = h3;
      e = h4;
      f = h5;
      g = h6;
      hh = h7;
      for (j = 0; j < 64; j++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        t1 = (hh + S1 + ch + K[j] + w[j]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = (S0 + maj) >>> 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + hh) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7];
  }

  function sha256hex(str) {
    var w = sha256words(str),
      out = '';
    for (var i = 0; i < 8; i++) out += ('00000000' + (w[i] >>> 0).toString(16)).slice(-8);
    return out;
  }

  /* ── SHA-256 → base64 (the CSP hash form: `'sha256-<base64>'`) ──────────────────────────────────
     SECURITY-CSP-STRICT-SCRIPT-SRC Phase 3. The browser compares this against the base64 SHA-256 of
     each inline <script>'s exact text content, so the digest MUST be over the same bytes. Pure-JS
     base64 (no Buffer/atob) keeps the core dependency-free + identical in Node and the sandbox. */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function sha256base64(str) {
    var w = sha256words(str),
      bytes = [];
    for (var i = 0; i < 8; i++) bytes.push((w[i] >>> 24) & 0xff, (w[i] >>> 16) & 0xff, (w[i] >>> 8) & 0xff, w[i] & 0xff);
    var out = '';
    for (var j = 0; j < bytes.length; j += 3) {
      var b0 = bytes[j],
        b1 = j + 1 < bytes.length ? bytes[j + 1] : 0,
        b2 = j + 2 < bytes.length ? bytes[j + 2] : 0;
      out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)] + (j + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=') + (j + 2 < bytes.length ? B64[b2 & 63] : '=');
    }
    return out;
  }

  /* ── Plain-inline asset extraction (THE shared contract with manifest-gate.js) ──────────────
     Every executed block in a plain-inline bundle carries `data-inline-src`: external files by
     their path, inline shell blocks by a synthetic ordinal name. These two regexes are the
     canonical extractor; manifest-gate.js's plain-inline branch mirrors them byte-for-byte. */
  var INLINE_SCRIPT_RE = /<script\b[^>]*\bdata-inline-src="([^"]*)"[^>]*>([\s\S]*?)<\/script>/gi;
  var INLINE_STYLE_RE = /<style\b[^>]*\bdata-inline-src="([^"]*)"[^>]*>([\s\S]*?)<\/style>/gi;

  function plainInlineAssets(bundleText) {
    var assets = [],
      m;
    INLINE_SCRIPT_RE.lastIndex = 0;
    while ((m = INLINE_SCRIPT_RE.exec(bundleText)) !== null) assets.push({ name: m[1], text: m[2] });
    INLINE_STYLE_RE.lastIndex = 0;
    while ((m = INLINE_STYLE_RE.exec(bundleText)) !== null) assets.push({ name: m[1], text: m[2] });
    return assets;
  }

  // A plain-inline bundle iff it carries at least one data-inline-src block AND no legacy
  // __bundler/manifest (the dual-branch discriminator manifest-gate.js also uses).
  function isPlainInline(bundleText) {
    return typeof bundleText === 'string' && /\bdata-inline-src="/.test(bundleText) && !/<script type="__bundler\/manifest">/.test(bundleText);
  }

  /* ── CSP strict script-src (SECURITY-CSP-STRICT-SCRIPT-SRC Phase 3) ──────────────────────────────
     After inlining, EVERY executable block is an inline <script> (external files became
     `<script data-inline-src="path">…</script>` with no src attr; shell blocks became
     `inline:script:N`). Dropping 'unsafe-inline' from script-src means each must carry a
     `'sha256-<base64>'` matching its EXACT text content. We hash every inline script body, de-dup
     (identical shared modules hash once) + SORT (determinism → `build --check` byte-stable), and
     substitute the sorted list into the `__DEX_SCRIPT_HASHES__` placeholder the .src.html CSP <meta>
     carries. Deterministic in → deterministic out. Non-executed JSON data-islands hash too (harmless:
     the browser just never needs those hashes). The CSP <meta> is HTML shell, not an inlined asset,
     so this does NOT move manifestHash. */
  var SCRIPT_HASH_PLACEHOLDER = '__DEX_SCRIPT_HASHES__';
  function scriptSrcHashes(bundleText) {
    var set = {},
      m;
    INLINE_SCRIPT_RE.lastIndex = 0;
    while ((m = INLINE_SCRIPT_RE.exec(bundleText)) !== null) set["'sha256-" + sha256base64(m[2]) + "'"] = true;
    return Object.keys(set).sort();
  }
  function applyScriptHashes(bundleText) {
    if (bundleText.indexOf(SCRIPT_HASH_PLACEHOLDER) < 0) return bundleText;
    return bundleText.replace(SCRIPT_HASH_PLACEHOLDER, scriptSrcHashes(bundleText).join(' '));
  }

  // manifestHash from FINAL bundle text — SYNC twin of manifest-gate.js's async plain-inline branch.
  function manifestHashFromInline(bundleText) {
    var assets = plainInlineAssets(bundleText);
    var parts = [];
    for (var i = 0; i < assets.length; i++) parts.push(assets[i].name + '\u0000' + sha256hex(assets[i].text));
    parts.sort();
    return sha256hex(parts.join('\n')).slice(0, 12);
  }

  /* ── Ref scan — which external files a `.src.html` pulls in (so the runner knows what to read) ─
     Only same-origin relative paths (never data: / http(s): / //). Returns { scripts, styles }
     preserving source order (deduped is NOT done — order + repeats mirror the src exactly). */
  function isLocalRef(p) {
    return !!p && !/^(?:[a-z]+:)?\/\//i.test(p) && !/^data:/i.test(p) && !/^#/.test(p);
  }

  function scanRefs(srcHtml) {
    var scripts = [],
      styles = [],
      m;
    var sre = /<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)>\s*<\/script>/gi;
    while ((m = sre.exec(srcHtml)) !== null) {
      if (isLocalRef(m[2])) scripts.push(m[2]);
    }
    var lre = /<link\b([^>]*)>/gi,
      tag;
    while ((tag = lre.exec(srcHtml)) !== null) {
      var attrs = tag[1] || '';
      if (/\brel="stylesheet"/i.test(attrs)) {
        var hm = attrs.match(/\bhref="([^"]+)"/i);
        if (hm && isLocalRef(hm[1])) styles.push(hm[1]);
      }
    }
    return { scripts: scripts, styles: styles };
  }

  /* ── The build ──────────────────────────────────────────────────────────────────────────────
     build({ srcHtml, assets }) -> { html, manifestHash, assetNames, inlineCounts }
       srcHtml : the `.src.html` text
       assets  : { '<relative path>': '<file text>' } for every scanRefs() ref
     Deterministic: no timestamps, no random, LF preserved from source. Throws on a missing asset
     or on any inlined text containing the sequence that would terminate its host tag. */
  // Spec-correct RAWTEXT terminators. A <script>/<style> body ends at `</script`/`</style`
  // followed by whitespace, `/`, or `>` (WHATWG). A body carrying one cannot be inlined verbatim
  // (it would close the host tag early). Note: the ESCAPED `<\/script>` (backslash) is NOT a
  // terminator and is correctly ignored — that is exactly why app JS uses it in HTML strings.
  function assertSafe(name, text) {
    if (/<\/script[\s/>]/i.test(text)) throw new Error('build: "' + name + '" contains a </script> terminator — cannot inline verbatim (brief A.2 step 2). Escape as <\\/script>.');
    if (/<\/style[\s/>]/i.test(text)) throw new Error('build: "' + name + '" contains a </style> terminator — cannot inline verbatim (brief A.2 step 2).');
  }

  /* SINGLE forward pass over the ORIGINAL srcHtml. Each <script>/<style>/<link> in the SOURCE is
     transformed in place; every other byte is copied verbatim (deterministic). Crucially we jump
     tagRe PAST each element we consume, so an inlined asset body is NEVER rescanned — a `<script>`
     / `</script>` STRING LITERAL inside app JS can't be mistaken for real markup (the exact bug a
     naive multi-pass regex bundler hits: it double-tags string literals in already-inlined code). */
  function build(opts) {
    opts = opts || {};
    var src = opts.srcHtml,
      assets = opts.assets || {};
    if (typeof src !== 'string') throw new Error('build: srcHtml must be a string');
    var out = '',
      i = 0,
      si = 0,
      ci = 0,
      assetNames = [];
    var tagRe = /<(script|style|link)\b/gi,
      m;
    while ((m = tagRe.exec(src)) !== null) {
      var start = m.index,
        kind = m[1].toLowerCase();
      out += src.slice(i, start); // verbatim up to the tag
      var gt = src.indexOf('>', start);
      if (gt < 0) throw new Error('build: unterminated <' + kind + '> open tag at ' + start);
      var openTag = src.slice(start, gt + 1);

      if (kind === 'link') {
        // void element
        var rel = (openTag.match(/\brel="([^"]*)"/i) || [])[1] || '';
        var href = (openTag.match(/\bhref="([^"]*)"/i) || [])[1] || '';
        if (/(^|\s)stylesheet(\s|$)/i.test(rel) && isLocalRef(href)) {
          if (!(href in assets)) throw new Error('build: missing asset text for stylesheet "' + href + '"');
          assertSafe(href, assets[href]);
          out += '<style data-inline-src="' + href + '">' + assets[href] + '</style>';
          assetNames.push(href);
        } else {
          out += openTag;
        } // icon / preload / non-local
        i = gt + 1;
        tagRe.lastIndex = i;
        continue;
      }

      // script | style: find the matching close from just past the open tag
      var closeRe = new RegExp('</' + kind + '\\s*>', 'i');
      var tail = src.slice(gt + 1),
        cm = tail.match(closeRe);
      if (!cm) throw new Error('build: unterminated <' + kind + '> element at ' + start);
      var body = tail.slice(0, cm.index),
        closeEnd = gt + 1 + cm.index + cm[0].length;

      if (kind === 'script') {
        var srcAttr = (openTag.match(/\bsrc="([^"]*)"/i) || [])[1];
        if (srcAttr && isLocalRef(srcAttr)) {
          if (!(srcAttr in assets)) throw new Error('build: missing asset text for script "' + srcAttr + '"');
          assertSafe(srcAttr, assets[srcAttr]);
          out += openTag.replace(/\s+src="[^"]*"/i, '').replace(/^<script/i, '<script data-inline-src="' + srcAttr + '"') + assets[srcAttr] + '</script>';
          assetNames.push(srcAttr);
        } else if (srcAttr) {
          out += src.slice(start, closeEnd); // non-local src (CDN/data): verbatim
        } else {
          var nm = 'inline:script:' + ci++;
          assertSafe(nm, body);
          out += openTag.replace(/^<script/i, '<script data-inline-src="' + nm + '"') + body + '</script>';
          assetNames.push(nm);
        }
      } else {
        // style
        if (/\bdata-inline-src=/i.test(openTag)) {
          out += src.slice(start, closeEnd);
        } else {
          var snm = 'inline:style:' + si++;
          assertSafe(snm, body);
          out += openTag.replace(/^<style/i, '<style data-inline-src="' + snm + '"') + body + '</style>';
          assetNames.push(snm);
        }
      }
      i = closeEnd;
      tagRe.lastIndex = i;
    }
    out += src.slice(i);
    out = applyScriptHashes(out); // CSP strict script-src: fill __DEX_SCRIPT_HASHES__ (no-op if absent)
    return { html: out, manifestHash: manifestHashFromInline(out), assetNames: assetNames };
  }

  root.DexBuild = {
    sha256hex: sha256hex,
    sha256base64: sha256base64,
    scriptSrcHashes: scriptSrcHashes,
    plainInlineAssets: plainInlineAssets,
    isPlainInline: isPlainInline,
    manifestHashFromInline: manifestHashFromInline,
    scanRefs: scanRefs,
    build: build,
    INLINE_SCRIPT_RE: INLINE_SCRIPT_RE,
    INLINE_STYLE_RE: INLINE_STYLE_RE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DexBuild;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
