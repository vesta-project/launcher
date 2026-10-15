import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';

// Visual component workbench. A plain SPA rooted in this folder; it is never
// part of the launcher build and does not need Tauri.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [solid({ diagnostics: true })],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 1431,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
  },
});
