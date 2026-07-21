// The bug these guard against: the editor showed one element while the file
// meant another. Enter used to insert a bare newline, so the line under a
// speech was still inside that speech as far as parseFountain was concerned --
// it looked like an action line until you typed, then snapped back to centred
// dialogue. So every assertion here is "type this the way the editor says
// you can, then check what the PARSER makes of the resulting file".
//
// The stress suites at the bottom run that check over EVERY element in the
// picker, rather than the handful that used to be spot-checked.
'use strict';

import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { parseFountain } from '../../fountain/parse.js';
import { enterPlan, elementSeparator, nextInCycle, backspacePlan, caretElementFor } from './cm-autoformat.js';
import {
  applyElement, applyElementTo, isBareMarkup, elementOfBlock,
  ELEMENT_SHORTCUTS, ELEMENT_MENU, ELEMENT_LABELS,
} from '../../fountain/element-ops.js';

// Types the parser assigns, line by line, with nulls for blank lines.
function typesByLine(src) {
  const parsed = parseFountain(src);
  const out = new Array(src.split('\n').length).fill(null);
  for (const b of parsed.blocks) if (b.line != null) out[b.line] = b.type;
  return out;
}

// One Enter at the end of the document, in the element `cur`, then the text
// you type next. Mirrors what smartEnter dispatches, seed included.
function pressEnterThenType(src, cur, typed) {
  const doc = Text.of(src.split('\n'));
  const at = doc.length;
  const { insert, el, caret } = enterPlan(doc, { from: at, to: at }, cur);
  const after = src + insert;
  return { src: after.slice(0, at + caret) + typed + after.slice(at + caret), el };
}

// What the editor would REPORT for the last line of `src`, with `pin` pinned
// to it. This is the picker's label, and the thing that must never lie.
function reportedElement(src, pin) {
  const doc = Text.of(src.split('\n'));
  return caretElementFor(doc, parseFountain(src), doc.lines - 1, pin || null);
}

describe('enterPlan', () => {
  it('ends a speech so the next line is really action, not more dialogue', () => {
    const { src, el } = pressEnterThenType('INT. KITCHEN - DAY\n\nJANE\nI am going.', 'dialogue', 'She leaves.');
    expect(el).toBe('action');
    expect(typesByLine(src)).toEqual(['scene', null, 'character', 'dialogue', null, 'action']);
  });

  it('keeps a cue and its speech contiguous', () => {
    const { src, el } = pressEnterThenType('INT. KITCHEN - DAY\n\nJANE', 'character', 'I am going.');
    expect(el).toBe('dialogue');
    expect(typesByLine(src)).toEqual(['scene', null, 'character', 'dialogue']);
  });

  it('keeps a parenthetical inside the speech', () => {
    const { src, el } = pressEnterThenType('JANE\n(quietly)', 'paren', 'I am going.');
    expect(el).toBe('dialogue');
    expect(typesByLine(src)).toEqual(['character', 'paren', 'dialogue']);
  });

  it('lets a transition typed after a speech be a transition', () => {
    const after = pressEnterThenType('JANE\nI am going.', 'dialogue', 'CUT TO:');
    expect(typesByLine(after.src)).toEqual(['character', 'dialogue', null, 'transition']);
  });

  it('separates action paragraphs so the next one can become a cue', () => {
    const { src } = pressEnterThenType('The door slams.', 'action', 'JANE');
    // JANE is only a cue once its dialogue exists; until then it is action,
    // but crucially it is its OWN block, not part of the paragraph above.
    expect(typesByLine(src)).toEqual(['action', null, 'action']);
    expect(typesByLine(src + '\nI am going.')).toEqual(['action', null, 'character', 'dialogue']);
  });

  it('is a plain newline mid-line and on a blank line', () => {
    const doc = Text.of(['I am going.', '']);
    expect(enterPlan(doc, { from: 4, to: 4 }, 'dialogue').insert).toBe('\n');
    expect(enterPlan(doc, { from: doc.length, to: doc.length }, 'action').insert).toBe('\n');
  });

  it('seeds the next element so a run of lyrics stays lyrics', () => {
    const { src, el } = pressEnterThenType('~One more river', 'lyric', 'one more mile');
    expect(el).toBe('lyric');
    expect(typesByLine(src)).toEqual(['lyric', 'lyric']);
  });

  it('seeds the scene heading Enter promises after a transition', () => {
    const { src } = pressEnterThenType('> CUT TO:', 'transition', 'KITCHEN');
    expect(typesByLine(src)).toEqual(['transition', null, 'scene']);
  });
});

