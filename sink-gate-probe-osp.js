/* A PROBE, DELETED IN THE NEXT COMMIT. The selftest reaches the pure cores; nothing reaches the seam
   that reads a real file from disk, resolves its earned escapers and strips the call. This file is
   that end-to-end control: one sink escaped through a node-local alias, one raw sink beside it. */
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function probe(el, elTwo, value) {
  el.innerHTML = escHtml(value);
  elTwo.innerHTML = value;
}
