// DOM selection capture for the Phase 1 rendered-HTML views (script preview,
// research reader). Walks the live selection range against every element
// carrying `attr` inside `container` and records, per intersected element,
// the substring selected and its offset within that element's text -- this
// is what becomes a {q, b, s} anchor part once paired with the block index.
//
// Selection lives in the root the content was rendered into. Lit components
// render into their own shadow root by default, and `document.getSelection()`
// does not reliably resolve ranges inside a shadow root in every browser, so
// callers must pass `getRootSelection(this.shadowRoot)` rather than calling
// `window.getSelection()` directly.
'use strict';

export function getRootSelection(root) {
  if (root && typeof root.getSelection === 'function') return root.getSelection();
  return window.getSelection();
}

export function captureParts(container, attr, root) {
  const sel = getRootSelection(root || container.getRootNode());
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (r.collapsed) return null;
  if (!container.contains(r.commonAncestorContainer)) return null;
  const parts = [];
  container.querySelectorAll('[' + attr + ']').forEach((be) => {
    let hit = false;
    try { hit = r.intersectsNode(be); } catch (err) { hit = false; }
    if (!hit) return;
    const ir = document.createRange();
    ir.selectNodeContents(be);
    if (be.contains(r.startContainer)) ir.setStart(r.startContainer, r.startOffset);
    if (be.contains(r.endContainer)) ir.setEnd(r.endContainer, r.endOffset);
    const q = ir.toString();
    if (!q.trim()) return;
    const pr = document.createRange();
    pr.selectNodeContents(be);
    pr.setEnd(ir.startContainer, ir.startOffset);
    parts.push({ q, b: parseInt(be.getAttribute(attr), 10), s: pr.toString().length });
  });
  return parts.length ? parts : null;
}