describe('Tab cycle on an empty line', () => {
  it('goes action, character, transition, scene, action', () => {
    const seen = [];
    let el = 'action';
    for (let i = 0; i < 4; i++) { el = nextInCycle(el, 1); seen.push(el); }
    expect(seen).toEqual(['character', 'transition', 'scene', 'action']);
  });

  it('never offers dialogue or parenthetical, which need a cue above them', () => {
    const reachable = new Set();
    let el = 'action';
    for (let i = 0; i < 8; i++) { el = nextInCycle(el, 1); reachable.add(el); }
    expect(reachable.has('dialogue')).toBe(false);
    expect(reachable.has('paren')).toBe(false);
  });

  it('leaves the line empty again after a full lap', () => {
    // Each step rewrites the line, so the markup one element seeds ('.', '> ')
    // has to be stripped by the next. A lap that ended on "!." or "> " would
    // mean tabbing past scene heading quietly left junk in the script.
    let text = '';
    for (const el of ['character', 'transition', 'scene', 'action']) text = applyElement(text, el);
    expect(text).toBe('');
  });
});

describe('element menu vocabulary', () => {
  it('has a unique shortcut per row and writes real Fountain for all of them', () => {
    const keys = ELEMENT_SHORTCUTS.map((it) => it.k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const it of ELEMENT_SHORTCUTS) {
      // Every row must produce markup the parser reads back as something, and
      // must say which construct it writes: no row may imply an element the
      // Fountain source cannot hold.
      expect(it.writes).toBeTruthy();
      expect(applyElement('Some text', it.el)).not.toBe('');
    }
  });

  it('only names elements the picker knows how to label', () => {
    for (const it of ELEMENT_SHORTCUTS) expect(ELEMENT_LABELS[it.el]).toBeTruthy();
  });
});

describe('elementSeparator', () => {
  const docOf = (lines) => Text.of(lines);

  it('breaks a line out of a dialogue run before applying a non-speech element', () => {
    const doc = docOf(['JANE', 'I am going.', 'CUT TO:']);
    expect(elementSeparator(doc, doc.line(3), 'transition')).toBe('\n');
    expect(elementSeparator(doc, doc.line(2), 'dialogue')).toBe('');
    expect(elementSeparator(doc, doc.line(2), 'paren')).toBe('');
  });

  it('gives a character cue the blank line it needs to be recognised', () => {
    const doc = docOf(['The door slams.', 'JANE']);
    expect(elementSeparator(doc, doc.line(2), 'character')).toBe('\n');
  });

  it('adds nothing where the line is already separated', () => {
    const doc = docOf(['The door slams.', '', 'JANE']);
    expect(elementSeparator(doc, doc.line(3), 'character')).toBe('');
    expect(elementSeparator(doc, doc.line(1), 'scene')).toBe('');
  });

  it('leaves ordinary action paragraphs alone', () => {
    const doc = docOf(['The door slams.', 'She waits.']);
    expect(elementSeparator(doc, doc.line(2), 'action')).toBe('');
  });
});

// ---- stress: every element in the picker, end to end ----

