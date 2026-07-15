// Dexie needs a real IndexedDB implementation; vitest runs in Node by
// default, so this polyfills it for the store tests.
import "fake-indexeddb/auto";

// settingsStorage.ts (active-sheet preference) uses
// localStorage directly; Node has no global localStorage, so a minimal
// in-memory stand-in covers get/set/clear for tests that touch it.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}
