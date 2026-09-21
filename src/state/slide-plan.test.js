// The preview deck (slidePlan): one slide per linked storyboard, plus one per
// stretch of script that sits BETWEEN two linked passages and belongs to
// neither. Built with the real parser and resolver so the block and anchor
// shapes are the real ones, not fixtures that could drift from them.
'use strict';

import { describe, it, expect } from 'vitest';
import { parseFountain } from '../fountain/parse.js';
import { scenesOf } from '../fountain/blocks.js';
import { computeResolved, slidePlan, UNLINKED_SLIDE_CHARS } from './selectors.js';

// A board anchored to the first occurrence of `q` in the script.
function board(id, q, seq = 0) {
  return { id, seq, img: null, refImg: null, anchor: { parts: [{ q, b: 0, s: 0 }] } };
}

function plan(text, boards) {
  const parsed = parseFountain(text);
  const scenes = scenesOf(parsed);
  const R = computeResolved(parsed, scenes, { boards, links: [], comments: [] }, {});
  return slidePlan(parsed.blocks, scenes, R.boards);
}

const shape = (p) => p.map((it) => (it.type === 'board' ? 'B:' + it.o.bd.id : 'U:' + it.lines.map((l) => l.text).join(' | ')));

const SCRIPT = [
  'INT. KITCHEN - DAY',
  '',
  'Ana pours coffee.',
  '',
  'She stares at the window.',
  '',
  'The kettle whistles.',
  '',
  'EXT. STREET - NIGHT',
  '',
  'Rain falls on the road.',
  '',
].join('\n');

describe('slidePlan', () => {
  it('plays the script between two linked passages as an unlinked slide', () => {
    const p = plan(SCRIPT, [board('a', 'Ana pours coffee.'), board('b', 'The kettle whistles.')]);
    // The street scene after the last link is a whole scene, so it follows as
    // its own trailing slide (see the edge cases below).
    expect(shape(p)).toEqual(['B:a', 'U:She stares at the window.', 'B:b', 'U:Rain falls on the road.']);
  });

  it('reads the rest of a scene, a whole scene and the top of the next as one run', () => {
    const p = plan(SCRIPT, [board('a', 'Ana pours coffee.'), board('b', 'Rain falls on the road.')]);
    expect(shape(p)).toEqual([
      'B:a',
      'U:She stares at the window. | The kettle whistles. | EXT. STREET - NIGHT',
      'B:b',
    ]);
  });

  it('cuts at the words: unlinked words between two linked ends of one line', () => {
    const p = plan('Ana walks slowly to the old door.\n', [board('a', 'Ana walks'), board('b', 'old door.')]);
    expect(shape(p)).toEqual(['B:a', 'U:slowly to the', 'B:b']);
    const gap = p[1].lines[0];
    // The line records exactly where it came from, so an edit made in the show
    // splices back into the right place.
    expect('Ana walks slowly to the old door.'.slice(gap.s, gap.e)).toBe('slowly to the');
  });

  it('does not play a fragment with no words in it', () => {
    const p = plan('Hello, world.\n', [board('a', 'Hello'), board('b', 'world')]);
    expect(shape(p)).toEqual(['B:a', 'B:b']);
  });

  it('does not play whitespace between two linked passages', () => {
    const p = plan('One two.\n', [board('a', 'One'), board('b', 'two.')]);
    expect(shape(p)).toEqual(['B:a', 'B:b']);
  });

  it('treats two storyboards on one passage as one linked stretch', () => {
    const p = plan(SCRIPT, [board('a', 'Ana pours coffee.', 0), board('a2', 'Ana pours coffee.', 1), board('b', 'The kettle whistles.')]);
    expect(shape(p)).toEqual(['B:a', 'B:a2', 'U:She stares at the window.', 'B:b', 'U:Rain falls on the road.']);
  });

  it('plays whole scenes before the first link and after the last as one slide each', () => {
    const p = plan(SCRIPT, [board('a', 'She stares at the window.')]);
    // The scene that carries the only link contributes only what it links; the
    // scene after it is a whole-scene digest, folded into one slide.
    expect(shape(p)).toEqual(['B:a', 'U:Rain falls on the road.']);
  });

  it('plays the whole script as one slide when nothing is linked', () => {
    const p = plan(SCRIPT, []);
    expect(p).toHaveLength(1);
    expect(p[0].type).toBe('unlinked');
    expect(p[0].lines.map((l) => l.text)).toContain('Rain falls on the road.');
  });

  it('ignores a storyboard whose passage no longer resolves', () => {
    const p = plan(SCRIPT, [board('a', 'Ana pours coffee.'), board('lost', 'a line that was deleted')]);
    expect(shape(p).filter((x) => x.startsWith('B:'))).toEqual(['B:a']);
  });

  it('deals a long unlinked stretch across several slides and drops nothing', () => {
    const paras = Array.from({ length: 8 }, (_, i) => 'Line ' + i + ' ' + 'x'.repeat(200) + '.').join('\n\n');
    const text = 'Start here.\n\n' + paras + '\n\nEnd here.\n';
    const p = plan(text, [board('a', 'Start here.'), board('b', 'End here.')]);
    const unlinked = p.filter((it) => it.type === 'unlinked');
    expect(unlinked.length).toBeGreaterThan(1);
    unlinked.forEach((u) => {
      const n = u.lines.reduce((t, l) => t + l.text.length, 0);
      // A single block may exceed the cap on its own; several never pile past it.
      expect(u.lines.length === 1 || n <= UNLINKED_SLIDE_CHARS + 210).toBe(true);
    });
    const played = unlinked.flatMap((u) => u.lines.map((l) => l.text));
    for (let i = 0; i < 8; i++) expect(played.some((t) => t.startsWith('Line ' + i + ' '))).toBe(true);
    // In script order: the first board, every unlinked slide, the last board.
    expect(p[0].type).toBe('board');
    expect(p[p.length - 1].type).toBe('board');
  });
});
