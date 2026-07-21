// pub-sub for "a usage record was added for some sheet" —
// mirrors headSubscription.ts's pattern, kept separate from it since usage
// accounting is an independent concern from version/head changes.

import { createSignal } from "./signal";

const signal = createSignal();

export const notifyUsageChanged = signal.notify;
export const subscribeUsageChanged = signal.subscribe;
