import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** Code and styles shared by all four dashboards (web/shared). */
const SHARED_DIR = fileURLToPath(new URL('../shared', import.meta.url));

/**
 * BASE_PATH lets this app be served from a sub-path of a shared host
 * (e.g. "/admin/") instead of a domain of its own. It is baked into the asset
 * URLs at build time, so it must be set when the bundle is built.
 */
export default defineConfig(({ mode }) => {
  // Vite inlines VITE_* at build time. A production bundle built without them
  // silently falls back to localhost and fails only in the browser, on the
  // deployed site — so refuse to produce one.
  if (mode === 'production' && !process.env.VITE_API_URL) {
    throw new Error(
      'VITE_API_URL is required for a production build, or the bundle will point at localhost.\n' +
      '  Deployed:    VITE_API_URL=https://your-host/api npm run build\n' +
      '  Local check: VITE_API_URL=http://localhost:3000/api npm run build\n' +
      'See .env.example for the full list.',
    );
  }

  return {
    base: process.env.BASE_PATH || '/',
    plugins: [react()],
    resolve: {
      alias: { '@shared': SHARED_DIR },
      // web/shared has no node_modules: make its React imports use this app's
      // copy, so there is exactly one React instance in the bundle.
      dedupe: ['react', 'react-dom'],
    },
    server: {
      // Let the dev server serve web/shared, which sits outside this app.
      fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
      port: 3002,
    },
    preview: {
      port: 3002,
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
