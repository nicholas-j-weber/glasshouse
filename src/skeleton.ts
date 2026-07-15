import type { Sheet } from "./types";

// §8.1: default tone text on creation.
const DEFAULT_TONE_TEXT = "Clear and direct; match the user's register.";

// §8.1: a new sheet's skeleton — default Tone, no pre-filled memories
// (Addendum J: no User Details; Addendum O: no dedicated Conversation
// Summary field — turns start out simply absent from an empty memories[]).
// Required by the mechanics themselves, since a stateless call has nowhere
// else for baseline instructions to live.
export function createSkeletonSheet(): Sheet {
  const now = new Date().toISOString();
  return {
    tone: {
      id: crypto.randomUUID(),
      label: "Tone",
      body: DEFAULT_TONE_TEXT,
      pinRank: 0, // Addendum C, 5.2.1: reserved sentinel, non-editable
      active: true,
      lastModified: now,
      provenance: { source: "manual" },
    },
    memories: [],
    freeformNotes: "",
  };
}
