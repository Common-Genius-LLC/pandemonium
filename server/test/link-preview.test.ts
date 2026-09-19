// Locks the link-preview pipeline without touching the network: every tier of
// the fallback hierarchy, encodings, the SSRF rules, and the fetch loop
// (redirects, blocks, timeouts, caps, caching) driven through injected fetch,
// DNS and clock. The live check against real sites is
// scripts/validate-link-preview.ts, kept out of this suite on purpose.

import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { extractMeta, buildPreview, decodeBody, sniffCharset, urlOnlyPreview, MAX_TITLE, type LinkPreview } from '../src/link-preview/parse';
import { isPublicAddress, assertPublicUrl } from '../src/link-preview/ssrf';
import { createPreviewService, LIMITS, DEFAULT_USER_AGENT, DEFAULT_BOT_USER_AGENT, DEFAULT_SOCIAL_USER_AGENT, isThin, type FetchFn } from '../src/link-preview/service';
import { readJsonLd, readOEmbed, isoSeconds } from '../src/link-preview/parse';
import { ipVersion } from '../src/link-preview/ip';
import { createRateLimiter } from '../src/rate-limit';
import { linkPreviewRoutes } from '../src/routes/link-preview';
import { HttpError } from '../src/errors';

const PAGE = 'https://www.example.org/article';
const preview = async (html: string, requestedUrl = PAGE, finalUrl = requestedUrl) =>
  buildPreview(await extractMeta(html), { requestedUrl, finalUrl });
const doc = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

// ---------------------------------------------------------------- parser --

describe('title: og:title > twitter:title > <title> > URL', () => {
  const all = '<meta property="og:title" content="OG"><meta name="twitter:title" content="TW"><title>HTML</title>';
  it('takes og:title first', async () => {
    const p = await preview(doc(all));
    expect([p.title, p.sources.title]).toEqual(['OG', 'og']);
  });
  it('falls to twitter:title', async () => {
    const p = await preview(doc('<meta name="twitter:title" content="TW"><title>HTML</title>'));
    expect([p.title, p.sources.title]).toEqual(['TW', 'twitter']);
  });
  it('falls to <title>', async () => {
    const p = await preview(doc('<title>HTML</title>'));
    expect([p.title, p.sources.title]).toEqual(['HTML', 'html']);
  });
  it('falls to the URL that was asked for', async () => {
    const p = await preview(doc(''));
    expect([p.title, p.sources.title]).toEqual([PAGE, 'url']);
  });
  it('treats an empty or whitespace tag as missing, not as a title', async () => {
    const p = await preview(doc('<meta property="og:title" content="   "><title>\n  Real \n</title>'));
    expect([p.title, p.sources.title]).toEqual(['Real', 'html']);
  });
  it('reads OG from name= and Twitter from property=, as real pages write them', async () => {
    expect((await preview(doc('<meta name="og:title" content="A">'))).sources.title).toBe('og');
    expect((await preview(doc('<meta property="twitter:title" content="B">'))).sources.title).toBe('twitter');
  });
  it('keeps the first of a repeated tag', async () => {
    expect((await preview(doc('<meta property="og:title" content="First"><meta property="og:title" content="Second">'))).title).toBe('First');
  });
  it('ignores a <title> inside the body when the head already had one', async () => {
    expect((await preview(doc('<title>Page</title>', '<svg><title>icon</title></svg>'))).title).toBe('Page');
  });
});

describe('description: og > twitter > meta description > first <p> > null', () => {
  it('walks every tier in order', async () => {
    const tiers: Array<[string, string, string | null]> = [
      [doc('<meta property="og:description" content="og"><meta name="twitter:description" content="tw"><meta name="description" content="m">', '<p>para</p>'), 'og', 'og'],
      [doc('<meta name="twitter:description" content="tw"><meta name="description" content="m">', '<p>para</p>'), 'tw', 'twitter'],
      [doc('<meta name="description" content="m">', '<p>para</p>'), 'm', 'meta'],
      [doc('', '<p>para</p>'), 'para', 'paragraph'],
    ];
    for (const [html, value, source] of tiers) {
      const p = await preview(html);
      expect([p.description, p.sources.description]).toEqual([value, source]);
    }
  });
  it('is null when there is nothing at all', async () => {
    const p = await preview(doc('<title>t</title>', '<div>no paragraphs</div>'));
    expect([p.description, p.sources.description]).toEqual([null, null]);
  });
  it('takes the first paragraph that has text, reading through nested inline tags', async () => {
    const p = await preview(doc('', '<p> </p><p>&nbsp;</p><p>Hello <b>bold <i>deep</i></b> &amp; <a href="#">linked</a></p><p>later</p>'));
    expect(p.description).toBe('Hello bold deep & linked');
  });
});

