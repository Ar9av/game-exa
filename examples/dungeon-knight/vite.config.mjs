import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
});
