// Locks the research SOURCE model: one record that may carry media, a URL and
// notes at once, whose `kind` is derived from what it holds rather than chosen
// when it is created. The panel used to ask "note or link?" up front and then
// ignore the answer, so what is pinned here is that the answer is never asked
// for and never wrong afterwards.
'use strict';

import { describe, it, expect } from 'vitest';
import {
  researchKind, mediaKind, normalizeUrl, hostOf, docTitle, docSnippet,
  filterResearch, colorToken, NOTE_COLORS, docParas,
  parasToBody, setPara, splitPara, mergePara,
  normalizeLabel, addLabel, removeLabel, allLabels, hasLabel,
} from './research-doc.js';
import { addResearch, updateResearch, deleteResearch, addLink } from './project-model.js';

const empty = () => ({ research: [], links: [] });

describe('researchKind', () => {
  it('reads a bare URL as a link and the same record with notes as a note', () => {
    expect(researchKind({ url: 'https://a.com' })).toBe('link');
    expect(researchKind({ url: 'https://a.com', body: 'what it says' })).toBe('note');
  });
  it('reads anything carrying media as a file, whatever else it holds', () => {
    expect(researchKind({ attachment: { data: 'data:image/png;base64,x' } })).toBe('file');
    expect(researchKind({ url: 'https://a.com', body: 'notes', attachment: { data: 'x' } })).toBe('file');
  });
  it('counts a synced attachment (assetId, data stripped) as media too', () => {
    expect(researchKind({ attachment: { assetId: 'a1', name: 'x.png' } })).toBe('file');
  });
  it('treats an empty record, and no record at all, as a note', () => {
    expect(researchKind({})).toBe('note');
    expect(researchKind(null)).toBe('note');
  });
  it('ignores whitespace-only fields', () => {
    expect(researchKind({ url: '   ' })).toBe('note');
    expect(researchKind({ url: 'https://a.com', body: '  \n ' })).toBe('link');
  });
});

describe('mediaKind', () => {
  it('names the viewer an attachment needs', () => {
    expect(mediaKind({ mime: 'image/png' })).toBe('image');
    expect(mediaKind({ mime: 'video/mp4' })).toBe('video');
    expect(mediaKind({ mime: 'audio/mpeg' })).toBe('audio');
    expect(mediaKind({ mime: 'application/pdf' })).toBe('pdf');
  });
  it('falls back to a download for anything it cannot render', () => {
    expect(mediaKind({ mime: 'application/zip' })).toBe('file');
    expect(mediaKind({})).toBe('file');
    expect(mediaKind(null)).toBe('file');
  });
});

describe('normalizeUrl', () => {
  it('adds the scheme a pasted host arrives without', () => {
    expect(normalizeUrl('wikipedia.org')).toBe('https://wikipedia.org/');
    expect(normalizeUrl('  example.com/a/b  ')).toBe('https://example.com/a/b');
  });
  it('keeps an explicit http or https scheme', () => {
    expect(normalizeUrl('http://a.com/x')).toBe('http://a.com/x');
  });
  it('rejects anything that is not a web URL, so notes are not mistaken for links', () => {
    expect(normalizeUrl('She waits by the door.')).toBe('');
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('localhost')).toBe('');
    expect(normalizeUrl('')).toBe('');
  });
});

