// Locks what a link is allowed to become on screen. Everything here is read
// off the URL string: nothing is fetched, no unfurl service is asked, and the
// only hosts that ever hear about a link are the link's own (see the header of
// link-preview.js for why).
'use strict';

import { describe, it, expect } from 'vitest';
import { previewOf, previewLabel, isRichPreview, storablePreview, previewMeta, cardLayout, optimizeImage, urlsIn, previewPatch } from './link-preview.js';

describe('previewOf: YouTube', () => {
  it('finds the video in every shape YouTube hands out', () => {
    const shapes = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ];
    for (const url of shapes) {
      const p = previewOf(url);
      expect(p.kind, url).toBe('youtube');
      expect(p.thumb, url).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
      expect(p.embed, url).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    }
  });

  it('embeds through the no-cookie host, and only on demand', () => {
    const p = previewOf('https://youtu.be/abc');
    expect(p.embed).toContain('youtube-nocookie.com');
    // A thumb may be shown unasked; an embed is a player and must not be.
    expect(p.thumb).toBeTruthy();
  });

  it('is not fooled by a lookalike host', () => {
    expect(previewOf('https://notyoutube.com/watch?v=abc').kind).toBe('page');
    expect(previewOf('https://youtube.com.evil.example/watch?v=abc').kind).toBe('page');
  });

  it('falls back to a page when there is no video id', () => {
    expect(previewOf('https://www.youtube.com/watch').kind).toBe('page');
    expect(previewOf('https://www.youtube.com/feed/subscriptions').kind).toBe('page');
  });
});

describe('previewOf: Vimeo', () => {
  it('embeds a numbered video and claims no thumbnail it cannot have', () => {
    const p = previewOf('https://vimeo.com/76979871');
    expect(p.kind).toBe('vimeo');
    expect(p.embed).toBe('https://player.vimeo.com/video/76979871');
    // Vimeo's thumbnail needs an API call, which is the thing being avoided.
    expect(p.thumb).toBeUndefined();
  });
  it('leaves a non-video Vimeo path as a page', () => {
    expect(previewOf('https://vimeo.com/channels/staffpicks').kind).toBe('page');
  });
});

describe('previewOf: direct media', () => {
  it('reads the kind off the extension, query string and all', () => {
    expect(previewOf('https://a.com/x/plate.jpg').kind).toBe('image');
    expect(previewOf('https://a.com/plate.PNG').kind).toBe('image');
    expect(previewOf('https://a.com/plate.webp?v=2').kind).toBe('image');
    expect(previewOf('https://a.com/clip.mp4').kind).toBe('video');
    expect(previewOf('https://a.com/take.m4a').kind).toBe('audio');
    expect(previewOf('https://a.com/report.pdf').kind).toBe('pdf');
  });
  it('shows an image URL as itself', () => {
    expect(previewOf('https://a.com/plate.jpg').thumb).toBe('https://a.com/plate.jpg');
  });
  it('does not mistake an extension in the query for the file itself', () => {
    expect(previewOf('https://a.com/search?q=cat.jpg').kind).toBe('page');
  });
});

describe('previewOf: an ordinary page', () => {
  it('takes the favicon from the site itself, never a third party', () => {
    const p = previewOf('https://en.wikipedia.org/wiki/Rothko');
    expect(p.kind).toBe('page');
    expect(p.host).toBe('en.wikipedia.org');
    expect(p.icon).toBe('https://en.wikipedia.org/favicon.ico');
  });
  it('keeps the port when there is one, so the icon is actually reachable', () => {
    expect(previewOf('http://localhost:8080/notes').icon).toBe('http://localhost:8080/favicon.ico');
  });
});

describe('previewOf: refusals', () => {
  it('returns nothing for what is not a web URL', () => {
    expect(previewOf('')).toBeNull();
    expect(previewOf('She waits by the door.')).toBeNull();
    expect(previewOf('javascript:alert(1)')).toBeNull();
    expect(previewOf('data:text/html,<b>x</b>')).toBeNull();
    expect(previewOf('file:///etc/passwd')).toBeNull();
    expect(previewOf(null)).toBeNull();
  });
});

describe('previewLabel', () => {
  it('says what it is and where it is from', () => {
    expect(previewLabel(previewOf('https://youtu.be/abc'))).toBe('Video on youtu.be');
    expect(previewLabel(previewOf('https://a.com/x.jpg'))).toBe('Image on a.com');
    expect(previewLabel(previewOf('https://www.bbc.co.uk/news'))).toBe('Page on bbc.co.uk');
    expect(previewLabel(null)).toBe('');
  });
});

