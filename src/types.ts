// Core data model.

export interface Provenance {
  // spec.md "Knowledge & Skills" — "file_upload" marks a Memory (kind:
  // "knowledge"/"skill") created by uploading a file directly, distinct
  // from "manual" (typed/edited by hand in the UI) and "ai_suggested"
  // (proposed by the model, accepted or auto-applied). No chatMessageId/
  // sheetEditorSessionId of its own — sourceExcerpt (the filename, per
  // moduleId's own comment on Memory) is what identifies it instead.
  source: "manual" | "ai_suggested" | "file_upload";
  chatMessageId?: string;
  sheetEditorSessionId?: string;
  // denormalized snapshot so provenance stays legible
  // even if chatMessageId no longer resolves to anything (ephemerality).
  sourceExcerpt?: string;
}

export interface Memory {
  id: string;
  label: string;
  body: string;
  pinRank: number | null;
  active: boolean;
  lastModified: string; // ISO 8601
  provenance: Provenance;
  // marks this memory as a conversation-turn entry,
  // serialized into the computed Conversation Summary block (5.1.3) and
  // ordered chronologically (ascending lastModified) rather than by
  // pinRank/recency like ordinary memories. Absent for ordinary memories.
  // pinRank stays null for these by convention (UI withholds Pin, not a
  // type-level guarantee — same pragmatic choice as Tone's inert fields).
  //
  // "summary" is a compressed digest replacing one or more
  // conversation turns — same local-chain/chronological-ordering/no-pinRank
  // treatment as "conversation_turn", but rendered in its own block above
  // the numbered turn list (5.1.3) rather than commingled into it, since a
  // digest covering many turns isn't itself one more turn. Deactivating the
  // turns a summary replaces (kept, not deleted — same visible-and-
  // reversible posture as every other deactivation in this app) is what
  // actually reduces Context size; the summary is what keeps the gist of
  // them in the model's context afterward.
  //
  // spec.md "Knowledge & Skills" — "knowledge" (reference text: facts,
  // docs) and "skill" (an ordered/branching procedure) are not a new
  // entity, just two more kind values in this same global-pool Memory,
  // uploaded rather than chat-suggested (Provenance.source: "file_upload").
  // v1 skills are structured prose in body (numbered steps, branch labels
  // as convention) — not a parsed/executable schema (spec.md non-goals).
  // Rendered in SheetPanel.tsx's own "Knowledge" tab, separate from
  // "Memories", but included in topLevelInstructions the same wholesale-
  // inclusion way ordinary memories already are — no separate retrieval
  // mechanism (spec.md "Retrieval: wholesale inclusion, not RAG").
  kind?: "conversation_turn" | "summary" | "knowledge" | "skill";
  // Groups every Memory created from one uploaded file/module together, so
  // the whole module can be bulk-toggled active in one action — reuses the
  // existing per-memory `active` flag, no new mechanism. Only ever set on
  // kind: "knowledge"/"skill" entries; absent otherwise.
  moduleId?: string;
}

// userDetails removed — durable facts about the user are now
// ordinary memories, same atomicity as everything else in the pool.
// conversationSummary removed too — conversation turns are now
// ordinary memories with kind: "conversation_turn", computed into their own
// serialized section (5.1.3) rather than stored in a dedicated field.
export interface Sheet {
  tone: Memory;
  memories: Memory[];
  freeformNotes: string;
}

// "ai_suggestion_auto_applied" distinguishes a version created
// by chat mode's auto-apply (no manual Accept click) from one the user
// explicitly accepted ("ai_suggestion_accepted") — both are genuinely
// AI-suggested (Provenance.source stays "ai_suggested" for either), this
// is specifically about *how* the version came to exist, for History.
type VersionAttributionKind =
  | "manual_edit"
  | "ai_suggestion_accepted"
  | "ai_suggestion_auto_applied"
  | "sheet_editor_session";

export interface VersionAttribution {
  kind: VersionAttributionKind;
  chatMessageId?: string;
  sheetEditorSessionId?: string;
}

