import { serializeSheet } from "./serializer";
import { SUGGESTION_BLOCK_END, SUGGESTION_BLOCK_START } from "./suggestionDelimiter";
import type { CallMode, Sheet } from "./types";

// the system prompt is three concatenated parts — mode
// preamble, serialized sheet, suggestion instructions — not just the
// serialized sheet on its own (original shorthand).
//
// CallMode itself now lives in types.ts, not here — PersistedMessage needs
// it too (to tag which surface produced a message), and importing it back
// from systemPrompt.ts into types.ts would be circular (systemPrompt.ts
// already imports Sheet from types.ts).
export type { CallMode };

// Per-message content-mode toggle (not a heuristic — same "deterministic
// and visible" posture as routingMode): "code" is the sole gate on whether
// code_change is a legal suggestion for the model to propose, enforced by
// CODE_MODE_ADDENDUM only ever appearing in the prompt when this is "code".
// Not persisted anywhere — unlike routingMode, nothing downstream needs to
// know after the fact which mode produced a given pass; only whether the
// resulting message ended up with a codeVersionId.
export type ContentMode = "prose" | "code";

// This supersedes an earlier conditional
// trigger: conversation_summary_update is now the one suggestion type
// that's mandatory to propose on every chat response, not optional — live
// testing showed the model reliably judged a single opening question
// didn't warrant one, defeating the whole point of the mechanism. Does not
// relax the statelessness guarantee (no raw history is ever resent) or
// the "nothing applied without explicit user action" rule (mandatory
// proposal is not auto-apply).
//
// the model is no longer asked to reproduce the whole
// existing list — only the new entry's text. Live testing showed asking
// for verbatim reproduction of prior entries was unreliable and caused
// accepted updates to silently drop earlier history; the client appends
// and numbers the entry itself instead.
//
// states the Conversation Summary's temporal ordering
// explicitly — live testing showed the model reversing prior-vs-current
// turn order on self-referential questions ("what did I just ask you?")
// when that relationship was only ever implicit.
// live testing found conversation_summary_update's mandatory-
// every-turn framing wasn't enough on its own — the model sometimes also
// proposed a new_memory whose content was really just a recap of the
// exchange (what was asked, what was answered), not a standalone fact.
// new_memory always targets the *global* pool, shared across
// every chat, so a chat-scoped recap misfiled this way pollutes every
// other chat's memory — precisely the "pool dilution from high-frequency
// entries" conversation_summary_update was built to prevent in the
// first place, just via a different door. The last paragraph now says
// explicitly what kind of content each type is for, not just how to format
// one of them.
const CHAT_PREAMBLE = `The following sections are the user's curated context for this conversation. Treat them as ground truth about the user and task. Respond to the user's message directly and conversationally.

The Conversation Summary section above, if present, lists prior exchanges in this conversation in order; the message you are responding to now is always the newest one, occurring after everything listed there.

After every response, without exception, propose a conversation_summary_update whose body is only the new entry's text for this exchange — no number, and do not repeat or rewrite earlier entries shown above; the new entry is appended automatically. Format: "User asked/said: <what the user asked or said>. AI replied: <what you answered>." This is required on every single response, regardless of whether the topic seems memorable on its own — proposing this update is never optional, unlike the suggestion types below.

If the exchange also suggests a durable addition or change to this context — a fact about the user, a tone adjustment — you may separately propose that too, using new_memory, edit_memory, or tone_update; but unlike the update above, proposing these remains optional and secondary to answering the user. A new_memory must be a standalone fact that would remain true and useful in a completely different conversation — never a restatement, recap, or summary of this exchange itself; that's what the mandatory conversation_summary_update above is already for, and it stays scoped to this chat instead of a pool shared across every other one. For ordinary facts about the user, prefer creating a new, specifically-labeled memory over folding multiple unrelated facts into one broad memory; each memory should stay a single fact or closely related cluster, not a catch-all.`;

// live testing found a real failure mode the original wording
// didn't prevent — asked to "eliminate all redundancies," the model's
// entire reply was a numbered prose recap of every conversation turn, each
// one suffixed with its raw memory id copied straight out of the serialized
// sheet above (ids are shown there so the model can *target* edit_memory/
// deactivate_memory suggestions precisely — never meant to be echoed back).
// No suggestions were proposed at all. "Respond with minimal or no
// conversational text" was a preference, easy to override when a broad
// instruction invites the model to reason out loud; this rewrite makes the
// constraints explicit and hard rather than implicit and soft — analysis
// happens silently, its result must land as suggestions (not a prose
// description of what should change), and memory ids are explicitly
// off-limits in reply text.
const SHEET_EDITOR_PREAMBLE = `You are in a dedicated sheet-editing session, not a conversation — the user only ever sees your final reply, never your reasoning. The user's instruction below describes how they want their context sheet restructured (e.g. merging memories, pruning, reordering pins). Do your analysis silently; its result must be expressed as suggestions in the format below, not as prose describing what you found or what should change. Never restate the sheet's contents or any memory's id in your reply text — ids exist only so you can target suggestions precisely. Keep conversational text to at most one short sentence. If no changes are warranted after your analysis, say so in that one sentence — but an instruction like "eliminate redundancies" calls for actual suggestions, not a description of the redundancies.`;

