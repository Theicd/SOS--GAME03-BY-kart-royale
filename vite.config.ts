import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  server: { port: 5173, strictPort: true, host: true },
  build: { target: 'es2022', sourcemap: true },
});
