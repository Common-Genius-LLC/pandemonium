// What a URL is, worked out from the URL itself, plus the helpers for the
// server's Open Graph preview (GET /v1/link-preview, see
// server/src/link-preview/). The two are layers, not rivals: the server reads
// the page and knows its real title, description and image; this file knows
// only the URL, and is what still works with no server at all (offline, or
// the API down). The card prefers the server's answer and keeps this one for
// what the page cannot say: whether a link can be played inline.
//
// The rest of this header describes the URL-only layer.
//
// A research panel full of bare blue strings tells the writer nothing, so a
// link gets a preview. The question is where the preview comes from, and the
// answer here is: from the link, and from nowhere else.
//
// NOT from an unfurl service (microlink, noembed and friends). Handing a third
// party the list of pages a writer is reading for an unreleased screenplay is
// not a fair price for a thumbnail, and it is the same reason analytics in this
// app never carries a project name (see viewInfo in state/store.js).
//
// NOT from fetching the page in the browser either: CORS makes that fail for
// almost every site, so it would be a feature that worked on a handful of
// domains and looked broken on the rest.
//
// So: parse the URL, recognise what it points at, and let the ORIGIN serve its
// own preview. A YouTube thumbnail comes from YouTube, a favicon comes from the
// site it belongs to, an image URL is just an image. Nothing learns about the
// writer that the link's own host would not learn the moment they opened it.
//
// The cost of that choice is honest and worth stating: there are no fetched
// titles or descriptions, because those cannot be had without either a
// third party or a server of our own doing the fetching. A server-side unfurl
// through server/ is the way to get them later, and would need its own SSRF
// guards before it fetched a single URL.
//
// Pure and DOM-free, so it is testable and cheap to call during render.
'use strict';

import { hostOf } from './research-doc.js';

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:$|\?)/i;
const VIDEO_EXT = /\.(?:mp4|webm|ogv|mov|m4v)(?:$|\?)/i;
const AUDIO_EXT = /\.(?:mp3|wav|m4a|aac|ogg|flac)(?:$|\?)/i;
const PDF_EXT = /\.pdf(?:$|\?)/i;

// The eleven-character video id in any of the shapes YouTube hands out.
function youtubeId(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
  return m ? m[1] : null;
}

// open.spotify.com/{track|album|playlist|episode|show|artist}/{id}, with or
// without a locale segment (/intl-fr/track/...).
function spotifyEmbed(u) {
  if (u.hostname !== 'open.spotify.com') return null;
  const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
}

function vimeoId(u) {
  if (u.hostname.replace(/^www\./, '') !== 'vimeo.com') return null;
  const m = u.pathname.match(/^\/(\d+)/);
  return m ? m[1] : null;
}

// {kind, host, url, thumb?, embed?} or null when the string is not a URL.
//
// `thumb` is an image the origin serves and we may show unasked (it is the
// point of the preview). `embed` is a player we must NOT load unasked: the
// reader shows a poster and loads the player on a click, so adding a link
// never quietly pulls in another site's scripts and cookies.
export function previewOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = hostOf(u.href);

  const yt = youtubeId(u);
  if (yt) {
    return {
      kind: 'youtube', host, url: u.href,
      // i.ytimg.com is YouTube's own thumbnail host. hqdefault exists for
      // every video, unlike maxresdefault, which 404s on older uploads.
      thumb: `https://i.ytimg.com/vi/${encodeURIComponent(yt)}/hqdefault.jpg`,
      embed: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`,
    };
  }

  const vm = vimeoId(u);
  if (vm) {
    // No thumbnail: Vimeo's needs an API call, and an API call is the thing
    // this module exists to avoid. The poster is a plain tile instead.
    return { kind: 'vimeo', host, url: u.href, embed: `https://player.vimeo.com/video/${encodeURIComponent(vm)}` };
  }

  // Spotify's player is a fixed-height strip, not a 16:9 frame, so it says
  // how tall it wants to be.
  const sp = spotifyEmbed(u);
  if (sp) return { kind: 'spotify', host, url: u.href, embed: sp, embedHeight: 152 };

  const path = u.pathname;
  if (IMAGE_EXT.test(path)) return { kind: 'image', host, url: u.href, thumb: u.href };
  if (VIDEO_EXT.test(path)) return { kind: 'video', host, url: u.href };
  if (AUDIO_EXT.test(path)) return { kind: 'audio', host, url: u.href };
  if (PDF_EXT.test(path)) return { kind: 'pdf', host, url: u.href };

  // An ordinary page: the site's own favicon, which is a request to a host the
  // writer has already visited, and nothing else.
  return { kind: 'page', host, url: u.href, icon: u.origin + '/favicon.ico' };
}

// The line under a link's title: what it is, and where it is from.
export function previewLabel(p) {
  if (!p) return '';
  const what = {
    youtube: 'Video', vimeo: 'Video', image: 'Image',
    video: 'Video', audio: 'Audio', pdf: 'PDF', page: 'Page',
  }[p.kind] || 'Page';
  return what + ' on ' + p.host;
}

// ---- the server's preview ----

// Whether a server preview has anything a card could show beyond the URL
// itself. A page that could not be read comes back with its URL as its title
// and nothing else, and a card made of that is just a link wearing a box.
export function isRichPreview(p) {
  if (!p) return false;
  return !!((p.sources && p.sources.title && p.sources.title !== 'url') || p.description || p.image);
}

