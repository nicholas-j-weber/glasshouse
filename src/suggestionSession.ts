import { useEffect, useState } from "react";
import { buildFallbackConversationSummaryUpdate, hasConversationSummaryUpdate } from "./conversationSummaryFallback";
import {
  buildSummaryFollowupUserMessage,
  extractSingleConversationSummaryUpdate,
  SUMMARY_FOLLOWUP_SYSTEM_PROMPT,
} from "./conversationSummaryFollowup";
import { GLOBAL_MEMORIES_SHEET_ID, mergeMemoryPools } from "./globalMemories";
import { loadMessages, saveMessage } from "./messagesStore";
import { createAnthropicAdapter } from "./providers/anthropic";
import { describeProviderError } from "./providers/errorMessage";
import { runReasoningAgent, type ModelCallFn } from "./reasoningAgent";
import { buildRevisionMessage } from "./revise";
import { getStoredApiKey, getStoredAutoApply, getStoredDefaultRoutingMode, getStoredModel } from "./settingsStorage";
import { memoryExists } from "./sheetEdits";
import { applyOverlay } from "./sheetOverlay";
import { getOverlay, resetOverlay, setOverlay } from "./sheetOverlayStore";
import { createVersion, ensureInitialized, revertToVersion } from "./store";
import { resolveAttribution, resolveContentChange } from "./suggestionAcceptance";
import { describeSuggestionChange } from "./suggestionChangeDisplay";
import { parseModelResponse, type ParsedModelResponse } from "./suggestionParser";
import { buildSystemPrompt, type CallMode } from "./systemPrompt";
import { recordUsage } from "./tokenUsageStore";
import type { ConversationSummaryUpdateSuggestion, PersistedDisplaySuggestion, PersistedSuggestionStatus, RoutingMode, Sheet, SheetSuggestion } from "./types";
import { useSheetOverlay } from "./useSheetOverlay";

// Shared by ChatPane (mode "chat") and SheetEditor (mode
// "sheet_editor") — accepting/rejecting/revising a suggestion works
// identically regardless of which surface produced it ("used
// identically by both the chat pane and the dedicated sheet-editor"). Only
// the mode passed to buildSystemPrompt and the framing text around the
// input differ between the two call sites.
//
// For chat mode specifically, suggestions there now
// auto-apply the instant they're received (no manual Accept), surfaced as a
// toast with an Undo window instead of a pending review card. sheet_editor
// mode (Manage with AI) is unchanged — handleAccept/handleReject/
// handleRevisionSubmit still work exactly as before and are how that
// surface applies everything, since batch/restructuring operations are
// exactly the case where a review step still earns its keep.
//
// chat mode's auto-apply is a setting (settingsStorage.ts's
// getStoredAutoApply, default on), not a permanent architectural choice —
// when off, chat suggestions behave exactly like sheet_editor's always have
// (pending cards, handleAccept/handleReject/handleRevisionSubmit), just
// rendered inline in the transcript (SuggestionSessionView) instead of
// ManageWithAIPanel's one-shot card list. Each message remembers which mode
// produced it (SessionMessage.autoApplied) so a toggle mid-conversation
// doesn't retroactively change how past messages render.

// "failed" covers an edit_memory/deactivate_memory
// suggestion whose memoryId doesn't match any memory in the current sheet —
// surfaced visibly rather than silently accepted as a no-op. Re-exported
// from types.ts so the persisted and in-memory shapes
// share a single definition.
type SuggestionStatus = PersistedSuggestionStatus;
export type DisplaySuggestion = PersistedDisplaySuggestion;

