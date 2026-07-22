import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  // Vitest (frontend). The backend under server/ has its own tests that run on
  // Bun's native runner (`bun:test`), which Vitest cannot resolve, so exclude it.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'server/**'],
  },
});
