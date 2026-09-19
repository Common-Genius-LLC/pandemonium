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
import { isIP } from 'node:net';
import { isPublicAddress } from './ssrf';

export const MAX_TITLE = 300;
export const MAX_DESCRIPTION = 500;

export interface RawMeta {
  meta: Record<string, string>; // first value seen per lower-cased property/name
  title: string | null;
  imageSrc: string | null; // <link rel="image_src">
  firstParagraph: string | null;
  base: string | null; // <base href>
}

export type TitleSource = 'og' | 'twitter' | 'html' | 'url';
export type DescriptionSource = 'og' | 'twitter' | 'meta' | 'paragraph' | null;
export type ImageSource = 'og' | 'twitter' | 'link' | 'self' | null;

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
}

const clean = (s: string | null | undefined, max: number): string | null => {
  if (s == null) return null;
  const out = s.replace(/\s+/g, ' ').trim();
  if (!out) return null;
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
};

// OG and Twitter keys are matched on either attribute, lower-cased: OG is
// specified on `property` and Twitter on `name`, but real pages mix them up in
// both directions often enough that honouring only the spelling in the spec
// loses real metadata.
const WANTED_META = new Set([
  'og:title', 'og:description', 'og:image', 'og:image:url', 'og:image:secure_url',
  'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:src',
  'description',
]);

export async function extractMeta(html: string): Promise<RawMeta> {
  const raw: RawMeta = { meta: {}, title: null, imageSrc: null, firstParagraph: null, base: null };
  let titleBuf: string | null = null;
  let titleDone = false;
  let pBuf = '';
  let pDone = false;
  let inP = 0;

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') || el.getAttribute('name') || '').trim().toLowerCase();
        if (!WANTED_META.has(key) || key in raw.meta) return;
        const content = el.getAttribute('content');
        if (content == null) return;
        const value = decodeHTMLAttribute(content).trim();
        if (value) raw.meta[key] = value;
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
        if (raw.imageSrc) return;
        const rel = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        const href = el.getAttribute('href');
        if (rel.includes('image_src') && href) raw.imageSrc = decodeHTMLAttribute(href).trim();
      },
    })
    .on('base', {
      element(el) {
        const href = el.getAttribute('href');
        if (!raw.base && href) raw.base = decodeHTMLAttribute(href).trim();
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

// An image the viewer's browser will load. Relative and protocol-relative
// values resolve against <base> or the page's own URL; anything that is not
// http(s), or that points at a private address literal, is dropped rather than
// handed to every browser that renders the card.
function resolveImage(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null;
  let u: URL;
  try { u = new URL(value, baseUrl); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || (isIP(host) && !isPublicAddress(host))) return null;
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
    ...extra,
  };
}

export function buildPreview(raw: RawMeta, { requestedUrl, finalUrl, status = 200, contentType = 'text/html' }: {
  requestedUrl: string; finalUrl: string; status?: number; contentType?: string | null;
}): LinkPreview {
  const m = raw.meta;
  let base = finalUrl;
  if (raw.base) { try { base = new URL(raw.base, finalUrl).href; } catch { /* keep the page URL */ } }

  let title: string | null;
  let titleSource: TitleSource;
  if ((title = clean(m['og:title'], MAX_TITLE))) titleSource = 'og';
  else if ((title = clean(m['twitter:title'], MAX_TITLE))) titleSource = 'twitter';
  else if ((title = clean(raw.title, MAX_TITLE))) titleSource = 'html';
  else { title = requestedUrl; titleSource = 'url'; }

  let description: string | null;
  let descriptionSource: DescriptionSource;
  if ((description = clean(m['og:description'], MAX_DESCRIPTION))) descriptionSource = 'og';
  else if ((description = clean(m['twitter:description'], MAX_DESCRIPTION))) descriptionSource = 'twitter';
  else if ((description = clean(m['description'], MAX_DESCRIPTION))) descriptionSource = 'meta';
  else if ((description = clean(raw.firstParagraph, MAX_DESCRIPTION))) descriptionSource = 'paragraph';
  else { description = null; descriptionSource = null; }

  let image: string | null;
  let imageSource: ImageSource;
  if ((image = resolveImage(m['og:image'] || m['og:image:secure_url'] || m['og:image:url'], base))) imageSource = 'og';
  else if ((image = resolveImage(m['twitter:image'] || m['twitter:image:src'], base))) imageSource = 'twitter';
  else if ((image = resolveImage(raw.imageSrc, base))) imageSource = 'link';
  else { image = null; imageSource = null; }

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
  };
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
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
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