describe('image: og:image > twitter:image > link[rel=image_src] > null', () => {
  it('walks every tier in order', async () => {
    const og = await preview(doc('<meta property="og:image" content="/og.png"><meta name="twitter:image" content="/tw.png"><link rel="image_src" href="/l.png">'));
    expect([og.image, og.sources.image]).toEqual(['https://www.example.org/og.png', 'og']);
    const tw = await preview(doc('<meta name="twitter:image" content="/tw.png"><link rel="image_src" href="/l.png">'));
    expect([tw.image, tw.sources.image]).toEqual(['https://www.example.org/tw.png', 'twitter']);
    const link = await preview(doc('<link rel="image_src" href="/l.png">'));
    expect([link.image, link.sources.image]).toEqual(['https://www.example.org/l.png', 'link']);
  });
  it('never falls back to an arbitrary <img>', async () => {
    const p = await preview(doc('<title>t</title>', '<img src="/logo.png"><img src="/ad.gif">'));
    expect([p.image, p.sources.image]).toEqual([null, null]);
  });
  it('uses og:image:secure_url and twitter:image:src when the plain keys are absent', async () => {
    expect((await preview(doc('<meta property="og:image:secure_url" content="https://c.dn/s.png">'))).image).toBe('https://c.dn/s.png');
    expect((await preview(doc('<meta name="twitter:image:src" content="https://c.dn/t.png">'))).sources.image).toBe('twitter');
  });
  it('resolves relative and protocol-relative paths against the final URL', async () => {
    const p = await preview(doc('<meta property="og:image" content="img/a.png">'), PAGE, 'https://www.example.org/posts/1');
    expect(p.image).toBe('https://www.example.org/posts/img/a.png');
    expect((await preview(doc('<meta property="og:image" content="//cdn.example.net/a.png">'))).image).toBe('https://cdn.example.net/a.png');
  });
  it('resolves against <base href> when the page declares one', async () => {
    expect((await preview(doc('<base href="https://static.example.org/assets/"><meta property="og:image" content="a.png">'))).image)
      .toBe('https://static.example.org/assets/a.png');
  });
  it('drops images that are not http(s) or that point into a private network', async () => {
    for (const bad of ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'http://192.168.1.1/x.png', 'http://127.0.0.1/x.png', 'http://localhost/x.png', 'http://[::1]/x.png']) {
      const p = await preview(doc(`<meta property="og:image" content="${bad}">`));
      expect(p.image).toBeNull();
    }
  });
  it('falls through a bad og:image to the next tier', async () => {
    const p = await preview(doc('<meta property="og:image" content="javascript:x"><meta name="twitter:image" content="/tw.png">'));
    expect(p.sources.image).toBe('twitter');
  });
});

describe('domain', () => {
  it('is the hostname of the requested URL without www.', async () => {
    expect((await preview(doc(''), 'https://www.bbc.co.uk/news')).domain).toBe('bbc.co.uk');
    expect((await preview(doc(''), 'https://en.wikipedia.org/wiki/X')).domain).toBe('en.wikipedia.org');
  });
  it('ignores og:site_name', async () => {
    expect((await preview(doc('<meta property="og:site_name" content="Totally Real Bank">'), 'https://evil.example/')).domain).toBe('evil.example');
  });
  it('shows the domain the card links to, not where a shortener redirected', async () => {
    const p = await preview(doc(''), 'https://sho.rt/x', 'https://www.paypal.com/login');
    expect([p.domain, p.finalUrl]).toEqual(['sho.rt', 'https://www.paypal.com/login']);
  });
});

