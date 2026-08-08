// Covers the written-versus-planned split that the timeline draws, and the
// hard-rule-3 property that makes it worth having: an outline that has been
// laid out but not written must never be reported as running time, and must
// never be counted as written.
'use strict';

import { describe, it, expect } from 'vitest';
import { parseFountain } from './parse.js';
import { scenesOf, sectionsOf } from './blocks.js';
import { scriptProgress, timelineStats } from '../state/selectors.js';

const scenesFor = (src) => scenesOf(parseFountain(src));

describe('scenesOf: scripted vs planned', () => {
  it('marks a scene with written content as scripted', () => {
    const scenes = scenesFor('INT. KITCHEN - DAY\n\nShe pours the coffee.\n');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].scripted).toBe(true);
    expect(scenes[0].secs).toBeGreaterThan(0);
  });

  it('marks a bare scene heading as not scripted, with no invented runtime', () => {
    const scenes = scenesFor('INT. KITCHEN - DAY\n\nINT. HALLWAY - NIGHT\n\nHe waits.\n');
    const [kitchen, hallway] = scenes;
    expect(kitchen.scripted).toBe(false);
    expect(kitchen.secs).toBe(0); // used to be a flat 2 seconds, which inflated the estimate
    expect(hallway.scripted).toBe(true);
  });

  it('treats a synopsis as outline, not as script', () => {
    // `=` is a synopsis: a note about what the scene will be, not the scene.
    const scenes = scenesFor('INT. KITCHEN - DAY\n\n= She finally tells him.\n');
    expect(scenes[0].scripted).toBe(false);
    expect(scenes[0].secs).toBe(0);
  });
});

describe('scriptProgress', () => {
  it('reports the written/planned split by scene count', () => {
    const scenes = scenesFor(
      'INT. A - DAY\n\nSomething happens.\n\nINT. B - DAY\n\nINT. C - DAY\n\nMore happens.\n',
    );
    const p = scriptProgress(scenes);
    expect(p.scenes).toBe(3);
    expect(p.scripted).toBe(2);
    expect(p.planned).toBe(1);
    expect(p.pctScripted).toBe(67);
  });

  // The reason this is counted rather than weighted by seconds: an unwritten
  // scene contributes 0 seconds, so a seconds-weighted percentage divides the
  // written time by the written time and calls every draft finished.
  it('does not report a half-written script as fully written', () => {
    const scenes = scenesFor('INT. A - DAY\n\nWritten.\n\nINT. B - DAY\n\nINT. C - DAY\n');
    const p = scriptProgress(scenes);
    expect(p.pctScripted).toBe(33);
    expect(p.pctScripted).not.toBe(100);
  });
});

describe('timelineStats with unwritten scenes', () => {
  it('estimates running time from written scenes only', () => {
    const written = parseFountain('INT. A - DAY\n\nShe pours the coffee slowly and waits.\n');
    const withPlan = parseFountain(
      'INT. A - DAY\n\nShe pours the coffee slowly and waits.\n\nINT. B - DAY\n\nINT. C - DAY\n',
    );
    const a = timelineStats(scenesOf(written), written.blocks.length);
    const b = timelineStats(scenesOf(withPlan), withPlan.blocks.length);
    // Adding two empty headings plans more script; it does not add runtime.
    expect(b.totalSeconds).toBe(a.totalSeconds);
  });

  it('still reports unknown for an empty script', () => {
    const parsed = parseFountain('');
    const stats = timelineStats(scenesOf(parsed), parsed.blocks.length);
    expect(stats.hasContent).toBe(false);
    expect(stats.estimate).toBeNull();
  });
});

describe('sectionsOf', () => {
  it('reads Fountain sections as the outline structure, with depth', () => {
    const parsed = parseFountain(
      '# ACT ONE\n\nINT. A - DAY\n\nGo.\n\n## Sequence 2\n\nINT. B - DAY\n\nStop.\n\n# ACT TWO\n\nINT. C - DAY\n\nRun.\n',
    );
    const sections = sectionsOf(parsed);
    expect(sections.map((s) => s.name)).toEqual(['ACT ONE', 'Sequence 2', 'ACT TWO']);
    expect(sections.map((s) => s.level)).toEqual([1, 2, 1]);
  });

  it('gives each section a span that ends before the next one starts', () => {
    const parsed = parseFountain('# ACT ONE\n\nINT. A - DAY\n\nGo.\n\n# ACT TWO\n\nINT. B - DAY\n\nStop.\n');
    const [one, two] = sectionsOf(parsed);
    expect(one.end).toBeLessThan(two.start);
  });

  it('returns nothing for a script with no sections', () => {
    expect(sectionsOf(parseFountain('INT. A - DAY\n\nGo.\n'))).toEqual([]);
  });
});
