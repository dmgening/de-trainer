import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const SERVER = 'http://127.0.0.1:8080';

/** Demo images ship inside the demo build as media/<sha256>.<ext>: the demo needs no API. */
function demoMedia(): Plugin {
  const dir = new URL('../../packages/fixtures/media/', import.meta.url);
  const files = () =>
    readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp)$/.test(f))
      .map((f) => {
        const source = readFileSync(new URL(f, dir));
        const ext = f.split('.').pop()!.replace('jpeg', 'jpg');
        return { name: `media/${createHash('sha256').update(source).digest('hex')}.${ext}`, source };
      });
  return {
    name: 'demo-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = files().find((f) => req.url === `/demo/${f.name}`);
        if (!hit) return next();
        res.setHeader('Content-Type', hit.name.endsWith('.png') ? 'image/png' : hit.name.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
        res.end(hit.source);
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: f.name, source: f.source });
    },
  };
}

// Two builds from one source: `--mode owner` (default) → dist/owner served at /,
// `--mode demo` → dist/demo served at /demo/. `@app` picks the root component per build,
// so owner-only modules (API, sync) never reach the demo bundle.
export default defineConfig(({ mode }) => {
  const app = mode === 'demo' ? 'demo' : 'owner';
  const plugins: PluginOption[] = [react()];
  if (app === 'demo') plugins.push(demoMedia());
  if (app === 'owner') {
    plugins.push(
      VitePWA({
        // Registered from the app (virtual:pwa-register) so the update waits for the learner.
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          id: '/',
          name: 'de-class — тренажёр немецкого',
          short_name: 'de-class',
          lang: 'ru',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#1a1a1a',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
          navigateFallback: '/index.html',
          // Server routes and the demo build are not part of the owner shell.
          navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/agent\//, /^\/demo(\/|$)/, /^\/healthz$/],
        },
      }),
    );
  }
  return {
    base: app === 'demo' ? '/demo/' : '/',
    resolve: { alias: { '@app': fileURLToPath(new URL(`./src/${app}/App.tsx`, import.meta.url)) } },
    build: { outDir: `dist/${app}`, emptyOutDir: true },
    plugins,
    server: { proxy: { '/api': SERVER, '/auth': SERVER, '/agent': SERVER, '/healthz': SERVER } },
  };
});
