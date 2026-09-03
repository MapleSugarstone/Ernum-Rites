/**
 * The two globals `worker/room.ts` uses that live only in workerd.
 *
 * The root typecheck reads the room through this suite and carries DOM types
 * rather than worker ones, so without these it cannot see the upgrade path. They
 * live in their own declaration file rather than in the stub module, because the
 * stub is resolved twice, once by its own path and once through the
 * `cloudflare:workers` alias, and a global declared in it would collide with
 * itself. Nothing in a test calls either: the harness attaches its fake socket
 * directly rather than going through the upgrade.
 */
export {};

declare global {
  const WebSocketPair: new () => Record<string, WebSocket & { accept(): void }>;

  interface ResponseInit {
    webSocket?: WebSocket | null;
  }
}