describe('text hygiene', () => {
  it('decodes entities in attributes and in text', async () => {
    const p = await preview(doc('<meta property="og:title" content="Rock &amp; Roll &quot;live&quot; &#8212; &eacute;t&eacute;"><title>x</title>', '<p>Tom &amp; Jerry &lt;3</p>'));
    expect(p.title).toBe('Rock & Roll "live" \u2014 \u00e9t\u00e9');
    expect(p.description).toBe('Tom & Jerry <3');
  });
  it('decodes an encoded image URL once, not twice', async () => {
    expect((await preview(doc('<meta property="og:image" content="/i.png?a=1&amp;b=2">'))).image).toBe('https://www.example.org/i.png?a=1&b=2');
  });
  it('collapses whitespace and caps an absurd title', async () => {
    const p = await preview(doc(`<title>  a\n\n\tb   ${'x'.repeat(1000)}</title>`));
    expect(p.title.startsWith('a b x')).toBe(true);
    expect(p.title.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(p.title.endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------- rich detail --
// Fixtures are trimmed copies of what the real sites serve (checked live).

describe('baseline OG detail (ogp.me)', () => {
  const OGP = doc(`<title>The Open Graph protocol</title>
    <meta property="og:title" content="Open Graph protocol"><meta property="og:type" content="website">
    <meta property="og:url" content="https://ogp.me/"><meta property="og:image" content="https://ogp.me/logo.png">
    <meta property="og:image:type" content="image/png"><meta property="og:image:width" content="300">
    <meta property="og:image:height" content="300"><meta property="og:image:alt" content="The Open Graph logo">
    <meta property="og:description" content="The Open Graph protocol enables any web page to become a rich object.">`);
  it('reads og:type, og:url, og:image and its dimensions and alt', async () => {
    const p = await preview(OGP, 'https://ogp.me/');
    expect([p.type, p.canonicalUrl, p.image]).toEqual(['website', 'https://ogp.me/', 'https://ogp.me/logo.png']);
    expect([p.imageWidth, p.imageHeight, p.imageAlt]).toEqual([300, 300, 'The Open Graph logo']);
    expect(p.favicon).toBe('https://ogp.me/favicon.ico'); // no <link rel=icon>: the site root
  });
  it('does not lend og:image dimensions to an image from another tier', async () => {
    const p = await preview(doc('<meta property="og:image:width" content="900"><meta name="twitter:image" content="/t.png">'));
    expect([p.sources.image, p.imageWidth]).toEqual(['twitter', null]);
  });
  it('prefers og:url over <link rel=canonical>, and uses canonical without it', async () => {
    expect((await preview(doc('<link rel="canonical" href="/c"><meta property="og:url" content="https://x.example/og">'))).canonicalUrl).toBe('https://x.example/og');
    expect((await preview(doc('<link rel="canonical" href="/c">'))).canonicalUrl).toBe('https://www.example.org/c');
  });
});

describe('video (YouTube)', () => {
  const YT = doc(`<meta property="og:type" content="video.other">
    <meta property="og:title" content="Rick Astley - Never Gonna Give You Up">
    <meta property="og:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg">
    <meta property="og:image:width" content="1280"><meta property="og:image:height" content="720">
    <meta property="og:video:url" content="https://www.youtube.com/embed/dQw4w9WgXcQ">
    <meta property="og:video:secure_url" content="https://www.youtube.com/embed/dQw4w9WgXcQ">
    <meta property="og:video:type" content="text/html"><meta property="og:video:width" content="1280">
    <meta property="og:video:height" content="720"><meta name="twitter:card" content="summary_large_image">
    <meta itemprop="duration" content="PT3M34S">
    <link rel="icon" href="/favicon_32x32.png" sizes="32x32"><link rel="icon" href="/favicon_144x144.png" sizes="144x144">
    <link rel="alternate" type="application/json+oembed" href="https://www.youtube.com/oembed?format=json&amp;url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Rick"}</script>`);
  const URL_YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  it('reads og:video with its type, size and the duration', async () => {
    const p = await preview(YT, URL_YT);
    expect(p.type).toBe('video.other');
    expect(p.video).toEqual({ url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', type: 'text/html', width: 1280, height: 720, duration: 214 });
    expect(p.card).toBe('summary_large_image');
  });
  it('discovers the oEmbed endpoint with its entity decoded', async () => {
    expect((await preview(YT, URL_YT)).oembedUrl).toBe('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
  });
  it('picks the icon nearest 32px and lists the schema types', async () => {
    const p = await preview(YT, URL_YT);
    expect(p.favicon).toBe('https://www.youtube.com/favicon_32x32.png');
    expect(p.jsonLdTypes).toEqual(['VideoObject']);
  });
  it('reads ISO 8601 durations', () => {
    expect([isoSeconds('PT3M34S'), isoSeconds('PT1H2M'), isoSeconds('PT45S'), isoSeconds('P1DT1S'), isoSeconds('3:34'), isoSeconds('PT')])
      .toEqual([214, 3720, 45, 86401, null, null]);
  });
});

describe('audio and music (Spotify)', () => {
  const SP = doc(`<meta property="og:title" content="Mr. Brightside"><meta property="og:type" content="music.song">
    <meta property="og:audio" content="https://p.scdn.co/mp3-preview/2680d6"><meta property="og:audio:type" content="audio/mpeg">
    <meta property="og:image" content="https://i.scdn.co/image/ab67"><meta property="og:image:width" content="640"><meta property="og:image:height" content="640">
    <meta name="twitter:card" content="summary">
    <meta name="music:duration" content="222"><meta name="music:album" content="https://open.spotify.com/album/4OHN">
    <meta name="music:album:track" content="2"><meta name="music:release_date" content="2004-06-15">
    <meta name="music:musician" content="https://open.spotify.com/artist/0C0X"><meta name="music:musician_description" content="The Killers">
    ${'<meta property="og:restrictions:country:allowed" content="GB">'.repeat(180)}`);
  it('reads og:audio and the music.song detail', async () => {
    const p = await preview(SP, 'https://open.spotify.com/track/3n3P');
    expect(p.type).toBe('music.song');
    expect(p.audio).toEqual({ url: 'https://p.scdn.co/mp3-preview/2680d6', type: 'audio/mpeg' });
    expect(p.music).toEqual({ duration: 222, releaseDate: '2004-06-15', albumUrl: 'https://open.spotify.com/album/4OHN', trackNumber: 2, musicians: ['The Killers'] });
    expect([p.card, p.imageWidth, p.imageHeight]).toEqual(['summary', 640, 640]);
  });
  it('never shows a profile URL as an artist name', async () => {
    const p = await preview(doc('<meta property="og:type" content="music.song"><meta name="music:musician" content="https://open.spotify.com/artist/x">'));
    expect(p.music!.musicians).toEqual([]);
  });
  it('keeps a key repeated a hundred times to a small cap', async () => {
    const many = await extractMeta(doc('<meta property="og:video:tag" content="t">'.repeat(100)));
    expect(many.meta['og:video:tag'].length).toBe(20);
  });
});

describe('articles (article:* and JSON-LD)', () => {
  const NEWS = doc(`<meta property="og:type" content="article"><meta property="og:title" content="A headline">
    <meta property="article:published_time" content="2026-09-19T10:00:00Z">
    <meta property="article:modified_time" content="2026-09-19T12:30:00Z">
    <meta property="article:author" content="Jane Doe"><meta property="article:author" content="https://example.com/by/john">
    <meta property="article:author" content="John Roe"><meta property="article:section" content="Climate">
    <meta property="article:tag" content="Oceans"><meta property="article:tag" content="Heat">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"page"},
      {"@type":"NewsArticle","headline":"A headline","datePublished":"2026-09-19T10:00:00Z",
       "author":[{"@type":"Person","name":"Jane Doe"},{"@type":"Person","name":"John Roe"}],
       "publisher":{"@type":"NewsMediaOrganization","name":"The Example Times"}}]}</script>`);
  it('reads article:* with repeated authors and tags, dropping URL-shaped authors', async () => {
    const p = await preview(NEWS);
    expect(p.article!.publishedTime).toBe('2026-09-19T10:00:00Z');
    expect(p.article!.modifiedTime).toBe('2026-09-19T12:30:00Z');
    expect(p.article!.authors).toEqual(['Jane Doe', 'John Roe']);
    expect([p.article!.section, p.article!.tags]).toEqual(['Climate', ['Oceans', 'Heat']]);
  });
  it('reads a NewsArticle out of an @graph, with its publisher', async () => {
    const p = await preview(NEWS);
    expect(p.jsonLdTypes).toEqual(['WebPage', 'NewsArticle']);
    expect([p.article!.publisher, p.article!.headline]).toEqual(['The Example Times', 'A headline']);
  });
  it('fills an article from JSON-LD alone when there are no article:* tags', async () => {
    const p = await preview(doc('<script type="application/ld+json">[{"@type":["BlogPosting"],"headline":"Post","datePublished":"2025-01-01","author":"Solo Writer"}]</script>'));
    expect(p.article).toEqual({ publishedTime: '2025-01-01', modifiedTime: null, authors: ['Solo Writer'], section: null, tags: [], headline: 'Post', publisher: null });
  });
  it('falls back to a "By" byline for the author', async () => {
    expect((await preview(doc('<meta property="og:type" content="article"><meta name="byl" content="By Ann Lee">'))).article!.authors).toEqual(['Ann Lee']);
  });
  it('survives a broken JSON-LD block beside a good one, and has no article on a plain page', async () => {
    expect(readJsonLd(['{not json', '{"@type":"Article","headline":"ok"}'], 'https://x.example/').article!.headline).toBe('ok');
    expect((await preview(doc('<title>plain</title>'))).article).toBeNull();
  });
});

describe('oEmbed', () => {
  it('keeps what a card uses and never the provider html', () => {
    const o = readOEmbed({ type: 'video', title: 'T', author_name: 'Rick Astley', author_url: 'https://www.youtube.com/@RickAstleyYT',
      provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', thumbnail_width: 480, thumbnail_height: 360,
      width: 200, height: 113, html: '<iframe src="https://evil.example"></iframe>' }, 'https://www.youtube.com/');
    expect(o).toEqual({ type: 'video', title: 'T', authorName: 'Rick Astley', authorUrl: 'https://www.youtube.com/@RickAstleyYT',
      providerName: 'YouTube', thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg', thumbnailWidth: 480, thumbnailHeight: 360, width: 200, height: 113 });
    expect(JSON.stringify(o)).not.toContain('iframe');
  });
  it('is null when there is nothing usable', () => {
    expect(readOEmbed(null, 'https://x.example/')).toBeNull();
    expect(readOEmbed({ html: '<b>x</b>' }, 'https://x.example/')).toBeNull();
  });
  it('is fetched when the page advertises it, and attached', async () => {
    const page = () => html(doc('<meta property="og:title" content="Video"><link rel="alternate" type="application/json+oembed" href="https://v.example/oembed?u=1">'));
    const { service, calls } = harness({
      'https://v.example/watch': page,
      'https://v.example/oembed?u=1': () => new Response(JSON.stringify({ author_name: 'Channel', provider_name: 'V' }), { headers: { 'content-type': 'application/json' } }),
    });
    const p = await service.get('https://v.example/watch');
    expect(p.oembed!.authorName).toBe('Channel');
    expect(calls).toEqual(['https://v.example/watch', 'https://v.example/oembed?u=1']);
  });
  it('is never fetched from a private address, and its failure spoils nothing', async () => {
    const page = () => html(doc('<meta property="og:title" content="V"><link rel="alternate" type="application/json+oembed" href="http://inside.example/oembed">'));
    const { service, calls } = harness({ 'https://v.example/p': page }, { dns: { 'inside.example': ['10.0.0.9'] } });
    const p = await service.get('https://v.example/p');
    expect([p.title, p.oembed]).toEqual(['V', null]);
    expect(calls).toEqual(['https://v.example/p']);
  });
});

describe('runtime-neutral pieces', () => {
  it('ipVersion matches node:net isIP', () => {
    expect(['1.2.3.4', '::1', '2606:4700::1111', '::ffff:1.2.3.4', 'example.com', '1.2.3', '', ':::'].map(ipVersion)).toEqual([4, 6, 6, 6, 0, 0, 0, 0]);
  });
  it('with lookup null (a Worker), refuses private literals but leaves names to the platform', async () => {
    let err: unknown = null;
    try { await assertPublicUrl('http://169.254.169.254/', null); } catch (e) { err = e; }
    expect((err as HttpError).status).toBe(400);
    expect((await assertPublicUrl('https://example.com/', null)).hostname).toBe('example.com');
  });
});

// -------------------------------------------------------------- encoding --

describe('character encoding', () => {
  const sjisHead = [...new TextEncoder().encode('<meta charset="shift_jis"><title>')];
  const sjisTitle = [0x93, 0xfa, 0x96, 0x7b]; // 日本 in Shift_JIS
  const sjisTail = [...new TextEncoder().encode('</title>')];

  it('reads a Shift_JIS page from its <meta charset>', async () => {
    const html = decodeBody(new Uint8Array([...sjisHead, ...sjisTitle, ...sjisTail]), 'text/html');
    expect((await preview(html)).title).toBe('日本');
  });
  it('lets the Content-Type header win over a <meta> that disagrees', () => {
    expect(sniffCharset(new TextEncoder().encode('<meta charset="shift_jis">'), 'text/html; charset=UTF-8')).toBe('utf-8');
  });
  it('reads the http-equiv form of the declaration', () => {
    expect(sniffCharset(new TextEncoder().encode('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">'), 'text/html')).toBe('euc-jp');
  });
  it('honours a byte-order mark above everything', () => {
    expect(sniffCharset(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]), 'text/html; charset=shift_jis')).toBe('utf-8');
  });
  it('falls back to UTF-8 for a label it cannot decode', () => {
    expect(sniffCharset(new TextEncoder().encode('<meta charset="klingon-8">'), null)).toBe('utf-8');
  });
  it('decodes UTF-8 Japanese without replacement characters', async () => {
    const bytes = new TextEncoder().encode(doc('<meta property="og:title" content="ウィキペディア">'));
    const p = await preview(decodeBody(bytes, 'text/html; charset=utf-8'));
    expect(p.title).toBe('ウィキペディア');
    expect(p.title).not.toContain('�');
  });
});

// ------------------------------------------------------------------ SSRF --

describe('isPublicAddress', () => {
  it('refuses every private, local and reserved range', () => {
    for (const ip of [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
      '192.168.0.1', '192.0.2.1', '198.18.0.1', '203.0.113.9', '224.0.0.1', '255.255.255.255',
      '::', '::1', 'fe80::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
      '::ffff:169.254.169.254', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1',
    ]) expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
  });
  it('allows public unicast', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '140.245.22.43', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, true]);
    }
  });
  it('refuses things that are not addresses at all', () => {
    for (const s of ['', 'example.com', '1.2.3', '1.2.3.256', ':::']) expect(isPublicAddress(s)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  const publicDns = async () => ['93.184.216.34'];
  const refuse = async (url: string, lookup = publicDns) => {
    try { await assertPublicUrl(url, lookup); return null; } catch (e) { return e; }
  };
  it('refuses the metadata service, loopback and friends by address and by name', async () => {
    for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'http://[::1]/', 'http://localhost/', 'http://db.internal/', 'http://printer.local/']) {
      const e = await refuse(u);
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
  });
  it('refuses a public-looking name that resolves somewhere private', async () => {
    expect(await refuse('https://sneaky.example/', async () => ['10.0.0.5'])).toBeInstanceOf(HttpError);
  });
  it('refuses a name with ANY private record among public ones', async () => {
    expect(await refuse('https://split.example/', async () => ['93.184.216.34', '127.0.0.1'])).toBeInstanceOf(HttpError);
  });
  it('refuses other schemes, embedded credentials and non-web ports', async () => {
    for (const u of ['ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'https://u:p@example.com/', 'https://example.com:6379/']) {
      expect(await refuse(u)).toBeInstanceOf(HttpError);
    }
  });
  it('treats a name that does not resolve as a clean 400, not a crash', async () => {
    const e = await refuse('https://nope.example/', async () => { throw new Error('ENOTFOUND'); });
    expect((e as HttpError).status).toBe(400);
  });
  it('lets an ordinary public URL through', async () => {
    expect(await refuse('https://example.com/a?b=c', publicDns)).toBeNull();
  });
});

// --------------------------------------------------------------- service --

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
function harness(routes: Record<string, Route>, { dns = {} as Record<string, string[]>, limits = LIMITS } = {}) {
  const calls: string[] = [];
  const agents: string[] = [];
  let clock = 1_000_000;
  const fetch: FetchFn = async (url, init) => {
    calls.push(url);
    agents.push((init.headers as Record<string, string>)['User-Agent']);
    const route = routes[url];
    if (!route) throw new Error('no route for ' + url);
    return route(url, init);
  };
  const lookup = async (host: string) => dns[host] || ['93.184.216.34'];
  const service = createPreviewService({ fetch, lookup, now: () => clock }, limits);
  return { service, calls, agents, advance: (ms: number) => { clock += ms; } };
}
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (location: string, status = 301) => new Response(null, { status, headers: { location } });

describe('fetching', () => {
  it('follows a 301 from http to https and reports where it landed', async () => {
    const { service, calls } = harness({
      'http://github.example/': () => redirect('https://github.example/'),
      'https://github.example/': () => html(doc('<meta property="og:title" content="GitHub">')),
    });
    const p = await service.get('http://github.example/');
    expect(calls).toEqual(['http://github.example/', 'https://github.example/']);
    expect([p.title, p.finalUrl, p.url, p.fetched]).toEqual(['GitHub', 'https://github.example/', 'http://github.example/', true]);
  });
  it('follows a relative Location header', async () => {
    const { service } = harness({
      'https://a.example/old': () => redirect('/new', 302),
      'https://a.example/new': () => html(doc('<title>New</title>')),
    });
    expect((await service.get('https://a.example/old')).title).toBe('New');
  });
  it('refuses to follow a redirect into the private network, and never requests it', async () => {
    const { service, calls } = harness(
      { 'https://bait.example/': () => redirect('http://metadata.example/latest') },
      { dns: { 'metadata.example': ['169.254.169.254'] } },
    );
    const p = await service.get('https://bait.example/');
    // Asked once per agent, refused every time, never followed.
    expect(calls).toEqual(['https://bait.example/', 'https://bait.example/', 'https://bait.example/']);
    expect(calls.some((u) => u.includes('metadata'))).toBe(false);
    expect([p.fetched, p.title]).toEqual([false, 'https://bait.example/']);
  });
  it('gives up on a redirect loop instead of following it forever', async () => {
    const { service, calls } = harness({ 'https://loop.example/': () => redirect('https://loop.example/') });
    const p = await service.get('https://loop.example/');
    expect(p.fetched).toBe(false);
    expect(calls.length).toBe(3 * (LIMITS.maxRedirects + 1)); // capped on each of the three passes
  });
  it('turns a block (403/503) into URL-only data, never a thrown error or a scraped error page', async () => {
    for (const status of [403, 404, 429, 503]) {
      const { service } = harness({ 'https://shop.example/': () => new Response('<title>Robot Check</title>', { status, headers: { 'content-type': 'text/html' } }) });
      const p = await service.get('https://shop.example/');
      expect([p.fetched, p.status, p.title, p.domain]).toEqual([false, status, 'https://shop.example/', 'shop.example']);
    }
  });
  it('turns a network failure into URL-only data', async () => {
    const { service } = harness({ 'https://down.example/': () => { throw new Error('ECONNRESET'); } });
    expect((await service.get('https://down.example/')).fetched).toBe(false);
  });
  it('gives up at the timeout', async () => {
    const hang: Route = (_u, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
    const { service } = harness({ 'https://slow.example/': hang }, { limits: { ...LIMITS, timeoutMs: 30 } });
    const started = Date.now();
    const p = await service.get('https://slow.example/');
    expect(p.fetched).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('treats an image URL as its own preview without reading it', async () => {
    // highWaterMark 0: pull only runs when something actually reads, so
    // `pulled` means "read", not "the stream buffered itself on creation".
    let pulled = false;
    let cancelled = false;
    const body = new ReadableStream({ pull() { pulled = true; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const { service } = harness({ 'https://cdn.example/a.jpg': () => new Response(body, { headers: { 'content-type': 'image/jpeg' } }) });
    const p = await service.get('https://cdn.example/a.jpg');
    expect([p.image, p.sources.image, p.fetched]).toEqual(['https://cdn.example/a.jpg', 'self', true]);
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true); // released, not left hanging open
  });
  it('reads nothing from a non-HTML page and still answers', async () => {
    const { service } = harness({ 'https://x.example/f.pdf': () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }) });
    const p = await service.get('https://x.example/f.pdf');
    expect([p.fetched, p.sources.title, p.contentType]).toEqual([true, 'url', 'application/pdf']);
  });
  it('stops reading an endless body at the size cap', async () => {
    let bytes = 0;
    const chunk = new TextEncoder().encode('<p>' + 'x'.repeat(16_000) + '</p>');
    const body = new ReadableStream({ pull(c) { bytes += chunk.byteLength; c.enqueue(chunk); } });
    const { service } = harness({ 'https://huge.example/': () => new Response(body, { headers: { 'content-type': 'text/html' } }) },
      { limits: { ...LIMITS, maxBodyBytes: 100_000 } });
    const p = await service.get('https://huge.example/');
    expect(p.fetched).toBe(true);
    expect(bytes).toBeLessThan(200_000);
  });
  it('refuses a private first URL with a 400 and fetches nothing', async () => {
    const { service, calls } = harness({});
    let err: unknown = null;
    try { await service.get('http://169.254.169.254/'); } catch (e) { err = e; }
    expect((err as HttpError).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('user agent: browser first, honest bot when the browser gets nothing', () => {
  const rich = (t: string) => html(doc(`<meta property="og:title" content="${t}"><meta property="og:image" content="/i.png">`));
  const shell = () => html(doc('<title>App</title>', '<div id="root"></div>'));
  const byAgent = (browser: () => Response, bot: () => Response): Route =>
    (_u, init) => ((init.headers as Record<string, string>)['User-Agent'] === DEFAULT_BOT_USER_AGENT ? bot() : browser());

  it('asks once, as a browser, when the browser gets a real card', async () => {
    const { service, agents } = harness({ 'https://ok.example/': () => rich('Card') });
    expect((await service.get('https://ok.example/')).title).toBe('Card');
    expect(agents).toEqual([DEFAULT_USER_AGENT]);
  });
  it('retries as the bot when the browser gets a JavaScript shell (the Spotify case)', async () => {
    const { service, agents } = harness({ 'https://app.example/': byAgent(shell, () => rich('Mr. Brightside')) });
    const p = await service.get('https://app.example/');
    expect([p.title, p.sources.title, !!p.image]).toEqual(['Mr. Brightside', 'og', true]);
    expect(agents).toEqual([DEFAULT_USER_AGENT, DEFAULT_BOT_USER_AGENT]);
  });
  it('retries as the bot when the browser is challenged with a 202 (the Amazon case)', async () => {
    const challenge = () => new Response('', { status: 202, headers: { 'content-type': 'text/html' } });
    const { service } = harness({ 'https://shop.example/': byAgent(challenge, () => rich('Shop')) });
    const p = await service.get('https://shop.example/');
    expect([p.title, p.fetched]).toEqual(['Shop', true]);
  });
  it('keeps the browser result when neither fallback does better', async () => {
    const { service, agents } = harness({ 'https://plain.example/': shell });
    const p = await service.get('https://plain.example/');
    expect([p.title, p.sources.title]).toEqual(['App', 'html']);
    expect(agents).toEqual([DEFAULT_USER_AGENT, DEFAULT_BOT_USER_AGENT, DEFAULT_SOCIAL_USER_AGENT]);
  });
  it('tries the social unfurler last, only after both others came back empty (the NYT case)', async () => {
    const allowlist: Route = (_u, init) => {
      const ua = (init.headers as Record<string, string>)['User-Agent'];
      return ua === DEFAULT_SOCIAL_USER_AGENT ? rich('The New York Times') : new Response('', { status: 403 });
    };
    const { service, agents } = harness({ 'https://news.example/': allowlist });
    const p = await service.get('https://news.example/');
    expect([p.title, p.fetched]).toEqual(['The New York Times', true]);
    expect(agents).toEqual([DEFAULT_USER_AGENT, DEFAULT_BOT_USER_AGENT, DEFAULT_SOCIAL_USER_AGENT]);
  });
  it('never uses the social unfurler when the honest bot already got the card', async () => {
    const { service, agents } = harness({ 'https://app.example/': byAgent(shell, () => rich('Card')) });
    await service.get('https://app.example/');
    expect(agents).not.toContain(DEFAULT_SOCIAL_USER_AGENT);
  });
  it('can have the social unfurler switched off', async () => {
    const agentsSeen: string[] = [];
    const service = createPreviewService({
      lookup: async () => ['93.184.216.34'],
      socialUserAgent: null,
      fetch: async (_url, init) => { agentsSeen.push((init.headers as Record<string, string>)['User-Agent']); return new Response('', { status: 403 }); },
    });
    await service.get('https://news.example/');
    expect(agentsSeen).toEqual([DEFAULT_USER_AGENT, DEFAULT_BOT_USER_AGENT]);
  });
  it('keeps the browser result when the bot is the one that gets blocked', async () => {
    const { service } = harness({ 'https://picky.example/': byAgent(shell, () => new Response('', { status: 403 })) });
    const p = await service.get('https://picky.example/');
    expect([p.title, p.fetched]).toEqual(['App', true]);
  });
  it('counts only a 200 or 203 as a page', async () => {
    for (const [status, fetched] of [[200, true], [203, true], [202, false], [204, false], [206, false]] as const) {
      const { service } = harness({ 'https://s.example/': () => new Response(status === 204 ? null : doc('<meta property="og:title" content="T">'), { status, headers: { 'content-type': 'text/html' } }) });
      expect([status, (await service.get('https://s.example/')).fetched]).toEqual([status, fetched]);
    }
  });
  it('calls a result thin when a card would have nothing but the URL', () => {
    const base = { ...urlOnlyPreview('https://u.example/', 'https://u.example/'), fetched: true, status: 200, contentType: 'text/html' };
    expect(isThin({ ...base, sources: { title: 'html', description: null, image: null } })).toBe(true);
    expect(isThin({ ...base, sources: { title: 'og', description: null, image: null } })).toBe(false);
    expect(isThin({ ...base, image: 'i', sources: { title: 'html', description: null, image: 'link' } })).toBe(false);
    expect(isThin({ ...base, fetched: false, sources: { title: 'url', description: null, image: null } })).toBe(true);
  });
});

describe('caching', () => {
  const page = () => html(doc('<meta property="og:title" content="Cached">'));
  it('serves a repeat from the cache for 24 hours, then fetches again', async () => {
    const { service, calls, advance } = harness({ 'https://c.example/': page });
    await service.get('https://c.example/');
    await service.get('https://c.example/');
    expect(calls.length).toBe(1);
    advance(LIMITS.successTtlMs - 1);
    await service.get('https://c.example/');
    expect(calls.length).toBe(1);
    advance(2);
    await service.get('https://c.example/');
    expect(calls.length).toBe(2);
  });
  it('keeps a failure for ten minutes only', async () => {
    const { service, calls, advance } = harness({ 'https://f.example/': () => new Response('', { status: 503 }) });
    await service.get('https://f.example/');
    const afterFirst = calls.length;
    advance(LIMITS.failureTtlMs - 1);
    await service.get('https://f.example/');
    expect(calls.length).toBe(afterFirst);
    advance(2);
    await service.get('https://f.example/');
    expect(calls.length).toBeGreaterThan(afterFirst);
  });
  it('ignores the fragment, which never changes what the server sends', async () => {
    const { service, calls } = harness({ 'https://c.example/': page });
    await service.get('https://c.example/#a');
    await service.get('https://c.example/#b');
    expect(calls).toEqual(['https://c.example/']);
  });
  it('shares one upstream fetch between simultaneous requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { service, calls } = harness({ 'https://c.example/': async () => { await gate; return page(); } });
    const a = service.get('https://c.example/');
    const b = service.get('https://c.example/');
    release();
    const [pa, pb] = await Promise.all([a, b]);
    expect(calls.length).toBe(1);
    expect(pa).toEqual(pb);
  });
  it('evicts the least recently used entry when full', async () => {
    const routes: Record<string, Route> = {};
    for (const k of ['a', 'b', 'c']) routes[`https://${k}.example/`] = page;
    const { service, calls } = harness(routes, { limits: { ...LIMITS, maxCacheEntries: 2 } });
    await service.get('https://a.example/');
    await service.get('https://b.example/');
    await service.get('https://a.example/'); // a is now the most recent
    await service.get('https://c.example/'); // evicts b
    expect(service.size()).toBe(2);
    await service.get('https://a.example/');
    expect(calls.filter((u) => u === 'https://a.example/').length).toBe(1);
    await service.get('https://b.example/');
    expect(calls.filter((u) => u === 'https://b.example/').length).toBe(2);
  });
  it('refuses work past the queue cap instead of piling it up', async () => {
    const hang: Route = () => new Promise(() => {});
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 5; i++) routes[`https://q${i}.example/`] = hang;
    const { service } = harness(routes, { limits: { ...LIMITS, maxConcurrent: 1, maxQueued: 2, timeoutMs: 60_000 } });
    for (let i = 0; i < 3; i++) service.get(`https://q${i}.example/`).catch(() => {});
    let err: unknown = null;
    try { await service.get('https://q3.example/'); } catch (e) { err = e; }
    expect((err as HttpError).status).toBe(503);
  });
});

// --------------------------------------------------------- rate limiting --

describe('rate limiter', () => {
  it('allows the limit, refuses past it, and reopens with the next window', () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([1, 2, 3].map(() => rl.check('ip').ok)).toEqual([true, true, true]);
    const denied = rl.check('ip');
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSec).toBe(60);
    expect(rl.check('other').ok).toBe(true); // per client, not global
    t += 60_000;
    expect(rl.check('ip').ok).toBe(true);
  });
});

// ----------------------------------------------------------------- route --

describe('GET /v1/link-preview', () => {
  const stub = (result: Partial<LinkPreview>) => ({
    get: async (url: string) => {
      if (url.includes('169.254')) throw new HttpError(400, 'that address is not on the public internet');
      return { ...urlOnlyPreview(url, url), fetched: true, status: 200, contentType: 'text/html', ...result } as LinkPreview;
    },
    size: () => 0,
  });
  const mount = (service: ReturnType<typeof stub>, limit = 100) => {
    const app = new Hono();
    app.route('/v1/link-preview', linkPreviewRoutes(service as any, createRateLimiter({ limit, windowMs: 60_000 })));
    app.onError((err, c) => c.json({ error: err.message }, (err as HttpError).status as any || 500));
    return app;
  };

  it('answers with the preview and a one-day cache header', async () => {
    const res = await mount(stub({ title: 'Hi' })).request('/v1/link-preview?url=' + encodeURIComponent('https://a.example/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect((await res.json()).title).toBe('Hi');
  });
  it('caches a failed read for ten minutes only', async () => {
    const res = await mount(stub({ fetched: false })).request('/v1/link-preview?url=https://a.example/');
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
  });
  it('rejects a missing or oversized url', async () => {
    const app = mount(stub({}));
    expect((await app.request('/v1/link-preview')).status).toBe(400);
    expect((await app.request('/v1/link-preview?url=https://a.example/' + 'x'.repeat(3000))).status).toBe(400);
  });
  it('passes the SSRF refusal through as a 400', async () => {
    expect((await mount(stub({})).request('/v1/link-preview?url=http://169.254.169.254/')).status).toBe(400);
  });
  it('rate-limits with a 429 and a Retry-After', async () => {
    const app = mount(stub({}), 2);
    await app.request('/v1/link-preview?url=https://a.example/');
    await app.request('/v1/link-preview?url=https://a.example/');
    const res = await app.request('/v1/link-preview?url=https://a.example/');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('is mounted on the real app', async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite://:memory:';
    const { default: app } = await import('../src/app');
    const res = await app.request('/v1/link-preview');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing url');
  });
});
