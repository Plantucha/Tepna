/* ════ Tepna · shared event-delegation dispatcher (dex-actions.js) ══════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0. See the LICENSE and NOTICE
 * files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ────────────────────────────────────────────────────────────────────────
 * THE one delegated event dispatcher for the whole suite
 * (SECURITY-CSP-STRICT-SCRIPT-SRC-2026-07-11). It replaces every inline `on*=`
 * handler in the fleet so the bundle CSP `script-src` can drop 'unsafe-inline'
 * and add per-block content hashes — then a script INJECTED into the DOM will
 * not execute (CSP becomes an injection backstop, not just the egress control).
 *
 * HOW IT WORKS. Loaded FIRST in each app shell (before any app script), it
 * installs ONE listener per event type on `document`. An element opts in with
 *   data-act="name"            → click
 *   data-act-change="name"     → change
 *   data-act-input="name"      → input
 *   data-act-keydown="name"    → keydown
 *   data-act-submit="name"     → submit
 * so ONE element can carry several (e.g. data-act + data-act-keydown). On the
 * event we walk from `event.target` up to the nearest element carrying the
 * matching attribute and call the registered `fn(el, event)`, where `el` is
 * that element (replaces the former inline `this`) and params ride on
 * `el.dataset` (data-idx, data-win, …). Because delegation fires only the
 * CLOSEST match, a click on an inner region never also triggers an ancestor's
 * action — the isolation the old inline `event.stopPropagation()` provided is
 * inherent (see the `stop` builtin). Elements added after load are handled for
 * free (the listeners live on `document`).
 *
 * Apps register their named actions at load via DexActions.registerAll({…}).
 * DOM-guarded: under Node / a worker (no document) it still exposes
 * register/registerAll (a no-op dispatcher), so co-loading it is always safe.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var handlers = Object.create(null); // name -> fn(el, event)

  function register(name, fn) {
    if (name && typeof fn === 'function') handlers[name] = fn;
  }
  function registerAll(map) {
    if (!map) return;
    Object.keys(map).forEach(function (k) {
      register(k, map[k]);
    });
  }

  // event type -> the attribute an element uses to opt in for that type.
  var ATTR = {
    click: 'data-act',
    change: 'data-act-change',
    input: 'data-act-input',
    keydown: 'data-act-keydown',
    submit: 'data-act-submit'
  };

  function dispatch(type, event) {
    var attr = ATTR[type];
    if (!attr) return;
    var start = event.target;
    if (start && start.nodeType !== 1 && start.parentElement) start = start.parentElement; // climb off text nodes
    var el = start && start.closest ? start.closest('[' + attr + ']') : null;
    if (!el) return;
    var fn = handlers[el.getAttribute(attr)];
    if (typeof fn === 'function') fn(el, event);
  }

  function install(doc) {
    Object.keys(ATTR).forEach(function (type) {
      doc.addEventListener(
        type,
        function (e) {
          dispatch(type, e);
        },
        false
      );
    });
  }

  // ── Generic DOM builtins every app inherits (pure DOM, no app logic) ──────
  registerAll({
    // <button data-act="print">
    print: function () {
      if (typeof window !== 'undefined' && window.print) window.print();
    },
    // <button data-act="scrollTop">
    scrollTop: function () {
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    // <button data-act="scrollToEl" data-target="profilePanel">
    scrollToEl: function (el) {
      var t = el.dataset && document.getElementById(el.dataset.target);
      if (t) t.scrollIntoView({ behavior: 'smooth' });
    },
    // <button data-act="clickEl" data-target="fileInput"> — proxy a click to another element (opens file dialogs, …)
    clickEl: function (el) {
      var t = el.dataset && document.getElementById(el.dataset.target);
      if (t) t.click();
    },
    // <div data-act="stop"> — isolation only. Delegation fires the CLOSEST data-act, so a noop
    // here stops a click on an inner region from reaching an ancestor's data-act (the former
    // inline `event.stopPropagation()` idiom on a click-through container).
    stop: function () {},
    noop: function () {},
    // <button data-act="removeClosest" data-sel=".parse-warning-banner"> — dismiss a container (+ preventDefault)
    removeClosest: function (el, e) {
      if (e && e.preventDefault) e.preventDefault();
      var t = el.closest && el.dataset ? el.closest(el.dataset.sel) : null;
      if (t) t.remove();
    }
  });

  var api = { register: register, registerAll: registerAll, dispatch: dispatch, _handlers: handlers };

  if (typeof document !== 'undefined' && document.addEventListener) install(document);

  root.DexActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