// The server's preview (GET /v1/link-preview): when it is worth a card, and
// what a research source keeps of it.
describe('isRichPreview', () => {
  const base = { url: 'https://a.com/', domain: 'a.com', title: 'https://a.com/', description: null, image: null };
  it('is false for a preview made from the URL alone (a block, a timeout)', () => {
    expect(isRichPreview({ ...base, sources: { title: 'url', description: null, image: null } })).toBe(false);
    expect(isRichPreview(null)).toBe(false);
  });
  it('is true once any real field is present', () => {
    expect(isRichPreview({ ...base, title: 'A', sources: { title: 'html' } })).toBe(true);
    expect(isRichPreview({ ...base, description: 'd', sources: { title: 'url' } })).toBe(true);
    expect(isRichPreview({ ...base, image: 'https://a.com/i.png', sources: { title: 'url' } })).toBe(true);
  });
});

describe('storablePreview', () => {
  const full = {
    url: 'https://open.spotify.com/track/x', finalUrl: 'https://open.spotify.com/track/x', domain: 'open.spotify.com',
    title: 'Mr. Brightside', description: 'The Killers', image: 'https://i.scdn.co/image/a',
    sources: { title: 'og', description: 'og', image: 'og' }, fetched: true, status: 200, contentType: 'text/html',
  };
  it('keeps only what a card needs, and nothing time-stamped', () => {
    expect(storablePreview(full)).toEqual({
      url: 'https://open.spotify.com/track/x', domain: 'open.spotify.com',
      title: 'Mr. Brightside', description: 'The Killers', image: 'https://i.scdn.co/image/a',
      layout: 'large', favicon: null, meta: null,
    });
  });
  it('keeps the size decision, the icon and the one-line summary for offline drawing', () => {
    const p = storablePreview({ ...full, type: 'music.song', card: 'summary', imageWidth: 640, imageHeight: 640,
      favicon: 'https://open.spotifycdn.com/f.png', music: { musicians: ['The Killers'], duration: 222 } });
    expect([p.layout, p.favicon, p.meta]).toEqual(['small', 'https://open.spotifycdn.com/f.png', 'Song \u00b7 The Killers \u00b7 3:42']);
  });
  it('is identical for identical answers, so two devices never conflict over it', () => {
    expect(JSON.stringify(storablePreview({ ...full }))).toBe(JSON.stringify(storablePreview({ ...full, status: 200 })));
  });
  it('does not store a URL-as-title as if it were the page title', () => {
    const p = storablePreview({ ...full, title: full.url, sources: { title: 'url', description: 'og', image: 'og' } });
    expect(p.title).toBeNull();
    expect(p.image).toBe(full.image);
  });
  it('keeps nothing from a preview with nothing in it, so it is asked for again', () => {
    expect(storablePreview({ ...full, title: full.url, description: null, image: null, sources: { title: 'url', description: null, image: null } })).toBeNull();
  });
});

describe('previewOf: Spotify', () => {
  it('turns every Spotify content link into its embeddable player, sized as a strip', () => {
    expect(previewOf('https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp')).toMatchObject({ kind: 'spotify', embed: 'https://open.spotify.com/embed/track/3n3Ppam7vgaVa1iaRUc9Lp', embedHeight: 152 });
    expect(previewOf('https://open.spotify.com/intl-fr/album/4OHNH3sDzIxnmUADXzv2kT?si=x').embed).toBe('https://open.spotify.com/embed/album/4OHNH3sDzIxnmUADXzv2kT');
    expect(previewOf('https://open.spotify.com/').kind).toBe('page');
  });
});

describe('previewMeta', () => {
  it('says what a song is: kind, artist, length', () => {
    expect(previewMeta({ type: 'music.song', music: { musicians: ['The Killers'], duration: 222 } })).toBe('Song \u00b7 The Killers \u00b7 3:42');
  });
  it('says what a video is: channel from oEmbed, and length', () => {
    expect(previewMeta({ type: 'video.other', video: { duration: 214 }, oembed: { authorName: 'Rick Astley' } })).toBe('Video \u00b7 Rick Astley \u00b7 3:34');
    expect(previewMeta({ type: 'video.other', video: { duration: 3725 } })).toBe('Video \u00b7 1:02:05');
  });
  it('gives an article its byline and date', () => {
    expect(previewMeta({ type: 'article', article: { authors: ['Maxine Joselow'], publishedTime: '2026-09-19T09:02:22.000Z' } }))
      .toBe('Maxine Joselow \u00b7 Sep 19, 2026');
    expect(previewMeta({ article: { authors: ['A', 'B', 'C'], publishedTime: null } })).toBe('A, B and others');
  });
  it('is null for an ordinary page, so no empty line is drawn', () => {
    expect(previewMeta({ type: 'website' })).toBeNull();
    expect(previewMeta({ type: 'article', article: { authors: [], publishedTime: null } })).toBeNull();
    expect(previewMeta(null)).toBeNull();
  });
});

