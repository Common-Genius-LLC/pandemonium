// Microsoft Clarity: heatmaps and session replay, for seeing where the
// interface makes people hesitate. The one place it is switched on, so turning
// it off (or swapping it) is one file, same as GA4 in analytics.js.
//
// It no-ops unless VITE_CLARITY_PROJECT_ID is set, which .env.production does
// and .env.example does not: a dev build records nothing.
//
// PRIVACY. A replay records the page, and this page is someone's unreleased
// screenplay. What keeps the writing out of it is the data-clarity-mask
// attributes on every surface that holds user content (the script, boards,
// research, timeline scene names, the project name, search, account label,
// the slideshow, dialogs and popovers). That works through this app's shadow
// DOM because Clarity's recorder (checked against clarity.js 0.8.70) starts
// every node at its parent's privacy level and treats a shadow root's host as
// its parent, so a mask on a container covers everything rendered inside it.
// Two consequences worth knowing:
//   - a mask set by CSS selector in the Clarity dashboard does NOT reach inside
//     a shadow root (it uses querySelectorAll), so for this app the attributes
//     in code are the only way to target a specific element;
//   - the dashboard's global Masking mode still applies everywhere, and should
//     be set to Strict as the backstop for any surface added later without a
//     mask on it.
// Anything new that shows the writer's words needs data-clarity-mask="true".
'use strict';

import Clarity from '@microsoft/clarity';

const PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID || '';

export function initClarity(projectId = PROJECT_ID) {
  if (!projectId) return false;
  try {
    Clarity.init(projectId);
    return true;
  } catch (err) {
    // Blocked by an extension or a network rule: the app does not care.
    console.warn('Clarity did not start:', err);
    return false;
  }
}
