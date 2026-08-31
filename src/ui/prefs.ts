/**
 * What the setup screens should still know on the next visit: the name the
 * player goes by online, and the decks they last picked.
 *
 * These live in localStorage beside the saved decks rather than in a document
 * cookie. A cookie would be posted up to the worker with every request and the
 * room has no use for it, and one call to navigator.storage.persist covers the
 * decks and these together.
 */

const KEY = 'ernumrites.prefs';

export interface Prefs {
  /** The name other players are shown online. */
  name: string;
  /** The setup screen's two deck keys, player one first. */
  picks: [string, string];
}

/** A field is null when nothing was kept for it, or what was kept is unusable. */
export interface StoredPrefs {
  name: string | null;
  picks: [string | null, string | null];
}

const NOTHING: StoredPrefs = { name: null, picks: [null, null] };

/**
 * What the last visit left behind. Deck keys come back exactly as written: only
 * the caller knows which decks still exist, and the name is only checked here
 * for being a string.
 */
export function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return NOTHING;
    const v = JSON.parse(raw) as Partial<Prefs>;
    const key = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
    return {
      name: typeof v.name === 'string' ? v.name : null,
      picks: [key(v.picks?.[0]), key(v.picks?.[1])],
    };
  } catch {
    // Private mode and blocked storage both throw rather than return null.
    return NOTHING;
  }
}

/** Only ever called for something the player just did, which is what lets it ask to persist. */
export function savePrefs(p: Prefs): void {
  void requestPersistence();
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // A full or disabled store is not worth taking the page down for.
  }
}

/** Asked at most once a page. The browser remembers the answer either way. */
let persistenceAsked = false;

/**
 * Asks the browser to keep this origin's storage through an eviction sweep,
 * which is what stops a name, a pick or a built deck vanishing when the disk
 * runs short. Firefox raises a permission prompt, Chrome answers from how much
 * the site has been used, and a browser without the API keeps its ordinary
 * eviction rules. Call this only from something the player did: a prompt needs
 * a gesture behind it or the browser drops it on the floor.
 */
export async function requestPersistence(): Promise<void> {
  if (persistenceAsked) return;
  persistenceAsked = true;
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    // No API, or a browser that refuses to be asked. Storage still works.
  }
}
