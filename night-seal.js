/*
 * night-seal.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * READ A `tepna-seal/1` NIGHT IN THE PAGE — CAPTURE-NIGHT-SEAL phase C (brief §5; format frozen in
 * docs/NIGHT-SEAL-FORMAT.md). The browser twin of tools/verify-seals.mjs and capture-host/unseal.py:
 * the same recipe, the same refusal vocabulary, the same order — and judged on the same committed
 * vector and the same eight plants, so the three readers cannot drift unseen.
 *
 * WebCrypto (`crypto.subtle`) and the browser-native `DecompressionStream('deflate-raw')` only. No
 * vendored crypto, no vendored zip: the ~40-line central-directory parser below IS the zip reader.
 * No network anywhere (CLAUDE.md §📚 hard line 1) — the box's public key travels in the clear header
 * and is PINNED to the fingerprint printed on the patient's card.
 *
 * ORDER, and the two things carried over from the Node twin EXACTLY:
 *   1. the FINGERPRINT is checked BEFORE the key is imported — a reader that imported first would
 *      run WebCrypto on attacker-chosen bytes before deciding whether it trusts them;
 *   2. the AAD of the GCM decrypt is the clear-header BYTES AS READ, never a re-serialisation — the
 *      header on disk is the signed and the authenticated thing.
 *
 * VERIFY ONLY WHAT IS OPENED (brief §5): `unseal()` verifies the framing, fingerprint, signature,
 * revision, key unwrap, GCM tag, zip structure, Payload-Oxum and the tagmanifest — everything that is
 * cheap and global — and returns each `data/` file with a `verify()` that checks THAT file's
 * manifest-sha256 line on demand. A 4 GB night is not hashed to open one stream. `verifyAll()` is the
 * Node twin's behaviour (every listed file, in manifest order).
 *
 * RESULT IS A PROVENANCE BADGE, NOT A GATE. The night opens on a tampered stream — that stream reds by
 * name (`TAMPERED: <stream>`) and the others open; nothing refuses silently and nothing fabricates
 * "verified". `verdict()` renders the outcome as ONE `tepna.verdict/1` object (VERDICT-CONTRACT §1)
 * through verdict.js when it is loaded, so a machine reads the same thing the badge shows.
 *
 * Node co-load: `crypto.subtle` and `DecompressionStream` are globals in Node ≥ 18, so the node lane
 * runs this reader on the committed vector for real. What Node CANNOT see is OverDex's wiring of it
 * (the file input, IndexedDB, the badge) — that is the browser-gates leg's job.
 */
