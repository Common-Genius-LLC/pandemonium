'use strict';

import './styles/global.css';
import './app-root/pandemonium-app.js';

// #printRoot must be a direct child of <body>, sibling to the app itself,
// not nested inside it -- see styles/global.css for why (the print media
// query hides everything under <body> except this one element, and that
// only works if it isn't itself inside the thing being hidden).
const printRoot = document.createElement('div');
printRoot.id = 'printRoot';
document.body.appendChild(printRoot);

document.getElementById('app-mount').appendChild(document.createElement('pandemonium-app'));