export interface SessionMessage {
  id: string;
  // which call surface produced this message — ChatPane's
  // "chat" vs ManageWithAIPanel's "sheet_editor". Set once at creation from
  // the hook's own mode argument (see makeSessionMessage below); used to
  // keep the two surfaces' persisted logs from leaking into each other
  // (they previously shared one, filtered only by sheetId).
  mode: CallMode;
  role: "user" | "assistant" | "error";
  text: string;
  // set once at creation, never changed — both orders the
  // persisted log and is carried through unchanged on every subsequent
  // persisted update (a suggestion's status changing doesn't mean the
  // message itself was created again).
  createdAt: string;
  suggestions?: DisplaySuggestion[];
  // sourceExcerpt source: the user-authored text (an
  // original message/instruction, or a revision instruction) that produced
  // this assistant reply's suggestions.
  sourceText?: string;
  // see types.ts's PersistedMessage.autoApplied — carried
  // through unchanged here so SuggestionSessionView knows whether to render
  // this message's suggestions as a plain record or still-interactive cards.
  autoApplied?: boolean;
  // spec.md "Routing: reasoning vs. blackbox" — set once at creation from
  // the hook's routingMode toggle, same "captured at send time, not
  // re-derived from a live setting" treatment as autoApplied above.
  routingMode: RoutingMode;
  // set iff routingMode === "reasoning" and the reasoning agent actually
  // ran (spec.md "The Pass") — links to the RunLog/StepRecord trace
  // ReasoningTrace.tsx renders as an expandable step list. A revision's
  // follow-up call never sets this, even mid-reasoning-toggled session —
  // see handleRevisionSubmit's comment.
  reasoningRunId?: string;
  // set iff this pass touched code (spec.md "The Pass") — independent of
  // routingMode. Links to the CodeVersion chain CodeDiffView.tsx renders as
  // an expandable per-file diff. Nothing sets this yet — that's the coding-
  // pass detection milestone 6 wires into the suggestion parser; this field
  // and CodeDiffView are the read/render side, built ahead of it.
  codeVersionId?: string;
}

// ephemeral (not persisted — a fresh page load starts with
// none) feedback for a chat-mode auto-applied suggestion. `undo` is present
// only while the change is still cleanly reversible; see applySuggestion's
// comment for what "cleanly" means here.
export interface SuggestionToast {
  id: string;
  text: string;
  kind: "applied" | "failed";
  undo?: () => Promise<void>;
}

const TOAST_LIFETIME_MS = 6000;

function truncateExcerpt(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function makeMessage(fields: Omit<SessionMessage, "id" | "createdAt">): SessionMessage {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...fields };
}

// what a toast should say about an applied suggestion.
// conversation_summary_update returns null on purpose — it's mandatory on
// every single chat turn, so a toast for it would fire
// constantly and say nothing notable; it still applies silently
// underneath, just without announcing itself.
function toastTextFor(suggestion: SheetSuggestion, sheet: Sheet): string | null {
  switch (suggestion.type) {
    case "conversation_summary_update":
      return null;
    case "new_memory":
      return `Added: ${suggestion.label}: ${suggestion.body}`;
    case "edit_memory":
      return `Updated: ${suggestion.label}: ${suggestion.body}`;
    case "tone_update":
      return `Tone updated: ${suggestion.body}`;
    case "deactivate_memory": {
      const change = describeSuggestionChange(suggestion, sheet);
      return `Deactivated: ${change.before ?? suggestion.memoryId}`;
    }
    case "reorder_pins":
      return "Pins reordered";
    case "compress_conversation":
      return `Compressed ${suggestion.turnIds.length} conversation turn${suggestion.turnIds.length === 1 ? "" : "s"} into one summary`;
  }
}

// only chat mode ever had a mandatory-
// proposal instruction, so only chat mode gets the fallback — sheet-editor
// responses with zero suggestions are left exactly as the model returned
// them, since a response can validly say "no changes are warranted".
//
// before reaching for the truncation fallback,
// try one disambiguated follow-up call whose only task is producing the
// update — most of the time (per live testing, this path is rare once the
// sheet has any real entry at all) this recovers genuine model-authored
// text instead of a lower-quality stand-in. `attemptFollowup` is injected
// so this stays testable without a real network call.
async function resolveSuggestions(
  parsed: ParsedModelResponse,
  mode: CallMode,
  userMessage: string,
  attemptFollowup: (userMessage: string, aiReplyText: string) => Promise<ConversationSummaryUpdateSuggestion | null>,
): Promise<DisplaySuggestion[] | undefined> {
  const real = parsed.suggestions.map((suggestion) => ({ suggestion, status: "pending" as const }));

  if (mode !== "chat" || hasConversationSummaryUpdate(parsed)) {
    return real.length > 0 ? real : undefined;
  }

  const followup = await attemptFollowup(userMessage, parsed.conversationalText);
  const extra: DisplaySuggestion = followup
    ? { suggestion: followup, status: "pending", isFollowUp: true }
    : {
        suggestion: buildFallbackConversationSummaryUpdate(userMessage, parsed.conversationalText),
        status: "pending",
        isFallback: true,
      };
  return [...real, extra];
}

