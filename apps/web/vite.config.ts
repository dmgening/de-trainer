import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const SERVER = 'http://127.0.0.1:8080';

// Two builds from one source: `--mode owner` (default) → dist/owner served at /,
// `--mode demo` → dist/demo served at /demo/. `@app` picks the root component per build,
// so owner-only modules (API, sync) never reach the demo bundle.
export default defineConfig(({ mode }) => {
  const app = mode === 'demo' ? 'demo' : 'owner';
  const plugins: PluginOption[] = [react()];
  if (app === 'owner') {
    plugins.push(
      VitePWA({
        registerType: 'prompt',
        injectRegister: 'script',
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
