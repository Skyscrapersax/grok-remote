#!/usr/bin/env node
// craft:check — fail if dist CSS reintroduces SaaS geometry / cool whites.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'dist', 'assets');
if (!fs.existsSync(assets)) {
  console.error('craft:check FAIL — dist/assets missing (run npm run build)');
  process.exit(1);
}

const cssFiles = fs.readdirSync(assets).filter((f) => f.startsWith('index-') && f.endsWith('.css'));
if (!cssFiles.length) {
  console.error('craft:check FAIL — no index-*.css in dist/assets');
  process.exit(1);
}

let fail = 0;
for (const f of cssFiles) {
  const css = fs.readFileSync(path.join(assets, f), 'utf8');
  const cool = (css.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || []).length;
  const soft = (css.match(/border-radius:\s*(6|8|10|12)px/g) || []).length;
  console.log(`${f}: cool-white=${cool} soft-radius-6/8/10/12=${soft}`);
  if (cool > 0) {
    console.error(`  FAIL cool white rgba(255,255,255,…) present`);
    fail++;
  }
  if (soft > 0) {
    console.error(`  FAIL soft SaaS radii present`);
    fail++;
  }
}

// Server settings default must be atelier
const settingsSrc = fs.readFileSync(path.join(root, 'lib', 'settings.ts'), 'utf8');
if (!/theme:\s*'atelier'/.test(settingsSrc)) {
  console.error('craft:check FAIL — lib/settings.ts default theme is not atelier');
  fail++;
} else {
  console.log('lib/settings.ts: default theme atelier OK');
}

if (fail) {
  console.error(`craft:check FAIL (${fail})`);
  process.exit(1);
}
console.log('craft:check OK');
