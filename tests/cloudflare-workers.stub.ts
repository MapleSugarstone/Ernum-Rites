/**
 * Enough of `cloudflare:workers` to build a room in a test.
 *
 * The real module only exists inside workerd, so the suite is aliased onto this
 * (see `test.alias` in vite.config.ts). Only the base class is needed: nothing
 * in MatchRoom calls anything the runtime puts on it beyond `ctx` and `env`.
 */
export class DurableObject {
  constructor(
    readonly ctx: {
      id: { name?: string; toString(): string };
      storage: {
        get<T>(key: string): Promise<T | undefined>;
        put(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<boolean>;
        setAlarm(when: number): Promise<void>;
        deleteAlarm(): Promise<void>;
      };
    },
    readonly env: unknown,
  ) {}
}

