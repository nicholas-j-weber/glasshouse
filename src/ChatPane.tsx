import { GLOBAL_MEMORIES_SHEET_ID, mergeMemoryPools } from "./globalMemories";
import { applyOverlay } from "./sheetOverlay";
import { SuggestionSessionView } from "./SuggestionSessionView";
import { useSuggestionSession } from "./suggestionSession";
import { useHeadVersion } from "./useHeadVersion";
import { useSheetOverlay } from "./useSheetOverlay";

// The chat pane. Every send is a fully stateless call — system prompt
// (serialized sheet) + this one user message → response.
// Scoped to whichever sheet is currently active.
export function ChatPane({ sheetId }: { sheetId: string }) {
  const session = useSuggestionSession("chat", sheetId);
  // only needed to render a still-pending suggestion's
  // before/after diff (ChangeCard, shown when auto-apply is off) — same
  // merged-pool-plus-overlay computation ManageWithAIPanel already does for
  // the same reason.
  const localHead = useHeadVersion(sheetId);
  const globalHead = useHeadVersion(GLOBAL_MEMORIES_SHEET_ID);
  const overlay = useSheetOverlay();
  const sheet = localHead && globalHead ? applyOverlay(mergeMemoryPools(localHead.sheet, globalHead.sheet), overlay) : null;

  return <SuggestionSessionView session={session} sheet={sheet} inputPlaceholder="Send a message..." />;
}
