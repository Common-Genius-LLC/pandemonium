'use strict';

// Finds the first image file in a paste event's clipboard data, if any.
export function imageFromClipboard(clipboardData) {
  if (!clipboardData) return null;
  const items = clipboardData.items;
  if (items) {
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  if (clipboardData.files) {
    for (const file of clipboardData.files) {
      if (file.type.startsWith('image/')) return file;
    }
  }
  return null;
}
