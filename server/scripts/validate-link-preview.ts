// Live check of the link-preview pipeline against real sites, one per failure
// mode that matters. Hits the network, so it is a script and not part of
// `bun test`: a suite that fails whenever a publisher changes its bot wall
// would teach everyone to ignore it.
//
//   bun run validate:link-preview                        in-process, this checkout
//   bun run validate:link-preview --api https://pandemonium.commongenius.in/api
//                                                        the production Pages Function
//   bun run validate:link-preview --api http://localhost:8787/v1
//                                                        a running Bun server
//
// Besides the metadata, every case whose preview has an image fetches that
// image the way the card will (no Referer, as referrerpolicy="no-referrer"
// sends), because "the parser found an og:image" and "a thumbnail shows up"
// are different claims, and only the second is the one that matters.
//
// Exits non-zero if any expectation fails.

import { createPreviewService } from '../src/link-preview/service';
import { systemLookup } from '../src/link-preview/dns';
import type { LinkPreview } from '../src/link-preview/parse';

type Check = (p: LinkPreview) => string[]; // problems; empty means pass
interface Case { name: string; url: string; proves: string; check: Check }

const has = (cond: unknown, problem: string) => (cond ? [] : [problem]);
const CJK = /[぀-ヿ㐀-鿿]/;
const MOJIBAKE = /�|Ã.|ã\u0080|â€/;

const CASES: Case[] = [
  {
    name: 'Baseline', url: 'https://ogp.me/',
    proves: 'core og:title, og:type, og:image and og:url extraction',
    check: (p) => [
      ...has(p.sources.title === 'og', `title from ${p.sources.title}, expected og`),
      ...has(p.type === 'website', `og:type ${p.type}`),
      ...has(p.sources.image === 'og' && p.image, `image from ${p.sources.image}`),
      ...has(p.canonicalUrl === 'https://ogp.me/', `og:url ${p.canonicalUrl}`),
      ...has(p.imageWidth === 300 && p.imageHeight === 300, `og:image size ${p.imageWidth}x${p.imageHeight}`),
    ],
  },
  {
    name: 'Missing tags', url: 'https://example.com/',
    proves: 'zero OG tags: falls back to <title> and then the plain-HTML description tiers, and invents no image',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(p.sources.title === 'html', `title from ${p.sources.title}, expected <title>`),
      ...has(p.description && (p.sources.description === 'meta' || p.sources.description === 'paragraph'), `description from ${p.sources.description}`),
      ...has(p.image === null && p.type === null, 'an image or og:type appeared from nowhere'),
    ],
  },
  {
    name: 'Video media', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    proves: 'og:video with its width and height, plus the oEmbed parameters',
    check: (p) => [
      ...has(/rick astley/i.test(p.title), `title "${p.title}"`),
      ...has(p.video && /youtube\.com\/embed\//.test(p.video.url), `og:video ${p.video && p.video.url}`),
      ...has(p.video && p.video.width && p.video.height, 'og:video:width/height missing'),
      ...has(p.oembed && p.oembed.providerName === 'YouTube' && p.oembed.authorName, `oEmbed ${JSON.stringify(p.oembed)}`),
    ],
  },
  {
    name: 'Audio media', url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
    proves: 'og:audio and the music.song detail (artist, duration, release date)',
    check: (p) => [
      ...has(p.type === 'music.song', `og:type ${p.type}`),
      ...has(p.audio && p.audio.url, 'no og:audio'),
      ...has(p.music && p.music.duration && p.music.musicians.length, `music ${JSON.stringify(p.music)}`),
      ...has(p.image, 'no image'),
    ],
  },
  {
    name: 'Articles (homepage)', url: 'https://www.nytimes.com/',
    proves: 'a publisher that allows only social unfurlers is read, and its JSON-LD is parsed',
    check: (p) => [
      ...has(p.fetched && p.sources.title === 'og', `title from ${p.sources.title} (fetched ${p.fetched}, status ${p.status})`),
      ...has(p.image, 'no image'),
      ...has(p.jsonLdTypes.length > 0, 'no JSON-LD found'),
    ],
  },
  {
    name: 'Bot protection', url: 'https://www.amazon.com/',
    proves: 'a bot wall is survived: the page is read, or URL-only data comes back; never a crash',
    check: (p) => [
      ...has(typeof p.title === 'string' && p.title.length > 0, 'no title at all'),
      ...has(p.domain === 'amazon.com', `domain ${p.domain}`),
      ...has(!(p.fetched && /robot check|captcha|sorry/i.test(p.title)), `scraped the block page as the title: "${p.title}"`),
    ],
  },
  {
    name: 'Redirects', url: 'http://github.com/',
    proves: 'a 301 from http to https is followed (every hop re-checked) before parsing',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(p.finalUrl.startsWith('https://github.com'), `finalUrl ${p.finalUrl}`),
      ...has(/github/i.test(p.title), `title "${p.title}"`),
    ],
  },
  {
    name: 'Character encoding', url: 'https://ja.wikipedia.org/wiki/メインページ',
    proves: 'a non-Latin URL is encoded for the request, and Japanese text decodes without mojibake',
    // The main page's own title is the English "Wikipedia", in <title> and
    // og:title alike, so the Japanese is checked where it is: the description.
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(CJK.test(p.description || ''), `description "${p.description}" has no Japanese`),
      ...has(!MOJIBAKE.test(p.title + ' ' + (p.description || '')), 'mojibake or replacement characters'),
    ],
  },
  {
    name: 'Image scaling', url: 'https://unsplash.com/',
    proves: 'a heavy og:image from an image CDN is found and actually loadable for the card',
    check: (p) => [
      ...has(p.fetched && p.sources.title === 'og', `title from ${p.sources.title} (fetched ${p.fetched}, status ${p.status})`),
      ...has(p.image && /images\.unsplash\.com/.test(p.image), `image ${p.image}`),
    ],
  },
];

