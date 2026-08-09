// Locks the one bug that mattered in the corner-drag generalization: reaching
// several ancestors up the tree to merge with a non-sibling neighbor must only
// ever remove the far side being merged away, never anything on the dragged
// leaf's own side that happens to share that ancestor. An earlier draft of
// absorbAcross replaced the whole crossed ancestor with just the dragged leaf,
// which silently deleted unrelated panes; see panel-layout.js's outwardPlan.
'use strict';

import { describe, it, expect } from 'vitest';
import { defaultLayout, leaf, absorbAcross, growAcross, pathTo, splitLeafAt } from './layout-tree.js';

function collectContents(node) {
  return node.type === 'leaf' ? [node.content] : [...collectContents(node.a), ...collectContents(node.b)];
}

function findLeaf(node, content) {
  if (node.type === 'leaf') return node.content === content ? node : null;
  return findLeaf(node.a, content) || findLeaf(node.b, content);
}

describe('absorbAcross', () => {
  // defaultLayout() = col(.82){ a: col(.68){ a: boards, b: research }, b: timeline }.
  // research's immediate sibling is boards, so the old single-level
  // absorbSibling could never reach timeline from research at all.
  // absorbAcross, walked to the root (their actual common ancestor), must
  // keep everything on the 'a' side intact and drop only 'b'.
  it('collapsing to the a side keeps every pane on that side and drops only the far side', () => {
    const root = defaultLayout();
    const collapsed = absorbAcross(root, root.id, 'a');
    expect(collectContents(collapsed).sort()).toEqual(['boards', 'research']);
    expect(findLeaf(collapsed, 'timeline')).toBeNull();
  });

  it('collapsing to the b side keeps only the far branch', () => {
    const root = defaultLayout();
    const collapsed = absorbAcross(root, root.id, 'b');
    expect(collectContents(collapsed)).toEqual(['timeline']);
  });
});

describe('growAcross', () => {
  // The reported bug: two columns, the left one split into two rows, the right
  // one a single full-height pane. Dragging the bottom-left pane rightward
  // should not swallow the whole right pane (absorbAcross would); it should
  // become a full-width row along the bottom, with the top now holding the
  // top-left and (shortened) right panes side by side.
  //   before: row( col(TL, BL), R )
  //   after:  col( row(TL, R), BL )
  function twoColOneTallRight() {
    const TL = leaf('script'), BL = leaf('boards'), R = leaf('research');
    const left = { id: 'left', type: 'split', dir: 'col', ratio: 0.5, a: TL, b: BL };
    const root = { id: 'root', type: 'split', dir: 'row', ratio: 0.5, a: left, b: R };
    return { root, TL, BL, R };
  }

  it('turns the dragged pane into a band spanning the ancestor, keeping the far side', () => {
    const { root, BL } = twoColOneTallRight();
    const out = growAcross(root, BL.id, 'root', 'col', false, 0.5);
    // Top is now a row of the two survivors; bottom is the dragged pane, full width.
    expect(out.dir).toBe('col');
    expect(out.b.type).toBe('leaf');
    expect(out.b.content).toBe('boards'); // the dragged pane
    expect(out.a.type).toBe('split');
    expect(out.a.dir).toBe('row');
    expect(collectContents(out.a).sort()).toEqual(['research', 'script']);
  });

  it('does not delete any pane (unlike absorbAcross)', () => {
    const { root, BL } = twoColOneTallRight();
    const out = growAcross(root, BL.id, 'root', 'col', false, 0.5);
    expect(collectContents(out).sort()).toEqual(['boards', 'research', 'script']);
  });
});

describe('pathTo', () => {
  it('returns the root-to-leaf chain, root first and the leaf last', () => {
    const root = defaultLayout();
    const researchLeaf = findLeaf(root, 'research');
    const path = pathTo(root, researchLeaf.id);
    expect(path[0]).toBe(root);
    expect(path[path.length - 1]).toBe(researchLeaf);
  });

  it('returns null for an id not in the tree', () => {
    expect(pathTo(defaultLayout(), 'nope')).toBeNull();
  });
});

describe('splitLeafAt content override', () => {
  it('defaults to the split leaf\'s own content when none is given (self-split, unchanged behavior)', () => {
    const single = leaf('script');
    const result = splitLeafAt(single, single.id, 'row', 0.3, true);
    expect(result.a.content).toBe('script');
    expect(result.b.content).toBe('script');
  });

  it('lets the fresh pane carry a different content, for splitting a neighboring leaf', () => {
    const single = leaf('research');
    const result = splitLeafAt(single, single.id, 'row', 0.3, true, 'boards');
    expect(result.a.content).toBe('boards'); // the fresh pane, carrying the dragged-from leaf's content
    expect(result.b.content).toBe('research'); // the split leaf itself, untouched
  });
});
