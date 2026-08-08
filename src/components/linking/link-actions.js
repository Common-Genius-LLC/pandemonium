// The one definition of the "link to" menu (Figma node 86-632): the three
// targets a passage can be linked to, in order, each carrying the accent colour
// its highlight uses elsewhere in the app (storyboard green, research pink,
// sound yellow). Both the in-editor row rail (cm-sections via script-editor)
// and the free-text selection affordance (selection-toolbar) build their menu
// from here, so the two can never drift in wording, order, or colour.
//
// Callers pass the action for each target, since where the passage came from
// (a parsed section vs a hand-dragged selection) decides how the board/source
// is actually attached; only the menu's shape is shared.
'use strict';

export function linkToItems({ onStoryboard, onResearch, onSound }) {
  return [
    { label: 'Storyboard', accent: 'var(--board-strong)', fn: onStoryboard },
    { label: 'Research', accent: 'var(--res)', fn: onResearch },
    { label: 'Sound', accent: 'var(--sound)', fn: onSound },
  ];
}
