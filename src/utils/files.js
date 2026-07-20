'use strict';

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result);
    rd.onerror = () => reject(rd.error);
    rd.readAsDataURL(file);
  });
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
