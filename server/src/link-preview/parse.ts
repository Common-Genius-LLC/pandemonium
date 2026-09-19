// Page metadata extraction, split in two so the rules can be tested on their
// own:
//
//   extractMeta(html)  streams the document through Bun's native HTMLRewriter
//                      and collects every candidate value, untouched by policy.
//   buildPreview(raw)  applies the fallback hierarchy to those candidates.
//
// The hierarchy is fixed and each field records which tier it came from
// (`sources`), so a preview can always say WHY it shows what it shows:
//
//   title        og:title > twitter:title > <title> > the URL itself
//   description  og:description > twitter:description > meta description
//                > the first <p> that has any text > null
//   image        og:image > twitter:image > <link rel="image_src"> > null
//                (never an arbitrary <img>: a page's first image is usually a
//                logo, an ad or a tracking pixel, and a wrong image is worse
//                than none)
//   domain       the hostname of the URL that was ASKED for, minus "www.".
//                Not og:site_name, which is free text; and not the post-redirect
//                host either, because the card links to the URL that was asked
//                for, and showing a different domain from the one the click goes
//                to is how a shortener dresses one site up as another.
//
// Two things HTMLRewriter does not do, done here: it hands back attribute
// values and text with entities still encoded ("Tom &amp; Jerry"), and it has
// no idea what encoding the bytes were in (decoding happens before it, in
// decodeBody).

import { decodeHTML, decodeHTMLAttribute } from 'entities';
import { ipVersion, isPublicAddress } from './ip';

export const MAX_TITLE = 300;
export const MAX_DESCRIPTION = 500;

export interface RawMeta {
  // Every value per lower-cased property/name/itemprop, in document order.
  // Several keys legitimately repeat (article:author, music:musician,
  // og:video:tag), and the first one is still the one the fallbacks use.
  meta: Record<string, string[]>;
  title: string | null;
  imageSrc: string | null; // <link rel="image_src">
  firstParagraph: string | null;
  base: string | null; // <base href>
  canonical: string | null; // <link rel="canonical">
  oembed: string | null; // <link rel="alternate" type="application/json+oembed">
  icons: Array<{ href: string; rel: string; size: number | null }>;
  jsonLd: string[]; // raw text of each <script type="application/ld+json">
}

export type TitleSource = 'og' | 'twitter' | 'html' | 'url';
export type DescriptionSource = 'og' | 'twitter' | 'meta' | 'paragraph' | null;
export type ImageSource = 'og' | 'twitter' | 'link' | 'self' | null;

export interface VideoMeta { url: string; type: string | null; width: number | null; height: number | null; duration: number | null }
export interface AudioMeta { url: string; type: string | null }
export interface MusicMeta {
  duration: number | null; // seconds
  releaseDate: string | null;
  albumUrl: string | null;
  trackNumber: number | null;
  musicians: string[]; // names (music:musician_description); music:musician itself is a URL
}
export interface ArticleMeta {
  publishedTime: string | null;
  modifiedTime: string | null;
  authors: string[];
  section: string | null;
  tags: string[];
  headline: string | null; // JSON-LD only
  publisher: string | null; // JSON-LD only
}
export interface OEmbedMeta {
  type: string | null;
  title: string | null;
  authorName: string | null;
  authorUrl: string | null;
  providerName: string | null;
  thumbnailUrl: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  width: number | null;
  height: number | null;
}

export interface LinkPreview {
  url: string; // what was asked for
  finalUrl: string; // where the redirects ended
  domain: string;
  title: string;
  description: string | null;
  image: string | null;
  sources: { title: TitleSource; description: DescriptionSource; image: ImageSource };
  // false when the page could not be fetched or was not a success (blocked,
  // 4xx/5xx, timeout, too many redirects). The fields are still filled, from
  // the URL alone, so a caller always has something to show.
  fetched: boolean;
  status: number | null; // HTTP status of the last hop, when there was one
  contentType: string | null;

  // Everything below is additive detail. None of it feeds the fallback
  // hierarchy above, which stays exactly as specified; a card uses it to say
  // more (a song's artist and length, an article's byline, a video's player).
  type: string | null; // og:type: website, article, video.other, music.song...
  siteName: string | null; // og:site_name, for display only; never the domain
  canonicalUrl: string | null; // og:url > <link rel="canonical">
  favicon: string | null;
  card: 'summary' | 'summary_large_image' | 'player' | 'app' | null; // twitter:card
  imageWidth: number | null;
  imageHeight: number | null;
  imageAlt: string | null;
  video: VideoMeta | null;
  audio: AudioMeta | null;
  music: MusicMeta | null;
  article: ArticleMeta | null;
  jsonLdTypes: string[]; // every schema.org @type found, e.g. ["NewsArticle"]
  oembedUrl: string | null; // discovered; the service fetches it
  oembed: OEmbedMeta | null;
}