export interface Version {
  id: string;
  // scopes this version to the sheet container it belongs
  // to — every sheet has its own independent version chain now, rather than
  // one implicit global chain.
  sheetId: string;
  parentId: string | null;
  createdAt: string; // ISO 8601
  attribution: VersionAttribution;
  sheet: Sheet;
}

// Export/import file shape.
// "1.1" adds an optional global-memory-pool section
// (independent lineage) alongside the local sheet's own —
// both present together or both absent. "1.0" files predate the global
// pool as a concept and are still readable, but have no opinion about it.
export interface SheetExport {
  formatVersion: "1.0" | "1.1";
  headVersionId: string;
  versions: Version[];
  globalHeadVersionId?: string;
  globalVersions?: Version[];
}

// a sheet *container* — metadata only. Distinct from
// `Sheet` above, which is the content shape a container's active Version
// holds; multiple `SheetMeta` records can each own their own independent
// version chain.
export interface SheetMeta {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
}

// The SHEET_SUGGESTIONS wire format.

export interface NewMemorySuggestion {
  type: "new_memory";
  label: string;
  body: string;
}

export interface EditMemorySuggestion {
  type: "edit_memory";
  memoryId: string;
  label: string;
  body: string;
}

export interface ToneUpdateSuggestion {
  type: "tone_update";
  body: string;
}

export interface DeactivateMemorySuggestion {
  type: "deactivate_memory";
  memoryId: string;
  reason: string;
}

export interface ReorderPinsSuggestion {
  type: "reorder_pins";
  pinOrder: string[]; // Memory ids
}

// replaces Sheet.conversationSummary's body wholesale,
// mirroring tone_update. The body's *content* is an ordered list (6.2.9),
// but that's a prompt-format convention, not something this type encodes.
export interface ConversationSummaryUpdateSuggestion {
  type: "conversation_summary_update";
  body: string;
}

// condenses one or more existing conversation turns (turnIds)
// into a single new kind: "summary" memory — one suggestion, one atomic
// version (adds the summary and deactivates the turns it replaces
// together), rather than a batch of N+1 separate new/deactivate
// suggestions each needing its own accept and each producing its own
// History entry for what's conceptually a single action.
export interface CompressConversationSuggestion {
  type: "compress_conversation";
  body: string;
  turnIds: string[];
}

// spec.md "Code-diff lane" — the vehicle for a coding pass's actual file
// changes. Only ever legal on a response sent under systemPrompt.ts's Code
// content mode (gated by that mode's addendum being present in the prompt,
// not by model judgment — same "toggle, not heuristic" posture as
// routingMode). files is a full snapshot per changed/created file
// (path -> complete new content, never a patch), matching
// CodeVersion.files exactly. summary is a short plain-language description
// for the pending-review card and toast — actual file content only ever
// surfaces through CodeDiffView after acceptance, never inline here.
export interface CodeChangeSuggestion {
  type: "code_change";
  summary?: string;
  files: Record<string, string>;
}

export type SheetSuggestion =
  | NewMemorySuggestion
  | EditMemorySuggestion
  | ToneUpdateSuggestion
  | DeactivateMemorySuggestion
  | ReorderPinsSuggestion
  | ConversationSummaryUpdateSuggestion
  | CompressConversationSuggestion
  | CodeChangeSuggestion;

// The two independent call surfaces sharing useSuggestionSession
// (suggestionSession.ts) — canonical home for this type since PersistedMessage
// below needs it too, not just systemPrompt.ts's buildSystemPrompt (which
// imports it back from here to avoid a circular import).
export type CallMode = "chat" | "sheet_editor";

// spec.md "Routing: reasoning vs. blackbox" — a per-message toggle, not a
// heuristic. Shared type so PersistedMessage/SessionMessage/settingsStorage
// all reference the same two literals.
export type RoutingMode = "reasoning" | "blackbox";

// a persisted chat message, scoped to a sheet — the same
// shape the chat session keeps in memory (suggestionSession.ts's
// SessionMessage/DisplaySuggestion), plus sheetId/createdAt for storage.
// Purely a human-facing convenience: statelessness is unaffected —
// nothing here is ever reconstructed into a system prompt or a call.
export type PersistedSuggestionStatus = "pending" | "accepted" | "rejected" | "revised" | "failed";

