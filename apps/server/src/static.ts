import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Handler } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

async function isFile(file: string) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves a Vite build mounted at `prefix`. Hashed files under assets/ are cached forever;
 * everything else (index.html, sw.js, manifest) is revalidated so app updates reach clients.
 * Unknown extensionless paths fall back to index.html for client-side routing.
 */
export function serveDir(root: string, prefix: string): Handler {
  const base = path.resolve(root);
  return async (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path).slice(prefix.length);
    } catch {
      return c.text('Bad request', 400);
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';

    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep)) return c.text('Not found', 404);

    let target = file;
    if (!(await isFile(file))) {
      if (path.extname(rel) !== '') return c.text('Not found', 404);
      target = path.join(base, 'index.html');
      if (!(await isFile(target))) return c.text('Not found', 404);
    }

    const cache = target.startsWith(path.join(base, 'assets') + path.sep)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    return c.body(await readFile(target), 200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': cache,
    });
  };
}