const clean = (s: string | null | undefined, max: number): string | null => {
  if (s == null) return null;
  const out = s.replace(/\s+/g, ' ').trim();
  if (!out) return null;
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
};

// Meta keys are matched on property, name or itemprop, lower-cased: OG is
// specified on `property` and Twitter on `name`, but real pages mix them up in
// both directions often enough that honouring only the spelling in the spec
// loses real metadata. Only the namespaces a card can use are kept, and each
// key is capped, because some pages repeat a key hundreds of times (Spotify
// lists every country a track may play in).
const META_PREFIX = /^(og|twitter|music|article|video):/;
const META_NAMES = new Set(['description', 'author', 'duration', 'byl']);
const MAX_PER_KEY = 20;
const MAX_JSONLD_BYTES = 256_000;

export async function extractMeta(html: string): Promise<RawMeta> {
  const raw: RawMeta = {
    meta: {}, title: null, imageSrc: null, firstParagraph: null, base: null,
    canonical: null, oembed: null, icons: [], jsonLd: [],
  };
  let titleBuf: string | null = null;
  let titleDone = false;
  let pBuf = '';
  let pDone = false;
  let inP = 0;
  let ldBuf: string | null = null;
  let ldBytes = 0;

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') || el.getAttribute('name') || el.getAttribute('itemprop') || '').trim().toLowerCase();
        if (!key || (!META_PREFIX.test(key) && !META_NAMES.has(key))) return;
        const content = el.getAttribute('content');
        if (content == null) return;
        const value = decodeHTMLAttribute(content).trim();
        if (!value) return;
        const list = (raw.meta[key] = raw.meta[key] || []);
        if (list.length < MAX_PER_KEY) list.push(value);
      },
    })
    .on('title', {
      // The first <title> only. The document's own title sits in <head>, ahead
      // of any <svg><title> in the body.
      element(el) {
        if (titleDone) return;
        titleBuf = '';
        el.onEndTag(() => { titleDone = true; raw.title = decodeHTML(titleBuf || ''); });
      },
      text(t) { if (!titleDone && titleBuf != null) titleBuf += t.text; },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase().trim();
        const rels = rel.split(/\s+/);
        const hrefRaw = el.getAttribute('href');
        if (!hrefRaw) return;
        const href = decodeHTMLAttribute(hrefRaw).trim();
        if (rels.includes('image_src') && !raw.imageSrc) raw.imageSrc = href;
        if (rels.includes('canonical') && !raw.canonical) raw.canonical = href;
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (rels.includes('alternate') && type === 'application/json+oembed' && !raw.oembed) raw.oembed = href;
        if (rels.includes('icon') || rels.includes('apple-touch-icon')) {
          const m = /(\d+)x\d+/.exec(el.getAttribute('sizes') || '');
          if (raw.icons.length < 12) raw.icons.push({ href, rel, size: m ? Number(m[1]) : null });
        }
      },
    })
    .on('base', {
      element(el) {
        const href = el.getAttribute('href');
        if (!raw.base && href) raw.base = decodeHTMLAttribute(href).trim();
      },
    })
    .on('script', {
      // JSON-LD only; script text is not HTML, so it is taken verbatim, not
      // entity-decoded.
      element(el) {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (!type.startsWith('application/ld+json') || ldBytes >= MAX_JSONLD_BYTES) return;
        ldBuf = '';
        el.onEndTag(() => {
          if (ldBuf != null && ldBuf.trim()) raw.jsonLd.push(ldBuf);
          ldBuf = null;
        });
      },
      text(t) {
        if (ldBuf == null) return;
        ldBytes += t.text.length;
        if (ldBytes <= MAX_JSONLD_BYTES) ldBuf += t.text;
      },
    })
    .on('p', {
      // The first paragraph with any real text: an empty <p> used as a spacer
      // is not "the first paragraph" in any sense a reader would recognise.
      // The text handler sees text from nested inline elements too, so a
      // paragraph with <b> or <a> inside is read whole.
      element(el) {
        if (pDone) return;
        inP++;
        pBuf = '';
        el.onEndTag(() => {
          inP--;
          const text = decodeHTML(pBuf).replace(/\s+/g, ' ').trim();
          if (!pDone && text) { pDone = true; raw.firstParagraph = text; }
        });
      },
      text(t) { if (!pDone && inP > 0) pBuf += t.text; },
    });

  await rewriter.transform(new Response(html)).arrayBuffer();
  if (!titleDone && titleBuf) raw.title = decodeHTML(titleBuf);
  return raw;
}

