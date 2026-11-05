/* Small helpers shared by all modules. Everything hangs off window.DCE. */
window.DCE = window.DCE || {};
(function (D) {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  function build(node, attrs, kids) {
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'class') node.setAttribute('class', v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  D.el = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
  D.svg = (tag, attrs, ...kids) => build(document.createElementNS(SVGNS, tag), attrs, kids);
  D.$ = (id) => document.getElementById(id);
  D.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  D.pad = (n, w) => String(n).padStart(w, '0');

  let toastTimer = null;
  D.toast = function (msg, isErr) {
    const s = D.$('status');
    if (!s) return;
    s.textContent = msg;
    s.className = isErr ? 'err' : '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { s.textContent = ''; s.className = ''; }, isErr ? 8000 : 4500);
  };

  D.download = function (filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };
})(window.DCE);
