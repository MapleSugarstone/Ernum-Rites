import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/, so assets need that prefix.
// Override with BASE_PATH=/ when serving from a custom domain via Cloudflare.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Ernum-Rites/',
  // Card art ships verbatim: assets/Cardgame/... is served at /Cardgame/...
  publicDir: 'assets',
  build: { outDir: 'dist', sourcemap: true },
  server: {
    port: Number(process.env.PORT) || 5173,
    // Training writes snapshots continuously; watching them makes any vite
    // process die with EBUSY while a tournament is running.
    watch: { ignored: ['**/runs/**', '**/replays/**'] },
    // Online play talks to window.location.origin, so the dev server has to
    // hand /api to the worker rather than answer it. `ws` covers the room
    // socket, which is an upgrade on the same prefix.
    proxy: {
      '/api': {
        target: process.env.WORKER_URL ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