(function (root) {
  'use strict';

  var FORMAT = 'tepna-seal/1';
  var MAGIC = 'TEPNASEAL';
  var VERSION = 1;
  var KEK_INFO = 'tepna-seal/1 card-kek';
  var GCM_NONCE_BYTES = 12;
  var P256_SIG_BYTES = 64;
  // The refusal vocabulary — echo unseal.KINDS / verify-seals KINDS exactly. A kind outside this
  // list is a bug in the reader, not a new refusal.
  var KINDS = ['magic', 'version', 'header', 'fingerprint', 'signature', 'revision', 'card-key', 'payload', 'zip', 'oxum', 'manifest', 'consent'];
  var CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  /* Web APIs are resolved LAZILY from the host realm, never at load: a Node vm co-load (the test
     runner) evaluates this file in a sandbox that carries them only if the runner injects them, and
     a module that touched `TextEncoder` at evaluation time would throw there and take every other
     co-loaded module down with it (CLAUDE.md §👥.3's module-evaluation-time crash). */
  function host(name) {
    if (root && typeof root[name] !== 'undefined') return root[name];
    if (typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined') return globalThis[name];
    return undefined;
  }
  var _enc = null,
    _dec = null;
  function enc() {
    if (!_enc) {
      var TE = host('TextEncoder');
      if (!TE) throw new Error('TextEncoder is not available in this runtime');
      _enc = new TE();
    }
    return _enc;
  }
  function dec() {
    if (!_dec) {
      var TD = host('TextDecoder');
      if (!TD) throw new Error('TextDecoder is not available in this runtime');
      _dec = new TD('utf-8', { fatal: true });
    }
    return _dec;
  }
  function subtleOf() {
    var c = host('crypto');
    return (c && c.subtle) || null;
  }

  function SealRefused(kind, detail) {
    var e = new Error(kind + ': ' + detail);
    e.name = 'SealRefused';
    if (KINDS.indexOf(String(kind).split(':')[0]) < 0) throw new Error('unknown refusal kind ' + kind);
    e.kind = kind;
    e.detail = detail;
    e.refused = true;
    return e;
  }

  function hex(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }
  function fromHex(s) {
    var m = String(s || '').match(/../g) || [];
    var out = new Uint8Array(m.length);
    for (var i = 0; i < m.length; i++) out[i] = parseInt(m[i], 16);
    return out;
  }
  function b64(s) {
    var A = host('atob'),
      B = host('Buffer');
    var bin = typeof A === 'function' ? A(s) : B.from(s, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function eq(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function sha256(u8) {
    return subtleOf()
      .digest('SHA-256', u8)
      .then(function (d) {
        return new Uint8Array(d);
      });
  }

  /* ── the card code (format §3): 26 Crockford symbols, 2 zero padding bits → 16 bytes ────────── */
  function decodeCardCode(code) {
    var s = String(code || '')
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/[IL]/g, '1')
      .replace(/O/g, '0');
    if (s.length !== 26) throw new Error('card code has ' + s.length + ' symbols, not 26');
    var bits = 0,
      nbits = 0,
      out = [];
    for (var i = 0; i < s.length; i++) {
      var v = CROCKFORD.indexOf(s[i]);
      if (v < 0) throw new Error('card code symbol ' + JSON.stringify(s[i]) + ' is not Crockford base32');
      bits = (bits << 5) | v;
      nbits += 5;
      while (nbits >= 8) {
        out.push((bits >> (nbits - 8)) & 0xff);
        nbits -= 8;
        bits &= (1 << nbits) - 1;
      }
    }
    // 130 bits → 16 bytes + 2 padding bits, which must be zero
    if (nbits !== 2 || bits !== 0) throw new Error('card code padding is not two zero bits');
    if (out.length !== 16) throw new Error('card code decodes to ' + out.length + ' bytes, not 16');
    return Uint8Array.from(out);
  }

  /* ── framing (format §1) ───────────────────────────────────────────────────────────────────── */
  function split(blob) {
    var magic = enc().encode(MAGIC);
    if (!eq(blob.subarray(0, magic.length), magic)) throw SealRefused('magic', 'not a tepna seal');
    var p = magic.length;
    if (blob[p] !== VERSION) throw SealRefused('version', 'seal version ' + blob[p] + '; this reader knows ' + VERSION);
    p += 1;
    var dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    var header, headerBytes, sig, payload;
    try {
      var hlen = dv.getUint32(p);
      p += 4;
      headerBytes = blob.subarray(p, p + hlen);
      p += hlen;
      if (headerBytes.length !== hlen) throw SealRefused('header', 'header truncated: ' + headerBytes.length + ' of ' + hlen + ' bytes');
      header = JSON.parse(dec().decode(headerBytes));
      var slen = dv.getUint16(p);
      p += 2;
      sig = blob.subarray(p, p + slen);
      p += slen;
      if (sig.length !== P256_SIG_BYTES) throw SealRefused('signature', 'signature is ' + sig.length + ' bytes, not ' + P256_SIG_BYTES);
      // u64 payload length; a browser DataView reads it as a BigInt
      var plen = Number(dv.getBigUint64(p));
      p += 8;
      payload = blob.subarray(p, p + plen);
      if (payload.length !== plen) throw SealRefused('payload', 'payload truncated: ' + payload.length + ' of ' + plen + ' bytes');
    } catch (e) {
      if (e && e.refused) throw e;
      throw SealRefused('header', 'cannot parse the clear header: ' + (e && e.message));
    }
    if (!header || typeof header !== 'object' || header.format !== FORMAT) throw SealRefused('header', 'format is ' + JSON.stringify(header && header.format) + ', not ' + FORMAT);
    return { header: header, headerBytes: headerBytes, sig: sig, payload: payload };
  }

  /** The clear header alone — what the page needs BEFORE it has a key (boxId, keyId, fingerprint). */
  function readHeader(blob) {
    return split(blob).header;
  }

  /* ── the zip's central directory, no library (format §4) ───────────────────────────────────── */
  function inflateRaw(raw) {
    var DS = host('DecompressionStream'),
      R = host('Response');
    if (!DS || !R) return Promise.reject(new Error('DecompressionStream is not available in this runtime'));
    var ds = new DS('deflate-raw');
    var writer = ds.writable.getWriter();
    writer.write(raw);
    writer.close();
    return new R(ds.readable).arrayBuffer().then(function (ab) {
      return new Uint8Array(ab);
    });
  }
  function unzip(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return Promise.reject(SealRefused('zip', 'no end-of-central-directory record'));
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var entries = {};
    var chain = Promise.resolve();
    var _loop = function () {
      if (dv.getUint32(p, true) !== 0x02014b50) throw SealRefused('zip', 'bad central-directory entry');
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var usize = dv.getUint32(p + 24, true);
      var nlen = dv.getUint16(p + 28, true),
        xlen = dv.getUint16(p + 30, true),
        clen = dv.getUint16(p + 32, true);
      var off = dv.getUint32(p + 42, true);
      var name = dec().decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (dv.getUint32(off, true) !== 0x04034b50) throw SealRefused('zip', 'bad local header for ' + name);
      var lnlen = dv.getUint16(off + 26, true),
        lxlen = dv.getUint16(off + 28, true);
      var start = off + 30 + lnlen + lxlen;
      var raw = u8.subarray(start, start + csize);
      var dataP;
      if (method === 0) dataP = Promise.resolve(raw);
      else if (method === 8) dataP = inflateRaw(raw);
      else throw SealRefused('zip', 'unsupported compression ' + method + ' for ' + name);
      return dataP.then(function (data) {
        if (data.length !== usize) throw SealRefused('zip', name + ': inflated ' + data.length + ', expected ' + usize);
        entries[name] = data;
      });
    };
    for (var k = 0; k < count; k++) chain = chain.then(_loop);
    return chain.then(function () {
      return entries;
    });
  }

  function bagInfo(entries) {
    if (!entries['bag-info.txt']) throw SealRefused('zip', 'bag-info.txt missing');
    var text;
    try {
      text = dec().decode(entries['bag-info.txt']);
    } catch (e) {
      throw SealRefused('zip', 'bag-info.txt is not UTF-8');
    }
    var info = {};
    text.split('\n').forEach(function (line) {
      var i = line.indexOf(': ');
      if (i > 0) info[line.slice(0, i)] = line.slice(i + 2);
    });
    return info;
  }
  function parseManifest(entries, name) {
    if (!entries[name]) throw SealRefused('zip', name + ' missing');
    var text;
    try {
      text = dec().decode(entries[name]);
    } catch (e) {
      throw SealRefused('zip', name + ' is not UTF-8');
    }
    var want = {};
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var i = line.indexOf('  ');
      if (i < 0) throw SealRefused('zip', name + ': unparseable line');
      want[line.slice(i + 2)] = line.slice(0, i);
    });
    return want;
  }
  function checkOne(entries, path, want, listedIn) {
    if (!entries[path]) return Promise.reject(SealRefused('manifest:' + path, 'listed in ' + listedIn + ' but absent from the bag'));
    return sha256(entries[path]).then(function (d) {
      var got = hex(d);
      if (got !== want) throw SealRefused('manifest:' + path, 'SHA-256 ' + got.slice(0, 12) + '… does not match ' + want.slice(0, 12) + '…');
      return true;
    });
  }
  function checkManifest(entries, name) {
    var want = parseManifest(entries, name);
    var chain = Promise.resolve();
    Object.keys(want).forEach(function (path) {
      chain = chain.then(function () {
        return checkOne(entries, path, want[path], name);
      });
    });
    return chain;
  }

  /* ── the verifier (format §5 order) ─────────────────────────────────────────────────────────── */
  function unseal(blob, opts) {
    opts = opts || {};
    var subtle = subtleOf();
    if (!subtle) return Promise.reject(new Error('crypto.subtle is not available in this runtime'));
    var parts;
    try {
      parts = split(blob);
    } catch (e) {
      return Promise.reject(e);
    }
    var header = parts.header,
      headerBytes = parts.headerBytes,
      sig = parts.sig,
      payload = parts.payload;
    var rawPub = b64(header.boxKey || '');
    var pinned = opts.pinnedFingerprint;
    return sha256(rawPub)
      .then(function (d) {
        // 1 · FINGERPRINT BEFORE KEY IMPORT — the pin decides whether these bytes are trusted at all.
        var fp = 'sha256/' + hex(d);
        if (!pinned || header.boxKeyFingerprint !== pinned || fp !== pinned) throw SealRefused('fingerprint', 'box key ' + header.boxKeyFingerprint + ' is not the pinned ' + (pinned || '(no pin)'));
        return subtle.importKey('raw', rawPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(function (e) {
          throw SealRefused('header', 'boxKey is not a P-256 point: ' + (e && e.message));
        });
      })
      .then(function (pub) {
        return sha256(payload).then(function (ph) {
          var msg = new Uint8Array(headerBytes.length + 32);
          msg.set(headerBytes, 0);
          msg.set(ph, headerBytes.length);
          return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, msg);
        });
      })
      .then(function (ok) {
        if (!ok) throw SealRefused('signature', 'ECDSA over header ‖ SHA-256(payload) does not verify');
        var rev = header.revision;
        if (!(typeof rev === 'number' && isFinite(rev) && Math.floor(rev) === rev) || rev < 1) throw SealRefused('header', 'revision is ' + JSON.stringify(rev));
        var known = opts.knownRevision == null ? null : opts.knownRevision;
        if (known !== null && rev < known) throw SealRefused('revision', 'revision ' + rev + ' presented after revision ' + known + ' was already seen');
        var recip = (header.recipients || []).filter(function (r) {
          return r && r.kind === 'card' && r.keyId === header.keyId;
        })[0];
        if (!recip || recip.wrap !== 'AES-KW') throw SealRefused('header', 'no AES-KW card recipient for keyId ' + header.keyId);
        var salt = enc().encode(String(header.boxId) + String(header.keyId));
        return subtle
          .importKey('raw', opts.cardKey, 'HKDF', false, ['deriveKey'])
          .then(function (ikm) {
            return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: enc().encode(KEK_INFO) }, ikm, { name: 'AES-KW', length: 256 }, false, ['unwrapKey']);
          })
          .then(function (kek) {
            return subtle.unwrapKey('raw', b64(recip.wrapped), kek, 'AES-KW', { name: 'AES-GCM' }, false, ['decrypt']).catch(function () {
              throw SealRefused('card-key', "the card key does not unwrap this seal's data key (keyId " + header.keyId + ')');
            });
          });
      })
      .then(function (dataKey) {
        // 2 · AAD = the clear-header BYTES AS READ.
        return subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, GCM_NONCE_BYTES), additionalData: headerBytes }, dataKey, payload.subarray(GCM_NONCE_BYTES)).catch(function () {
          throw SealRefused('payload', 'AES-GCM tag does not verify');
        });
      })
      .then(function (plainAb) {
        return unzip(new Uint8Array(plainAb));
      })
      .then(function (entries) {
        var info = bagInfo(entries);
        var files = {};
        var bytes = 0,
          n = 0;
        Object.keys(entries).forEach(function (k) {
          if (k.indexOf('data/') === 0) {
            files[k.slice(5)] = entries[k];
            bytes += entries[k].length;
            n++;
          }
        });
        var got = bytes + '.' + n;
        // Payload-Oxum BEFORE any hashing — a truncated payload is caught by arithmetic, not by a digest.
        if ((info['Payload-Oxum'] || '') !== got) throw SealRefused('oxum', 'Payload-Oxum says ' + info['Payload-Oxum'] + ', data/ holds ' + got + ' — checked before any hashing');
        return checkManifest(entries, 'tagmanifest-sha256.txt').then(function () {
          var want = parseManifest(entries, 'manifest-sha256.txt');
          var consent = header.consent === 'yes' || header.consent === 'no' ? header.consent : null; // absent ⇒ null, never "no"
          // The header MIRRORS bag-info's consent (format §2). Two answers to one question is a seal
          // that was not written by the sealer — refused by name, never resolved in either direction.
          var inBag = info['Tepna-Research-Consent'] === 'yes' || info['Tepna-Research-Consent'] === 'no' ? info['Tepna-Research-Consent'] : null;
          if (inBag !== consent) throw SealRefused('consent', 'clear header says ' + JSON.stringify(consent) + ' but bag-info.txt says ' + JSON.stringify(inBag));
          var out = {
            header: header,
            consent: consent,
            bagInfo: info,
            files: files,
            manifest: want,
            /** Verify ONE data file against manifest-sha256 — the per-stream check, on open. */
            verify: function (name) {
              var path = 'data/' + name;
              if (!(path in want)) return Promise.reject(SealRefused('manifest:' + path, 'not listed in manifest-sha256.txt'));
              return checkOne(entries, path, want[path], 'manifest-sha256.txt');
            },
            /** Every listed file, manifest order — the Node twin's behaviour. */
            verifyAll: function () {
              return checkManifest(entries, 'manifest-sha256.txt');
            }
          };
          return out;
        });
      });
  }

  /* ── ONE tepna.verdict/1 per opened seal (VERDICT-CONTRACT §1) ─────────────────────────────── */
  function verdict(outcome) {
    // outcome: { status:'PASS'|'FAIL'|'NOT_RUN', kind?, detail?, header?, streams:{opened,verified,tampered[]}, file }
    var V = root.Verdict || null;
    var tampered = (outcome.streams && outcome.streams.tampered) || [];
    var opened = (outcome.streams && outcome.streams.opened) || 0;
    var verified = (outcome.streams && outcome.streams.verified) || 0;
    var status = outcome.status;
    var reason = status === 'PASS' ? null : outcome.kind ? outcome.kind + ': ' + outcome.detail : outcome.detail || 'not run';
    var obj = {
      schema: 'tepna.verdict/1',
      gate: 'night-seal-open',
      status: status,
      scope: 'internal', // P5 — a page's own provenance check is never a publishable claim
      // population = the streams the page OPENED (the ones it verified), as an equality
      population: { checked: verified + tampered.length, eligible: opened, excluded: opened - verified - tampered.length },
      criterion: { name: 'seal-verifies-and-every-opened-stream-matches-its-manifest', threshold: 0, unit: 'tampered streams', direction: 'eq' },
      result:
        status === 'NOT_RUN'
          ? null
          : {
              boxId: outcome.header ? outcome.header.boxId : null,
              night: outcome.header ? outcome.header.night : null,
              revision: outcome.header ? outcome.header.revision : null,
              consent: outcome.consent === undefined ? null : outcome.consent,
              tampered: tampered.slice(),
              kind: outcome.kind || null
            },
      evidence: ['night-seal.js'].concat(outcome.file ? [String(outcome.file)] : []),
      reason: reason,
      producedBy: outcome.commit
        ? { tool: 'night-seal.js', commit: outcome.commit }
        : { tool: 'night-seal.js', commit: null, commitReason: 'in-page reader — the bundle carries manifestHash, not a git sha' },
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    };
    // Validated by verdict.js when it is loaded (OverDex bundles it); the validator's own errors ride
    // along so a malformed object cannot pass as a verdict. `valid` is the page's tell, not part of §1.
    if (V && typeof V.validate === 'function') {
      var v = V.validate(obj);
      obj.valid = !!(v && v.ok);
      if (!obj.valid) obj.validationErrors = v && v.errors;
    }
    return obj;
  }

  /* ── the badge text (brief §5) — one string per outcome, the page sites it like an evidence badge ── */
  function badge(outcome) {
    if (!outcome || outcome.status === 'NOT_RUN' || outcome.legacy) return { cls: 'seal-unknown', text: 'unsealed folder — provenance unknown' };
    if (outcome.status === 'FAIL') {
      if (outcome.kind === 'fingerprint') return { cls: 'seal-bad', text: 'signature: unknown key — not on card' };
      if (outcome.kind && outcome.kind.indexOf('manifest:') === 0) return { cls: 'seal-bad', text: 'TAMPERED: ' + outcome.kind.slice('manifest:data/'.length) };
      return { cls: 'seal-bad', text: 'REFUSED: ' + outcome.kind + (outcome.detail ? ' — ' + outcome.detail : '') };
    }
    var t = (outcome.streams && outcome.streams.tampered) || [];
    if (t.length) return { cls: 'seal-bad', text: 'TAMPERED: ' + t.join(', ') };
    var h = outcome.header || {};
    var closed = h.closedAt != null ? fmtClock(h.closedAt) : '?';
    return { cls: 'seal-ok', text: 'sealed · box ' + h.boxId + ' · closed ' + closed + ' · verified' };
  }
  function fmtClock(ms) {
    var d = new Date(ms); // floating tMs → UTC getters (Clock Contract §5)
    var p2 = function (x) {
      return x < 10 ? '0' + x : '' + x;
    };
    return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  }

  /* ── the card-key store: IndexedDB per (boxId, keyId), browser only ─────────────────────────── */
  var DB_NAME = 'tepna-night-seal',
    STORE = 'cards';
  function openDb() {
    return new Promise(function (resolve, reject) {
      var IDB = host('indexedDB');
      if (!IDB) return reject(new Error('IndexedDB is not available'));
      var req = IDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }
  function keyOf(boxId, keyId) {
    return String(boxId) + '\u0000' + String(keyId);
  }
  function getCard(boxId, keyId) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).get(keyOf(boxId, keyId));
        r.onsuccess = function () {
          resolve(r.result || null);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
    });
  }
  function putCard(boxId, keyId, card) {
    // card: { cardKeyHex, fingerprint, knownRevision? }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(card, keyOf(boxId, keyId));
        tx.oncomplete = function () {
          resolve(card);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  var API = {
    FORMAT: FORMAT,
    KINDS: KINDS.slice(),
    decodeCardCode: decodeCardCode,
    readHeader: readHeader,
    split: split,
    unzip: unzip,
    unseal: unseal,
    verdict: verdict,
    badge: badge,
    fromHex: fromHex,
    hex: hex,
    cards: { get: getCard, put: putCard }
  };
  root.NightSeal = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
