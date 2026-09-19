// Live check of the link-preview pipeline against real sites, one per failure
// mode that matters. Hits the network, so it is a script and not part of
// `bun test`: a suite that fails whenever Amazon changes its bot wall would
// teach everyone to ignore it.
//
//   bun run validate:link-preview                  in-process, this checkout
//   bun run validate:link-preview --api https://api.pandemonium.commongenius.in/v1
//                                                  against a deployed API
//
// Exits non-zero if any expectation fails. Each case names what it proves.

import { createPreviewService } from '../src/link-preview/service';
import type { LinkPreview } from '../src/link-preview/parse';

type Check = (p: LinkPreview) => string[]; // problems; empty means pass

interface Case { name: string; url: string; proves: string; check: Check }

const has = (cond: boolean, problem: string) => (cond ? [] : [problem]);
const CJK = /[぀-ヿ㐀-鿿]/;
const MOJIBAKE = /�|Ã.|ã\u0080|â€/;

const CASES: Case[] = [
  {
    name: 'Baseline standard', url: 'https://ogp.me/',
    proves: 'perfect OG tags are read tier-one for every field',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(p.sources.title === 'og', `title from ${p.sources.title}, expected og`),
      ...has(p.sources.description === 'og', `description from ${p.sources.description}, expected og`),
      ...has(p.sources.image === 'og' && !!p.image, `image from ${p.sources.image}, expected og`),
      ...has(p.domain === 'ogp.me', `domain ${p.domain}`),
    ],
  },
  {
    name: 'Missing tags (fallback)', url: 'https://example.com/',
    proves: 'with no OG or Twitter tags, the plain-HTML tiers fill in and no image is invented',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(p.sources.title === 'html', `title from ${p.sources.title}, expected <title>`),
      ...has(p.description != null && (p.sources.description === 'meta' || p.sources.description === 'paragraph'),
        `description from ${p.sources.description}, expected meta or first <p>`),
      ...has(p.image === null, `image ${p.image}, expected none`),
      ...has(p.domain === 'example.com', `domain ${p.domain}`),
    ],
  },
  {
    name: 'Media / video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    proves: 'a video page yields its real title and its thumbnail',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(/rick astley|never gonna/i.test(p.title), `title "${p.title}"`),
      ...has(!!p.image && /ytimg\.com/.test(p.image), `image ${p.image}`),
      ...has(p.domain === 'youtube.com', `domain ${p.domain}`),
    ],
  },
  {
    name: 'Audio / app', url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
    proves: 'an app deep link served as a web page still carries its OG card',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(p.sources.title === 'og', `title from ${p.sources.title}, expected og`),
      ...has(!!p.image, 'no image'),
      ...has(p.domain === 'open.spotify.com', `domain ${p.domain}`),
    ],
  },
  {
    name: 'Bot protection', url: 'https://www.amazon.com/',
    proves: 'a bot wall is survived: either the page is read, or URL-only data comes back; never a crash',
    check: (p) => [
      ...has(typeof p.title === 'string' && p.title.length > 0, 'no title at all'),
      ...has(p.domain === 'amazon.com', `domain ${p.domain}`),
      // Blocked is an acceptable outcome; what is not acceptable is a scraped
      // "Robot Check" page presented as Amazon's title.
      ...has(!(p.fetched && /robot check|captcha|sorry/i.test(p.title)), `scraped the block page as the title: "${p.title}"`),
    ],
  },
  {
    name: 'HTTP redirect', url: 'http://github.com/',
    proves: 'a 301 is followed by hand (every hop re-checked) and the landing page is read',
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(p.finalUrl.startsWith('https://github.com'), `finalUrl ${p.finalUrl}, expected the https redirect target`),
      ...has(/github/i.test(p.title), `title "${p.title}"`),
      ...has(p.domain === 'github.com', `domain ${p.domain}`),
    ],
  },
  {
    name: 'Character encoding', url: 'https://ja.wikipedia.org/wiki/メインページ',
    proves: 'a non-Latin URL is encoded for the request, and the Japanese page decodes without mojibake',
    // The main page's own title is the English "Wikipedia", in <title> and in
    // og:title alike, so the title cannot carry this test. The Japanese is in
    // the body, and the description falls to the first <p>, which is where the
    // decoding is actually exercised.
    check: (p) => [
      ...has(p.fetched, 'not fetched'),
      ...has(CJK.test(p.description || ''), `description "${p.description}" has no Japanese`),
      ...has(!MOJIBAKE.test(p.title + ' ' + (p.description || '')), 'mojibake or replacement characters in the text'),
      ...has(p.domain === 'ja.wikipedia.org', `domain ${p.domain}`),
    ],
  },
];

const apiIdx = process.argv.indexOf('--api');
const apiBase = apiIdx > 0 ? process.argv[apiIdx + 1] : null;
const service = apiBase ? null : createPreviewService();

async function preview(url: string): Promise<LinkPreview> {
  if (service) return service.get(url);
  const res = await fetch(`${apiBase}/link-preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`API answered ${res.status}: ${await res.text()}`);
  return res.json() as Promise<LinkPreview>;
}

const clip = (s: string | null, n: number) => (s == null ? '-' : s.length > n ? s.slice(0, n - 1) + '…' : s);

console.log(`link-preview validation (${apiBase ? 'API ' + apiBase : 'in-process'})\n`);
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
  const ms = Math.round(performance.now() - started);
  if (problems.length) failures++;
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${c.name}  (${ms} ms)  ${c.url}`);
  console.log(`      proves: ${c.proves}`);
  if (p) {
    console.log(`      title       [${p.sources.title}] ${clip(p.title, 90)}`);
    console.log(`      description [${p.sources.description}] ${clip(p.description, 90)}`);
    console.log(`      image       [${p.sources.image}] ${clip(p.image, 90)}`);
    console.log(`      domain ${p.domain}   final ${clip(p.finalUrl, 60)}   status ${p.status}   fetched ${p.fetched}`);
  }
  for (const problem of problems) console.log(`      !! ${problem}`);
  console.log('');
}
console.log(failures ? `${failures} of ${CASES.length} failed` : `all ${CASES.length} passed`);
process.exit(failures ? 1 : 0);
