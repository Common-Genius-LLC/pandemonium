'use strict';

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result);
    rd.onerror = () => reject(rd.error);
    rd.readAsDataURL(file);
  });
}

export async function downscaleDataURL(dataUrl, { maxSide = 1600, quality = 0.82 } = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.startsWith('data:image/svg+xml')) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    for (const mime of ['image/webp', 'image/jpeg']) {
      const out = canvas.toDataURL(mime, quality);
      if (out.startsWith('data:' + mime)) return out;
    }
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result));
    rd.onerror = () => reject(rd.error);
    rd.readAsText(file);
  });
}

export function downloadBlob(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

// Text-shaped files become linkable research notes (their content is plain
// Fountain-free prose, ingested into a research doc's `body`). Everything
// else is stored as an opaque attachment (data URL) and is viewable but not
// span-linkable -- see src/components/research/attachment-viewer.js.
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.fountain'];

export function isTextShaped(file) {
  const name = (file.name || '').toLowerCase();
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return /^text\//.test(file.type || '');
}
