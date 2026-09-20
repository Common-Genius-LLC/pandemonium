// The letters shown in the round account button: the first letter of the first
// two words of a display name ("Ashu Sharma" is AS), or one letter for a single
// word. With no name, the address before the @ is read the same way, splitting
// on the punctuation people put in one ("john.doe" is JD). Works on any
// script, and always returns something (a "?" for nothing at all).
'use strict';

export function initialsOf(user) {
  const src = String((user && (user.displayName || (user.email || '').split('@')[0])) || '').trim();
  const words = src.split(/[\s._+\-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = (w) => Array.from(w)[0];
  return (words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1])).toUpperCase();
}
