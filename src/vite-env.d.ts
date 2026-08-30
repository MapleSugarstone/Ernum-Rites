/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the match server lives. Left unset in dev, where vite proxies /api to
   * a local `wrangler dev`; set at build time once the worker is deployed,
   * because the site and the worker are then on different origins.
   */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