const apiIdx = process.argv.indexOf('--api');
const apiBase = apiIdx > 0 ? process.argv[apiIdx + 1].replace(/\/$/, '') : null;
const service = apiBase ? null : createPreviewService({ lookup: systemLookup });
const SOCIAL_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

async function preview(url: string): Promise<LinkPreview> {
  if (service) return service.get(url);
  const res = await fetch(`${apiBase}/link-preview?url=${encodeURIComponent(url)}`, { headers: { 'sec-fetch-site': 'same-origin' } });
  if (!res.ok) throw new Error(`API answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<LinkPreview>;
}

// The newest article linked from the NYT homepage, found at run time so the
// article case never goes stale. Missing is reported, not failed: it depends
// on NYT letting THIS machine read its homepage, which is not what is tested.
async function nytArticle(): Promise<string | null> {
  try {
    const res = await fetch('https://www.nytimes.com/', { headers: { 'User-Agent': SOCIAL_UA } });
    const m = /https:\/\/www\.nytimes\.com\/20\d\d\/\d\d\/\d\d\/[a-z0-9/-]+\.html/.exec(await res.text());
    return m ? m[0] : null;
  } catch { return null; }
}

// Load the image as the card will: no Referer. Reports size and type.
async function probeImage(url: string): Promise<{ ok: boolean; note: string }> {
  try {
    const res = await fetch(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) } as RequestInit);
    const type = res.headers.get('content-type') || '?';
    const bytes = (await res.arrayBuffer()).byteLength;
    const ok = res.status === 200 && /^image\//.test(type);
    return { ok, note: `${res.status} ${type} ${(bytes / 1024).toFixed(0)} KB` };
  } catch (err) {
    return { ok: false, note: `failed: ${(err as Error).message}` };
  }
}

const article = await nytArticle();
if (article) {
  CASES.splice(5, 0, {
    name: 'Articles (article page)', url: article,
    proves: 'article:published_time, article:author and a JSON-LD article schema on a real NYT article',
    check: (p) => [
      ...has(p.fetched && p.type === 'article', `og:type ${p.type} (fetched ${p.fetched}, status ${p.status})`),
      ...has(p.article && p.article.publishedTime, 'no published time'),
      ...has(p.article && p.article.authors.length, 'no author'),
      ...has(p.jsonLdTypes.some((t) => /article/i.test(t)), `JSON-LD types ${JSON.stringify(p.jsonLdTypes)}`),
    ],
  });
}

const clip = (s: unknown, n: number) => (s == null ? '-' : String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

console.log(`link-preview validation (${apiBase ? 'API ' + apiBase : 'in-process'})`);
if (!article) console.log('(NYT article case skipped: no article link found on the homepage from this machine)');
console.log('');
let failures = 0;
for (const c of CASES) {
  const started = performance.now();
  let problems: string[];
  let p: LinkPreview | null = null;
  try {
    p = await preview(c.url);
    problems = c.check(p);
  } catch (err) {
    problems = [`threw: ${(err as Error).message}`];
  }
  let imageNote = '';
  if (p && p.image) {
    const probe = await probeImage(p.image);
    imageNote = probe.note;
    if (!probe.ok) problems.push(`image does not load: ${probe.note}`);
  }
  const ms = Math.round(performance.now() - started);
  if (problems.length) failures++;
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${c.name}  (${ms} ms)  ${c.url}`);
  console.log(`      proves: ${c.proves}`);
  if (p) {
    console.log(`      title       [${p.sources.title}] ${clip(p.title, 80)}`);
    console.log(`      description [${p.sources.description}] ${clip(p.description, 80)}`);
    console.log(`      image       [${p.sources.image}] ${clip(p.image, 70)}${p.imageWidth ? `  (${p.imageWidth}x${p.imageHeight})` : ''}${imageNote ? `  -> ${imageNote}` : ''}`);
    const extra = [
      p.type && `type ${p.type}`, p.card && `card ${p.card}`,
      p.video && `video ${p.video.width}x${p.video.height}${p.video.duration ? ' ' + p.video.duration + 's' : ''}`,
      p.audio && `audio ${p.audio.type}`,
      p.music && `music ${p.music.musicians.join(', ')} ${p.music.duration}s ${p.music.releaseDate || ''}`,
      p.article && `article ${p.article.authors.join(', ') || '(no author)'} ${p.article.publishedTime || ''}`,
      p.jsonLdTypes.length && `json-ld ${p.jsonLdTypes.join(',')}`,
      p.oembed && `oembed ${p.oembed.providerName}/${p.oembed.authorName}`,
    ].filter(Boolean).join(' | ');
    if (extra) console.log(`      detail      ${clip(extra, 150)}`);
    console.log(`      domain ${p.domain}   final ${clip(p.finalUrl, 55)}   status ${p.status}   fetched ${p.fetched}`);
  }
  for (const problem of problems) console.log(`      !! ${problem}`);
  console.log('');
}
console.log(failures ? `${failures} of ${CASES.length} failed` : `all ${CASES.length} passed`);
process.exit(failures ? 1 : 0);