export interface SuggestionSession {
  messages: SessionMessage[];
  draft: string;
  setDraft: (value: string) => void;
  isSending: boolean;
  // Per-message toggle (spec.md "Routing: reasoning vs. blackbox") — read at
  // send time by handleSend/handleRevisionSubmit, defaulted from Settings'
  // default-routing-mode preference each time the sheet/mode changes.
  routingMode: RoutingMode;
  setRoutingMode: (mode: RoutingMode) => void;
  handleSend: () => Promise<void>;
  handleAccept: (message: SessionMessage, index: number) => Promise<void>;
  handleReject: (message: SessionMessage, index: number) => void;
  revising: RevisionTarget | null;
  revisionDraft: string;
  setRevisionDraft: (value: string) => void;
  startRevision: (messageId: string, index: number) => void;
  cancelRevision: () => void;
  handleRevisionSubmit: (message: SessionMessage, index: number) => Promise<void>;
  // lets a still-pending conversation_summary_update's body be
  // edited directly, in place, before Accept — see ChangeCard.tsx's Edit
  // button. No-op for any other suggestion type (nothing else has a plain
  // free-text body worth hand-editing this way; new_memory/edit_memory's
  // label+body and tone_update's body all still go through Revise with AI).
  editSuggestionBody: (message: SessionMessage, index: number, body: string) => void;
  // Only populated when chat mode is actively auto-applying
  // (the default) — sheet_editor mode never produces toasts (nothing there
  // auto-applies), and neither does chat mode with the setting off, so this
  // is simply always [] in both those cases.
  toasts: SuggestionToast[];
  dismissToast: (id: string) => void;
  undoToast: (id: string) => Promise<void>;
}

interface RevisionTarget {
  messageId: string;
  index: number;
}

// Shared by ManageWithAIPanel and SuggestionSessionView — both need a
// short reference to what's being revised, so the input label stays
// meaningful even if the target card has scrolled out of view (each is
// one shared scroll region — the field isn't sticky above it).
export function getRevisingContext(
  messages: SessionMessage[],
  revising: RevisionTarget | null,
  sheet: Sheet | null,
): { revisingMessage: SessionMessage | undefined; revisingTitle: string | null } {
  const revisingMessage = revising ? messages.find((m) => m.id === revising.messageId) : undefined;
  const revisingDisplay = revising ? revisingMessage?.suggestions?.[revising.index] : undefined;
  const revisingTitle = sheet && revisingDisplay ? describeSuggestionChange(revisingDisplay.suggestion, sheet).title : null;
  return { revisingMessage, revisingTitle };
}

interface ApplyOutcome {
  ok: boolean;
  toastText?: string;
  undo?: () => Promise<void>;
}