describe('hostOf / docTitle / docSnippet', () => {
  it('strips www from the host and survives junk', () => {
    expect(hostOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
    expect(hostOf('not a url')).toBe('');
  });
  it('falls back through file name, host, then the first line of the notes', () => {
    expect(docTitle({ title: 'Given' })).toBe('Given');
    expect(docTitle({ title: 'Untitled', attachment: { name: 'plate.png' } })).toBe('plate.png');
    expect(docTitle({ url: 'https://www.bbc.co.uk/news' })).toBe('bbc.co.uk');
    expect(docTitle({ body: 'Working memory\nsecond line' })).toBe('Working memory');
    expect(docTitle({})).toBe('Untitled');
  });
  it('never leaves a card blank', () => {
    expect(docSnippet({ body: 'the notes' })).toBe('the notes');
    expect(docSnippet({ url: 'https://a.com' })).toBe('https://a.com');
    expect(docSnippet({ attachment: { mime: 'image/png' } })).toBe('image/png');
  });
});

describe('colorToken', () => {
  it('maps a stored colour to its token and treats no colour as plain', () => {
    expect(colorToken('yellow')).toBe('var(--note-yellow)');
    expect(colorToken(null)).toBe('var(--note-plain)');
    expect(colorToken('nonsense')).toBe('var(--note-plain)');
  });
  it('offers plain plus five colours, plain stored as null', () => {
    expect(NOTE_COLORS).toHaveLength(6);
    expect(NOTE_COLORS[0].key).toBeNull();
  });
});

describe('filterResearch', () => {
  const docs = [
    { id: 'a', title: 'Baddeley 2003', body: 'working memory', url: '' },
    { id: 'b', title: 'Untitled', body: '', url: 'https://tate.org.uk/rothko' },
    { id: 'c', title: 'Untitled', body: '', attachment: { name: 'corridor-plate.png' } },
  ];
  it('matches every field a writer might have put the word in', () => {
    expect(filterResearch(docs, { query: 'baddeley' }).map((d) => d.id)).toEqual(['a']);
    expect(filterResearch(docs, { query: 'memory' }).map((d) => d.id)).toEqual(['a']);
    expect(filterResearch(docs, { query: 'rothko' }).map((d) => d.id)).toEqual(['b']);
    expect(filterResearch(docs, { query: 'corridor' }).map((d) => d.id)).toEqual(['c']);
  });
  it('ignores case and returns everything for an empty query', () => {
    expect(filterResearch(docs, { query: '  BADD ' }).map((d) => d.id)).toEqual(['a']);
    expect(filterResearch(docs, { query: '' })).toHaveLength(3);
    expect(filterResearch(docs, {})).toHaveLength(3);
  });
  it('shows only what is not yet linked to the script when asked', () => {
    const linked = new Set(['a']);
    expect(filterResearch(docs, { unlinkedOnly: true, linked }).map((d) => d.id)).toEqual(['b', 'c']);
  });
  it('combines the query with the unlinked filter', () => {
    const linked = new Set(['b']);
    expect(filterResearch(docs, { query: 'untitled', unlinkedOnly: true, linked }).map((d) => d.id)).toEqual(['c']);
  });
  it('survives a project with no research at all', () => {
    expect(filterResearch(undefined, { query: 'x' })).toEqual([]);
  });
});

describe('addResearch / updateResearch', () => {
  it('derives the kind rather than taking one from the caller', () => {
    const link = addResearch(empty(), { url: 'https://a.com' }).doc;
    expect(link.kind).toBe('link');
    const note = addResearch(empty(), { body: 'words' }).doc;
    expect(note.kind).toBe('note');
    const file = addResearch(empty(), { attachment: { name: 'a.png', mime: 'image/png', data: 'd' } }).doc;
    expect(file.kind).toBe('file');
  });
  it('re-derives the kind on every edit, so a link that gains notes is a note', () => {
    const made = addResearch(empty(), { url: 'https://a.com' });
    expect(made.doc.kind).toBe('link');
    const p = updateResearch(made.project, made.doc.id, { body: 'what it actually says' });
    expect(p.research[0].id).toBe(made.doc.id); // the same record, not a new one
    expect(p.research[0].kind).toBe('note');
    expect(p.research[0].url).toBe('https://a.com'); // the URL is kept, not traded away
  });
  it('lets a note gain media and become a file without losing its notes', () => {
    let p = addResearch(empty(), { body: 'what the plate shows' }).project;
    p = updateResearch(p, p.research[0].id, { attachment: { name: 'p.png', mime: 'image/png', data: 'd' } });
    expect(p.research[0].kind).toBe('file');
    expect(p.research[0].body).toBe('what the plate shows');
  });
  it('lets media be removed again, leaving the notes behind', () => {
    let p = addResearch(empty(), { attachment: { name: 'p.png', mime: 'image/png', data: 'd' }, body: 'notes' }).project;
    p = updateResearch(p, p.research[0].id, { attachment: null });
    expect(p.research[0].kind).toBe('note');
    expect(p.research[0].body).toBe('notes');
  });
  it('leaves an unnamed source with an empty title, not the word Untitled', () => {
    expect(addResearch(empty(), {}).doc.title).toBe('');
    expect(addResearch(empty(), { title: '  Baddeley  ' }).doc.title).toBe('Baddeley');
    // ...while a project saved before that still reads correctly.
    expect(docTitle({ title: 'Untitled', url: 'https://www.bbc.co.uk' })).toBe('bbc.co.uk');
  });
  it('starts every source uncoloured and takes a colour later', () => {
    let p = addResearch(empty(), { body: 'x' }).project;
    expect(p.research[0].color).toBeNull();
    p = updateResearch(p, p.research[0].id, { color: 'pink' });
    expect(p.research[0].color).toBe('pink');
  });
  it('touches no other source', () => {
    let p = addResearch(empty(), { body: 'one' }).project;
    p = addResearch(p, { body: 'two' }).project;
    const before = p.research[1];
    p = updateResearch(p, p.research[0].id, { title: 'changed' });
    expect(p.research[1]).toBe(before);
  });
  it('ignores an id that is not there', () => {
    const p = addResearch(empty(), { body: 'one' }).project;
    expect(updateResearch(p, 'missing', { title: 'x' }).research).toEqual(p.research);
  });
});

describe('deleteResearch', () => {
  it('takes the source and its links to the script with it', () => {
    let p = addResearch(empty(), { body: 'one' }).project;
    const id = p.research[0].id;
    p = addLink(p, { researchId: id, sParts: [{ q: 'She waits.', b: 0, s: 0 }] }).project;
    p = addResearch(p, { body: 'two' }).project;
    p = deleteResearch(p, id);
    expect(p.research).toHaveLength(1);
    expect(p.links).toHaveLength(0);
  });
});

// The reader edits notes one paragraph at a time, in place, so these three
// operations are what typing in a source actually does to the stored body.
describe('paragraph editing', () => {
  it('round-trips the paragraph list through the stored body', () => {
    const paras = ['first', 'second', 'third'];
    expect(docParas({ body: parasToBody(paras) })).toEqual(paras);
  });

  it('replaces one paragraph and leaves the rest alone', () => {
    expect(setPara(['a', 'b', 'c'], 1, 'B')).toEqual(['a', 'B', 'c']);
  });

  it('splits at the caret and puts the caret at the start of the new paragraph', () => {
    const out = splitPara(['hello world'], 0, 'hello world', 5);
    expect(out.paras).toEqual(['hello', ' world']);
    expect(out.caret).toEqual({ pi: 1, offset: 0 });
  });

  it('splits with the text as typed, which may differ from what was stored', () => {
    // The paragraph holds what has been typed since the last commit; that is
    // what has to be split, not the stale stored copy.
    const out = splitPara(['old'], 0, 'brand new', 5);
    expect(out.paras).toEqual(['brand', ' new']);
  });

  it('splits at either end without losing the paragraph', () => {
    expect(splitPara(['abc'], 0, 'abc', 0).paras).toEqual(['', 'abc']);
    expect(splitPara(['abc'], 0, 'abc', 3).paras).toEqual(['abc', '']);
    expect(splitPara(['abc'], 0, 'abc', 99).paras).toEqual(['abc', '']);
  });

  it('splits in the middle of a list', () => {
    const out = splitPara(['a', 'bc', 'd'], 1, 'bc', 1);
    expect(out.paras).toEqual(['a', 'b', 'c', 'd']);
    expect(out.caret).toEqual({ pi: 2, offset: 0 });
  });

  it('merges into the paragraph above, caret at the join', () => {
    const out = mergePara(['ab', 'cd'], 1, 'cd');
    expect(out.paras).toEqual(['abcd']);
    expect(out.caret).toEqual({ pi: 0, offset: 2 });
  });

  it('refuses to merge the first paragraph, which has nothing above it', () => {
    expect(mergePara(['ab'], 0, 'ab')).toBeNull();
  });

  it('undoes its own split', () => {
    const split = splitPara(['hello world'], 0, 'hello world', 5);
    const merged = mergePara(split.paras, 1, split.paras[1]);
    expect(merged.paras).toEqual(['hello world']);
    expect(merged.caret).toEqual({ pi: 0, offset: 5 });
  });

  it('expands a pasted multi-paragraph blob into paragraphs on the round trip', () => {
    // A blank line is what separates paragraphs, so pasting one in makes two.
    const body = parasToBody(setPara(['x'], 0, 'one\n\ntwo'));
    expect(docParas({ body })).toEqual(['one', 'two']);
  });
});

describe('labels', () => {
  it('collapses whitespace so two spellings of one topic are one topic', () => {
    expect(normalizeLabel('  the   fire ')).toBe('the fire');
    expect(normalizeLabel('')).toBe('');
    expect(normalizeLabel(null)).toBe('');
  });

  it('caps the length so a chip cannot become a paragraph', () => {
    expect(normalizeLabel('x'.repeat(200)).length).toBe(32);
  });

  it('adds a label and refuses a duplicate whatever its case', () => {
    expect(addLabel([], 'Costume')).toEqual(['Costume']);
    expect(addLabel(['Costume'], 'costume')).toEqual(['Costume']);
    expect(addLabel(['Costume'], '  COSTUME  ')).toEqual(['Costume']);
    expect(addLabel(['Costume'], 'Fire')).toEqual(['Costume', 'Fire']);
  });

  it('ignores an empty label', () => {
    expect(addLabel(['a'], '   ')).toEqual(['a']);
    expect(addLabel(undefined, '')).toEqual([]);
  });

  it('removes a label whatever its case, and tolerates a missing one', () => {
    expect(removeLabel(['Costume', 'Fire'], 'costume')).toEqual(['Fire']);
    expect(removeLabel(['Fire'], 'nope')).toEqual(['Fire']);
    expect(removeLabel(undefined, 'x')).toEqual([]);
  });

  it('derives the whole label list from what sources carry, most used first', () => {
    const research = [
      { labels: ['Fire', 'Costume'] },
      { labels: ['fire'] },
      { labels: ['Rothko'] },
      { },
    ];
    expect(allLabels(research)).toEqual([
      { label: 'Fire', count: 2 },
      { label: 'Costume', count: 1 },
      { label: 'Rothko', count: 1 },
    ]);
  });

  it('retires a label the moment nothing carries it', () => {
    expect(allLabels([{ labels: [] }, {}])).toEqual([]);
    expect(allLabels(undefined)).toEqual([]);
  });

  it('reports whether a source carries a label', () => {
    expect(hasLabel({ labels: ['Costume'] }, 'costume')).toBe(true);
    expect(hasLabel({ labels: ['Costume'] }, 'Fire')).toBe(false);
    expect(hasLabel({}, 'Fire')).toBe(false);
  });
});

describe('filterResearch by label', () => {
  const docs = [
    { id: 'a', title: 'Plates', labels: ['Costume'] },
    { id: 'b', title: 'Fire report', labels: ['Fire'] },
    { id: 'c', title: 'Both', labels: ['Costume', 'Fire'] },
    { id: 'd', title: 'Loose' },
  ];
  it('shows the sources in any chosen topic, not only those in all of them', () => {
    expect(filterResearch(docs, { labels: new Set(['Costume']) }).map((d) => d.id)).toEqual(['a', 'c']);
    expect(filterResearch(docs, { labels: new Set(['Costume', 'Fire']) }).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });
  it('ignores case, and an empty choice means every topic', () => {
    expect(filterResearch(docs, { labels: new Set(['costume']) }).map((d) => d.id)).toEqual(['a', 'c']);
    expect(filterResearch(docs, { labels: new Set() })).toHaveLength(4);
  });
  it('narrows a chosen topic with the search box', () => {
    expect(filterResearch(docs, { labels: new Set(['Fire']), query: 'report' }).map((d) => d.id)).toEqual(['b']);
  });
  it('finds a source by its label from the search box alone', () => {
    expect(filterResearch(docs, { query: 'rothko' })).toHaveLength(0);
    expect(filterResearch(docs, { query: 'costume' }).map((d) => d.id)).toEqual(['a', 'c']);
  });
});

// A research source keeps the server's preview of its link (see
// storablePreview), and uses it where nothing the writer typed says more.
describe('a stored link preview', () => {
  const url = 'https://open.spotify.com/track/x';
  const preview = { url, domain: 'open.spotify.com', title: 'Mr. Brightside', description: 'The Killers · Hot Fuss', image: 'https://i.scdn.co/a' };
  it('names an untitled link after its page', () => {
    expect(docTitle({ url, preview })).toBe('Mr. Brightside');
  });
  it('never outranks a title the writer gave it', () => {
    expect(docTitle({ title: 'Song for the bar scene', url, preview })).toBe('Song for the bar scene');
  });
  it('is ignored once the link has changed under it', () => {
    expect(docTitle({ url: 'https://www.bbc.co.uk/', preview })).toBe('bbc.co.uk');
  });
  it('previews the page in the grid when there are no notes, and gives way to notes', () => {
    expect(docSnippet({ url, preview })).toBe('The Killers · Hot Fuss');
    expect(docSnippet({ url, preview, body: 'use for the chase' })).toBe('use for the chase');
  });
  it('makes the page title and description searchable', () => {
    const docs = [{ id: 'a', title: '', url, preview }, { id: 'b', title: 'Other' }];
    expect(filterResearch(docs, { query: 'brightside' }).map((d) => d.id)).toEqual(['a']);
    expect(filterResearch(docs, { query: 'hot fuss' }).map((d) => d.id)).toEqual(['a']);
  });
});
