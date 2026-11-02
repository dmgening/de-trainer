// Post-build guard: both builds exist, and the public demo build carries no owner-only code.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../dist');
const fail = (message) => {
  console.error(`check-bundles: ${message}`);
  process.exit(1);
};
const filesIn = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => path.join(dir, String(f)))
    .filter((f) => statSync(f).isFile());

for (const f of ['owner/index.html', 'owner/manifest.webmanifest', 'owner/sw.js', 'demo/index.html']) {
  if (!existsSync(path.join(dist, f))) fail(`missing ${f}`);
}
for (const f of ['demo/sw.js', 'demo/manifest.webmanifest']) {
  if (existsSync(path.join(dist, f))) fail(`demo must not ship ${f}`);
}
for (const f of filesIn(path.join(dist, 'demo')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  for (const needle of ['/api/', '/auth/login']) {
    if (src.includes(needle)) fail(`${path.relative(dist, f)} contains ${needle}`);
  }
}
console.log('check-bundles: ok');