// Every send/revision is a fully stateless call — system prompt
// (mode preamble + serialized sheet + suggestion instructions)
// + this one message → response. `messages` is never resent to the model;
// it's persisted locally anyway, purely as a human-facing
// scrollback scoped to `sheetId` — reloaded on mount and whenever sheetId
// changes (switching sheets), never fed back into a call.
export function useSuggestionSession(mode: CallMode, sheetId: string): SuggestionSession {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  // deactivate_memory and reorder_pins accepts are
  // session-only until folded into the next real version. Shared across
  // every surface via sheetOverlayStore.ts so they don't diverge.
  const overlay = useSheetOverlay();
  const [revising, setRevising] = useState<RevisionTarget | null>(null);
  const [revisionDraft, setRevisionDraft] = useState("");
  const [toasts, setToasts] = useState<SuggestionToast[]>([]);
  const [routingMode, setRoutingMode] = useState<RoutingMode>(getStoredDefaultRoutingMode());

  useEffect(() => {
    let cancelled = false;
    setMessages([]); // avoid a flash of the previous sheet's messages while loading
    setDraft("");
    setRevising(null);
    setRevisionDraft("");
    setToasts([]);
    setRoutingMode(getStoredDefaultRoutingMode());

    loadMessages(sheetId, mode).then((loaded) => {
      if (!cancelled) setMessages(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [sheetId, mode]);

  // Adds a message to the visible session and persists it.
  function addMessage(message: SessionMessage) {
    setMessages((prev) => [...prev, message]);
    void saveMessage(sheetId, message);
  }

  // Wraps makeMessage with this hook's own mode — every message this
  // session creates is tagged with whichever surface (chat vs sheet_editor)
  // produced it. routingMode defaults to the toggle's live value but can be
  // overridden (handleRevisionSubmit always forces "blackbox", since that
  // call never goes through the reasoning agent regardless of the toggle).
  function makeSessionMessage(fields: Omit<SessionMessage, "id" | "createdAt" | "mode" | "routingMode"> & { routingMode?: RoutingMode }): SessionMessage {
    return makeMessage({ ...fields, mode, routingMode: fields.routingMode ?? routingMode });
  }

  function updateSuggestionStatus(messageId: string, index: number, status: SuggestionStatus) {
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === messageId && m.suggestions
          ? { ...m, suggestions: m.suggestions.map((s, i) => (i === index ? { ...s, status } : s)) }
          : m,
      );
      const updated = next.find((m) => m.id === messageId);
      if (updated) void saveMessage(sheetId, updated);
      return next;
    });
  }

  // same shape as updateSuggestionStatus, but rewrites a still-
  // pending suggestion's own body in place — a direct hand-edit rather than
  // a round trip through the model (Revise with AI). A no-op for suggestion
  // types with no plain `body` field (deactivate_memory, reorder_pins);
  // ChangeCard.tsx only ever offers the Edit button that calls this for
  // conversation_summary_update, but this stays generic rather than special-
  // cased to one type, since resolveContentChange already treats
  // `suggestion.body` uniformly across every type that has one.
  function editSuggestionBody(message: SessionMessage, index: number, body: string) {
    const display = message.suggestions?.[index];
    if (!display || !("body" in display.suggestion)) return;
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === message.id && m.suggestions
          ? {
              ...m,
              suggestions: m.suggestions.map((s, i) =>
                i === index && "body" in s.suggestion ? { ...s, suggestion: { ...s.suggestion, body } } : s,
              ),
            }
          : m,
      );
      const updated = next.find((m) => m.id === message.id);
      if (updated) void saveMessage(sheetId, updated);
      return next;
    });
  }

  function pushToast(toast: Omit<SuggestionToast, "id">) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => dismissToast(id), TOAST_LIFETIME_MS);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function undoToast(id: string) {
    const toast = toasts.find((t) => t.id === id);
    if (!toast?.undo) return;
    await toast.undo();
    dismissToast(id);
  }

  function appendError(text: string) {
    addMessage(makeSessionMessage({ role: "error", text }));
  }

  // a quiet second call — failure here (network error,
  // malformed response, or the model still not producing a valid entry)
  // just falls through to the truncation fallback, so unlike
  // runCall this never appends a visible error; the main response already
  // succeeded and this is only backfilling a secondary mechanism.
  async function attemptSummaryFollowup(
    userMessage: string,
    aiReplyText: string,
  ): Promise<ConversationSummaryUpdateSuggestion | null> {
    const apiKey = getStoredApiKey();
    if (!apiKey) return null;

    setIsSending(true);
    try {
      const adapter = createAnthropicAdapter({ apiKey, model: getStoredModel() });
      const result = await adapter.call(
        SUMMARY_FOLLOWUP_SYSTEM_PROMPT,
        buildSummaryFollowupUserMessage(userMessage, aiReplyText),
      );
      if (!result.ok) return null;
      // this call has a real cost even though it never produces
      // its own visible chat message — record it here, not tied to any message.
      if (result.usage) void recordUsage(sheetId, result.usage);
      return extractSingleConversationSummaryUpdate(parseModelResponse(result.text));
    } finally {
      setIsSending(false);
    }
  }

  // Returns the parsed response on success, or null on failure (after
  // appending a visible error). Never touches the message list on
  // failure beyond that — callers own deciding what a *successful* call adds.
  async function runCall(systemPrompt: string, userMessage: string): Promise<ParsedModelResponse | null> {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      appendError("No API key set — add one above.");
      return null;
    }

    setIsSending(true);
    try {
      const adapter = createAnthropicAdapter({ apiKey, model: getStoredModel() });
      const result = await adapter.call(systemPrompt, userMessage);

      if (!result.ok) {
        appendError(describeProviderError(result.error));
        return null;
      }

      // covers the main chat/revision call and sheet-editor
      // calls alike — this function is already shared across both modes.
      if (result.usage) void recordUsage(sheetId, result.usage);
      return parseModelResponse(result.text);
    } finally {
      setIsSending(false);
    }
  }

  // Reasoning-routed counterpart to runCall (spec.md "Reasoning agent" +
  // "The Pass"). systemPrompt becomes topLevelInstructions — the same
  // "sheet's memories are one source of truth" value runCall would've sent
  // as the system prompt — so every step (including the final one) carries
  // the same suggestion-format instructions a direct call gets; the run's
  // finalAnswer is parsed exactly like runCall's result.text. Each step's
  // own model call already logs its full prompt/response in runSteps, so
  // there's no separate system/user split here — modelCallFn just forwards
  // the agent's one flat prompt string as the user message.
  //
  // chatMessageId is threaded in from the caller (generated before the
  // assistant SessionMessage itself exists) so RunLog.chatMessageId can
  // link back to it once that message is created.
  async function runReasoningPass(
    systemPrompt: string,
    problem: string,
    chatMessageId: string,
  ): Promise<{ parsed: ParsedModelResponse; reasoningRunId: string } | { parsed: null; reasoningRunId?: never }> {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      appendError("No API key set — add one above.");
      return { parsed: null };
    }

    setIsSending(true);
    try {
      const adapter = createAnthropicAdapter({ apiKey, model: getStoredModel() });
      const modelCallFn: ModelCallFn = async (prompt) => {
        const result = await adapter.call("", prompt);
        if (!result.ok) throw new Error(describeProviderError(result.error));
        if (result.usage) void recordUsage(sheetId, result.usage);
        return result.text;
      };

      let run;
      try {
        run = await runReasoningAgent({
          sheetId,
          chatMessageId,
          problem,
          topLevelInstructions: systemPrompt,
          modelCallFn,
          modelName: getStoredModel(),
        });
      } catch (e) {
        // A step's model call failed (network/auth/rate-limit) — the run's
        // db row is left "running" (reasoningAgent.ts has no error status of
        // its own to set), but nothing here treats that as a completed pass:
        // no message is added, same "failure never silently no-ops" contract
        // as runCall's own error path.
        appendError(e instanceof Error ? e.message : String(e));
        return { parsed: null };
      }

      return { parsed: parseModelResponse(run.finalAnswer ?? ""), reasoningRunId: run.runId };
    } finally {
      setIsSending(false);
    }
  }

  // Applies one suggestion and reports back enough to show a toast and
  // (while still fresh) undo it. Shared by manual accept (handleAccept —
  // sheet_editor mode always, chat mode when auto-apply is off) and chat
  // mode's auto-apply loop — the two differ only in `autoApplied` (which
  // attribution kind the resulting version gets) and in who
  // calls it.
  //
  // Reads the overlay via getOverlay() (a plain synchronous store read),
  // not the `overlay` React-state value closed over above — auto-apply
  // calls this sequentially for every suggestion in one response, and a
  // stale closed-over overlay would miss a deactivate_memory/reorder_pins
  // change made earlier in the *same* batch, breaking the
  // "folded into whichever version is created next" mechanic for anything
  // after the first suggestion in a batch.
  //
  // Undo: content-changing suggestions (new_memory/edit_memory/tone_update/
  // conversation_summary_update) revert their chain to the version's parent
  // — the same mechanism History's "Revert to here" already uses. That's
  // only ever offered while nothing else has happened to that chain since
  // (toasts are short-lived and this app's versioning is strictly linear,
  // reverting an *older* version discards whatever came after it
  // too, same as History already does). Overlay-only suggestions
  // (deactivate_memory/reorder_pins) restore the prior overlay value
  // directly, which has no such caveat since it's plain session state.
  async function applySuggestion(
    display: DisplaySuggestion,
    messageId: string,
    sourceExcerpt: string | undefined,
    autoApplied: boolean,
  ): Promise<ApplyOutcome> {
    const { suggestion } = display;
    const now = new Date().toISOString();
    const currentOverlay = getOverlay();

    const [localHead, globalHead] = await Promise.all([
      ensureInitialized(sheetId),
      ensureInitialized(GLOBAL_MEMORIES_SHEET_ID),
    ]);
    const localBase = applyOverlay(localHead.sheet, currentOverlay);
    const globalBase = applyOverlay(globalHead.sheet, currentOverlay);
    const mergedForDisplay = mergeMemoryPools(localBase, globalBase);

    if (suggestion.type === "deactivate_memory") {
      // fail visibly rather than silently no-op.
      if (!memoryExists(mergedForDisplay, suggestion.memoryId)) {
        return { ok: false };
      }
      const priorOverride = currentOverlay.activeOverrides[suggestion.memoryId];
      setOverlay((prev) => ({
        ...prev,
        activeOverrides: { ...prev.activeOverrides, [suggestion.memoryId]: false },
      }));
      return {
        ok: true,
        toastText: toastTextFor(suggestion, mergedForDisplay) ?? undefined,
        undo: async () => {
          setOverlay((prev) => {
            const next = { ...prev.activeOverrides };
            if (priorOverride === undefined) delete next[suggestion.memoryId];
            else next[suggestion.memoryId] = priorOverride;
            return { ...prev, activeOverrides: next };
          });
        },
      };
    }

    if (suggestion.type === "reorder_pins") {
      const priorPinReorder = currentOverlay.pinReorder;
      setOverlay((prev) => ({ ...prev, pinReorder: suggestion.pinOrder }));
      return {
        ok: true,
        toastText: toastTextFor(suggestion, mergedForDisplay) ?? undefined,
        undo: async () => {
          setOverlay((prev) => ({ ...prev, pinReorder: priorPinReorder }));
        },
      };
    }

    const { attribution, provenance } = resolveAttribution(display.isFallback, mode, messageId, sourceExcerpt, autoApplied);
    const resolved = resolveContentChange(suggestion, localBase, globalBase, provenance, now);
    if (!resolved) {
      // edit_memory targeting an id in neither pool.
      return { ok: false };
    }
    const chainSheetId = resolved.chain === "local" ? sheetId : GLOBAL_MEMORIES_SHEET_ID;
    const parentVersionId = resolved.chain === "local" ? localHead.id : globalHead.id;
    await createVersion(resolved.sheet, attribution, chainSheetId);
    resetOverlay();
    return {
      ok: true,
      toastText: toastTextFor(suggestion, mergedForDisplay) ?? undefined,
      undo: async () => {
        await revertToVersion(parentVersionId, chainSheetId);
      },
    };
  }

  // chat mode's auto-apply — every suggestion in the response
  // applies immediately, in order, with a toast per notable one. Sequential
  // (not Promise.all) is load-bearing: each applySuggestion call re-reads
  // the current head/overlay, so suggestion 2 needs suggestion 1's write to
  // have actually landed first, or it would compute its new version from
  // stale base content and silently drop suggestion 1's change.
  async function autoApplyAll(message: SessionMessage, suggestions: DisplaySuggestion[]) {
    const sourceExcerpt = message.sourceText ? truncateExcerpt(message.sourceText) : undefined;
    for (let index = 0; index < suggestions.length; index++) {
      const display = suggestions[index];
      const outcome = await applySuggestion(display, message.id, sourceExcerpt, true);
      if (outcome.ok) {
        updateSuggestionStatus(message.id, index, "accepted");
        if (outcome.toastText) {
          pushToast({ text: outcome.toastText, kind: "applied", undo: outcome.undo });
        }
      } else {
        updateSuggestionStatus(message.id, index, "failed");
        pushToast({ text: "Couldn't apply a suggested change — its target may have been deleted since it was proposed.", kind: "failed" });
      }
    }
  }

  async function handleSend() {
    const messageText = draft.trim();
    if (!messageText || isSending) return;

    const [localHead, globalHead] = await Promise.all([
      ensureInitialized(sheetId),
      ensureInitialized(GLOBAL_MEMORIES_SHEET_ID),
    ]);
    const merged = mergeMemoryPools(localHead.sheet, globalHead.sheet);
    const systemPrompt = buildSystemPrompt(applyOverlay(merged, overlay), mode);

    // Captured once, up front — routingMode is a live toggle the user could
    // flip again before the (possibly multi-step) call resolves, but a pass
    // must be tagged with whichever routing actually produced it, not
    // whatever the toggle happens to read afterward.
    const passRoutingMode = routingMode;
    // Generated ahead of the call so a reasoning-routed run's RunLog can
    // reference this message's id as chatMessageId before the SessionMessage
    // itself exists.
    const assistantMessageId = crypto.randomUUID();
    const { parsed, reasoningRunId } =
      passRoutingMode === "reasoning"
        ? await runReasoningPass(systemPrompt, messageText, assistantMessageId)
        : { parsed: await runCall(systemPrompt, messageText), reasoningRunId: undefined };
    if (!parsed) return; // error already appended; draft preserved, no "sent" turn added

    const suggestions = await resolveSuggestions(parsed, mode, messageText, attemptSummaryFollowup);
    // sheet_editor mode never auto-applies regardless of the
    // setting — Manage with AI's review-every-batch model is unaffected by
    // a toggle that's specifically about chat mode.
    const autoApply = mode === "chat" && getStoredAutoApply();

    addMessage({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), mode, role: "user", text: messageText, routingMode: passRoutingMode });
    const assistantMessage: SessionMessage = {
      id: assistantMessageId,
      createdAt: new Date().toISOString(),
      mode,
      role: "assistant",
      text: parsed.conversationalText,
      sourceText: messageText,
      suggestions,
      autoApplied: autoApply,
      routingMode: passRoutingMode,
      reasoningRunId,
    };
    addMessage(assistantMessage);
    setDraft("");

    if (autoApply && suggestions && suggestions.length > 0) {
      await autoApplyAll(assistantMessage, suggestions);
    }
  }

  // reachable from chat mode too now, whenever a suggestion is
  // still pending — which happens either in sheet_editor mode (always) or
  // in chat mode with auto-apply switched off in Settings.
  async function handleAccept(message: SessionMessage, index: number) {
    const display = message.suggestions?.[index];
    if (!display) return;
    const sourceExcerpt = message.sourceText ? truncateExcerpt(message.sourceText) : undefined;
    const outcome = await applySuggestion(display, message.id, sourceExcerpt, false);
    updateSuggestionStatus(message.id, index, outcome.ok ? "accepted" : "failed");
  }

  function handleReject(message: SessionMessage, index: number) {
    // Rejecting never creates a version and never mutates the sheet.
    updateSuggestionStatus(message.id, index, "rejected");
  }

  function startRevision(messageId: string, index: number) {
    setRevising({ messageId, index });
    setRevisionDraft("");
  }

  function cancelRevision() {
    setRevising(null);
  }

  async function handleRevisionSubmit(message: SessionMessage, index: number) {
    const display = message.suggestions?.[index];
    const instruction = revisionDraft.trim();
    if (!display || !instruction) return;

    const syntheticMessage = buildRevisionMessage(display.suggestion, instruction);

    // Reuses the originating call's mode/preamble.
    const [localHead, globalHead] = await Promise.all([
      ensureInitialized(sheetId),
      ensureInitialized(GLOBAL_MEMORIES_SHEET_ID),
    ]);
    const merged = mergeMemoryPools(localHead.sheet, globalHead.sheet);
    const systemPrompt = buildSystemPrompt(applyOverlay(merged, overlay), mode);
    const parsed = await runCall(systemPrompt, syntheticMessage);
    if (!parsed) return; // error already appended; suggestion stays pending so the user can retry

    const suggestions = await resolveSuggestions(parsed, mode, instruction, attemptSummaryFollowup);

    updateSuggestionStatus(message.id, index, "revised");
    setRevising(null);
    setRevisionDraft("");
    // revision is only ever reachable from a still-pending
    // card (sheet_editor mode, or chat mode with auto-apply off) — so the
    // follow-up it produces is always manually reviewed too, regardless of
    // the current auto-apply setting. Always routingMode: "blackbox",
    // regardless of the pane's current toggle — this always goes through
    // runCall, never the reasoning agent, so tagging it "reasoning" would
    // claim an audit trail (and suppress the Blackbox badge) that doesn't
    // exist for this call.
    addMessage(
      makeSessionMessage({
        role: "assistant",
        text: parsed.conversationalText,
        sourceText: instruction,
        suggestions,
        autoApplied: false,
        routingMode: "blackbox",
      }),
    );
  }

  return {
    messages,
    draft,
    setDraft,
    isSending,
    routingMode,
    setRoutingMode,
    handleSend,
    handleAccept,
    handleReject,
    revising,
    revisionDraft,
    setRevisionDraft,
    startRevision,
    cancelRevision,
    handleRevisionSubmit,
    editSuggestionBody,
    toasts,
    dismissToast,
    undoToast,
  };
}