// A URL the viewer's browser will load (an image, a player, an icon).
// Relative and protocol-relative values resolve against <base> or the page's
// own URL; anything that is not http(s), or that points at a private address
// literal, is dropped rather than handed to every browser that renders the
// card.
function resolveHttp(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  let u: URL;
  try { u = new URL(value, baseUrl); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || (ipVersion(host) && !isPublicAddress(host))) return null;
  return u.href;
}

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}

// A preview made from the URL alone, for when there is no page to read. Every
// field the card needs is still present, so "always return data" holds even
// for a block or a timeout.
export function urlOnlyPreview(requestedUrl: string, finalUrl: string, extra: Partial<LinkPreview> = {}): LinkPreview {
  return {
    url: requestedUrl,
    finalUrl,
    domain: domainOf(requestedUrl),
    title: requestedUrl,
    description: null,
    image: null,
    sources: { title: 'url', description: null, image: null },
    fetched: false,
    status: null,
    contentType: null,
    ...EMPTY_DETAIL,
    ...extra,
  };
}

const EMPTY_DETAIL = {
  type: null, siteName: null, canonicalUrl: null, favicon: null, card: null,
  imageWidth: null, imageHeight: null, imageAlt: null,
  video: null, audio: null, music: null, article: null, jsonLdTypes: [] as string[],
  oembedUrl: null, oembed: null,
} satisfies Partial<LinkPreview>;

