'use strict';
// Publish only browser files. No bundler, dependency installation, or secrets.
const {mkdirSync, copyFileSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
mkdirSync(path.join(root, 'dist'), {recursive:true});
for (const file of ['index.html', 'bluetooth-ownership.js', 'bluetooth.js', 'controller-protocols.js', 'serial.js']) {
  copyFileSync(path.join(root, file), path.join(root, 'dist', file));
}
console.log('Built Album Glow browser files in dist/');
