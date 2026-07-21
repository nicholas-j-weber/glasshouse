// Minimal pub-sub so UI surfaces (chat pane, sheet panel) can react when the
// store's head version changes, without pulling in a state-management
// library for what's otherwise a single IndexedDB-backed pointer.

import { createSignal } from "./signal";

const signal = createSignal();

export const notifyHeadChanged = signal.notify;
export const subscribeHeadChanged = signal.subscribe;
