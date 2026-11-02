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
// The public demo: no API or sync code, no owner test content, no workbook locators (A09).
for (const f of filesIn(path.join(dist, 'demo')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  for (const needle of ['/api/', '/auth/login', '/sync/', 'owner-test', 'workbook-test-doc', 'source_refs:[{']) {
    if (src.includes(needle)) fail(`${path.relative(dist, f)} contains ${needle}`);
  }
}
if (!filesIn(path.join(dist, 'demo/media')).some((f) => f.endsWith('.png'))) fail('demo media are missing');
// The owner shell is public too: it must not embed any bank content.
for (const f of filesIn(path.join(dist, 'owner')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  for (const needle of ['owner-test', 'demo-core', 'workbook-test-doc']) {
    if (src.includes(needle)) fail(`${path.relative(dist, f)} contains ${needle}`);
  }
}
console.log('check-bundles: ok');