// The one line under a card's title that says what the thing IS, from the
// structured detail the server read: a song's artist and length, a video's
// channel and length, an article's byline and date. Null when there is
// nothing structured to say, so an ordinary page shows no empty line.
export function previewMeta(p) {
  if (!p) return null;
  const type = String(p.type || '');
  const parts = [];
  if (p.music || type.startsWith('music.')) {
    const kind = { 'music.song': 'Song', 'music.album': 'Album', 'music.playlist': 'Playlist', 'music.radio_station': 'Station' }[type];
    if (kind) parts.push(kind);
    if (p.music && p.music.musicians && p.music.musicians.length) parts.push(p.music.musicians.slice(0, 2).join(', '));
    if (p.music && p.music.duration) parts.push(clock(p.music.duration));
  } else if (p.video || type.startsWith('video.')) {
    parts.push('Video');
    if (p.oembed && p.oembed.authorName) parts.push(p.oembed.authorName);
    if (p.video && p.video.duration) parts.push(clock(p.video.duration));
  } else if (p.article && (p.article.authors.length || p.article.publishedTime)) {
    if (p.article.authors.length) parts.push(p.article.authors.slice(0, 2).join(', ') + (p.article.authors.length > 2 ? ' and others' : ''));
    const d = shortDate(p.article.publishedTime);
    if (d) parts.push(d);
  }
  return parts.length ? parts.join(' \u00b7 ') : null;
}

function clock(secs) {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function shortDate(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Large or small, the way Twitter and Slack decide: a page that asks for a
// large image (twitter:card summary_large_image, or a player) and anything
// wide and big enough gets the big frame; a square or small image (an album
// cover, a logo) gets a thumbnail beside the text, because cropping a square
// logo to 1.91:1 cuts it in half.
export function cardLayout(p) {
  if (!p || !p.image) return 'text';
  if (p.card === 'summary_large_image' || p.card === 'player') return 'large';
  const w = p.imageWidth;
  const h = p.imageHeight;
  if (w && h && (w / h < 1.3 || w < 400)) return 'small';
  if (p.card === 'summary') return 'small';
  return 'large';
}

// A smaller rendition of an image from a CDN that resizes on request, for
// the size a card actually draws it at. Only hosts whose resizing parameters
// are documented and stable: an unknown host is returned untouched rather
// than guessed at. Unsplash (imgix), any imgix domain, and Contentful (which
// GitHub's og:image comes from) all take a width.
export function optimizeImage(url, width = 720) {
  let u;
  try { u = new URL(url); } catch { return url; }
  const host = u.hostname;
  if (host === 'images.unsplash.com' || host.endsWith('.imgix.net')) {
    u.searchParams.set('w', String(width));
    // A link to an original often carries q=100; at card size that only buys
    // bytes, so quality is brought down to 75, never up.
    const q = Number(u.searchParams.get('q'));
    if (!q || q > 75) u.searchParams.set('q', '75');
    if (!u.searchParams.has('auto')) u.searchParams.set('auto', 'format');
    return u.href;
  }
  if (host === 'images.ctfassets.net') {
    u.searchParams.set('w', String(width));
    if (!u.searchParams.has('fm')) u.searchParams.set('fm', 'webp');
    return u.href;
  }
  return url;
}

// Every web link in a piece of note text, in order, each once, trimmed of the
// punctuation that ends a sentence rather than a URL ("see https://x.com.").
// A bare www. address counts; a bare domain does not, because "e.g." and
// "Mr." would start looking like links.
export function urlsIn(text) {
  const out = [];
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    let raw = m[0].replace(/[.,;:!?]+$/, '');
    // A closing bracket belongs to the URL only if the URL opened one.
    while (/[)\]}]$/.test(raw) && (raw.match(/[([{]/g) || []).length < (raw.match(/[)\]}]/g) || []).length) raw = raw.slice(0, -1);
    const href = /^www\./i.test(raw) ? 'https://' + raw : raw;
    let normal;
    try { normal = new URL(href).href; } catch { continue; }
    if (!out.includes(normal)) out.push(normal);
  }
  return out;
}

// What a research source keeps of a preview: enough to draw its card in the
// grid offline and to name the source, and nothing time-stamped. Two devices
// that fetch the same URL get the same cached answer, so what they store is
// identical and the sync merge never sees a conflict that is not really one.
// A preview with nothing rich in it is not kept at all, so it is asked for
// again next time instead of a block being remembered forever.
export function storablePreview(p) {
  if (!isRichPreview(p)) return null;
  return {
    url: p.url,
    domain: p.domain || '',
    title: p.sources && p.sources.title !== 'url' ? p.title : null,
    description: p.description || null,
    image: p.image || null,
    // What the card needs to draw the same way offline: its size decision,
    // the site icon, and the one-line summary of what the thing is.
    layout: cardLayout(p),
    favicon: p.favicon || null,
    meta: previewMeta(p),
  };
}

// What a research source should change once its link's preview arrives:
// the stored preview when it says something new, and the title when the
// source has none of its own. A title the writer gave is never replaced. An
// empty patch means nothing to write, so reopening a source is not an edit.
export function previewPatch(doc, stored) {
  if (!doc || !stored || stored.url !== doc.url) return {};
  const patch = {};
  if (JSON.stringify(stored) !== JSON.stringify(doc.preview || null)) patch.preview = stored;
  const own = String(doc.title || '').trim();
  if ((!own || own === 'Untitled') && stored.title) patch.title = stored.title;
  return patch;
}