export function buildPreview(raw: RawMeta, { requestedUrl, finalUrl, status = 200, contentType = 'text/html' }: {
  requestedUrl: string; finalUrl: string; status?: number; contentType?: string | null;
}): LinkPreview {
  const m = raw.meta;
  const one = (key: string) => (m[key] && m[key][0]) || null;
  let base = finalUrl;
  if (raw.base) { try { base = new URL(raw.base, finalUrl).href; } catch { /* keep the page URL */ } }

  let title: string | null;
  let titleSource: TitleSource;
  if ((title = clean(one('og:title'), MAX_TITLE))) titleSource = 'og';
  else if ((title = clean(one('twitter:title'), MAX_TITLE))) titleSource = 'twitter';
  else if ((title = clean(raw.title, MAX_TITLE))) titleSource = 'html';
  else { title = requestedUrl; titleSource = 'url'; }

  let description: string | null;
  let descriptionSource: DescriptionSource;
  if ((description = clean(one('og:description'), MAX_DESCRIPTION))) descriptionSource = 'og';
  else if ((description = clean(one('twitter:description'), MAX_DESCRIPTION))) descriptionSource = 'twitter';
  else if ((description = clean(one('description'), MAX_DESCRIPTION))) descriptionSource = 'meta';
  else if ((description = clean(raw.firstParagraph, MAX_DESCRIPTION))) descriptionSource = 'paragraph';
  else { description = null; descriptionSource = null; }

  let image: string | null;
  let imageSource: ImageSource;
  if ((image = resolveHttp(one('og:image') || one('og:image:secure_url') || one('og:image:url'), base))) imageSource = 'og';
  else if ((image = resolveHttp(one('twitter:image') || one('twitter:image:src'), base))) imageSource = 'twitter';
  else if ((image = resolveHttp(raw.imageSrc, base))) imageSource = 'link';
  else { image = null; imageSource = null; }

  // Dimensions describe the og:image they sit beside; a twitter image carries
  // only its alt text. Borrowed dimensions would misdescribe a different file.
  const imageWidth = imageSource === 'og' ? posInt(one('og:image:width')) : null;
  const imageHeight = imageSource === 'og' ? posInt(one('og:image:height')) : null;
  const imageAlt = clean(imageSource === 'og' ? one('og:image:alt') : imageSource === 'twitter' ? one('twitter:image:alt') : null, MAX_TITLE);

  const cardValue = (one('twitter:card') || '').toLowerCase();
  const card = (['summary', 'summary_large_image', 'player', 'app'] as const).find((c) => c === cardValue) || null;

  const videoUrl = resolveHttp(one('og:video:secure_url') || one('og:video:url') || one('og:video'), base);
  const video: VideoMeta | null = videoUrl ? {
    url: videoUrl,
    type: one('og:video:type'),
    width: posInt(one('og:video:width')),
    height: posInt(one('og:video:height')),
    duration: posInt(one('video:duration')) ?? isoSeconds(one('duration')),
  } : null;

  const audioUrl = resolveHttp(one('og:audio:secure_url') || one('og:audio:url') || one('og:audio'), base);
  const audio: AudioMeta | null = audioUrl ? { url: audioUrl, type: one('og:audio:type') } : null;

  const type = clean(one('og:type'), 64);
  const musicKeys = Object.keys(m).some((k) => k.startsWith('music:'));
  const music: MusicMeta | null = musicKeys || (type || '').startsWith('music.') ? {
    duration: posInt(one('music:duration')),
    releaseDate: clean(one('music:release_date'), 32),
    albumUrl: resolveHttp(one('music:album'), base),
    trackNumber: posInt(one('music:album:track')),
    musicians: names(m['music:musician_description'] || []),
  } : null;

  const ld = readJsonLd(raw.jsonLd, base);
  const metaAuthors = names(m['article:author'] || []);
  const hasArticleMeta = Object.keys(m).some((k) => k.startsWith('article:'));
  const article: ArticleMeta | null = hasArticleMeta || ld.article || (type === 'article') ? {
    publishedTime: clean(one('article:published_time'), 64) || (ld.article && ld.article.datePublished) || null,
    modifiedTime: clean(one('article:modified_time'), 64) || (ld.article && ld.article.dateModified) || null,
    // Meta tags first, then the schema, then a bare <meta name="author">.
    authors: metaAuthors.length ? metaAuthors
      : (ld.article && ld.article.authors.length) ? ld.article.authors
        : names([...(m['author'] || []), ...(m['byl'] || []).map((b) => b.replace(/^by\s+/i, ''))]),
    section: clean(one('article:section'), 80),
    tags: names(m['article:tag'] || []).slice(0, 10),
    headline: ld.article ? ld.article.headline : null,
    publisher: ld.article ? ld.article.publisher : null,
  } : null;

  return {
    url: requestedUrl,
    finalUrl,
    domain: domainOf(requestedUrl),
    title,
    description,
    image,
    sources: { title: titleSource, description: descriptionSource, image: imageSource },
    fetched: true,
    status,
    contentType,
    type,
    siteName: clean(one('og:site_name'), 80),
    canonicalUrl: resolveHttp(one('og:url'), base) || resolveHttp(raw.canonical, base),
    favicon: pickIcon(raw.icons, base),
    card,
    imageWidth,
    imageHeight,
    imageAlt,
    video,
    audio,
    music,
    article,
    jsonLdTypes: ld.types,
    oembedUrl: resolveHttp(raw.oembed, base),
    oembed: null,
  };
}

// ---- small readers ----

function posInt(v: string | number | null | undefined): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// ISO 8601 durations as schema.org and YouTube write them: PT3M34S, PT1H2M.
export function isoSeconds(v: string | null | undefined): number | null {
  const mm = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(String(v || '').trim());
  if (!mm || !mm.slice(1).some(Boolean)) return null;
  const [, d, h, mi, se] = mm;
  return Math.round((Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(mi || 0) * 60) + Number(se || 0)) || null;
}