// Applying an element then typing has to leave the file saying that element.
// The two exceptions are stated, not assumed: a character cue is not a cue
// until dialogue follows it, and dialogue/parenthetical do not exist outside a
// cue's run, so both are exercised in the context they actually live in.
const TYPED = {
  scene: 'kitchen - day',
  action: 'She opens the door.',
  character: 'jane',
  dialogue: 'I am going.',
  paren: 'quietly',
  transition: 'cut to:',
  centered: 'THE END',
  lyric: 'one more river to cross',
  section: 'Act One',
  section2: 'Sequence Two',
  section3: 'Beat Three',
  synopsis: 'She finally leaves.',
  note: 'check this against the interview',
};

// The document each element is applied inside, and the line it goes on.
// `head` is what precedes the line being typed on.
function contextFor(key) {
  if (key === 'dialogue' || key === 'paren') return ['INT. KITCHEN - DAY', '', 'JANE'];
  return ['INT. KITCHEN - DAY', ''];
}

describe('every element in the picker', () => {
  for (const key of ELEMENT_MENU) {
    it(`writes a real ${ELEMENT_LABELS[key]} and reports it as one`, () => {
      const head = contextFor(key);
      // Seed the empty line the way setLine does, then type into the caret
      // position the seed asks for.
      const seed = applyElementTo('', key);
      const typed = TYPED[key];
      const lineText = seed.text.slice(0, seed.caret) + typed + seed.text.slice(seed.caret);
      // Upper-casing is what the editor's transactionFilter does while you
      // type in these three; applying it here keeps the test on the real path.
      const finalText = ['scene', 'character', 'transition'].includes(key) ? lineText.toUpperCase() : lineText;
      const lines = [...head, finalText];
      // A cue only becomes one when a speech follows.
      if (key === 'character') lines.push('I am going.');
      const src = lines.join('\n');

      const parsed = parseFountain(src);
      const lineNo = head.length; // 0-based index of the line we typed on
      const block = parsed.blocks.find((b) => b.line === lineNo);
      expect(block, `no block parsed on line ${lineNo} of:\n${src}`).toBeTruthy();
      expect(elementOfBlock(block)).toBe(key);
      // And the text survived: nothing swallowed by the markup.
      expect(block.plain.toLowerCase()).toContain(typed.toLowerCase().replace(/:$/, ''));
    });
  }
});

describe('an empty seeded line already reads as its element', () => {
  // Before you type a single character. This is what makes pinning honest:
  // the picker's label is backed by the file from the moment you choose it.
  const PARSER_CANNOT_JUDGE = new Set(['scene', 'action', 'character', 'dialogue']);
  for (const key of ELEMENT_MENU) {
    if (PARSER_CANNOT_JUDGE.has(key)) continue;
    it(`${ELEMENT_LABELS[key]} seeds markup the parser recognises`, () => {
      const head = contextFor(key);
      const src = [...head, applyElementTo('', key).text].join('\n');
      const block = parseFountain(src).blocks.find((b) => b.line === head.length);
      expect(elementOfBlock(block)).toBe(key);
    });
  }
});

describe('the picker never reports an element the file does not contain', () => {
  it('drops a pin the parser contradicts once the line has text', () => {
    // Pinning Lyric and then typing a plain line used to keep saying "Lyric"
    // while the file said action. Now the file wins.
    expect(reportedElement('INT. KITCHEN - DAY\n\nShe leaves.', 'lyric')).toBe('action');
    expect(reportedElement('INT. KITCHEN - DAY\n\n~She leaves.', 'lyric')).toBe('lyric');
  });

  it('keeps the pin on an empty line, where there is nothing to contradict', () => {
    expect(reportedElement('INT. KITCHEN - DAY\n\n', 'lyric')).toBe('lyric');
  });

  it('keeps the pin for the two elements the parser cannot judge alone', () => {
    // A cue with no speech under it yet, and a bare forced-scene dot.
    expect(reportedElement('The door slams.\n\nJANE', 'character')).toBe('character');
    expect(reportedElement('The door slams.\n\n.', 'scene')).toBe('scene');
  });

  it('reports section depth and whole-line notes accurately', () => {
    expect(reportedElement('## Sequence Two', null)).toBe('section2');
    expect(reportedElement('### Beat Three', null)).toBe('section3');
    expect(reportedElement('[[ check this ]]', null)).toBe('note');
  });
});

