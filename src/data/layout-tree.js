// Blender-style window division as a binary split tree (the react-mosaic model,
// itself the IDE/Blender tiling pattern). A node is either:
//   leaf:  { id, type:'leaf', content:'script'|'boards'|'research'|'timeline' }
//   split: { id, type:'split', dir:'row'|'col', ratio, a, b }
// 'row' splits left|right (a is left), 'col' splits top|bottom (a is top);
// `ratio` is a's fraction of the split. All helpers are pure and return a new
// tree, so the layout reduces like everything else. No DOM here.
//
// The tree lives in the PERSISTED project branch, not in transient ui state: a
// layout is part of how a particular project is being worked on (a research
// pass wants a wide research pane, a boarding pass does not), so it travels
// with the project file and syncs with the project to the account. Theme is the
// opposite case and stays per user in localStorage (see state/theme.js).
'use strict';

import { uid, clamp } from '../utils/format.js';

export const PANEL_TYPES = ['script', 'boards', 'research', 'timeline'];

export function leaf(content) { return { id: uid(), type: 'leaf', content }; }

// Default arrangement: boards | script across the top, research beneath them,
// and the timeline across the foot. The timeline used to be fixed chrome above
// the whole layout, which meant it could not be closed, moved, or given more
// room when it was the thing being read.
export function defaultLayout() {
  return {
    id: uid(), type: 'split', dir: 'col', ratio: 0.82,
    a: {
      id: uid(), type: 'split', dir: 'col', ratio: 0.68,
      a: { id: uid(), type: 'split', dir: 'row', ratio: 0.42, a: leaf('boards'), b: leaf('script') },
      b: leaf('research'),
    },
    b: leaf('timeline'),
  };
}

export function leafCount(node) {
  return node.type === 'leaf' ? 1 : leafCount(node.a) + leafCount(node.b);
}

export function setLeafContent(node, id, content) {
  if (node.type === 'leaf') return node.id === id ? { ...node, content } : node;
  return { ...node, a: setLeafContent(node.a, id, content), b: setLeafContent(node.b, id, content) };
}

export function setRatio(node, id, ratio) {
  if (node.type === 'leaf') return node;
  if (node.id === id) return { ...node, ratio: clamp(ratio, 0.12, 0.88) };
  return { ...node, a: setRatio(node.a, id, ratio), b: setRatio(node.b, id, ratio) };
}

// Replace a leaf with a split of itself plus a new pane (same content, like
// Blender duplicating the area; change it from the new pane's dropdown).
export function splitLeaf(node, id, dir) {
  if (node.type === 'leaf') {
    if (node.id !== id) return node;
    return { id: uid(), type: 'split', dir, ratio: 0.5, a: node, b: leaf(node.content) };
  }
  return { ...node, a: splitLeaf(node.a, id, dir), b: splitLeaf(node.b, id, dir) };
}

// Split at the ratio the gesture actually released at, with the new pane on
// whichever side the corner was dragged from. `before` puts the new pane in the
// `a` slot, which is what dragging a left or top corner means: the pane you
// pulled off the corner appears where you pulled it from.
export function splitLeafAt(node, id, dir, ratio, before) {
  if (node.type === 'leaf') {
    if (node.id !== id) return node;
    const fresh = leaf(node.content);
    const r = clamp(before ? ratio : 1 - ratio, 0.12, 0.88);
    return {
      id: uid(), type: 'split', dir, ratio: r,
      a: before ? fresh : node,
      b: before ? node : fresh,
    };
  }
  return { ...node, a: splitLeafAt(node.a, id, dir, ratio, before), b: splitLeafAt(node.b, id, dir, ratio, before) };
}

// Remove a leaf: its parent split collapses to the sibling. Removing the only
// pane is a no-op (caller guards with leafCount > 1).
export function closeLeaf(node, id) {
  if (node.type === 'leaf') return node;
  if (node.a.type === 'leaf' && node.a.id === id) return node.b;
  if (node.b.type === 'leaf' && node.b.id === id) return node.a;
  return { ...node, a: closeLeaf(node.a, id), b: closeLeaf(node.b, id) };
}

export function subtreeContains(node, id) {
  if (node.type === 'leaf') return node.id === id;
  return subtreeContains(node.a, id) || subtreeContains(node.b, id);
}

export function parentOf(node, id, parent = null) {
  if (node.type === 'leaf') return node.id === id ? parent : null;
  return parentOf(node.a, id, node) || parentOf(node.b, id, node);
}

// The subtree on the far side of a pane's own divider, or null when it is the
// only pane. This is the region a corner dragged outward will consume, and it
// is also the whole of what a corner can reach: in the tree, the area across a
// given divider IS the sibling subtree, so restricting merge to it excludes
// nothing a corner drag could have meant.
export function siblingSubtree(root, id) {
  const p = parentOf(root, id);
  if (!p) return null;
  return subtreeContains(p.a, id) ? p.b : p.a;
}

// Merge: the pane the gesture started in swallows everything across its own
// divider. Its parent split is replaced by the pane itself. The same collapse
// closeLeaf performs, driven from the surviving side rather than the dying one,
// which is the direction a corner drag expresses.
export function absorbSibling(node, keepId) {
  if (node.type === 'leaf') return node;
  if (node.a.type === 'leaf' && node.a.id === keepId) return node.a;
  if (node.b.type === 'leaf' && node.b.id === keepId) return node.b;
  return { ...node, a: absorbSibling(node.a, keepId), b: absorbSibling(node.b, keepId) };
}
