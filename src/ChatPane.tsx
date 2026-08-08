import { useEffect, useState } from "react";
import { CompressionPrompt } from "./CompressionPrompt";
import { GLOBAL_MEMORIES_SHEET_ID, mergeMemoryPools } from "./globalMemories";
import { serializeSheet } from "./serializer";
import { COMPRESSION_RECOMMENDATION_THRESHOLD, getStoredAutoRunCompression, getStoredRecommendCompression } from "./settingsStorage";
import { applyOverlay } from "./sheetOverlay";
import { SuggestionSessionView } from "./SuggestionSessionView";
import { COMPRESSION_INSTRUCTION, useSuggestionSession } from "./suggestionSession";
import { estimateTokenCount } from "./tokenEstimate";
import { useHeadVersion } from "./useHeadVersion";
import { useSheetOverlay } from "./useSheetOverlay";

// The chat pane. Every send is a fully stateless call — system prompt
// (serialized sheet) + this one user message → response.
// Scoped to whichever sheet is currently active.
export function ChatPane({ sheetId, onOpenManageWithAI }: { sheetId: string; onOpenManageWithAI: (prefill?: string) => void }) {
  const session = useSuggestionSession("chat", sheetId);
  // only needed to render a still-pending suggestion's
  // before/after diff (ChangeCard, shown when auto-apply is off) — same
  // merged-pool-plus-overlay computation ManageWithAIPanel already does for
  // the same reason.
  const localHead = useHeadVersion(sheetId);
  const globalHead = useHeadVersion(GLOBAL_MEMORIES_SHEET_ID);
  const overlay = useSheetOverlay();
  const sheet = localHead && globalHead ? applyOverlay(mergeMemoryPools(localHead.sheet, globalHead.sheet), overlay) : null;

  // Background-only now (the old Token Estimator panel showed this
  // directly; removed). Purely a trigger for the CompressionPrompt below —
  // dismissedAtTokenCount remembers the count as of the last dismissal (any
  // path — X, Not now, or Compress) so the prompt only reappears once
  // context has grown another full threshold's worth, not on every render
  // past the original threshold.
  const tokenCount = sheet ? estimateTokenCount(serializeSheet(sheet)) : 0;
  const [dismissedAtTokenCount, setDismissedAtTokenCount] = useState<number | null>(null);

  useEffect(() => {
    setDismissedAtTokenCount(null);
  }, [sheetId]);

  const showCompressionPrompt =
    getStoredRecommendCompression() &&
    tokenCount >= COMPRESSION_RECOMMENDATION_THRESHOLD &&
    (dismissedAtTokenCount === null || tokenCount >= dismissedAtTokenCount + COMPRESSION_RECOMMENDATION_THRESHOLD);

  return (
    <>
      <SuggestionSessionView session={session} sheet={sheet} inputPlaceholder="Send a message..." />
      {showCompressionPrompt && (
        <CompressionPrompt
          onAccept={() => {
            if (getStoredAutoRunCompression()) {
              void session.runCompressionNow();
            } else {
              onOpenManageWithAI(COMPRESSION_INSTRUCTION);
            }
          }}
          onDismiss={() => setDismissedAtTokenCount(tokenCount)}
        />
      )}
    </>
  );
}
