// Locks what a link is allowed to become on screen. Everything here is read
// off the URL string: nothing is fetched, no unfurl service is asked, and the
// only hosts that ever hear about a link are the link's own (see the header of
// link-preview.js for why).
'use strict';

import { describe, it, expect } from 'vitest';
import { previewOf, previewLabel } from './link-preview.js';

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
