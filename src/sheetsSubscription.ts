// Addendum S: pub-sub for "the sheets list, or which sheet is active, may
// have changed" — deliberately separate from headSubscription.ts's "a
// version was created/reverted within a sheet." useSheets() is the only
// subscriber that needs this; components below it just receive the
// resolved sheetId as a normal reactive prop/param once it changes.

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifySheetsChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeSheetsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
