import { createSignal } from "./signal";

// Minimal pub-sub so UI surfaces can react to store changes, without pulling
// in a state-management library for what are otherwise a couple of
// IndexedDB-backed pointers. Two deliberately separate signals — a version
// being created/reverted within a sheet is a different event from the sheets
// list itself changing, and the hooks listening for each want only their own.
// They live in one file because each was previously its own five-line module
// wrapping this same primitive.

const headSignal = createSignal();
const sheetsSignal = createSignal();

// "a version was created/reverted within some sheet." Note the notification
// carries no sheetId — it's a single unscoped broadcast, which useHeadVersion
// specifically accounts for (see its comment about import ordering).
export const notifyHeadChanged = headSignal.notify;
export const subscribeHeadChanged = headSignal.subscribe;

// "the sheets list, or which sheet is active, may have changed."
// useSheets() is the only subscriber that needs this; components below it
// just receive the resolved sheetId as a normal reactive prop once it changes.
export const notifySheetsChanged = sheetsSignal.notify;
export const subscribeSheetsChanged = sheetsSignal.subscribe;
