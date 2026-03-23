'use strict';

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const idx = process.argv.indexOf('--browser');
const browser = idx !== -1 ? process.argv[idx + 1] : null;

if (browser !== 'chrome' && browser !== 'firefox') {
  process.stderr.write('Usage: node scripts/build-manifest.js --browser chrome|firefox\n');
  process.exit(1);
}

const root = resolve(__dirname, '..');
const base = JSON.parse(readFileSync(resolve(root, 'manifest.base.json'), 'utf8'));

const background = browser === 'firefox'
  ? { service_worker: 'background/service-worker.js', scripts: ['background/service-worker.js'], type: 'module' }
  : { service_worker: 'background/service-worker.js', type: 'module' };

const manifest = Object.assign({}, base, { background });
writeFileSync(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write('manifest.json written for ' + browser + '\n');