describe('cardLayout', () => {
  it('draws a page that asks for a large image, large', () => {
    expect(cardLayout({ image: 'i', card: 'summary_large_image', imageWidth: 300, imageHeight: 300 })).toBe('large');
    expect(cardLayout({ image: 'i', card: 'player' })).toBe('large');
  });
  it('keeps a square or small image as a thumbnail, so a logo is not cut in half', () => {
    expect(cardLayout({ image: 'i', imageWidth: 640, imageHeight: 640 })).toBe('small'); // album cover
    expect(cardLayout({ image: 'i', imageWidth: 300, imageHeight: 300 })).toBe('small'); // ogp.me logo
    expect(cardLayout({ image: 'i', imageWidth: 350, imageHeight: 180 })).toBe('small'); // wide but tiny
    expect(cardLayout({ image: 'i', card: 'summary' })).toBe('small');
  });
  it('draws a big wide image, or one of unknown size, large; and no image as text', () => {
    expect(cardLayout({ image: 'i', imageWidth: 1200, imageHeight: 630 })).toBe('large');
    expect(cardLayout({ image: 'i' })).toBe('large');
    expect(cardLayout({ image: null })).toBe('text');
  });
});

describe('optimizeImage', () => {
  it('asks a resizing CDN for a card-sized rendition', () => {
    expect(optimizeImage('https://images.unsplash.com/photo-1?ixid=x', 720)).toBe('https://images.unsplash.com/photo-1?ixid=x&w=720&q=75&auto=format');
    expect(optimizeImage('https://acme.imgix.net/a.jpg?q=90', 400)).toBe('https://acme.imgix.net/a.jpg?q=90&w=400&auto=format');
    expect(optimizeImage('https://images.ctfassets.net/s/a.png', 720)).toBe('https://images.ctfassets.net/s/a.png?w=720&fm=webp');
  });
  it('leaves every other host alone rather than guessing its parameters', () => {
    expect(optimizeImage('https://i.scdn.co/image/ab67', 720)).toBe('https://i.scdn.co/image/ab67');
    expect(optimizeImage('not a url')).toBe('not a url');
  });
});

describe('urlsIn', () => {
  it('finds each link once, in order, without the sentence punctuation after it', () => {
    expect(urlsIn('See https://ogp.me/. Then https://ogp.me/ again, and https://github.com!')).toEqual(['https://ogp.me/', 'https://github.com/']);
  });
  it('keeps brackets a URL opened, drops ones it did not', () => {
    expect(urlsIn('(see https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    expect(urlsIn('(https://ogp.me/)')).toEqual(['https://ogp.me/']);
  });
  it('reads a bare www. address as a link, but not a bare word with a dot', () => {
    expect(urlsIn('try www.nytimes.com or e.g. Mr. Smith')).toEqual(['https://www.nytimes.com/']);
  });
  it('finds nothing in plain prose', () => {
    expect(urlsIn('She waits by the door.')).toEqual([]);
    expect(urlsIn('')).toEqual([]);
  });
});

describe('previewPatch: a source learns from its link', () => {
  const stored = { url: 'https://open.spotify.com/track/x', title: 'Mr. Brightside', domain: 'open.spotify.com', description: null, image: null, layout: 'text', favicon: null, meta: null };
  it('takes the page title when the source has no title of its own', () => {
    expect(previewPatch({ url: stored.url, title: '' }, stored).title).toBe('Mr. Brightside');
    expect(previewPatch({ url: stored.url, title: 'Untitled' }, stored).title).toBe('Mr. Brightside');
  });
  it('never replaces a title the writer gave', () => {
    expect(previewPatch({ url: stored.url, title: 'Bar scene song' }, stored).title).toBeUndefined();
  });
  it('stores the preview only when it says something new', () => {
    expect(previewPatch({ url: stored.url, title: 'x', preview: stored }, stored)).toEqual({});
    expect(previewPatch({ url: stored.url, title: 'x' }, stored)).toEqual({ preview: stored });
  });
  it('ignores a preview for a link the source no longer has', () => {
    expect(previewPatch({ url: 'https://other.example/', title: '' }, stored)).toEqual({});
    expect(previewPatch({ url: stored.url, title: '' }, null)).toEqual({});
  });
});