describe('caret placement inside paired markup', () => {
  it('puts the caret between the delimiters, not past them', () => {
    for (const key of ['paren', 'centered', 'note']) {
      const { text, caret } = applyElementTo('', key);
      expect(caret, key).toBeLessThan(text.length);
      // Typing at that caret has to produce the element, not break it. A
      // parenthetical only exists inside a cue's run, so it gets one.
      const typed = text.slice(0, caret) + 'x' + text.slice(caret);
      const head = key === 'paren' ? ['JANE'] : [];
      const src = [...head, typed].join('\n');
      const block = parseFountain(src).blocks.find((b) => b.line === head.length);
      expect(elementOfBlock(block), key).toBe(key);
    }
  });

  it('keeps existing text inside the delimiters when converting a line', () => {
    expect(applyElementTo('quietly', 'paren')).toEqual({ text: '(quietly)', caret: 8 });
    expect(applyElementTo('THE END', 'centered')).toEqual({ text: '> THE END <', caret: 9 });
  });
});

describe('backspace', () => {
  const at = (lines, line, col) => {
    const doc = Text.of(lines);
    const pos = doc.line(line).from + col;
    return { doc, sel: { from: pos, to: pos } };
  };

  it('clears a whole seed rather than breaking its markup', () => {
    for (const key of ELEMENT_MENU) {
      const seed = applyElementTo('', key).text;
      if (!seed) continue;
      expect(isBareMarkup(seed), `${key} seed ${JSON.stringify(seed)}`).toBe(true);
      const { doc, sel } = at(['JANE', '', seed], 3, applyElementTo('', key).caret);
      const plan = backspacePlan(doc, sel);
      expect(plan, key).toBeTruthy();
      expect(doc.sliceString(0, plan.from) + doc.sliceString(plan.to)).toBe('JANE\n\n');
    }
  });

  it('takes back the blank line Enter inserted, in one press', () => {
    const { doc, sel } = at(['She leaves.', '', ''], 3, 0);
    const plan = backspacePlan(doc, sel);
    expect(plan).toBeTruthy();
    expect(doc.sliceString(0, plan.from) + doc.sliceString(plan.to)).toBe('She leaves.');
    expect(plan.caret).toBe('She leaves.'.length);
  });

  it('leaves ordinary deletion alone', () => {
    // Mid-word, and at the start of a line with real content above it.
    const mid = at(['She leaves.'], 1, 5);
    expect(backspacePlan(mid.doc, mid.sel)).toBe(null);
    const joinUp = at(['JANE', 'I am going.'], 2, 0);
    expect(backspacePlan(joinUp.doc, joinUp.sel)).toBe(null);
  });

  it('does not fire on a selection', () => {
    const doc = Text.of(['(quietly)']);
    expect(backspacePlan(doc, { from: 0, to: 3 })).toBe(null);
  });
});

describe('a whole scene typed the way the editor drives it', () => {
  // Scene heading, action, cue, parenthetical, speech, action, transition:
  // the ordinary spine of a page, assembled only from what Enter produces.
  it('parses as the screenplay the writer saw', () => {
    let src = '.THE KITCHEN';
    let el = 'scene';
    const type = (text) => {
      const r = pressEnterThenType(src, el, text);
      src = r.src; el = r.el;
    };
    type('She opens the door.');      // scene -> action
    type('JANE');                     // action -> action (cue, once spoken)
    el = 'character';                 // the editor reads a written cue as one
    type('I am going.');              // character -> dialogue
    type('The door slams.');          // dialogue -> action
    expect(typesByLine(src)).toEqual([
      'scene', null, 'action', null, 'character', 'dialogue', null, 'action',
    ]);
  });
});
