import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/, so assets need that prefix.
// Override with BASE_PATH=/ when serving from a custom domain via Cloudflare.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Ernum-Rites/',
  // Card art ships verbatim: assets/Cardgame/... is served at /Cardgame/...
  publicDir: 'assets',
  build: { outDir: 'dist', sourcemap: true },
  // The suite runs the bot with its searches turned down (see tests/setup.ts),
  // which is what keeps it to a length you would run after an edit. The timeout
  // is still generous because the slow tests play thousands of games.
  test: {
    // The deploy gate: invariants only. Decision-level bot tests live under
    // tests/behaviour and run with npm run test:behaviour.
    include: ['tests/*.test.ts'],
    testTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
    // The match room extends a class that only exists inside workerd. Aliased,
    // the room is ordinary TypeScript and the suite can drive one directly.
    alias: { 'cloudflare:workers': '/tests/cloudflare-workers.stub.ts' },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    // Training writes snapshots continuously and dotnet locks its build
    // output; watching either makes any vite process die with EBUSY while a
    // tournament or a C# build is running.
    watch: { ignored: ['**/runs/**', '**/replays/**', '**/csharp/**'] },
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
