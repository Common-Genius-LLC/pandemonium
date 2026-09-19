// The one definition of the "link to" menu (Figma node 86-632): the targets a
// passage can be linked to (storyboard, blank storyboard, research, sound), in
// order, each carrying the accent colour its highlight uses elsewhere in the
// app (storyboard green, research pink, sound yellow). Both the in-editor row rail (cm-sections via script-editor)
// and the free-text selection affordance (selection-toolbar) build their menu
// from here, so the two can never drift in wording, order, or colour.
//
// Callers pass the action for each target, since where the passage came from
// (a parsed section vs a hand-dragged selection) decides how the board/source
// is actually attached; only the menu's shape is shared.
'use strict';

export function linkToItems({ onStoryboard, onBlankStoryboard, onResearch, onSound }) {
  const items = [{ label: 'Storyboard', accent: 'var(--board-strong)', fn: onStoryboard }];
  // A storyboard with no image yet, for a beat that needs boarding before
  // there is a frame: it can carry a note, and takes an image in either the
  // Final or the Reference frame later. Only offered where a caller can make one.
  if (onBlankStoryboard) items.push({ label: 'Blank storyboard', accent: 'var(--board-strong)', fn: onBlankStoryboard });
  items.push(
    { label: 'Research', accent: 'var(--res)', fn: onResearch },
    { label: 'Sound', accent: 'var(--sound)', fn: onSound },
  );
  return items;
}
