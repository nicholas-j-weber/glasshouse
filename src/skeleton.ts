import type { Sheet } from "./types";

// Default tone text on creation.
const DEFAULT_TONE_TEXT = "Clear and direct; match the user's register.";

// A new sheet's skeleton — default Tone, no pre-filled memories
// (no User Details; no dedicated Conversation
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
      pinRank: 0, // reserved sentinel, non-editable
      active: true,
      lastModified: now,
      provenance: { source: "manual" },
    },
    memories: [],
    freeformNotes: "",
  };
}