// Person names out of values that are sometimes names and sometimes profile
// URLs (article:author on many sites, music:musician on Spotify). A URL is not
// a name, so it is dropped rather than shown as a byline.
function names(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const n = clean(v, 80);
    if (!n || /^https?:\/\//i.test(n)) continue;
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

// The icon a 16-32px slot looks best with: a declared size nearest 32, then
// any icon, then an apple-touch-icon, then the site's /favicon.ico.
function pickIcon(icons: RawMeta['icons'], base: string): string | null {
  const plain = icons.filter((i) => i.rel.split(/\s+/).includes('icon'));
  const sized = plain.filter((i) => i.size).sort((a, b) => Math.abs(a.size! - 32) - Math.abs(b.size! - 32));
  const pick = sized[0] || plain[0] || icons.find((i) => i.rel.includes('apple-touch-icon'));
  if (pick) return resolveHttp(pick.href, base);
  try { return new URL('/favicon.ico', base).href; } catch { return null; }
}

// ---- JSON-LD ----

const ARTICLE_TYPES = new Set([
  'article', 'newsarticle', 'blogposting', 'reportagenewsarticle', 'analysisnewsarticle',
  'opinionnewsarticle', 'reviewnewsarticle', 'backgroundnewsarticle', 'liveblogposting',
  'techarticle', 'scholarlyarticle', 'report', 'socialmediaposting',
]);

interface LdArticle { headline: string | null; authors: string[]; datePublished: string | null; dateModified: string | null; publisher: string | null }

// Reads every JSON-LD block into a flat list of nodes (top-level objects,
// arrays, and @graph members), reports every @type seen, and pulls the first
// article-like node apart. A block that is not valid JSON is skipped, not
// fatal: plenty of pages ship one broken block beside good ones.
export function readJsonLd(blocks: string[], base: string): { types: string[]; article: LdArticle | null } {
  const nodes: any[] = [];
  const push = (v: any) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (v && typeof v === 'object') {
      nodes.push(v);
      if (Array.isArray(v['@graph'])) v['@graph'].forEach(push);
    }
  };
  for (const text of blocks) {
    try { push(JSON.parse(text)); } catch { /* one bad block does not spoil the rest */ }
  }
  const typesOf = (n: any): string[] => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).filter((t: any) => typeof t === 'string');
  const types: string[] = [];
  for (const n of nodes) for (const t of typesOf(n)) if (!types.includes(t) && types.length < 12) types.push(t);

  const node = nodes.find((n) => typesOf(n).some((t) => ARTICLE_TYPES.has(t.toLowerCase())));
  if (!node) return { types, article: null };
  const text = (v: any) => (typeof v === 'string' ? clean(v, MAX_TITLE) : null);
  const personNames = (v: any): string[] => {
    const list = Array.isArray(v) ? v : v ? [v] : [];
    return names(list.map((p: any) => (typeof p === 'string' ? p : p && typeof p.name === 'string' ? p.name : '')).filter(Boolean));
  };
  const publisher = node.publisher && (typeof node.publisher === 'string' ? node.publisher : node.publisher.name);
  return {
    types,
    article: {
      headline: text(node.headline) || text(node.name),
      authors: personNames(node.author || node.creator),
      datePublished: text(node.datePublished),
      dateModified: text(node.dateModified),
      publisher: text(publisher),
    },
  };
}

// ---- oEmbed ----

// The parts of an oEmbed response a card can use. Deliberately NOT `html`:
// that is third-party markup (usually an iframe), and the client builds its own
// player from known URL shapes instead of rendering whatever a page points at.
export function readOEmbed(json: any, base: string): OEmbedMeta | null {
  if (!json || typeof json !== 'object') return null;
  const text = (v: any, max = MAX_TITLE) => (typeof v === 'string' ? clean(v, max) : null);
  const out: OEmbedMeta = {
    type: text(json.type, 16),
    title: text(json.title),
    authorName: text(json.author_name, 120),
    authorUrl: resolveHttp(typeof json.author_url === 'string' ? json.author_url : null, base),
    providerName: text(json.provider_name, 80),
    thumbnailUrl: resolveHttp(typeof json.thumbnail_url === 'string' ? json.thumbnail_url : null, base),
    thumbnailWidth: posInt(json.thumbnail_width),
    thumbnailHeight: posInt(json.thumbnail_height),
    width: posInt(json.width),
    height: posInt(json.height),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// ---- bytes to text ----

// Which encoding the page is in, by the WHATWG precedence: a byte-order mark,
// then the Content-Type header, then a <meta> declaration in the first few KB,
// then UTF-8. Getting this wrong is what turns a Japanese title into mojibake.
export function sniffCharset(bytes: Uint8Array, contentType: string | null): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
  if (fromHeader && supported(fromHeader[1])) return fromHeader[1].toLowerCase();
  // ASCII-compatible read of the head, which is all a <meta charset> prescan
  // needs: the declaration itself is always plain ASCII.
  let head = '';
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  if (fromMeta && supported(fromMeta[1])) return fromMeta[1].toLowerCase();
  return 'utf-8';
}

function supported(label: string): boolean {
  try { new TextDecoder(label); return true; } catch { return false; }
}

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  return new TextDecoder(sniffCharset(bytes, contentType)).decode(bytes);
}
