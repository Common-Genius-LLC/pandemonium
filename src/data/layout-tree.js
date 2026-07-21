// Blender-style window division as a binary split tree (the react-mosaic model,
// itself the IDE/Blender tiling pattern). A node is either:
//   leaf:  { id, type:'leaf', content:'script'|'boards'|'research' }
//   split: { id, type:'split', dir:'row'|'col', ratio, a, b }
// 'row' splits left|right (a is left), 'col' splits top|bottom (a is top);
// `ratio` is a's fraction of the split. All helpers are pure and return a new
// tree, so the layout lives in transient ui state and reduces like everything
// else. No DOM here.
'use strict';

import { uid, clamp } from '../utils/format.js';

export function leaf(content) { return { id: uid(), type: 'leaf', content }; }

// Default arrangement mirrors the old "everything" view so nothing feels lost:
// boards | script across the top, research along the bottom.
export function defaultLayout() {
  return {
    id: uid(), type: 'split', dir: 'col', ratio: 0.68,
    a: { id: uid(), type: 'split', dir: 'row', ratio: 0.42, a: leaf('boards'), b: leaf('script') },
    b: leaf('research'),
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

// Remove a leaf: its parent split collapses to the sibling. Removing the only
// pane is a no-op (caller guards with leafCount > 1).
export function closeLeaf(node, id) {
  if (node.type === 'leaf') return node;
  if (node.a.type === 'leaf' && node.a.id === id) return node.b;
  if (node.b.type === 'leaf' && node.b.id === id) return node.a;
  return { ...node, a: closeLeaf(node.a, id), b: closeLeaf(node.b, id) };
}
