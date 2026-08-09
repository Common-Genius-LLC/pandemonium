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

export const PANEL_TYPES = ['script', 'boards', 'research', 'timeline', 'status'];

// Shared with the panel header's switch-content dropdown (panel-picker.js) and
// the leaf's right-click menu (panel-layout.js), so the label for a given
// content type is spelled once.
export const PANEL_LABELS = { script: 'Script Editor', boards: 'Storyboards', research: 'Research', timeline: 'Timeline', status: 'Project Status' };

export function leaf(content) { return { id: uid(), type: 'leaf', content }; }

// Default arrangement: boards across the top, research beneath it, and the
// timeline across the foot. The script editor is not shown by default, it is
// one picker choice away from any pane. The timeline used to be fixed chrome
// above the whole layout, which meant it could not be closed, moved, or given
// more room when it was the thing being read.
export function defaultLayout() {
  return {
    id: uid(), type: 'split', dir: 'col', ratio: 0.82,
    a: {
      id: uid(), type: 'split', dir: 'col', ratio: 0.68,
      a: leaf('boards'),
      b: leaf('research'),
    },
    b: leaf('timeline'),
  };
}

export function leafCount(node) {
  return node.type === 'leaf' ? 1 : leafCount(node.a) + leafCount(node.b);
}

// Is any pane in the layout already showing `content`? Used to decide whether a
// panel needs to be opened (store.revealContent) rather than opened twice.
export function hasContent(node, content) {
  if (node.type === 'leaf') return node.content === content;
  return hasContent(node.a, content) || hasContent(node.b, content);
}

// The id of the first leaf in document order (the top-left pane), the anchor a
// newly revealed panel is split off from.
export function firstLeafId(node) {
  return node.type === 'leaf' ? node.id : firstLeafId(node.a);
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
//
// `content` overrides the new pane's content instead of copying the split
// leaf's own. This is what lets a corner drag target a *different*, neighboring
// leaf: the neighbor is the one being split (it shrinks), but the fresh pane
// carries the dragged pane's content, so growing pane A into neighbor B reads
// as "A's content took over part of B" rather than "B duplicated itself".
export function splitLeafAt(node, id, dir, ratio, before, content = null) {
  if (node.type === 'leaf') {
    if (node.id !== id) return node;
    const fresh = leaf(content != null ? content : node.content);
    const r = clamp(before ? ratio : 1 - ratio, 0.12, 0.88);
    return {
      id: uid(), type: 'split', dir, ratio: r,
      a: before ? fresh : node,
      b: before ? node : fresh,
    };
  }
  return { ...node, a: splitLeafAt(node.a, id, dir, ratio, before, content), b: splitLeafAt(node.b, id, dir, ratio, before, content) };
}

// Remove a leaf: its parent split collapses to the sibling. Removing the only
// pane is a no-op (caller guards with leafCount > 1).
export function closeLeaf(node, id) {
  if (node.type === 'leaf') return node;
  if (node.a.type === 'leaf' && node.a.id === id) return node.b;
  if (node.b.type === 'leaf' && node.b.id === id) return node.a;
  return { ...node, a: closeLeaf(node.a, id), b: closeLeaf(node.b, id) };
}

// The chain of nodes from the root to the node with `id`, inclusive, or null
// if `id` isn't in the tree. Lets a caller walk outward from a leaf toward the
// root once, with each step's parent already at hand, instead of repeated
// top-down searches for the same walk.
export function pathTo(node, id) {
  if (node.type === 'leaf') return node.id === id ? [node] : null;
  const viaA = pathTo(node.a, id);
  if (viaA) return [node, ...viaA];
  const viaB = pathTo(node.b, id);
  if (viaB) return [node, ...viaB];
  return null;
}

// Collapse the split node `ancestorId` down to just its `keepSide` branch
// ('a' or 'b'), discarding the other branch and everything in it. This is
// closeLeaf's own collapse-to-the-surviving-branch move, generalized from "the
// dying branch is always one specific leaf" to "the dying branch is whatever
// subtree sits on the far side of however far up the tree a corner drag
// reached". Critically, it only ever touches the subtree rooted at
// `ancestorId`: everything on the kept side is returned untouched, so a merge
// several levels up the tree can never delete panes that live on the dragged
// pane's own side of that ancestor. For `ancestorId` equal to a leaf's
// immediate parent, this is exactly what the old single-level absorbSibling
// did.
export function absorbAcross(node, ancestorId, keepSide) {
  if (node.type === 'leaf') return node;
  if (node.id === ancestorId) return keepSide === 'a' ? node.a : node.b;
  return { ...node, a: absorbAcross(node.a, ancestorId, keepSide), b: absorbAcross(node.b, ancestorId, keepSide) };
}

// Extend a leaf into a band that spans an ancestor. Unlike absorbAcross (which
// deletes the far side to make the dragged pane fill the whole ancestor), this
// keeps the far side and reshapes the ancestor so the dragged pane becomes a
// strip across it: dragging the bottom-left pane rightward past the column
// divider turns the ancestor into `col(<everything else>, thisPane)`, a new
// full-width row along the bottom, rather than swallowing the neighbor.
//
// It is only meaningful when the dragged pane is *smaller* than the ancestor
// along the band's axis (otherwise the pane already spans it and a plain absorb
// is the right move); the caller decides which of the two applies. Because the
// pane is smaller, it always has a sibling stack on its own side, so removing it
// first (closeLeaf) can only collapse its immediate parent, never the ancestor
// being re-wrapped -- the ancestor is guaranteed to survive the removal.
//
// `bandDir` is the new split's direction (perpendicular to the drag), `before`
// puts the pane on the a-side (top/left) of that band, and `frac` is the pane's
// own fraction of the ancestor along the band axis, so the strip lands at the
// size the pane already had.
export function growAcross(tree, leafId, ancestorId, bandDir, before, frac) {
  const path = pathTo(tree, leafId);
  if (!path) return tree;
  const leafNode = path[path.length - 1];
  const rest = closeLeaf(tree, leafId);
  const ratio = clamp(before ? frac : 1 - frac, 0.12, 0.88);
  const wrap = (sub) => ({
    id: uid(), type: 'split', dir: bandDir, ratio,
    a: before ? leafNode : sub,
    b: before ? sub : leafNode,
  });
  return mapNode(rest, ancestorId, wrap);
}

// Replace the node with `id` by the result of `fn(node)`, leaving the rest of
// the tree untouched. Internal helper for growAcross.
function mapNode(node, id, fn) {
  if (node.id === id) return fn(node);
  if (node.type === 'leaf') return node;
  return { ...node, a: mapNode(node.a, id, fn), b: mapNode(node.b, id, fn) };
}