export interface PersistedDisplaySuggestion {
  suggestion: SheetSuggestion;
  status: PersistedSuggestionStatus;
  // See suggestionSession.ts's
  // DisplaySuggestion for what these drive in the UI.
  isFallback?: boolean;
  isFollowUp?: boolean;
}

export interface PersistedMessage {
  id: string;
  sheetId: string;
  // which of useSuggestionSession's two call surfaces produced
  // this message — ChatPane ("chat") and ManageWithAIPanel ("sheet_editor")
  // previously shared one undifferentiated per-sheet log (filtered only by
  // sheetId), so a pending suggestion from one would leak into the other's
  // view. messagesStore.ts's loadMessages now filters by this too. Older
  // rows predating this field simply won't match either filter and stop
  // appearing anywhere — treated as disposable local data, same precedent
  // as prior schema-shape changes here (migration note).
  mode: CallMode;
  role: "user" | "assistant" | "error";
  text: string;
  sourceText?: string;
  suggestions?: PersistedDisplaySuggestion[];
  // whether this message's suggestions were auto-applied
  // or left for manual review, per the auto-apply setting at
  // the moment this message was created — set once, never changed
  // retroactively if the setting is toggled later. Determines how
  // suggestionSession.ts's rendering treats each suggestion's status:
  // true means the plain historical record; false means pending/failed
  // ones are still-interactive change cards. undefined (sheet_editor
  // messages, user/error messages) means "not applicable."
  autoApplied?: boolean;
  // Glasshouse pass routing (spec.md "The Pass" / "Routing"). routingMode
  // is always set; reasoningRunId is set iff "reasoning", codeVersionId
  // iff this pass touched code (independent of routingMode).
  routingMode: RoutingMode;
  reasoningRunId?: string;
  codeVersionId?: string;
  // Pass Triage's "what actually went in" pane — serializeSheet(overlaidSheet)
  // captured at send time (suggestionSession.ts), for both routing modes.
  // Reasoning-routed passes technically also have this in RunLog.topLevelInstructions,
  // but that string includes mode-preamble boilerplate on top of the sheet
  // content; capturing it uniformly here at the one shared call-site avoids
  // needing to parse it back out, and gives blackbox passes the same audit
  // data reasoning-routed passes already had.
  contextSnapshot?: string;
  createdAt: string; // ISO 8601
}

// Reasoning agent (spec.md "Reasoning agent" — port of reasoning-agent's
// agent.py). Schema only for now: StepRecord/RunLog gain behavior in a
// later milestone.
export type StepRole = "reasoning" | "judge" | "router" | "compile" | "final";

export interface StepRecord {
  runId: string;
  stepId: number;
  role: StepRole;
  instruction: string;
  prompt: string; // full exact text sent to the model
  rawResponse: string; // unmodified model output
  timestamp: string; // ISO 8601
  model: string;
  metadata?: Record<string, unknown>;
}

export interface RunLog {
  runId: string;
  sheetId: string;
  chatMessageId: string;
  originalProblem: string;
  topLevelInstructions: string;
  finalAnswer?: string;
  status: "running" | "completed" | "max_steps_reached" | "error";
}

// Code-diff lane (spec.md "Code-diff lane"). Schema only for now —
// diffCode() and the "diff, not inline code" rule land in a later
// milestone.
export interface CodeVersion {
  id: string;
  sheetId: string;
  parentId: string | null;
  createdAt: string; // ISO 8601
  chatMessageId: string;
  files: Record<string, string>; // path -> full content, snapshot not patch
}

// one record per real API call that reported usage, scoped by
// sheet. Deliberately independent of PersistedMessage — usage accounting
// and transcript display are different concerns, and a disambiguated
// follow-up call has a real cost to attribute without ever
// producing its own visible chat message. The displayed running total is
// the sum of these for a sheet, not a single stored counter.
export interface UsageRecord {
  id: string;
  sheetId: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string; // ISO 8601
}
