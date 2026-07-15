/*
 * overdex-walk.js — Tepna folder walker (recursive, fully local, UI-free)
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ────────────────────────────────────────────────────────────────────────
 * OverDex step 1 (brief Phase 10): drag-drop a DIRECTORY (nested allowed) or
 * folder-pick it; recurse every subfolder; collect a flat File[] each tagged
 * with its relative path. Pure browser, 100% local — no server, no network.
 * Two entry points cover both browser affordances:
 *   · fromDataTransfer(dt) → Promise<File[]>  (drag-drop; webkitGetAsEntry recursion)
 *   · fromInput(fileList)  → File[]           (<input type=file webkitdirectory>)
 * Each returned File carries a `.relPath` (folder-relative) for display + a
 * stable de-dupe key. Hidden / system files (dotfiles, __MACOSX) are skipped.
 * ──────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  function isJunk(name) {
    return !name || name.charAt(0) === '.' || name === '__MACOSX' || /(^|\/)\.DS_Store$/i.test(name);
  }

  // Tag a File with a folder-relative path without mutating identity semantics.
  function tag(file, relPath) {
    try {
      Object.defineProperty(file, 'relPath', { value: relPath || file.name, configurable: true });
    } catch (e) {
      /* some File impls are frozen — fall back to a parallel field */ file._relPath = relPath || file.name;
    }
    return file;
  }
  function relOf(file) {
    return file.relPath || file._relPath || file.name;
  }

  // ── drag-drop: recurse the webkit Entry tree ────────────────────────────
  function readEntries(reader) {
    // readEntries returns AT MOST 100 entries per call — must loop until empty.
    return new Promise(function (resolve, reject) {
      var all = [];
      (function pump() {
        reader.readEntries(function (batch) {
          if (!batch.length) {
            resolve(all);
            return;
          }
          all = all.concat(Array.prototype.slice.call(batch));
          pump();
        }, reject);
      })();
    });
  }

  function walkEntry(entry, prefix) {
    if (!entry) return Promise.resolve([]);
    if (isJunk(entry.name)) return Promise.resolve([]);
    var here = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isFile) {
      return new Promise(function (resolve) {
        entry.file(
          function (f) {
            resolve([tag(f, here)]);
          },
          function () {
            resolve([]);
          }
        );
      });
    }
    if (entry.isDirectory) {
      return readEntries(entry.createReader()).then(function (children) {
        return Promise.all(
          children.map(function (c) {
            return walkEntry(c, here);
          })
        ).then(function (lists) {
          return lists.reduce(function (a, b) {
            return a.concat(b);
          }, []);
        });
      });
    }
    return Promise.resolve([]);
  }

  function fromDataTransfer(dt) {
    if (!dt) return Promise.resolve([]);
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
    if (entries.length) {
      return Promise.all(
        entries.map(function (e) {
          return walkEntry(e, '');
        })
      ).then(function (lists) {
        return lists.reduce(function (a, b) {
          return a.concat(b);
        }, []);
      });
    }
    // no entry API (or plain file drop) → fall back to the flat file list
    return Promise.resolve(fromInput(dt.files));
  }

  // ── folder-pick: <input webkitdirectory> hands a flat list with
  //    webkitRelativePath already populated ────────────────────────────────
  function fromInput(fileList) {
    var files = fileList ? Array.prototype.slice.call(fileList) : [];
    var out = [];
    files.forEach(function (f) {
      var rel = f.webkitRelativePath || f.name;
      if (isJunk(f.name) || rel.split('/').some(isJunk)) return;
      out.push(tag(f, rel));
    });
    return out;
  }

  root.OverDexWalk = {
    fromDataTransfer: fromDataTransfer,
    fromInput: fromInput,
    relOf: relOf
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
