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
  };
}