// spec.md "Code-diff lane" — appended (not substituted) when the caller's
// ContentMode is "code", so the mode's ordinary rules (mandatory
// conversation_summary_update, sheet-editor's silent-analysis rule, etc.)
// stay in force during a coding pass too. This is the sole gate
// SUGGESTION_INSTRUCTIONS' code_change rule below refers to — its presence
// here, controlled entirely by the caller's toggle, is what makes
// code_change legal on this response, not the model's own judgment about
// whether the request "counts as code."
const CODE_MODE_ADDENDUM = `This is a coding pass — the user wants an actual code change, not a description of one. Never write code anywhere in your conversational reply (no fenced code blocks, no inline snippets) — describe what changed in plain language and refer to "the diff" for the real content. Express the actual file changes as a single code_change suggestion below, containing the complete, final content of every file you are creating or modifying — a full snapshot of each file, never a patch, partial excerpt, or a comment like "// rest unchanged."`;

// new_memory, edit_memory, tone_update, deactivate_memory, reorder_pins,
// conversation_summary_update, compress_conversation, and code_change — the
// full SheetSuggestion union.
const SUGGESTION_INSTRUCTIONS = `## Suggesting Sheet Changes

After your reply, you may optionally append a single block containing a JSON array of proposed sheet changes, using this exact delimiter:

${SUGGESTION_BLOCK_START}
[ ... ]
${SUGGESTION_BLOCK_END}

Omit the block entirely if you have no suggestions. Each array element is one candidate change, in one of these shapes:

- {"type": "new_memory", "label": "...", "body": "..."}
- {"type": "edit_memory", "memoryId": "...", "label": "...", "body": "..."}
- {"type": "tone_update", "body": "..."}
- {"type": "deactivate_memory", "memoryId": "...", "reason": "..."}
- {"type": "reorder_pins", "pinOrder": ["memoryId1", "memoryId2", "..."]}
- {"type": "conversation_summary_update", "body": "..."}
- {"type": "compress_conversation", "body": "...", "turnIds": ["turnId1", "turnId2", "..."]}
- {"type": "code_change", "summary": "...", "files": {"path/to/file": "complete new file content", "...": "..."}}

When editing or deactivating an existing memory, use the exact id shown next to it above — do not guess or invent one.

code_change is only ever valid on a coding pass — propose it only when the message above told you this is a coding pass; never on an ordinary conversational or sheet-editing response. files must map each changed or created file's repo-relative path to its complete, final content (a full snapshot, not a diff or partial excerpt) — never omit unchanged surrounding code with a placeholder comment. summary is a short plain-language description of the change, shown to the user before the diff itself is available; the actual content only ever surfaces as a diff, never inline in your reply. At most one code_change per response.

compress_conversation condenses two or more *existing* Conversation Summary turns (referenced by the ids shown next to them) into a single new summary entry, in one action — turnIds must list ids actually shown above, body is the condensed replacement text, and the turns it names are removed from the model's context (not deleted — they remain visible to the user, just no longer sent) once accepted. Only propose this when specifically asked to compress, condense, or summarize older turns — never on your own initiative alongside an ordinary reply. turnIds may name a numbered turn's id or a "[Summary]:" entry's id interchangeably — an existing summary is just as foldable into a new, larger one as a plain turn is, so a second compression later in the same conversation should fold any existing summary in alongside whatever new turns have accumulated since, rather than leaving it stranded as a separate entry. When asked to condense all, every, or the oldest turns without a specific number given, turnIds must include every Conversation Summary turn id shown above — every numbered turn and every existing summary — with no exceptions; do not stop early at an arbitrary subset (e.g. only the first few, or only one topical cluster) and do not leave an existing summary out of a new one. Count them if it helps. If the instruction does name a specific number or range, follow that instead. body must keep the user's questions, statements, and positions distinguishable from your own replies, explanations, and proposals — not full "User:"/"AI:" tags on every clause (that would defeat the point of compressing), but natural attributive phrasing at each major point (e.g. "user asked about...", "user pushed back that...", "AI proposed...", "AI cautioned that..."); an undifferentiated topic recap that loses track of who said what is not an acceptable summary. Deactivating the named turns happens automatically once this suggestion is accepted — not a separate judgment call, and not something to narrate: do not describe in your reply text which turns you condensed, what they covered, or what was left alone; propose the actual compress_conversation entry with real turnIds, or propose nothing at all.`;

function modePreamble(mode: CallMode, contentMode: ContentMode): string {
  const base = mode === "chat" ? CHAT_PREAMBLE : SHEET_EDITOR_PREAMBLE;
  return contentMode === "code" ? `${base}\n\n${CODE_MODE_ADDENDUM}` : base;
}

export function buildSystemPrompt(sheet: Sheet, mode: CallMode, contentMode: ContentMode = "prose"): string {
  return [buildReasoningInstructions(sheet, mode, contentMode), SUGGESTION_INSTRUCTIONS].join("\n\n");
}

// Reasoning agent's intermediate steps (restate/generate/evaluate/select/
// sanity-check/judge/compile) never have their own output parsed for
// suggestions — only the final call's response does (suggestionSession.ts's
// runReasoningPass) — so they get the sheet content without the suggestion-
// format instructions. That saves tokens and stops the model from producing
// throwaway SHEET_SUGGESTIONS blocks mid-reasoning that nothing ever reads.
// SUGGESTION_INSTRUCTIONS is exported separately so the final call can have
// it reattached directly, rather than trusting the compile step to carry it
// forward on its own.
export function buildReasoningInstructions(sheet: Sheet, mode: CallMode, contentMode: ContentMode = "prose"): string {
  return [modePreamble(mode, contentMode), serializeSheet(sheet)].join("\n\n");
}

export { SUGGESTION_INSTRUCTIONS };
