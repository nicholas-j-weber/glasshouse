// pub-sub for "the sheets list, or which sheet is active, may
// have changed" — deliberately separate from headSubscription.ts's "a
// version was created/reverted within a sheet." useSheets() is the only
// subscriber that needs this; components below it just receive the
// resolved sheetId as a normal reactive prop/param once it changes.

import { createSignal } from "./signal";

const signal = createSignal();

export const notifySheetsChanged = signal.notify;
export const subscribeSheetsChanged = signal.subscribe;
