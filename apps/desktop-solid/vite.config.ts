import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

export default defineConfig({
  // Turnkey client mode: no index.html and no mount file — the plugin generates
  // the entries around src/App.tsx (wrapped in src/Document.tsx) and `vite build`
  // prerenders the shell into a purely static dist/client.
  plugins: [
    // Solid RC refresh proxies can become recursive after repeated edits and
    // halt the reactive runtime. Use full reloads for code edits until the
    // installed refresh runtime is fixed; keep dev diagnostics enabled.
    solid({ start: true, diagnostics: true, refresh: { disabled: true } }), // add `ssr: true` for streaming SSR
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 1430,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
});
