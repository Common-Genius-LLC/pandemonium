'use strict';

import './styles/global.css';
import { initAnalytics } from './utils/analytics.js';
import { initClarity } from './utils/clarity.js';
import { theme } from './state/theme.js';
import './app-root/pandemonium-app.js';

initAnalytics();
initClarity();

// Before the app mounts, so the first paint is already in the right theme.
// Applying it after would show a white flash on a dark desktop.
theme.init();

// #printRoot must be a direct child of <body>, sibling to the app itself,
// not nested inside it -- see styles/global.css for why (the print media
// query hides everything under <body> except this one element, and that
// only works if it isn't itself inside the thing being hidden).
const printRoot = document.createElement('div');
printRoot.id = 'printRoot';
// It holds the whole script while printing, in the light DOM where every
// recorder can see it. Masked like every other surface with the writing on it.
printRoot.setAttribute('data-clarity-mask', 'true');
document.body.appendChild(printRoot);

document.getElementById('app-mount').appendChild(document.createElement('pandemonium-app'));
