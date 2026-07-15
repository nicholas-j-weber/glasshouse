# Auditable Context & Memory Methodology (ACM2): A Legible, Stateless-Per-Call Methodology for Managing AI Context

**Status:** Draft spec for proof-of-concept implementation **Author:** Nicholas Weber **Date:** 2026-07-10


## 1. Problem Statement

Conversational AI systems typically manage memory by accumulating a hidden transcript and/or an opaque, model-managed summary of it. Two failure modes follow directly from this:

1. **Context rot.** As the transcript grows, irrelevant, stale, or contradictory content accumulates and is resubmitted on every turn. Models attend unevenly across long contexts (recall degrades for content in the middle of a long prompt — the "lost in the middle" effect), so bloat doesn't just cost tokens, it actively degrades output quality and increases hallucination risk.

2. **Memory opacity.** The user cannot see, in one legible view, exactly what the model "knows" at the moment it generates a response. When memory is auto-managed (auto-summarized, silently pruned, or invisibly carried forward), the user cannot audit, correct, or trust it. Errors compound silently.

This is especially costly for **power users doing high-stakes work** — engineers, writers, researchers, healthcare workers — who need to trust that a response is grounded in exactly the information they intended, no more and no less, and who are willing to do extra curation work in exchange for that guarantee.

### 1.1 Core hypothesis

If every call to the model is **stateless** and constructed entirely from a single, **user-legible, user-and-AI-editable, versioned document** (the "context sheet"), then:

- Nothing enters the model's context invisibly.

- Nothing persists across turns except what a human (or an accepted AI suggestion) explicitly put there.

- The full history of *what the AI has known at any point in time* is reconstructable, inspectable, and reversible.

This trades away some of what stateful systems offer for free (e.g. incidental tone continuity — see §6.4) in exchange for legibility and auditability. That is an intentional, named tradeoff, not an oversight.

### 1.2 Primary success criterion for the PoC

The PoC should demonstrate — even informally — that curating a small, legible context sheet produces **more faithful, less hallucinated, more consistent** outputs than dumping an equivalent amount of raw transcript at the model. Tone/style consistency is a secondary, illustrative benefit, not the headline claim.

### 1.3 Non-goals for this PoC

- Not a monetizable product. The goal is to establish and publish a methodology / open protocol, not to ship a business.

- Not multi-user / not accounts-based. Single local user only.

- Not a native or desktop app. Browser-only for the PoC (see §9 for future implementations of the protocol in other environments).

- Not provider-locked. Designed model-agnostically from the start (see §7).


## 2. Core Concepts & Terminology

| Term | Definition |
| - | - |
| **Context Sheet** | The single versioned document that constitutes the AI's entire memory. Rendered on the right side of the interface. |
| **Memory** | A free-form, user-labeled chunk of content within the sheet. The atomic unit of curated context. |
| **Pin / Pin Order** | User-assigned priority determining a memory's serialization position. Higher-pinned memories are placed closer to the start/end of the prompt (away from the "dead zone," see §5.4). |
| **Active / Inactive** | A per-memory toggle. Inactive memories remain visible in the sheet but are excluded from the next API call. Toggling does not require a full version snapshot (see §4.4). |
| **User Details** | A fixed, always-present section of the sheet holding persistent facts about the user. Its own serialization section. |
| **Tone** | A fixed, always-present, always-pinned memory holding a free-form description of desired AI register/style. Uses the same suggestion/edit/versioning mechanics as any other memory, just serialized in its own labeled section (see §6.4). |
| **Suggestion Mode** | The default mode of AI-sheet collaboration: the AI proposes a diff to the sheet; nothing is written until the user accepts (see §6). |
| **Version** | A full snapshot of the sheet, created whenever an accepted change (manual or AI-suggested) alters sheet content. The sequence of versions is the entire "history" of the system — there is no other transcript store (see §4). |
| **Chat Pane** | The conversational interface where the user talks to the AI to get work done. Stateless per message; does not itself store reusable history (see §3). |



## 3. The Chat Pane

- The chat pane is where the user sends task-oriented messages ("debug this," "draft a reply to...") and receives responses.

- Each send is a **fully stateless API call**: `serialized context sheet (system prompt) + this one user message → response`. No prior chat turns are included in the call, regardless of how long the visible chat history is.

- The chat pane's visible message list is **ephemeral UI state**, not sheet content. It is not re-sent on subsequent calls and is not itself a versioned artifact. If the browser session is cleared, chat history is lost; the sheet is not.

  - *Rationale:* if the chat pane silently accumulated and resent its own transcript, it would recreate exactly the hidden-history problem this methodology exists to solve. The sheet must be the only channel of persistence.

- After each AI response, the AI may propose candidate memories or a tone update based on that exchange (see §6.2). These are surfaced inline, attached to the message that prompted them, and require explicit accept/reject/revise.

- Regenerating a response re-sends the *current* sheet state (which may differ from the sheet state at the time of the original send, since the sheet can change between turns). This is intentional — the sheet is always the single source of truth for "what does the AI know right now."

### 3.1 Edge cases

- **Empty sheet, first message ever:** the sheet always has its skeleton present (empty User Details section, default Tone memory — see §8.3), so the first call is never truly context-free, even on a brand-new project.

- **User edits the sheet mid-response-stream:** the in-flight call already captured its sheet snapshot at send time; the edit applies to the *next* call, not the in-flight one. No retroactive mutation of an in-flight request.

- **Very long single user message:** no special handling in the PoC beyond the provider's own context limit; token budget UI (§5.4) reflects sheet + draft message combined so the user can see this coming.


## 4. Versioning & Rollback

### 4.1 What creates a version

A new sheet version is created **only when accepted content changes are made** to the sheet:

- A manual edit (add/edit/delete a memory, edit user details, edit tone) that the user explicitly saves.

- An AI-proposed suggestion (new memory, edited memory, tone update) that the user accepts.

Plain chat Q&A in the chat pane that produces no accepted sheet change **does not** create a version. This keeps version history meaningful — a log of decisions about what the AI should know — rather than noisy with every message sent.

### 4.2 What does NOT create a version

- Toggling a memory active/inactive (lightweight UI-state flag, instantly reversible, not part of version history — see §4.4).

- Reordering pin priority *without* changing content. This is a lightweight metadata change bundled into whichever version comes next (i.e. it is not stamped immediately, but rides along with the next content change). A pin-only reorder therefore has no rollback point of its own until something else changes — this is an accepted limitation, not a bug, since giving every reorder its own version would make the history noisy with metadata churn rather than decisions.

- Rejecting or dismissing an AI suggestion.

- Sending/receiving chat pane messages that don't touch the sheet.

### 4.3 Version structure

Each version is a full snapshot (not a diff-only patch, to keep rollback simple and robust) containing:

- Full sheet content (user details, tone, all memories with their pin/active state).

- Timestamp.

- Attribution: `manual\_edit` | `ai\_suggestion\_accepted` | `sheet\_editor\_session`, including which chat message or sheet-editor exchange prompted it, where applicable.

- Parent version ID (for branch reconstruction).

- A rendered diff against its parent, computed and shown in the UI (not necessarily stored — can be computed on demand from two snapshots).

### 4.4 Rollback mechanics

Single tier for the PoC: **linear undo only.**

- "Revert to version N" moves the sheet's current head pointer back to version N. Nothing is deleted — versions after N remain in storage — but they are no longer on the visible/active line.

- If the user then edits from version N, that edit creates version N+1 with parent N. Whatever previously came "after" N in the old sequence is still stored (so nothing is lost and a user could, in principle, recover it later) but the PoC does **not** expose branch naming, a branch list, or branch switching. There is exactly one active line: the current head and its ancestors.

- Explicit deletion of old versions is a separate, deliberate action (not exposed by default in the PoC) — rollback is non-destructive by design.

Full branching (naming checkpoints, switching between multiple active lines) is a natural extension once real usage patterns are observed, but is deliberately out of scope for the PoC.


## 5. Sheet Structure & Serialization

### 5.1 Sections, in serialization order

1. **User Details** — fixed section, freeform-editable, persistent facts about the user (role, preferences, standing constraints). Has its own labeled block in the system prompt.

2. **Tone** — fixed, always-active, always-pinned single memory in its own labeled block. Freeform text description of desired register/style (see §6.4).

3. **Pinned Memories** — user-labeled freeform chunks, ordered by pin rank (highest priority first).

4. **Unpinned Memories** — remaining active memories, ordered most-recently-modified-first. This is a firm default for the PoC, not a placeholder: it keeps the section's ordering legible (the user can predict where a memory will land without checking a rank) and requires no additional metadata beyond the timestamp already stored per memory. Alphabetical or creation-order orderings are plausible alternatives but are not implemented in the PoC.

5. **Freeform Notes** — a single open text block for anything that doesn't warrant being split into a discrete memory (scratch space, loose notes).

Only **active** memories from sections 3–5 are included in a given call; inactive memories are skipped but remain visible in the sheet UI.

### 5.2 What a "memory" is

- No fixed taxonomy/type system. A memory is: a user-defined label/title + freeform body text + pin rank + active/inactive flag + last-modified timestamp + provenance (`manual` or `ai\_suggested`, and if the latter, which chat exchange or sheet-editor session produced it).

- Memories can be created via: direct manual entry, the dedicated AI sheet-editor interface (§6.3), or accepted inline suggestions from the chat pane (§6.2).

### 5.3 Serialization format

Plain, clearly delimited text sections (e.g. `\#\# User Details`, `\#\# Tone`, `\#\# Memory: \<label\>`) rather than JSON-in-prompt, since the target audience benefits from being able to read the literal prompt as naturally as they read the UI — the serialized prompt itself should be inspectable/copyable as a diagnostic feature.

### 5.4 Token count

- A live token count for the full serialized sheet, always visible.

- No hard cap on sheet size. The interface *encourages* minimalism through visibility (token countery) rather than enforcing a limit.

- An explicitly user-triggered "suggest prunes" action (not automatic/background) that asks the AI to review the current sheet and propose deactivations — using the same suggestion-mode accept/reject flow as any other AI-proposed change.


## 6. AI Collaboration & Suggestion Mode

### 6.1 Default posture

All AI-proposed changes to the sheet — new memories, edits to existing memories, tone updates — are **suggestions**, not direct writes. Nothing is applied without explicit user action. This is the default and, per §6.5, the *only* mode in the PoC.

### 6.2 Inline suggestions (from the chat pane)

- After an AI response in the chat pane, the AI may attach 0+ candidate sheet changes to that message (e.g. "Save as memory: ...", "Update tone: ...").

- Each suggestion shows: the proposed content, a diff against current sheet state (if editing an existing memory), and three actions: **Accept**, **Reject**, and **Revise** (a free-text field where the user tells the AI how to revise the suggestion before re-proposing — e.g. "no, phrase it more concisely").

- Suggestions are scoped to the single exchange that produced them; dismissing one does not resurface it later.

### 6.3 Dedicated sheet-editor interface

- A separate AI-facing surface (distinct from the chat pane) whose sole purpose is collaborating on the sheet itself — restructuring memories, merging near-duplicates, proposing prunes, reorganizing pin order.

- Also stateless per call; it receives the current sheet plus the user's instruction for this editing session, and returns a proposed diff — same accept/reject/revise flow as §6.2.

- The chat pane's recent exchange (the messages currently visible, not stored history) may be used as *input context* for a sheet-editor session when the user invokes it from that context — e.g., "turn our last few messages into a memory" — but this is the user explicitly directing that content into the editor, not the system silently carrying it forward.

### 6.4 Tone as a memory

Tone is not a distinct subsystem. It is a memory like any other — same creation/edit/versioning/suggestion mechanics — that happens to be:

- Always present (created by default on a new sheet, see §8.3).

- Always active and always pinned (cannot be deactivated or unpinned in the PoC).

- Serialized into its own labeled section rather than alongside other memories.

**On "tone drift":** in a stateless-per-call system, tone cannot literally drift the way it can in a system with accumulating hidden history, since there is no accumulation to drift within. What can actually happen is:

- **Staleness** — the tone memory's text no longer matches what the user currently wants (written for an earlier phase of the work).

- **Consistency variance** — a freeform tone description underdetermines exact phrasing, so output style can vary somewhat call-to-call even with an unchanged descriptor.

The spec deliberately does not claim to solve consistency variance — that's an inherent property of freeform natural-language style instructions. It *does* make staleness fixable and visible, since the tone memory is just as inspectable and editable as anything else, via the identical suggestion mechanism (the AI may propose an updated tone memory if the user's chat-pane messages suggest the current description no longer fits) — no special-cased "drift detector" needed.

This is arguably a demonstration of the broader methodology's claim: stateless systems trade invisible, creeping drift for explicit, legible staleness that the user can see and correct on demand.

### 6.5 No auto-apply in the PoC

All AI-proposed changes require explicit user acceptance. There is no auto-apply mode, even opt-in, in this version of the PoC. (Considered and deliberately cut — see §10 for the reasoning and what a future opt-in auto-apply mode might look like.)

### 6.6 Explicitly out of scope for the PoC

The AI sheet-editor does **not**, in this version:

- Proactively flag contradictions between memories.

- Proactively flag likely-irrelevant memories for the current task (beyond the explicitly user-triggered "suggest prunes" action in §5.4).

These are natural extensions but are cut to keep the PoC's AI-assistance surface to exactly two actions: propose a new memory, and propose an edit to an existing memory (including tone).


## 7. Model / Provider Integration

### 7.1 Model-agnostic by design

The protocol's required interface is minimal and near-universal:

```
system\_prompt (= serialized context sheet) + single user message → text response
```

This shape is supported by essentially every major provider (Anthropic, OpenAI, and OpenAI-compatible endpoints including local/self-hosted models), which is intentional — a protocol that only works with one vendor's API reads as a product pitch, not a methodology.

### 7.2 PoC provider support

- Bring-your-own-API-key (BYOK). The user supplies their own API key; it is stored client-side only (see §9.2 for storage details) and calls go directly from the browser to the provider — no backend proxy for AI calls in the PoC.

- Ship with 2–3 provider adapters (e.g. an Anthropic adapter and a generic OpenAI-compatible adapter) to prove the abstraction is real, not an assumption. Full universal provider support is explicitly not a PoC goal.

### 7.3 Failure handling

Because AI calls go directly from the browser to the provider (no backend proxy), the client must handle provider-side failures itself. Minimal PoC behavior:

- **Auth failure (invalid/expired API key):** surfaced as a visible, plain-language error in the chat pane, not a silent no-op. The sheet is never mutated on a failed call.

- **Rate limit / provider-side throttling:** surfaced as a visible error with the provider's retry-after hint if available; no automatic silent retry loop.

- **Malformed or empty response:** treated as a failed call, surfaced the same way.

No automatic retry, backoff, or fallback-provider logic is required for the PoC — the bar is simply that failures are always visible to the user rather than silently swallowed, which follows directly from the spec's legibility principle (§1): a failed call that fails silently is exactly the kind of invisible event this methodology exists to prevent.


## 8. Sheet Lifecycle

### 8.1 Creating a new sheet ("project")

- A new sheet is not blank in the sense of having no structure — the **skeleton is** **always present**: an empty User Details section and a default Tone memory. This is not optional scaffolding layered on top of the mechanics; it's required by the mechanics themselves, since a stateless call has nowhere else for baseline instructions to live.

- Default tone text on creation: something neutral, e.g. *"Clear and direct; match* *the user's register."*

- No pre-filled memories by default.

### 8.2 Starter templates

Optional, stretch-goal for the PoC (not core): a small set of starter templates (e.g. "coding project," "writing project," "research project") that pre-suggest a handful of example memory labels (still empty, or with placeholder guidance text) to help new users understand what a "memory" is meant to hold. Explicitly secondary to the required skeleton in §8.1.

### 8.3 Export / import

Core PoC feature, not a stretch goal, given the goal of eventually protocolizing this: the full sheet (all sections, all memories with metadata, and — at minimum — the current version's lineage) is exportable and importable as a single JSON file. This:

- Reinforces the legibility pitch directly (a user can inspect their own context outside the app).

- Gives the project a natural artifact to publish alongside SPEC.md (e.g. a JSON Schema for the format), which is useful groundwork if this is meant to become an open protocol other implementations can target.


## 9. PoC Technical Scope

### 9.1 Platform

- Browser-only, single-page web app. No installed component, no desktop app, no backend server required beyond serving static assets (AI calls go directly from client to provider via BYOK).

- Explicitly **not** the final form — if the methodology proves out, future work includes alternate implementations (e.g. a local desktop app with sheet data as files on disk, or a CLI/editor-integrated version) as different implementations of the same underlying protocol. This intent belongs in this spec's future-direction notes, not in the sheet's runtime data.

### 9.2 Storage

- Single local user, no accounts. Sheet data (including version history) persisted in browser storage (IndexedDB, given version history + memories will exceed practical localStorage size/complexity limits).

- API key stored client-side (e.g. in browser storage), never transmitted anywhere except directly to the provider's API as an auth header.

### 9.3 Out of scope for PoC (explicit)

- Multi-user accounts / auth.

- Backend AI proxy or key management service.

- Visual git-style branch graph (see §10).

- Auto-apply suggestion mode (see §6.5, §10).

- Proactive contradiction/relevance flagging (see §6.6).

- Native/desktop packaging.


## 10. Why This Matters (Positioning Note)

This is intended as a **methodology / open protocol contribution**, not a product. The core claims worth defending publicly, in order of importance:

1. Stateless-per-call + a single legible, versioned context document produces more auditable, more trustworthy AI output than accumulating hidden history, because nothing enters the model's context without a visible, reversible decision behind it.

2. This trades away some conveniences of stateful systems (e.g. effortless tone continuity) for **legibility** — and that tradeoff is worth naming explicitly rather than hiding, because the failure mode it avoids (silent, invisible, uncorrectable drift) is worse for the target audience than the failure mode it accepts (visible staleness that can be fixed with one click).

3. The protocol should remain implementable against any provider that accepts a system-prompt-plus-message shape — which is nearly all of them — so that its validity doesn't depend on any single vendor.

# Addenda to SPEC.md

These resolve four schema/behavior ambiguities identified in review. Addendum A extends §4 (Versioning & Rollback) and touches §6.2 (Inline suggestions). Addendum B extends §5.1 (Sections, in serialization order). Both are additive — no existing section needs to be rewritten, only appended to.


## Addendum A — Versioning edge cases (extends §4)

### 4.2.1 Pin-only reorders and rollback (extends §4.2, §4.4)

A pin-only reorder is stored as **pending metadata** attached to the current head, not as a field inside any version snapshot. This resolves the ambiguity left open by §4.2 and §4.4 together:

- Pending pin state lives outside the version chain entirely — it is UI/session state, analogous to active/inactive toggles (§4.2, first bullet).

- **On revert to version N:** pending pin state is discarded, not carried back and not silently reapplied. The sheet's pin order reverts to whatever was captured in version N's snapshot (§4.3 already stores pin rank per memory, so this requires no new data). This matches the treatment of active/inactive flags on revert and keeps "revert" behaving as "go back to a known-good snapshot," full stop.

- **On the next content-changing edit** (whether from head or from a reverted position): any pending pin reorder is folded into that new version's snapshot, as §4.2 already specifies. If the user reverted first and *then* reorders pins with no other change, the reorder remains pending against the new head (N) until a content change occurs, per the existing rule — reverting doesn't change how pin-only reorders behave, it just changes what "current head" means.

- Net effect: a pin-only reorder is always disposable right up until it's captured by a real content version. Nothing about revert semantics needs to special-case it further.

### 4.1.1 Suggestion batching within one exchange (extends §4.1, §6.2)

§6.2 allows an exchange to produce multiple candidate suggestions (e.g. two new memories plus a tone update). Each **accept** action creates its own version, immediately, in the order accepted:

- Accepting suggestion 1 of 3 creates version N+1 (parent: N).

- Accepting suggestion 2 (from the same exchange, possibly seconds later) creates version N+2 (parent: N+1) — not a merged/batched version.

- Rejecting or revising a suggestion never creates a version (§4.2 already covers this), regardless of how many sibling suggestions from the same exchange were accepted.

- Rationale: this keeps §4.3's attribution model working unmodified — each version already stores "which chat message... prompted it," and one version per accepted suggestion means that attribution is always unambiguous (one version = one accepted decision). Batching accepted suggestions into a single version would require inventing a new "multi-cause" attribution shape for no real benefit, since the linear undo model in §4.4 already lets the user step back through N+1, N+2, N+3 individually if they accepted something they didn't mean to.

- UI implication (non-normative): the sheet-editor and chat pane should accept suggestions as independent actions even when shown as a group, so this behavior falls out of the interaction model rather than needing special-casing.

### 7.3.1 Preserving the user's message on a failed call (extends §7.3)

On any failed call (auth failure, rate limit, malformed/empty response), the user's original message text is preserved in the chat pane's draft/input state, not cleared. This is ephemeral UI state per §3 (not a sheet or version concern) but is worth stating explicitly since §7.3 specifies *that* failures must be visible but not *what happens to the input the user already typed*:

- The failed message is not added to the visible message list as a "sent" turn (since it produced no response), but its text is restored to the input field so the user can retry, edit, or abandon it without retyping.

- This is a UI-state requirement only — it does not touch the sheet, does not create a version, and is fully consistent with §4.2's "sending/receiving chat pane messages that don't touch the sheet" already not being version-worthy.


## Addendum B — Freeform Notes data shape (extends §5.1, §5.2)

§5.2 defines the memory schema (label + body + pin rank + active flag + timestamp + provenance). §5.1's Freeform Notes section was described only as "a single open text block," leaving its storage shape unspecified. This addendum resolves it:

### 5.1.1 Freeform Notes is a single sheet-level field, not a memory collection

- Freeform Notes is **one string field on the sheet itself** — not a list of memory-like objects, and not something with its own pin rank or active/inactive toggle. There is exactly one Freeform Notes block per sheet, matching how §5.1 already describes it ("a single open text block").

- It **is** included in full-sheet version snapshots (§4.3's "full sheet content" already implies this — this addendum just makes it explicit: the field is part of what gets snapshotted, same as user details and tone text).

- It has **no independent provenance field** — unlike memories (§5.2), Freeform Notes has no `manual` vs `ai\_suggested` distinction, because it is not proposed or accepted via the suggestion mechanism (§6) at all in the PoC. It is edited directly, the same way User Details is edited directly. (If a future version wants the AI to propose additions to Freeform Notes, that's a natural extension of §6.2/§6.3, but it's explicitly not in scope here — mirrors the spec's existing pattern of naming extensions without building them, e.g. §4.4's branching note.)

- It has **no active/inactive toggle** — it is always included in serialization when non-empty (§5.1 already places it at a fixed serialization position, \#5), consistent with User Details and Tone also having no active/inactive toggle.

- Token count (§5.4) includes Freeform Notes' current length, same as every other serialized section.

**Addendum C — Data schema for Sheet, Memory, and Version (extends §4.3, §5.2, §8.3)**

§4.3 and §5.2 specify the *fields* a Version and a Memory must carry, in prose, but neither section fixes a concrete schema. §8.3 requires export/import as "a single JSON file," which means a schema is not optional polish — it's the literal file format being exported. This addendum fixes that shape so the sheet store, the serializer (§5.3), and export/import (§8.3) all target the same structure instead of three independently-inferred ones.

*5.2.1 Memory schema*

```
interface Memory \{  
  id: string;                // stable UUID, assigned on creation, never reused  
  label: string;              // user-defined title  
  body: string;                // freeform text  
  pinRank: number | null;      // null = unpinned (§5.1 \#3 vs \#4); lower = higher priority  
  active: boolean;             // §2's Active/Inactive toggle; UI-state, not version-stamped (§4.2)  
  lastModified: string;        // ISO 8601 timestamp; drives Unpinned ordering (§5.1 \#4)  
  provenance: \{  
    source: "manual" | "ai\_suggested";  
    // present only when source === "ai\_suggested":  
    chatMessageId?: string;         // §6.2 inline suggestion  
    sheetEditorSessionId?: string;   // §6.3 dedicated editor  
  \};  
\}
```

Tone (§6.4) is a `Memory` with `pinRank` fixed at a reserved sentinel (e.g. `0`) and `active` fixed `true` — both non-editable in the PoC UI — rather than a distinct type, matching §6.4's "not a distinct subsystem" framing.

*4.3.1 Version and Sheet schema*

```
interface Sheet \{  
  userDetails: string;          // §5.1 \#1, freeform  
  tone: Memory;                  // §5.1 \#2, see 5.2.1 above  
  memories: Memory\[\];             // §5.1 \#3-\#4, pinned + unpinned live in one array;  
                                    // serialization order (§5.1) is derived, not stored  
  freeformNotes: string;          // §5.1 \#5; per Addendum B, sheet-level field, no Memory wrapper  
\}  
  
interface Version \{  
  id: string;                    // stable UUID  
  parentId: string | null;        // null only for the very first version (§8.1 skeleton)  
  createdAt: string;               // ISO 8601  
  attribution: \{  
    kind: "manual\_edit" | "ai\_suggestion\_accepted" | "sheet\_editor\_session";  
    chatMessageId?: string;          // present when kind === "ai\_suggestion\_accepted"  
    sheetEditorSessionId?: string;    // present when kind === "sheet\_editor\_session"  
  \};  
  sheet: Sheet;                   // full snapshot per §4.3, not a patch  
\}
```

`pendingPinReorder` (Addendum A, §4.2.1) is explicitly **not** a field on `Sheet` or `Version` — it lives in application/session state only, exactly as Addendum A specifies, and is folded into `Sheet.memories\[\].pinRank` at the moment it's captured by the next `Version`.

*8.3.1 Export/import file shape*

The exported JSON file is:

```
interface SheetExport \{  
  formatVersion: "1.0";          // for future protocol compatibility (§9.1, §10 \#3)  
  headVersionId: string;           // which Version is "current" at export time  
  versions: Version\[\];              // full lineage per §4.4 — ancestors of head,  
                                      // sufficient to reconstruct rollback history  
\}
```

Import replaces the local store's version chain with the imported one and sets head to `headVersionId`. Re-deriving lineage on import is a matter of walking `parentId` pointers back from `headVersionId`; the array does not need to be pre-sorted.

Rationale: fixing this now means the sheet store, the §5.3 serializer, and §8.3 export/import are all written against one type, rather than each component independently inferring a shape and drifting apart — which is exactly the kind of silent inconsistency this methodology's own legibility principle (§1) argues against.


**Addendum D — Suggestion wire format (extends §6.2, §6.3)**

§6.2 and §6.3 specify the *UI-facing* behavior of a suggestion (proposed content, diff, accept/reject/revise) but not how the model's response actually communicates "this is a candidate sheet change" versus plain conversational text. This is a prompt-design and parsing decision, not a UI detail, so it's resolved here rather than left to be inferred per-provider.

*6.2.1 Suggestions are returned as a structured block, not parsed from prose*

The system prompt (i.e. the serialized sheet, per §5.3) instructs the model to emit candidate sheet changes as a fenced, machine-parseable block appended after its conversational reply, using a fixed delimiter the client scans for:

```
\<!-- SHEET\_SUGGESTIONS  
\[  
  \{  
    "type": "new\_memory",  
    "label": "...",  
    "body": "..."  
  \},  
  \{  
    "type": "edit\_memory",  
    "memoryId": "...",  
    "label": "...",  
    "body": "..."  
  \},  
  \{  
    "type": "tone\_update",  
    "body": "..."  
  \}  
\]  
--\>
```

This is used identically by both the chat pane (§6.2) and the dedicated sheet-editor (§6.3) — the editor's responses simply consist of suggestion blocks with little or no conversational text around them, rather than requiring a second wire format.

Why a delimited block rather than a provider tool-use/function-calling feature: §7.1's model-agnostic requirement is a plain `system\_prompt + message → text` shape; provider-native structured output (e.g. Anthropic tool use) is not guaranteed to exist in the same form across every §7.2 adapter, including "a generic OpenAI-compatible adapter" and future self-hosted targets. A text-embedded, delimited block works identically against any provider that can follow a formatting instruction, which is a weaker and more universal requirement than "supports this provider's structured-output feature." A provider adapter *may* additionally request native structured output as an internal implementation detail if the provider supports it, so long as the client-facing result is the same suggestion shape — but the protocol's baseline does not depend on it.

*6.2.2 Parsing failure handling*

If the delimited block is present but fails to parse (malformed JSON, unrecognized `type`), the client discards only the suggestion block and still renders the conversational text that preceded it — it does not treat the whole exchange as a failed call per §7.3. Suggestions are additive to a response, not load-bearing for it; losing a malformed suggestion is a visible-but-minor degradation (the user simply sees no suggestion that turn), consistent with the spec's general preference for visible partial failure over either silent loss or blocking the entire response.

*6.2.3 Suggestion identity within an exchange*

Each object in the `SHEET\_SUGGESTIONS` array is one candidate change, matching Addendum A's 4.1.1: accepting array element 1 and array element 2 from the same response creates two versions in acceptance order (N+1, N+2), not one. `edit\_memory` suggestions reference the target `Memory.id` (Addendum C, 5.2.1) directly, which is what the diff shown in §6.2 is computed against.


**Addendum E — Closing three implementation gaps (extends §5.4, §6.3, §3, Addendum C, Addendum D)**

Building against Addenda A–D surfaced three points where the schema or wire format doesn't yet cover behavior the spec already promises elsewhere. These are additive, same as A–D: no existing section is rewritten, only extended.

### 6.2.4 Missing suggestion types: deactivate and pin-reorder (extends Addendum D's 6.2.1)

Addendum D's `SHEET\_SUGGESTIONS` enum (`new\_memory`, `edit\_memory`, `tone\_update`) has no entry for two capabilities the spec already commits to elsewhere:

- §5.4's "suggest prunes" action, which asks the AI to "propose deactivations."

- §6.3's sheet-editor, which lists "reorganizing pin order" as an in-scope capability.

Two additional suggestion types close this:

```
\{  
  "type": "deactivate\_memory",  
  "memoryId": "...",  
  "reason": "..."  
\}

\{  
  "type": "reorder\_pins",  
  "pinOrder": \["memoryId1", "memoryId2", "..."\]  
\}
```

Handling, per existing rules:

- `deactivate\_memory` accept flips `Memory.active` to `false`. Per §4.2 this is **not** version-worthy on its own — same as a manual toggle — so accepting it does not create a version, unlike `new\_memory`/`edit\_memory`/`tone\_update` accepts (Addendum A, 4.1.1). This is the one suggestion type whose acceptance does not follow the "one accept = one version" rule, precisely because the underlying action it performs (§4.2's active/inactive toggle) was already exempted from versioning before suggestions existed. `reason` is display-only (shown in the UI next to the proposed deactivation) and is not stored on the `Memory`.

- `reorder\_pins` accept sets the named memories' `pinRank` to a **pending** reorder, identical in status to a manually-dragged pin reorder (§4.2, Addendum A 4.2.1) — not stamped into a version until the next content-changing edit, and discarded (not reapplied) on revert, per 4.2.1's existing rule. Memory IDs omitted from `pinOrder` keep their current `pinRank` (including `null` for unpinned); the array only needs to list memories whose relative order is changing.

- Both types use the same accept/reject/revise flow as §6.2/§6.3 for presentation purposes, even though accepting them doesn't always produce a version — "requires explicit user action" (§6.1) is about the accept/reject gate, not about version creation, and the two are independent per §4's own distinction between "accepted" and "version-worthy."

### 3.2 Revision call shape (extends §3, §6.2)

§6.2 defines Revise as a free-text field that sends a suggestion back for revision, but §3's call shape is fixed at `system\_prompt + single user message`, and it was left unstated what that single message contains on a revision.

A revision call's user message is a synthesized composite, assembled client-side (not typed by the user verbatim):

```
\[Revising a previous suggestion\]  
Original suggestion: \<type + label/body fields of the rejected-for-revision suggestion, serialized the same way a Memory block would be\>  
User's requested change: \<the free text the user typed into the Revise field\>
```

- This keeps the call stateless per §3 — no prior chat turns are pulled in, only the one suggestion object being revised plus the user's instruction, both of which are already visible in the UI at the moment Revise is invoked (nothing invisible enters context).

- The response to a revision call is handled exactly like any other chat-pane response (§6.2): conversational text optionally followed by a `SHEET\_SUGGESTIONS` block. The revised suggestion is a new object, not a patch to the old one; the old (rejected-for-revision) suggestion is discarded the same way a straightforward Reject discards one (§6.2's "dismissing one does not resurface it later").

- This applies identically to revisions issued against sheet-editor suggestions (§6.3), substituting the sheet-editor's session framing for the chat pane's.

### 5.2.2 Provenance references and session-scoped legibility (extends §5.2, §5.1's chat-pane framing, Addendum C's 5.2.1/4.3.1)

`Memory.provenance.chatMessageId` and `Version.attribution.chatMessageId` (Addendum C) are persisted indefinitely — they live inside `Version` snapshots, which are the durable record (§4.3, §9.2 IndexedDB). But §3 makes the chat pane's message list "ephemeral UI state... not itself a versioned artifact," lost on browser session clear. Left as originally specified, a persisted provenance record could point to a `chatMessageId` that no longer resolves to anything, anywhere, after a session clear — which sits uneasily next to the spec's central legibility claim (§1, §10 \#1) that "the full history of what the AI has known... is reconstructable, inspectable, and reversible."

Resolution: `chatMessageId` and `sheetEditorSessionId` are **best-effort cross-references, not guaranteed-resolvable foreign keys**, and the schema and UI both treat them that way rather than assuming persistence they were never promised:

- The provenance record additionally captures a small denormalized snapshot at creation time, so the *decision* remains legible even if the *originating message* doesn't survive:

- ```
provenance: \{  
  source: "manual" | "ai\_suggested";  
  chatMessageId?: string;  
  sheetEditorSessionId?: string;  
  sourceExcerpt?: string;   // first ~200 chars of the user message or editor  
                              // instruction that produced this suggestion,  
                              // captured at accept time, independent of  
                              // whether the chat pane later loses the full message  
\}
```

- `sourceExcerpt` is what the version-history UI (§4.3) renders by default when showing "which exchange prompted this" — not a live lookup against the chat pane's current message list, which per §3 may no longer contain the message at all (new session, cleared history, or simply scrolled-past ephemeral state).

- `chatMessageId`/`sheetEditorSessionId` are still stored and still used opportunistically: *within the same session*, if the referenced message is still present in the chat pane's current (ephemeral) list, the UI may link directly to it. This is a convenience, not a guarantee — nothing in rollback, export/import (§8.3), or audit correctness depends on the link resolving.

- This does not change §3's core rule that the chat pane never becomes a persisted transcript store. It only means provenance was, from the start, meant to answer "what decision was made and roughly why," not "replay the exact conversation" — and `sourceExcerpt` makes that scope explicit in the schema instead of leaving it to be discovered when a `chatMessageId` first dangles.


**Addendum G — OpenAI's API cannot be called directly from the browser (extends §7.1, §7.2, §7.3)**

§7.2 committed to shipping "an Anthropic adapter and a generic OpenAI-compatible adapter" under §9.1's no-backend-proxy constraint. Building the first adapter surfaced a factual, not merely ambiguous, obstacle to the second: **OpenAI's hosted API does not support being called directly from a browser, and there is no client-side workaround.**

- **Anthropic's API does support this.** As of 2024, Anthropic added an opt-in `anthropic-dangerous-direct-browser-access: true` request header specifically to enable BYOK client-side tools like this one — a server-side decision on Anthropic's part to return the CORS headers a browser requires. The Anthropic adapter works as originally specced.

- **OpenAI's API does not.** `api.openai.com` returns no `Access-Control-Allow-Origin` header, so a browser blocks the request before it ever reaches OpenAI's servers — this is enforced by the browser, not something a client can negotiate around. The OpenAI SDK's `dangerouslyAllowBrowser` flag is frequently mistaken for a fix; it only suppresses the SDK's own warning about running in a browser and has no effect on CORS. The only documented workarounds all route through a backend proxy, which §9.1 and §9.3 explicitly rule out for this PoC.

### 7.2.1 Scope for the PoC

The PoC ships the **Anthropic adapter only**, as a live, working call path. The "generic OpenAI-compatible adapter" from §7.2 is deferred, not dropped — when built, it targets **self-hosted / local OpenAI-compatible endpoints** (Ollama, LM Studio, vLLM, custom base URLs), which are typically configured to allow any origin and so are not subject to this constraint. This is not a scope reduction against §7.1, which already frames the target as "OpenAI-compatible endpoints including local/self-hosted models" — it was never literally "OpenAI's own hosted API," that was just the ambient assumption until this addendum made it explicit.

To keep the abstraction itself honest in the interim (§7.2's stated purpose — "to prove the abstraction is real, not an assumption" — doesn't require two working adapters simultaneously, just a provider-agnostic interface one adapter is already built against): the adapter contract (`ProviderAdapter`: `call(systemPrompt, userMessage) → text | error`) is provider-agnostic and takes no Anthropic-specific parameters at its boundary, so a second adapter is a drop-in addition, not a refactor.

### 7.3.1 Two additional error kinds, beyond §7.3's three (extends §7.3)

Implementing real request/response handling surfaced two failure categories a live adapter cannot avoid encountering, neither named in §7.3's three (auth failure, rate limit, malformed/empty response):

- **`provider\_error`** — any other non-2xx HTTP response the provider returns (e.g. Anthropic's `invalid\_request\_error`, `overloaded\_error`). Not an auth or rate-limit failure, and not "malformed" in the sense §7.3 meant (a garbled or missing body) — it's a valid, well-formed error response the provider is deliberately returning. Surfaced with the provider's own error message, consistent with §7.3's principle that failures must be visible rather than swallowed.

- **`network`** — the `fetch` call itself rejected before any HTTP response arrived at all (CORS block, offline, DNS failure). This is distinct from `malformed\_response`, which presupposes a response was received.

Both follow §7.3's existing rule: surfaced as a visible, plain-language error in the chat pane; the sheet is never mutated on a failed call; no automatic retry.


**Addendum H — Memory ID visibility, visible-failure on unmatched suggestions, and the "Conversation Summary" convention (extends §3, §5.3, §6.2, §6.4, Addendum D, Addendum E, Addendum F)**

Prompted by a live session where a stateless-per-call follow-up ("I'm interested in this topic...") had no way to resolve "this topic," since neither raw conversation history nor any memory captured what was being discussed. This addendum resolves the underlying design question — can the sheet itself carry conversational continuity, without becoming a hidden transcript? — and, in working through it, surfaces and fixes a real, independent gap: the model has never actually been shown a memory's `id`, even though `edit\_memory`/`deactivate\_memory` suggestions require one.

### 5.3.2 Memory IDs are part of the serialized block (extends §5.3, Addendum D 6.2.1)

§5.3's format (`\#\# Memory: \<label\>`) never included the memory's `id`, yet Addendum E's 6.2.3 already assumed the model could reference `Memory.id` directly in `edit\_memory`/`deactivate\_memory` suggestions ("`edit\_memory` suggestions reference the target `Memory.id` directly"). There was no way for the model to know an id it was never shown. The serialized format is amended to:

```
\#\# Memory: \<label\> (id: \<id\>)  
\<body\>
```

This is the only change to §5.3's format; section order, delimiters, and the plain-text philosophy are unchanged. The suggestion instructions (Addendum F's "\#\# Suggesting Sheet Changes") gain one added sentence: *"When editing or deactivating an existing memory, use the exact `id` shown next to it above — do not guess or invent one."*

Cost, named rather than hidden (matching this spec's practice, e.g. Addendum F 5.4.1): a UUID is a fixed, small addition to every memory's token count (§5.4). This is a necessary correctness cost, not something to optimize away — a wrong or hallucinated `memoryId` silently doing nothing (6.2.7 below) would be worse than a few extra tokens.

### 6.2.7 A suggestion referencing an unknown memory id fails visibly, not silently (extends §6.2, Addendum D 6.2.2)

Before 5.3.2, an `edit\_memory` or `deactivate\_memory` suggestion whose `memoryId` didn't match any memory in the current sheet would be accepted, silently produce a no-op sheet mutation (or no-op overlay change), and still show the user "accepted" — a false success. This is the same category of problem §7.3 names for provider-level failures ("failures must be visible... a failed call that fails silently is exactly the kind of invisible event this methodology exists to prevent"), just at the suggestion-acceptance layer rather than the network layer.

Resolution: accepting an `edit\_memory` or `deactivate\_memory` suggestion first checks that `memoryId` matches a memory in the current sheet (post-overlay). If it doesn't:

- The sheet is not mutated and no version is created — the same guarantee §7.3 gives for a failed provider call.

- The suggestion's display status becomes `failed` (a fourth status alongside `pending`/`accepted`/`rejected`/`revised`), rendered distinctly (e.g. "memory not found — it may have been deleted since this suggestion was proposed").

- The user's remaining options are the same as for any other suggestion: dismiss it, or Revise with an instruction such as "that memory no longer exists, try again."

`new\_memory` and `tone\_update` don't reference an existing memory, so this doesn't apply to them. `reorder\_pins` already tolerates unknown/stale ids gracefully by design (Addendum E 6.2.4: "Memory IDs omitted from pinOrder keep their current pinRank"), so no change there either.

### 3.4 The "Conversation Summary" convention (extends §3, §6.2, §6.4, Addendum F 6.2.5)

§3's statelessness guarantee is not relaxed by this addendum — no raw conversation history is ever resent, and the chat pane's message list remains ephemeral UI state, exactly as §3 specifies. What's added is a *convention*, not a mechanism: the chat pane's suggestion instructions (Addendum F, 6.2.5) gain guidance that the AI may propose a memory summarizing the conversation so far, using the ordinary `new\_memory`/`edit\_memory` suggestion types already built for every other memory — no new suggestion type, no new `Sheet` field, no new fixed section in §5.1, matching §6.6's existing constraint that AI assistance stays to exactly two actions.

Amended chat preamble (illustrative wording; structure is the normative part, per the precedent set in Addendum F 6.2.5/6.3.1):

> *"...If the conversation reaches a point where a future turn would benefit from remembering what's been discussed, you may propose a memory summarizing it. Check whether a memory labeled 'Conversation Summary' already exists above (its id is shown next to it, per the serialization format) — if so, propose an edit\_memory updating it rather than creating a duplicate; if not, propose a new\_memory with that label."*

This is only possible because of 5.3.2 above — without memory ids being visible, the model would have no way to target an existing summary for an edit, and would just accumulate duplicates turn after turn.

**The honest tradeoff, and it isn't tone.** The framing going into this addendum was that "tone won't be perfectly consistent," but the actual tradeoff is staleness/latency — the same shape §6.4 already names for Tone: *"in a stateless-per-call system, tone cannot literally drift... What can actually happen is staleness."* A Conversation Summary memory has the identical property: it is only ever as current as the last time the user accepted a proposed update. Two back-to-back messages sent before any summary is proposed and accepted will not have continuity between them — the second call still won't see the first exchange, for exactly the reason described in §3. This addendum does not, and cannot, give zero-latency pronoun/reference resolution across rapid-fire turns; it gives *curated, bounded, legible* continuity across a slower cadence — an exchange settles, the user accepts a summary, later turns benefit from it. That is a deliberate, named tradeoff in exchange for §1's legibility guarantee, not an oversight, and it matches the spec's existing stance on Tone staleness exactly.

**No uniqueness enforced.** Memory labels are not unique anywhere else in this spec (nothing stops two memories both being called "Deadline"), so this addendum doesn't introduce a special "exactly one Conversation Summary" invariant either — it's a convention the preamble nudges toward, not a constraint the schema enforces. If duplicates accumulate (e.g. across genuinely unrelated conversations), they're handled the same way any duplicate memory is: manually, or via the sheet-editor's existing "merging near-duplicates" capability (§6.3).

**Lifecycle.** A Conversation Summary memory, once accepted, is a completely ordinary memory — it persists after the visible chat clears (§3: "the sheet is not \[lost\]"), it's subject to the same staleness/pruning lifecycle as anything else (§5.4's "suggest prunes," manual deactivation), and it carries the same provenance/versioning guarantees as any other accepted suggestion. Nothing about it is special-cased in storage; only the preamble convention that produces it is new.


**Addendum I — Conversation Summary becomes a dedicated field, not an ordinary memory (supersedes Addendum H, 3.4; extends §4.3, §5.1, §6.2, Addendum B, Addendum C, Addendum D, Addendum E, Addendum F)**

Addendum H's 3.4 deliberately kept "Conversation Summary" as nothing more than a labeling convention on an ordinary memory, reasoning by analogy from Tone's "not a distinct subsystem" framing (§6.4). Using it surfaced two real problems that change that conclusion:

1. **Memories were observed collapsing into one growing catch-all.** The model generalized the "find the existing one and edit it in place" instruction — written for Conversation Summary specifically — to ordinary personal-fact memories too, folding unrelated facts into a single "User Profile" -style blob. This defeats §2's framing of a memory as "the atomic unit of curated context."

2. **Conversation continuity needs guaranteed positional and sequential integrity** — not mixed in with, or resortable against, the general memory pool by pin rank or recency. An ordinary memory's position in §5.1's serialization depends on pin/recency sorting; a running conversation record shouldn't be subject to that at all.

Rather than patch the convention further, this addendum promotes Conversation Summary to a dedicated `Sheet` field — the same move §6.4 already made for Tone, for the same underlying reason (singular, always-relevant, deserves a fixed position), just arrived at independently for a different field. This is exactly the kind of visible, additive correction the methodology is supposed to make easy: Addendum H's 3.4 stays in the record unedited; this addendum explicitly supersedes its mechanism rather than silently rewriting it.

### 4.3.2 Sheet schema gains `conversationSummary` (extends Addendum C, 4.3.1)

```
interface Sheet \{  
  userDetails: string;  
  tone: Memory;  
  conversationSummary: Memory;    // Addendum I: dedicated field, same treatment as tone  
  memories: Memory\[\];  
  freeformNotes: string;  
\}
```

`conversationSummary` is a `Memory` for schema uniformity (id, provenance, timestamps all still matter), but `pinRank` and `active` are inert on it, exactly as they already are on `tone` (Addendum C, 5.2.1) — its position is always fixed (5.1.2 below) and its inclusion is governed by body non-emptiness (5.1.2), not by pinning or a toggle. `label` is fixed to `"Conversation Summary"` and not user-editable, matching how Tone's label is effectively fixed.

### 5.1.2 Conversation Summary is a new fixed serialization section (extends §5.1, Addendum B 5.1.1)

§5.1's section order gains a new fixed position, inserted between Tone and Pinned Memories:

1. User Details

2. Tone

3. **Conversation Summary** *(new)*

4. Pinned Memories

5. Unpinned Memories

6. Freeform Notes

Unlike Tone, which §6.4 keeps in the prompt even when unremarkable, Conversation Summary is **omitted from serialization when its body is empty** — matching User Details' and Freeform Notes' treatment (§5.1), not Tone's. An empty conversation summary has nothing to say; an empty Tone still expresses a (default) register.

### 6.2.8 New suggestion type: `conversation\_summary\_update` (extends Addendum D 6.2.1, Addendum E 6.2.4)

```
interface ConversationSummaryUpdateSuggestion \{  
  type: "conversation\_summary\_update";  
  body: string;  
\}
```

Added to the `SheetSuggestion` union. Mirrors `tone\_update`'s shape and mechanics exactly: accepting it *replaces* `Sheet.conversationSummary`'s body wholesale (with a version created, `manual\_edit`/`ai\_suggestion\_accepted`/`sheet\_editor\_session` attribution per the accepting surface, same as every other version-creating suggestion type). "Replaces wholesale" is a statement about the *field* (there is exactly one `conversationSummary`, not a collection), not about the *content* — the body's content is itself an ordered list (6.2.9), and a normal update's replacement text is that same list with one new entry appended. This is available from both the chat pane and the sheet editor (a user can explicitly ask the sheet editor to restructure or trim it), even though the *proactive nudge* to propose one unprompted remains chat-only (6.2.9 below), matching Addendum H's existing "only in chat mode" scoping.

### 6.2.9 An ordered list of turn summaries; append, don't auto-compress (extends 6.2.8, Addendum H 3.4's staleness framing)

The chat preamble (Addendum F 6.2.5, as amended by Addendum H) is revised. Where it previously said to propose a `new\_memory`/`edit\_memory` labeled "Conversation Summary," it now says:

> *"...If the conversation reaches a point where a future turn would benefit from remembering what's been discussed, propose a conversation\_summary\_update. The body is an ordered, numbered list — one concise entry per exchange, in chronological order, summarizing (not quoting verbatim) what was asked and answered, labeling who said what when it isn't obvious from context (e.g. '4. User asked whether tide pools form the same way on every coastline; I discussed current research trends.'). Append one new entry for the latest exchange to the existing list. Do not rewrite, condense, or drop earlier entries — leave that to the user."*

This format was chosen deliberately over free-form prose: an explicit, chronological, per-turn structure is what makes "understood in order" a property of the format itself, not something the reader has to reconstruct from a paragraph.

**No automatic compression, by design.** An earlier draft of this addendum had the AI periodically re-summarize/condense older entries, reasoning that an ever-growing log would recreate the "hidden transcript" problem §1 exists to prevent. That reasoning doesn't hold once every entry is already a *summary*, not a verbatim quote, and every update is a *suggestion requiring explicit accept* — nothing about a growing list here is either raw or invisible, which are the two properties §1 actually objects to. This is the same principle §5.4 already states for the sheet as a whole: *"No hard cap on sheet size. The interface encourages minimalism through visibility... rather than enforcing a limit."* Growth is made visible via the token count (§5.4) and left to the user's own judgment — trim it, edit it, or leave it, the same as any other memory — rather than an automatic behavior the AI performs on the user's behalf.

The staleness/latency tradeoff Addendum H named still holds unchanged: this is only ever as current as the last accepted update, and gives no zero-latency continuity across rapid-fire turns with no accept step in between.

### 6.2.10 Ordinary memories should stay atomic, not consolidate into a catch-all (extends Addendum F 6.2.5)

Independent of the Conversation Summary mechanism, the chat preamble gains a general instruction addressing the first problem observed above directly: *"For ordinary facts about the user — not conversation continuity — prefer creating a new, specifically-labeled memory over folding multiple unrelated facts into one broad memory. Each memory should stay a single fact or closely related cluster, not a catch-all."* The "find the existing one and edit it in place" pattern is reserved for Conversation Summary (and Tone) specifically, because those are singular dedicated fields — it was never meant to generalize to the memory pool, and this makes that boundary explicit in the instructions themselves rather than leaving it to be inferred.

### 8.1.1 Skeleton gains an empty Conversation Summary (extends §8.1)

The §8.1 skeleton's `conversationSummary` starts with an empty body (omitted from serialization per 5.1.2, same as the skeleton's empty User Details). No default text is proposed — unlike Tone, there's no universally sensible starting value for "what's been discussed" before any conversation has happened.


**Addendum J — User Details removed; its function was already redundant, not deferred (extends §5.1, §8.1, Addendum C 4.3.1)**

Addendum I's 6.2.10 fix for memories collapsing into a catch-all surfaced a deeper question: should User Details (§5.1 \#1) — "freeform-editable, persistent facts about the user," explicitly designed to hold multiple facts together in one blob — exist at all, given §2 frames a memory as "the atomic unit of curated context"? That's a different atomicity rule for the same kind of content (durable facts about the user) depending only on which of two sections it happened to land in.

The instinct to fix this by pushing everything into individual memories initially looked like it would mean deferring a capability — "cross-session user profile facts, the way other providers' memory features work" — as later work. It doesn't: **ordinary memories in this sheet already persist across every session**, the same way User Details did. There's no per-session reset anywhere in this spec; the sheet is the same document across every conversation (§3, §9.2). The property that makes other providers' memory features notable — facts surviving *across separate conversations* — was never something User Details had and memories lacked. User Details wasn't providing a capability memories couldn't; it was a second, less-atomic path to the same one.

### 5.1 (revised) Section order loses User Details

§5.1's numbered section list is revised — User Details is removed, not replaced:

1. Tone

2. Conversation Summary

3. Pinned Memories

4. Unpinned Memories

5. Freeform Notes

Addendum I's 5.1.2 ("inserted between Tone and Pinned Memories") is unaffected by the renumbering — Conversation Summary's position relative to Tone and the memory pool doesn't change, only User Details' removal shifts everything else up by one.

### 4.3.2 (revised) Sheet schema loses `userDetails`

```
interface Sheet \{  
  tone: Memory;  
  conversationSummary: Memory;  
  memories: Memory\[\];  
  freeformNotes: string;  
\}
```

Any durable fact that would previously have gone into User Details (name, role, standing preferences) is now just an ordinary memory — same schema, same atomicity, same accept/edit/deactivate/pin controls as everything else, no special case.

### 8.1 (revised) Skeleton loses the empty User Details section

§8.1's skeleton description ("an empty User Details section and a default Tone memory") is revised to: a default Tone memory and an empty Conversation Summary, no pre-filled memories. The core claim §8.1 makes — a stateless call always has somewhere for baseline instructions to live — still holds; Tone alone already establishes that, and always did.

### Scope note: this defers a specific, named feature, not a vague possibility

"Session," here and going forward, means an individual sheet — what §8.1 loosely called a "project." Today's PoC has exactly one: single local user (§1.3), no multi-sheet UI, nothing to switch between. In that world, "scoped to this session" and "global across every session" are the same claim, because there's only one session to be global across — which is precisely why removing User Details costs nothing right now.

That stops being true the moment multi-sheet/multi-session support exists — itself not yet built, and not yet formally in- or out-of-scope anywhere in this spec (§9.3's "out of scope" list rules out multi-*user*, never multi-*sheet*). Once it does exist, User Details has a real, distinct job again: a field that persists across every sheet a user has, the same relationship other providers' memory features have to individual conversation threads — as opposed to an ordinary memory, which (per this addendum) lives inside one specific sheet. Building that properly is a two-part dependency (multi-session support, then a global-scoped fact layer on top of it), not a small addition to the current single-sheet model — which is exactly why it's named here as explicit future work rather than either built prematurely or silently forgotten.


**Addendum F — System prompt assembly (extends §3, §5.1, §5.3, §6.2, §6.3, Addendum D, Addendum E)**

§5.3 specifies how *sheet sections* are formatted. Addendum D's 6.2.1 specifies a further instructional paragraph the model needs (how to emit `SHEET\_SUGGESTIONS`). Neither section specifies how these combine into the literal `system\_prompt` string actually sent to the provider, and §3's shorthand — "system prompt = serialized context sheet" — turns out to be imprecise once Addendum D's instructional text is accounted for. Separately, §6.3 describes the sheet-editor's expected output as "little or no conversational text," implying its system prompt instructs the model differently than the chat pane's — but nothing specifies how. This addendum fixes both.

### 3.3 The system prompt has three fixed parts, not one (extends §3, §5.3)

The `system\_prompt` sent on every call (§7.1's `system\_prompt + single user message → text response` shape) is the concatenation, in order, of:

1. **Mode preamble** — fixed instructional text that differs by call type (6.2.5, 6.3.1 below).

2. **Serialized sheet content** — exactly what §5.1/§5.3 already specify: the five sections in order, active memories only, in the delimited plain-text format. This part is unchanged by this addendum.

3. **Suggestion-format instructions** — the fixed instructional paragraph (expanding on Addendum D 6.2.1) describing the `SHEET\_SUGGESTIONS` delimiter, schema, and the five suggestion types (Addendum D + Addendum E 6.2.4). Identical text in every call, regardless of mode — a chat-pane call still needs to know the format is available even on turns where it emits zero suggestions (§6.2: "0+ candidate sheet changes").

This decomposition fixes the serializer's contract, which was the actual ambiguity blocking implementation: **§5.3's serializer produces part 2 only.** It is a pure function `serializeSheet(sheet: Sheet): string` with no knowledge of call mode, preamble text, or suggestion instructions. A separate, higher-level function assembles the full prompt:

```
type CallMode = "chat" | "sheet\_editor";  
  
function buildSystemPrompt(sheet: Sheet, mode: CallMode): string \{  
  return \[modePreamble(mode), serializeSheet(sheet), SUGGESTION\_INSTRUCTIONS\].join("\\n\\n");  
\}
```

Keeping `serializeSheet` mode-agnostic matters beyond tidiness: §5.3 already frames the serialized sheet as "inspectable/copyable as a diagnostic feature," and a user inspecting "the sheet as text" should see the same thing regardless of which surface (chat pane vs. sheet-editor) they're about to send it from. Only the preamble and instructions wrapped around it vary.

### 6.2.5 Chat-pane preamble (extends §6.2, §3)

Fixed text (illustrative wording, not frozen copy — structure is the normative part, matching how §8.1 gives illustrative default tone text):

> *"The following sections are the user's curated context for this conversation. Treat them as ground truth about the user and task. Respond to the user's message directly and conversationally. If the exchange suggests a durable addition or change to this context, you may propose it — see the suggestion format below — but proposing changes is optional and secondary to answering the user."*

### 6.3.1 Sheet-editor preamble (extends §6.3, §3)

Distinct fixed text, reflecting that this mode's primary output *is* suggestions, not conversation:

> *"You are in a dedicated sheet-editing session, not a conversation. The user's instruction below describes how they want their context sheet restructured (e.g. merging memories, pruning, reordering pins). Respond with minimal or no conversational text and express your proposed changes as suggestions in the format below. If no changes are warranted, say so briefly rather than proposing changes for their own sake."*

Because the sheet-editor is where §5.4's "suggest prunes" and §6.3's "reorganizing pin order" actually live, its calls are the primary expected source of `deactivate\_memory` and `reorder\_pins` suggestions (Addendum E, 6.2.4) — though nothing prevents the chat pane from producing them too (e.g. the user says "stop tracking my old employer" mid-conversation and the AI proposes a `deactivate\_memory` inline, same as any other suggestion type).

### 6.2.6 Revision calls reuse their originating mode's preamble (extends Addendum E, 3.2)

Addendum E's 3.2 specifies what the *user message* contains on a revision but was silent on the system prompt. To close that: a revision call is not a third mode. It uses whichever preamble (6.2.5 or 6.3.1) matches where the suggestion being revised came from — a chat-pane suggestion's revision uses the chat-pane preamble, a sheet-editor suggestion's revision uses the sheet-editor preamble. Only `buildSystemPrompt`'s second input, the sheet itself, and the synthesized user message (Addendum E, 3.2) change; `mode` is carried over from the original call.

### 5.4.1 Token count reflects part 2 only (extends §5.4)

§5.4's live token count is of the *serialized sheet* (`serializeSheet(sheet)` output) — parts 1 and 3 (preamble, suggestion instructions) are fixed, constant-size text the user doesn't curate and can't reduce, so counting them would work against §5.4's stated purpose (encouraging minimalism in what the user *controls*) by inflating the number with overhead the user has no lever over. The actual wire cost to the provider is higher than the displayed count by a small, constant amount (parts 1 + 3); this is an accepted, named simplification, not an oversight — analogous to §6.4's stance that some gaps are worth naming rather than hiding.


**Addendum K — `conversation\_summary\_update` is mandatory on every chat response, not optional (supersedes Addendum I 6.2.9's conditional trigger; extends §6.1, §6.2)**

Live testing surfaced the actual failure this addendum closes: Addendum I's trigger — *"if the conversation reaches a point where a future turn would benefit from remembering what's been discussed"* — is a judgment call the model gets to make, and it consistently judged that a single opening question (including the exact "what are tide pools" case that motivated Addendum I in the first place) didn't meet that bar. A prompted-but-optional instruction is inherently probabilistic; for a mechanism whose entire purpose is *reliably* preventing the "this topic" failure mode, optionality defeats the point. Confirmed live (DevTools network inspection) that the model was returning no `SHEET\_SUGGESTIONS` block at all, not a malformed one — this is a prompt-instruction gap, not a parsing bug.

### 6.2.11 `conversation\_summary\_update` is proposed after every chat-pane response, unconditionally

This is the one suggestion type in this spec that is not optional to *propose*. The chat preamble (Addendum F 6.2.5, as amended by Addendum H and Addendum I) is revised:

> *"After every response, without exception, propose a conversation\_summary\_update appending one new entry for this exchange to the existing Conversation Summary list shown above, in this exact format: 'N. User asked/said: \<what the user asked or said\>. AI replied: \<what you answered\>.' This is required on every single response, regardless of whether the topic seems memorable on its own — proposing this update is never optional, unlike the suggestion types below. Do not rewrite, condense, or drop earlier entries — only append the new one.*

> *If the exchange also suggests a durable addition or change to this context — a fact about the user, a tone adjustment — you may separately propose that too, using new\_memory, edit\_memory, or tone\_update; but unlike the update above, proposing these remains optional and secondary to answering the user. For ordinary facts about the user, prefer creating a new, specifically-labeled memory over folding multiple unrelated facts into one broad memory; each memory should stay a single fact or closely related cluster, not a catch-all."*

Two things are deliberately unchanged by making this mandatory:

- **§6.1's core rule** — "nothing is applied without explicit user action" — is untouched. Mandatory *proposal* is not auto-apply; the user still sees every `conversation\_summary\_update` as a suggestion and must explicitly accept it, exactly like any other suggestion (§6.5's no-auto-apply stance is unaffected).

- **`new\_memory`/`edit\_memory`/`tone\_update` stay content-gated**, per §6.2's original "may propose" framing and Addendum I 6.2.10's atomicity guidance. Making *these* mandatory too was considered and rejected: forcing the model to manufacture a memory for exchanges with nothing durable in them (a plain knowledge question, for instance) would recreate a version of the blobbing problem Addendum I fixed, just as forced-low-value-memories instead of one growing blob. Only `conversation\_summary\_update` is unconditionally safe to mandate, because it's the one suggestion type that's *always* meaningful — any exchange, however trivial, can honestly be described as "user asked/said X, I replied Y."

### 6.2.12 Fixed entry format (extends 6.2.9)

Addendum I's 6.2.9 described the entry format loosely ("summarizing... what was asked and answered, labeling who said what when it isn't obvious from context"). This addendum fixes it to a literal template, not an illustrative example: every entry is `N. User asked/said: \<...\>. AI replied: \<...\>.` — consistent structure turn to turn, not free prose that happens to mention both parties.

### Suggestion-instructions note (extends Addendum F 6.2.1)

Addendum F's shared suggestion instructions say "Omit the block entirely if you have no suggestions" — still correct for sheet-editor mode (§6.3.1: "if no changes are warranted, say so briefly"), but no longer literally true for chat mode, where the block is never fully absent since `conversation\_summary\_update` is always included. No wording change was needed to the shared instructions themselves — the chat preamble's new unconditional instruction (6.2.11) already establishes the mandatory case; the shared text's "omit if none" is simply inapplicable to the one suggestion type the mode-specific preamble already requires.


**Addendum L — `conversation\_summary\_update`'s body is the new entry only, appended by the client (extends Addendum I 6.2.8, Addendum K 6.2.11/6.2.12)**

Addendum I's 6.2.8 made `conversation\_summary\_update` "replace `Sheet.conversationSummary`'s body wholesale," on the model's promise (6.2.9's preamble instruction) to always include the full existing list plus one new line in that replacement body. Live testing after Addendum K shipped surfaced the failure this depended on not happening: an accepted update overwrote earlier entries — the model hadn't reliably reproduced them verbatim. This is a different root cause from Addendum K's problem (which was the model declining to propose an update at all) but the same *category* of fix: something the model was asked to do reliably — byte-for-byte reproduction of content it was only shown, not asked to transform — is something the client can simply do itself, correctly, every time.

### 6.2.13 `body` is the new entry, not the replacement document

`ConversationSummaryUpdateSuggestion.body` (Addendum I, 6.2.8) is redefined: it now holds **only the text of the new entry being proposed** — no entry number, no earlier entries repeated. The suggestion's TypeScript shape is unchanged (`\{ type: "conversation\_summary\_update"; body: string \}`); only what the string is understood to contain changes.

Accepting the suggestion now **appends** a numbered line built from that text to the end of the existing `conversationSummary.body`, rather than replacing the field wholesale:

- The client computes the next entry number itself (count of existing non-empty lines, plus one) — the model no longer supplies or is trusted with numbering either, for the same reliability reason.

- Earlier entries are never re-sent by the model and never touched by the client beyond appending after them — the "never drop or rewrite earlier entries" guarantee from Addendum I 6.2.9 (kept in Addendum K 6.2.11) is now mechanically enforced by the accept path itself, not dependent on the model's recall.

The chat preamble (Addendum K 6.2.11) is revised accordingly — where it said the body should append "one new entry... to the existing Conversation Summary list shown above" (implying the model reproduces the list), it now says:

> *"...propose a conversation\_summary\_update whose body is only the new entry's text for this exchange — no number, and do not repeat or rewrite earlier entries; the new entry is appended automatically. Format: 'User asked/said: \<...\>. AI replied: \<...\>.'"*

### Scope: manual edits are unaffected

The sheet panel's Conversation Summary field is still directly, wholesale-editable by the user (§4.1's manual-edit path, `editConversationSummary`) — a human editing visible text directly has no verbatim-reproduction problem, since they're looking at exactly what they're changing. Only the AI-suggestion acceptance path changes to append-only; `editConversationSummary` keeps its existing wholesale-replace semantics for that reason, and Addendum I's `Sheet.conversationSummary: Memory` schema (4.3.2) is untouched — this is a change to how one suggestion type is interpreted and accepted, not to the data model.


**Addendum M — the preamble never states that the Conversation Summary is strictly in the past (extends Addendum K 6.2.11)**

Live testing surfaced a minor but real confusion: asked "What did I just ask you?" as a second message, the model answered with the two prior/current questions in reversed chronological order — treating the message it was actively answering as if it preceded an earlier, already-summarized turn. Nothing in the preamble ever states the relationship between the two: that the Conversation Summary lists strictly *prior* exchanges, and the message the model is being asked to respond to right now is always the *newest* one, occurring after everything listed there. The model has to infer that ordering, and a self-referential question about turn order is precisely where an unstated inference is most likely to fail.

### 6.2.14 State the temporal relationship explicitly

The chat preamble (Addendum K 6.2.11) gains one clarifying sentence, placed right before the Conversation Summary instruction: *"The Conversation Summary section above, if present, lists prior exchanges in this conversation in order; the message you are responding to now is always the newest one, occurring after everything listed there."*

This is a wording fix, not a mechanism change — nothing about serialization (§5.1.2), the suggestion type (Addendum I 6.2.8), or the append-only accept path (Addendum L 6.2.13) is touched. As with Addendum K's own mandatory-proposal instruction, an explicit statement narrows but cannot fully eliminate the failure mode — prompted behavior stays probabilistic; this makes the correct answer easier for the model to reach, not guaranteed.


**Addendum N — Multi-session support deferred; conversation summary/memories merge deferred with it (extends Addendum J's scope note, Addendum I)**

Discussion considered merging Conversation Summary entries into the ordinary memory pool within one sheet — giving up the dedicated-field structure (Addendum I) in favor of treating turns as memories like any other. That merge only avoids reintroducing the problems Addendum I was built to solve (memory-pool dilution from high-frequency entries, pin-rank semantics conflicting between priority-ordering and sequence-ordering) if a *separate*, cross-session "preferences" tier exists to hold durable facts insulated from per-session churn. That tier requires multi-session/multi-sheet support to mean anything — Addendum J's scope note already named this as deferred, not-yet-built, and not yet formally in- or out-of-scope anywhere in this spec.

**Decision: multi-session support remains deferred, as its own deliberate future feature — not built now.** Its direct consequence: the conversation-summary/memories merge is deferred *with* it, not independently. Building the merge alone, without the cross-session split that made it viable, would simply recreate the dilution and ordering problems in a different shape.

**Current architecture is unchanged by this addendum.** `Sheet.conversationSummary` remains a dedicated field, separate from `Sheet.memories`, exactly as built through Addenda I, K, L, and M. No schema or code changes result from this addendum — it exists only to record the reasoning and target direction before it's forgotten, not to implement anything.

**Named target architecture, for whenever multi-session support is eventually built** (not designed in detail here, no schema proposed): per-session unified pool (conversation turns and session-specific memories together, since within one session the dilution concern is much smaller) plus a separate cross-session layer for durable preferences that apply regardless of which session is active. This is the concrete shape Addendum J's deferred "global User Details replacement" turns out to take, refined by this conversation's discussion of merging conversation tracking into it too.


**Addendum O — Conversation turns become tagged `Memory` objects, not a dedicated field (supersedes Addendum I 4.3.2/5.1.2, Addendum L 6.2.13; extends Addendum K, Addendum M)**

Addendum N deferred merging conversation turns into the memory pool because doing so, under §5.1's existing sort rule (unpinned memories ordered most-recently-modified-first), would make turns read newest-first — backwards from a transcript — and reusing `pinRank` to fix that would collide priority-ordering with sequence-ordering in one field. Both objections dissolve once turns are ordered by a field they don't share a purpose with: their own `lastModified`, ascending, never touching `pinRank` at all. This isn't the deferred multi-session merge from Addendum N (which was about a *cross-session* preferences split) — it's a narrower, buildable-now fix to the *within-one-sheet* ordering problem that was Addendum N's stated reason for deferral. Multi-session support and the global-preferences tier remain exactly as deferred as Addendum N left them.

### 4.3.3 `Memory` gains an optional `kind` marker (supersedes Addendum I 4.3.2)

```
interface Memory \{  
  id: string;  
  label: string;  
  body: string;  
  pinRank: number | null;  
  active: boolean;  
  lastModified: string;  
  provenance: Provenance;  
  kind?: "conversation\_turn"; // absent for ordinary memories  
\}  
  
interface Sheet \{  
  tone: Memory;  
  memories: Memory\[\]; // conversation turns and ordinary memories both live here now  
  freeformNotes: string;  
\}
```

`Sheet.conversationSummary` (Addendum I, 4.3.2) is removed — there is no longer a dedicated field. A conversation turn is an ordinary `Memory` with `kind: "conversation\_turn"` and `pinRank` always `null` (turns are never pinned; see 5.1.3's rationale). This is a UI/accept-path convention, not a type-level guarantee — nothing stops `pinRank` from being set on a `kind: "conversation\_turn"` memory at the type level, the same pragmatic choice already made for Tone's inert `pinRank`/`active` fields (Addendum C, 5.2.1).

### 5.1.3 Serialization: Conversation Summary is now a computed section, not a stored field (supersedes Addendum I 5.1.2)

§5.1's order is unchanged in shape — Tone, Conversation Summary, Pinned Memories, Unpinned Memories, Freeform Notes — but the Conversation Summary section's content is now *derived* at serialization time from `Sheet.memories`, not read from a dedicated field:

- **Selection:** active memories with `kind === "conversation\_turn"`.

- **Order:** ascending `lastModified` (chronological) — the opposite direction from ordinary unpinned memories' most-recent-first rule, and independent of `pinRank` entirely.

- **Rendering:** still one `\#\# Conversation Summary` block, still a numbered list — but the numbers are computed from sorted position, not stored: `"N. \<body\> (id: \<id\>)"`, one line per active turn. The trailing id follows the same convention as `renderMemoryBlock` (Addendum H 5.3.2) and isn't optional: without it, this addendum's "emergent capability" claim below — that `edit\_memory`/`deactivate\_memory` already work on turns — would be unexercisable, since the model would have no id to reference. `Memory.body` for a conversation-turn still holds only the entry text ("User asked/said: ... AI replied: ..."), same contract as Addendum L already established; what changes is that this text now lives in its own `Memory` rather than being concatenated into a shared string.

- **Ordinary Pinned/Unpinned Memories sections:** unchanged sort rules (`pinRank` ascending / `lastModified` descending), now additionally filtered to exclude `kind === "conversation\_turn"` memories, so a turn never appears twice.

- **Inactive turns:** excluded from serialization exactly like any other inactive memory (§2), but — same as any other memory — remain visible (greyed out, chronologically positioned) in the sheet panel.

### 6.2.15 What's unchanged: the suggestion wire format and preamble instructions

`conversation\_summary\_update`'s JSON shape (`\{ "type": "conversation\_summary\_update", "body": "..." \}`, Addendum I 6.2.8) does not change. Addendum K's mandatory-every-response instruction and Addendum M's temporal-ordering clarification do not change — both describe the *rendered* Conversation Summary block, which looks identical to the model before and after this addendum. Addendum E 3.2's revision-message formatting for this suggestion type (`\#\# Conversation Summary\\n\<body\>`) is unaffected for the same reason. Only what *accepting* the suggestion does internally changes: instead of appending a line to a stored string (Addendum L 6.2.13), it creates a new `Memory` with `kind: "conversation\_turn"`, mirroring how accepting `new\_memory` already works. The client-side numbering logic Addendum L introduced (`existingEntryCount + 1`, tracked and incremented) is retired — the number is never stored; it's recomputed from sort position every time 5.1.3's selection runs, for both the LLM-facing prompt and the sheet panel's display.

### Emergent capability: `edit\_memory`/`deactivate\_memory` now work on conversation turns for free

Because a conversation turn is an ordinary `Memory` with a real `id`, the existing `edit\_memory` and `deactivate\_memory` suggestion types (Addendum E, Addendum H 6.2.7's unmatched-id handling) already work on turns without any new code — the AI (or the user, via the sheet-editor) can correct or deactivate a single turn using mechanics that already exist, rather than needing turn-specific suggestion types. This wasn't possible when turns lived inside one opaque string.

### UI: conversation turns render as individual blocks, not one text area

The sheet panel's single "Conversation Summary" `\<textarea\>` is replaced with a list of individually editable blocks — one per conversation-turn memory, chronologically ordered (including inactive ones, dimmed, per §2) — reusing the same row pattern as the general Memories list (Edit, Delete, an active/inactive toggle) with one exception: **no Pin control**. Pinning a conversation turn would reintroduce the exact ordering conflict this addendum exists to avoid, so the affordance is withheld at the UI layer for this `kind`, not enforced by the type system. The general Memories section now filters out `kind: "conversation\_turn"` entries, so nothing appears twice.

### Incidental simplification: `versionDiff.ts`

The dedicated `"conversation-summary"` diff kind (Addendum I, added when introducing the dedicated field) is retired. A new, edited, or deactivated conversation turn now shows up through the same "Added/Edited/Deactivated memory" diff lines every other memory already produces — one fewer special case in version history, not one more.


**Addendum P — Conversation Summary always renders, with a concrete example when empty (revises Addendum O 5.1.3's "omitted when empty" rule)**

Live testing found a reproducible pattern: `conversation\_summary\_update` — mandatory per Addendum K, "without exception" — was reliably skipped specifically when the Conversation Summary section was empty (a brand-new sheet, or right after deleting every existing turn), and reliably followed once at least one entry, even a manually-added placeholder, already existed. Confirmed directly: manually seeding one dummy entry fixed compliance on the next call. The abstract instruction in the preamble, stated once, wasn't a reliable enough anchor on its own; a concrete example of the section's existence and format was.

### 5.1.3 (revised) The section is never omitted; empty state shows a labeled example

Addendum O 5.1.3 said the Conversation Summary block is "omitted when there are no active turns." That's revised: the section always renders. When there are no active turns, it shows one clearly-marked example line instead of nothing:

```
\#\# Conversation Summary  
(No entries yet — your first conversation\_summary\_update will start the list, e.g. "1. User asked/said: ... AI replied: ...")
```

This isn't new instructional content — it repeats the exact format Addendum K's preamble already specifies ("Format: 'User asked/said: \<...\>. AI replied: \<...\>.'"), just relocated to a second, concrete anchor point exactly where the model needs to act, rather than relying solely on an instruction stated once, earlier in the prompt. Once any real turn exists, the placeholder is replaced by actual entries (5.1.3's existing chronological/numbered rendering, unchanged) — the placeholder's only job is covering the gap before the first real entry exists.

### Scope

This changes serialization only — §5.1's Conversation Summary always occupies its fixed position now, rather than being conditionally present. No schema change (still `Memory` objects tagged `kind: "conversation\_turn"`, Addendum O 4.3.3), no change to the accept path (Addendum O 6.2.15), no change to `orderConversationTurns` (Addendum O 5.1.3's chronological/id-shown rendering for real entries is unchanged). Token count (§5.4) increases by a small, fixed amount on an empty sheet as a result.

**Correction, recorded rather than silently edited out:** further live testing showed this placeholder alone did not reliably reproduce the compliance the original manual dummy-entry test suggested — the same "empty sheet, no suggestion returned" failure recurred with the placeholder live in the prompt (confirmed via token count: the request included it). Either the placeholder wasn't a close enough structural match to a real, pattern-completable list entry, or the original observation was partly coincidental against a small sample. This addendum's change is left in place — it's a reasonable, low-cost part of a layered approach — but it is not, on its own, the fix. Addendum Q addresses the actual reliability requirement structurally instead of through further prompt iteration.


**Addendum Q — Client-side fallback when the model doesn't propose the mandatory update (extends Addendum K 6.2.11)**

Addendum K made `conversation\_summary\_update` mandatory via prompt instruction; Addendum M and Addendum P each tried to close observed gaps with more precise wording and a concrete in-prompt anchor. Live testing kept finding the same failure: a chat response with no `SHEET\_SUGGESTIONS` block at all, confirmed via direct inspection of the raw response, not a parsing issue. This is the structural limit of the approach — a prompted instruction, however carefully worded, is inherently probabilistic (§7's model-agnostic design means there's no provider-level "must call this" guarantee being relied on here), and no further wording iteration can turn "narrows the failure rate" into "eliminates it." The reliability guarantee has to move to a layer that isn't probabilistic: the client itself.

### 6.2.16 The client synthesizes a fallback entry when the model's response has none

After any **chat-mode** call (this does not apply to sheet-editor mode, which never had Addendum K's mandatory instruction to begin with), the client checks whether the parsed response includes a `conversation\_summary\_update`. If it doesn't, the client constructs one itself:

```
\{"type": "conversation\_summary\_update", "body": "User asked/said: \<truncated user message\>. AI replied: \<truncated assistant reply\>."\}
```

Truncation, not summarization — there's no model-authored compression to draw on when this path fires at all, so the fallback is deliberately honest about being a lower-quality stand-in (raw text, cut to a fixed length with an ellipsis) rather than pretending to be an AI-authored summary it isn't.

### Still a suggestion, not an auto-apply

The synthesized entry is appended to the same suggestion list the user sees for that response and goes through the identical accept/reject/revise flow as anything else (§6.2) — §6.1's "nothing applied without explicit user action" is unaffected. The user can reject a fallback entry exactly like a bad AI-proposed one, or revise it with an instruction (Addendum E 3.2's revision mechanics don't distinguish; a revised fallback becomes a genuine model-authored response on the next call).

### Provenance is honest about origin, not attributed as if the model proposed it

Accepting a fallback entry does **not** use `ai\_suggestion\_accepted`/`ai\_suggested` attribution — that would misrepresent something the client generated as something the model decided to propose. It's recorded as `manual\_edit`/`source: "manual"`, with a `sourceExcerpt` noting it was a client-generated fallback. This is the same category §4.1 already uses for direct manual edits — a defensible fit, since the *decision* to add this entry was ultimately the user's (via accepting it), even though the *text* wasn't authored by either the user or the model in the usual sense.

### UI marks fallback suggestions distinctly

The suggestion list visibly distinguishes a fallback entry from a genuine model-proposed one (e.g., "auto-generated — the model didn't propose one this turn") — so the user knows, before accepting, that a given entry is a lower-quality stand-in rather than the model's own summary, and can choose to revise for a better one instead of accepting the truncated version.

### What this doesn't change

Addendum K's instruction stays in the preamble — the fallback is a backstop, not a replacement; most turns should still get a genuine model-authored entry. Addendum P's placeholder stays too. Addendum L's append-only mechanics, Addendum O's schema (tagged `Memory` objects, `kind: "conversation\_turn"`), and Addendum M's temporal-ordering note are all unaffected — a fallback entry is indistinguishable from a real one once accepted, except for its provenance record.


**Addendum R — A disambiguated follow-up call before falling back to truncation (extends Addendum Q 6.2.16)**

Addendum Q's truncation fallback guarantees an entry always exists, but a truncated raw excerpt is a strictly lower-quality stand-in than a real model-authored summary. Live testing (Addendum P) found the underlying failure correlates strongly with an *empty* Conversation Summary section specifically — compliance was reliable once any real entry existed, and unreliable on a brand-new sheet or right after every entry was manually cleared. Since a stateless call has no way to tell "first ever use" apart from "user just cleared it" (both look identical: an empty section, no history to compare against), the two cases can't be targeted separately — but they also don't need to be, since the same fix helps both.

### 6.2.17 Try a dedicated follow-up call before truncating

When 6.2.16's condition is met (chat mode, no `conversation\_summary\_update` in the response), the client no longer reaches for truncation immediately. It first makes one additional stateless call whose *only* task is producing that entry — no sheet, no other suggestion types, nothing else competing for the model's attention:

```
System: "You will be shown one exchange from a conversation: a user's  
message and an AI assistant's reply to it. Your only task is to summarize  
this exchange as a single conversation\_summary\_update suggestion, using  
this exact format: \[...\] Output nothing else — no conversational text, no  
other suggestion types, exactly one array element."  
  
Message: "User message: \<the original user message\>  
  
AI reply: \<the original assistant reply\>"
```

This is still a fully stateless call per §3 (fresh system prompt + one message, nothing resent) — it's simply a narrower, single-purpose one, not a variant that violates the architecture. Excluding the sheet keeps it cheap and keeps the model from having anything else to consider; a single unambiguous task is expected to be far more reliable than one optional item inside a general-purpose reply, which is exactly what 6.2.16's mandatory-but-ignored instruction was.

If this call succeeds and returns a valid `conversation\_summary\_update`, that entry is used — genuinely model-authored, just obtained via a dedicated second call rather than the main one. If it fails for any reason (network error, non-2xx, malformed response, or — rarely — still no valid entry), the client falls through to Addendum Q's truncation fallback exactly as before. Truncation remains the ultimate backstop; it just fires less often.

### Provenance: this is real model output, not treated as a fallback

Unlike Addendum Q's truncated entries, an accepted follow-up entry gets ordinary `ai\_suggestion\_accepted`/`source: "ai\_suggested"` attribution — the model actually wrote this text, just in a second call. Misattributing it as `manual\_edit` would be as dishonest in the other direction as attributing a truncation as AI-authored. The UI still marks it distinctly ("requested via a follow-up call — not in the original reply") so the user can see, for legibility's sake, where it came from — a lighter marker than the fallback's, since this isn't a lower-quality stand-in, just a differently-sourced one.

### Cost is bounded by how often 6.2.16's condition fires, not by turn count

This adds one extra call only when the main response lacked the update — which, per the evidence above, is expected to cluster around the start of a sheet's life (or right after a manual clear) rather than recur every turn. In the common case this is a one-time cost per sheet, not a per-message tax.

### Scope

No schema change, no change to accept/reject/revise mechanics (§6.1's "nothing applied without explicit user action" still holds — a follow-up-sourced entry is still just a pending suggestion), no change to Addendum Q's truncation fallback itself, which remains fully intact as the final backstop. This only changes what happens *before* truncation is reached.


**Addendum S — Multiple sheets ("projects") coexisting locally (extends §8)**

§8.1 already called a new sheet a "project," implying more than one was always the intended shape — the PoC just never built past a single implicit sheet. A user working across genuinely distinct contexts (this app's own dev work, a novel, an unrelated day job) shouldn't have to share one Tone and one memory pool across all of them. This addendum adds first-class support for several independent sheets, switchable within one browser session.

**This is not the multi-session merge Addendum N deferred.** Addendum N was about subdividing conversation turns and memories *within one sheet* into a per-session tier and a cross-session "durable preferences" tier — that remains exactly as deferred as Addendum N left it. This addendum instead adds multiple wholly independent, self-contained sheets side by side, each exactly as complete on its own as the single sheet already was — no merging, no shared tier between them. If within-sheet multi-session support is ever built, it would compose with this (a "session" becomes a subdivision inside one still-independent sheet), not be replaced by it.

### 8.4 Sheets become a first-class, listable entity (extends 8.1, §9.2)

A new `SheetMeta` record — `\{ id, name, createdAt \}` — represents a sheet *container*, distinct from `Sheet` (§5's content shape: tone, memories, freeform notes), which is unchanged and remains exactly what a `Version.sheet` holds.

- `Version` gains a required `sheetId`, scoping every version to the container it belongs to. Each sheet has its own fully independent version chain — §4's mechanics (creation, non-destructive revert, lineage walk) are otherwise unchanged, just scoped per `sheetId` instead of operating over one implicit global chain.

- The `head` pointer is no longer a hardcoded singleton row; it's one row per sheet, keyed by `sheetId` (same `\{ id, versionId \}` shape as before, just no longer pinned to the fixed string `"head"`).

- Which sheet is currently displayed is a plain client preference, persisted the same way as the API key and model selection (already local, unsynced settings) — not a `Version` and not something requiring its own history, since it isn't sheet content.

### 8.5 Creating, switching, renaming, deleting (extends 8.1)

- **Create**: inserts a `SheetMeta` row, creates its skeleton `Version` exactly as 8.1 already specifies (default Tone, no memories), makes it the active sheet.

- **Switch**: updates the active-sheet preference and notifies subscribers, the same pattern `headSubscription.ts` already uses for head changes. The chat pane, sheet panel, and pending overlay (Addendum A 4.2.1) all re-derive from the newly active `sheetId`. The shared `PendingOverlay` is explicitly reset on switch — deactivate/reorder toggles not yet folded into a version are scoped to whichever sheet is currently open and must not leak into a different sheet's memories.

- **Rename**: updates `SheetMeta.name` only. Not version-worthy — this is metadata about the container, not sheet content, and §4.1 already limits version-worthy changes to content.

- **Delete**: cascade-deletes every `Version` and every persisted message (8.6) scoped to that `sheetId`, plus its `head` row and its `SheetMeta` row, in one transaction. Unlike version revert (§4.4, explicitly non-destructive — reverted-past versions stay in storage), deleting a sheet is genuinely irreversible — the first destructive action anywhere in this spec — so the UI must confirm before executing it. If the deleted sheet was the active one, the app falls back to another existing sheet, or, mirroring 8.1's "never nothing" bootstrap guarantee, auto-creates a fresh default sheet if none remain.

### 8.6 A persisted, per-sheet chat log — never re-enters a call (extends §3)

A new `messages` table, one row per chat message, scoped by `sheetId`: the same shape the chat pane already keeps in memory (id, role, text, sourceText, suggestions with their current status), plus `sheetId` and `createdAt`. Written the moment a message is added, and updated in place as a suggestion's status changes — so what's stored reflects final state, not just the first snapshot.

This is a human-facing convenience, not a second source of truth. §3's statelessness guarantee is completely unchanged: every call remains system prompt + exactly one new message, nothing resent. The persisted log is written and read purely for display — surviving reloads and sheet switches — and no code path ever reconstructs it into a system prompt or a call payload. It's the same category of "visible but inert" data the version history already is for anything off the active line (§4.4): durable and legible, but never automatically re-entering context.

A practical side benefit: since `Version`s only record *accepted* content changes, this log is the only place a rejected suggestion, or a passing exchange that never became a memory, is remembered at all. Deleted along with its sheet (8.5).

### Migration: none — existing data is discarded, by agreement

This bumps the Dexie schema (§9.2) to add `sheetId` as a required field on `Version` and to introduce the `sheets` and `messages` tables. Unlike Addendum O's careful legacy-data migration, no migration path is provided: the existing single-sheet data predates `sheetId` entirely, and it's confirmed, disposable test content. The schema upgrade clears the old `versions`/`head` tables outright rather than backfilling a synthetic `sheetId`; `ensureInitialized`'s existing "create the skeleton if nothing exists" bootstrap then produces a fresh default sheet, indistinguishable from a brand-new install.

### Scope

§4's versioning, §5's serialization, §6's suggestion mechanism, and §7's provider integration are all unaffected in behavior — they already operate on "the current sheet's content"; multiple sheets just means several independent instances of that content exist, only one active/displayed/called-against at a time. §9.2's "single local user, no accounts" is unchanged — still purely local, no sync, no collaboration.

UI scope for this pass is deliberately minimal: create, switch, rename, delete. No duplicate, no per-sheet export/import (§8.3 continues to operate on the active sheet only), no reordering the sheet list — candidates for a later addendum if needed.


**Addendum T — Ordinary memories become global, shared across every sheet (fulfills Addendum N's deferred cross-session tier; extends Addendum S)**

Addendum N deferred a cross-session "durable preferences" tier, reasoning that it required multi-sheet support to mean anything. Addendum S built multi-sheet support but deliberately kept sheets "wholly independent, self-contained... no merging, no shared tier." This addendum builds that deferred tier: ordinary memories (facts about the user, preferences — anything not tagged `kind: "conversation\_turn"`) now live in one pool shared across every sheet, while Tone and Conversation Summary stay exactly as sheet-local as Addendum S left them. A fact like "the user prefers concise answers" shouldn't need re-teaching to every new project sheet — but a project's register (Tone) and its specific conversation history (Conversation Summary) genuinely are per-project, not durable facts about the user.

### 4.5 A second, independent version chain for the global memory pool

Rather than a new schema, the global pool reuses exactly the same `Version`/`head`/`versions` machinery every sheet already has (§4, Addendum S 8.4) — just keyed by one reserved, non-user-visible sentinel id instead of a real `SheetMeta`. This gets undo/revert (§4.4) for free, entirely independent of any single sheet's own history — reverting one sheet's local content must never also revert facts other sheets rely on, so the two chains being genuinely separate isn't an implementation shortcut, it's the actual requirement. The sentinel chain's `Version.sheet` reuses the full `Sheet` shape for minimal reuse of existing code, but only `.memories` (filtered to non-conversation-turn) is ever read from it — `.tone`/`.freeformNotes` stay at skeleton defaults and go unused, the same pragmatic inert-field pattern Tone's `pinRank` and turns' `pinRank` already use elsewhere in this schema. It never gets a `SheetMeta` row, so it never appears in the sheet switcher (Addendum S 8.5) — it's infrastructure, not a project the user manages.

### 5.1.4 Serialization merges both pools; local sheets only ever contribute conversation turns going forward

Wherever a sheet's content is rendered or sent to the model, its local memories (filtered to `kind: "conversation\_turn"` only) and the global pool's memories are concatenated before serialization — §5.1's existing per-kind ordering rules (chronological for turns, pin/recency for ordinary) are unchanged, since serialization already splits by `kind`. The filter is deliberate, not just forward-looking: it also makes any ordinary memory left over in a sheet's local storage from before this addendum invisible going forward, rather than needing an explicit migration. Token count (§5.4/Addendum F 5.4.1) reflects the merged result, since that's what's actually sent.

### Suggestion routing depends on kind, not just type

`new\_memory` always targets the global pool. `tone\_update` and `conversation\_summary\_update` always target the local sheet, unchanged. `edit\_memory`/`deactivate\_memory` can target either — Addendum O's "emergent capability" of editing/deactivating a conversation turn by id still works, since routing is resolved by checking which pool actually contains the target id (already unambiguous, ids aren't reused across pools), not by anything the model needs to specify.

### What stays local, and why

Tone (a project's register) and Conversation Summary (a project's specific history) are unaffected — Addendum S's reasoning for keeping sheets wholly independent still applies to both. Only the "durable fact, independent of which project I'm in" category — exactly what Addendum N named — moves.

### Scope: what this doesn't (yet) change

- **No migration.** Per direct confirmation, existing per-sheet ordinary memories are discarded, not merged — every sheet's global pool starts empty, the same treatment Addendum S gave the version/head tables.

- **Export/import (§8.3) is unaffected for now** — it still operates on one sheet's local chain only, same as Addendum S left it. An export taken today would not include the global pool, so it wouldn't fully reconstruct what the model actually saw. Left as a named gap for a future addendum rather than expanded here.

- **The shared `PendingOverlay`'s reset-on-switch behavior (Addendum S 8.5) is unchanged** — an uncommitted deactivate/reorder toggle on a global memory is discarded on a sheet switch exactly like a local one. This is a deliberate simplification (a pool-aware partial reset was considered and rejected as unnecessary complexity for what's already provisional, session-only state per §4.2), not an oversight.

- The UI marks the Memories section as shared across every sheet, so the distinction from Tone/Conversation Summary's per-sheet scope stays legible, not just documented here.


**Addendum U — Export/import includes the global memory pool (extends §8.3, Addendum T)**

Addendum T named this gap explicitly rather than expanding its own scope to cover it: an export taken under Addendum S/T only captured a sheet's local chain, so it didn't fully reconstruct what the model actually saw — undercutting §8.3's "a user can inspect their own context outside the app" claim for exactly the memories meant to be durable. This addendum closes it.

### 8.3.2 Export format gains an optional global section; bumps to "1.1"

The wire format (8.3.1) gains two new fields, both present together or both absent: `globalHeadVersionId`/`globalVersions`, mirroring `headVersionId`/`versions` but for the global pool's own independent lineage (Addendum T 4.5). `formatVersion` becomes `"1.1"` for any export produced from here on; `"1.0"` (Addendum S/T-era exports, predating this addendum) remains readable, but is understood to have no opinion about the global pool at all — not "an export of an empty pool."

### Import: replace what the file has an opinion about, leave the rest alone

Importing a `"1.1"` file replaces both chains — the local sheet's version history (8.3.1's existing "replaces...with the imported one" semantics) and the global pool's, independently, each keyed by its own sheetId (the target sheet, and the reserved sentinel from Addendum T 4.5). Importing a `"1.0"` file replaces only the local chain, exactly as it always has — it does **not** clear or touch the current global pool, since a `"1.0"` file predates the global pool as a concept and has nothing to say about it. Wiping shared, cross-sheet data as a side effect of an import scoped to one sheet would be a surprising, hard-to-reverse action for the user, not a reasonable reading of "this file has no global section."

### Scope

No schema change — reuses `Version`/`head`/`versions` exactly as they are, the same "no new plumbing" design Addendum T itself used. `exportSheet`/`importSheet` (store.ts) stay untouched, single-chain primitives; the dual-pool behavior is a thin orchestration layer on top, calling each unchanged primitive twice. The exported file is larger (two lineages instead of one) — the honest cost of §8.3's own stated goal: a user "inspecting their own context outside the app" should see everything the model would, not a partial view.


**Addendum V — Real token usage, captured from the provider and shown as a running total (extends §5.4, §7.2)**

§5.4's token count has only ever been a client-side estimate (`chars/4`, Addendum F 5.4.1) of what the *next* call would cost — useful for judging current sheet size, but never a record of what any call actually cost. The Anthropic Messages API returns a `usage` field (`input\_tokens`/`output\_tokens`) on every response — real, provider-billed numbers — which the adapter (§7.2) has been discarding entirely, keeping only the response text. This addendum captures it and adds a second, complementary statistic: not a replacement for the existing estimate, since the two answer different questions ("how big is my context right now" vs. "how much have I actually spent on this chat so far").

### 7.2.2 The provider adapter surfaces real usage on success

`ProviderCallResult`'s success case gains an optional `usage: \{ inputTokens: number; outputTokens: number \}`, populated from the Anthropic response body's own `usage.input\_tokens`/`usage.output\_tokens` when present. Adapters that can't supply it (or a malformed/missing field) simply omit it — nothing downstream requires it to be present, the same tolerant-of-absence pattern §7.1's model-agnostic design already uses elsewhere.

### A per-sheet running total, recorded independently of message construction

Every real call made for a sheet — the main chat/revision/sheet-editor call, and Addendum R's disambiguated follow-up call — reports its usage (when present) to a dedicated running total the moment it succeeds, via a `recordUsage(sheetId, usage)` call sitting alongside `runCall`/`attemptSummaryFollowup`'s existing shared call sites. This is deliberately decoupled from the persisted chat log (Addendum S 8.6) rather than attached to individual messages: usage accounting and transcript display are different concerns, and coupling them would make attributing a follow-up call's cost (which never produces its own visible chat message) awkward. A new, minimal table (`usage`: `\{ id, sheetId, inputTokens, outputTokens, createdAt \}`) holds individual records; the displayed total is their sum for the active sheet. Deleting a sheet (Addendum S 8.5) cascades to its usage records too, same as its versions and messages.

### 5.4.2 Two statistics, not one — "Context size" and "Tokens consumed"

The panel now shows both: **Context size** (the existing live estimate, relabeled — still updates in real time as the sheet is edited, before any call is made) and **Tokens consumed** (the new running total of real, provider-reported usage across every call made for this chat). Neither replaces the other. A tooltip on Context size notes what it actually measures — "what gets sent with every message," since §3's full-resend-every-call architecture is a genuinely distinguishing fact worth surfacing, not something to leave implicit.

### Naming note: "Context," not "Chat," size

The estimate reflects the full merged sheet (Addendum T: local chat content *and* the shared global memory pool), not just this chat's own Tone/Conversation Summary/Notes — so it's named "Context size," tying to the panel's own name, rather than "Chat context size," which would imply a narrower scope than what's actually measured. Same precision concern Addendum U's Export/Import relabeling already addressed once.

### Scope: what this doesn't (yet) change

- **No schema change to `Version`/`head`/`versions`/`messages`** — `usage` is a new, independent table, additive only (Dexie schema bump with no upgrade/migration needed, since no existing table's shape changes).

- **Not yet used to trigger anything.** An eventual AI-recommended-compression suggestion (discussed, not built) would key off *Context size* specifically — current bloat, not cumulative historical spend — but that feature remains unbuilt; this addendum only adds the statistics themselves.

- Sheet-editor-mode calls count toward the same sheetId's total as chat-mode calls, since `runCall`/`attemptSummaryFollowup` are already shared across both modes (Addendum D) — no mode-specific accounting.


**Addendum W — The persisted chat log is scoped by mode, not just by sheet (extends Addendum S 8.6)**

Addendum S 8.6 scoped the persisted message log by `sheetId` alone — accurate at the time, since the chat pane was the only surface writing to it. That stopped being true once the sheet-editor (§6.3) gained its own persisted session: both it and the chat pane call the same `useSuggestionSession(mode, sheetId)` hook against the same `sheetId`, and with no field recording which produced a given message, the two shared one undifferentiated log. In practice this meant a suggestion proposed in one surface leaked into the other's rendered view — a chat-originated `tone\_update` would show up as a pending change card in the sheet-editor, and a sheet-editor instruction and its reply would show up inline in the chat transcript, mixed in among real conversation turns.

`PersistedMessage` (and its in-memory counterpart, `SessionMessage`) now carries a `mode: CallMode` field, set once at creation from whichever surface's `useSuggestionSession` call produced it. `loadMessages` filters by both `sheetId` and `mode`, so each surface's session only ever loads and renders its own messages. No schema/version bump: `mode` isn't indexed, just an additional stored field, filtered client-side after the existing `sheetId` index lookup — the same additive-only precedent Addendum V's `usage` table already established. Existing local rows predating this field simply won't match either surface's filter and stop appearing anywhere — the same disposable-test-data treatment Addendum S's own migration note already applied to that generation's schema change.


**Addendum X — Sheet-editor preamble tightened: analysis must land as suggestions, never as prose reciting the sheet (extends §6.3.1, Addendum F 6.3.1)**

Live testing (via Manage with AI, §6.3) surfaced a real failure mode Addendum F's original sheet-editor preamble didn't prevent. Asked to "eliminate all redundancies," the model's entire reply was a numbered prose recap of every conversation turn — each one suffixed with its raw memory id, copied straight out of the serialized sheet. No suggestions were proposed at all. The change cards themselves were never at risk (`describeSuggestionChange` always resolves a suggestion's target to clean label/body text, never a raw id) — this was specifically the free-form conversational text going out unfiltered.

Two things let this happen. First, memory ids are shown in the serialized sheet (`\#\# Memory: \<label\> (id: \<uuid\>)`) so the model can *target* `edit\_memory`/`deactivate\_memory` suggestions precisely — nothing said that's the *only* legitimate use of an id, so the model treated them as ordinary content worth restating. Second, "respond with minimal or no conversational text" was a preference, not a hard constraint — easy to override when a broad instruction (like "eliminate redundancies," which requires reasoning across every turn before anything can be proposed) invites the model to reason out loud instead of silently, then hand back only the result.

The preamble now makes both constraints explicit rather than implicit: analysis happens silently; its result must be expressed as suggestions, not a prose description of what should change; memory ids are explicitly off-limits in reply text; conversational text is capped at one short sentence, reserved for the "no changes warranted" case. No mechanism enforces this beyond the prompt itself — like every other prompt-engineering fix in this spec, it improves the odds, it doesn't guarantee compliance, and only continued live testing (not unit tests, which mock the response) can confirm whether it actually holds up against instructions similarly broad to the one that first exposed the gap.


**Addendum Y — Chat preamble now distinguishes new\_memory from conversation\_summary\_update by content, not just format (extends §6.2, Addendum K)**

A second live-testing finding, same underlying shape as Addendum X's. `conversation\_summary\_update` is already mandatory on every chat turn (Addendum K) — but the preamble's separate, optional permission to propose `new\_memory` for "a durable addition... a fact about the user" didn't say what *isn't* a durable fact. Live testing found the model sometimes proposing a `new\_memory` whose content was really just a recap of the exchange (what was asked, what was answered) — the same content the mandatory update already covers, duplicated into the wrong suggestion type.

That distinction matters architecturally, not just stylistically: `new\_memory` always targets the *global* pool (Addendum T), shared across every chat, while `conversation\_summary\_update` always stays local (`resolveContentChange` in `suggestionAcceptance.ts` — verified by direct code reading before treating this as model behavior rather than a routing bug). A chat-scoped recap misfiled as `new\_memory` doesn't just look redundant, it pollutes every *other* chat's memory pool — precisely the "pool dilution from high-frequency entries" Addendum I built `conversation\_summary\_update` to prevent in the first place, arriving through a different door.

`CHAT\_PREAMBLE`'s guidance on `new\_memory` now states the test directly: it must be a standalone fact that would remain true and useful in a completely different conversation, never a restatement of this one. Same caveat as Addendum X — this is prompt wording, not an enforced constraint, so it improves the odds without guaranteeing the model never blurs the two again.


**Addendum Z — Chat mode auto-applies suggestions, surfaced via toast + a short Undo window (supersedes §6.1, §6.5; extends §4, §6.2, Addendum A 4.1.1)**

Two arguments motivated revisiting "no auto-apply," both worth recording since they're the actual reasoning, not just the conclusion. First, §10's positioning argument conflated the accept/reject gate with auditability — but every suggestion, manually accepted or not, already creates a normal, reversible `Version` (§4.3, §4.4); the gate only ever bought pre-approval, not the audit trail or reversibility, which come from versioning regardless of how a version was created. Second, risk isn't uniform across suggestion types: `conversation\_summary\_update` is mandatory on every turn already (Addendum K), summarizes one exchange the model has fully in context, and is about as reliable as generative tasks get — a categorically lower-stakes case than `new\_memory`/`edit\_memory`/`deactivate\_memory`, which touch the *global* pool (Addendum T) and whose misclassification this same session had just found and fixed twice (Addendum X, Addendum Y).

**Scope: chat mode only.** Sheet-editor mode (Manage with AI, §6.3) is unaffected — `handleAccept`/`handleReject`/`handleRevisionSubmit` still gate everything there exactly as before. Batch/restructuring instructions are exactly the case where a review step still earns its keep, and the motivating "see memories appear ambiently while chatting" value proposition doesn't apply to an occasional, deliberate, multi-change operation the way it does to routine conversation.

### Mechanics

Every suggestion in a chat-mode response applies immediately and sequentially — not in parallel. Each suggestion's apply step re-reads the current head/overlay, so a later suggestion in the same batch needs an earlier one's write to have actually landed first, or it would compute its new version from stale content and silently drop the earlier change. Content-changing suggestion types (`new\_memory`, `edit\_memory`, `tone\_update`, `conversation\_summary\_update`) each create a version exactly as accepting always has (§4.1); overlay-only types (`deactivate\_memory`, `reorder\_pins`) set the overlay exactly as accepting always has (§4.2, Addendum A 4.2.1). Addendum H's failed-target handling is unchanged — an `edit\_memory`/`deactivate\_memory` whose target doesn't exist still fails visibly, now via a toast instead of a status badge on a pending card.

### A new attribution kind, so History stays honest

`VersionAttributionKind` gains `ai\_suggestion\_auto\_applied`, distinct from `ai\_suggestion\_accepted` — both mean genuinely AI-suggested content (`Provenance.source` stays `"ai\_suggested"` either way), the distinction is *how* the version came to exist: an explicit click (sheet-editor mode, still) versus the user's standing configuration that chat mode auto-applies (chat mode, now). §10's auditability claim — "nothing enters the model's context without a visible, reversible decision behind it" — still holds: the decision is now made once, upfront, rather than per instance, but it's still a visible, deliberate decision, and every resulting version is exactly as inspectable and revertible as before.

### Toast + Undo: a short correction window, not a second, parallel undo system

Each applied suggestion may surface a toast (fixed lifetime, `ToastStack` in `Toast.tsx`) naming what happened, with an Undo button while it's showing. `conversation\_summary\_update` deliberately never gets one — mandatory on every turn, a toast for it would fire constantly and say nothing notable; it still applies silently underneath. The other five types do.

Undo's semantics are exactly History's existing "Revert to here" (§4.4), not a new mechanism: content-changing suggestions revert their chain to the version's parent; overlay-only ones restore the prior overlay value directly. Because this app's versioning is strictly linear (§4.4, Addendum A 4.1.1 — "each accept creates its own version... not a merged/batched version"), Undo on an *older* toast — something else already happened to that chain since — discards that later change too, exactly as clicking "Revert to here" on an old version in History already does. This isn't a new limitation Addendum Z introduces; it's the same one History already had, now reachable a second way. Once a toast's fixed lifetime expires, that shortcut is gone — correction from then on goes through History or direct editing in Memories/This Chat, unchanged.

### What this removes from the chat pane

`SuggestionSessionView.tsx`'s Accept/Reject/Edit/Revise-with-AI review UI (built up across several earlier passes this same session) is removed — nothing is ever pending in chat mode anymore, so there's nothing left to review. Each message instead shows a plain, non-interactive record of what was applied (or failed to), so scrolling back through a conversation still shows what happened at each turn without needing a toast (long gone) or a trip to History. `useSuggestionSession`'s `updateSuggestionContent` (the manual-edit mechanism that UI used) is removed as genuinely dead code — nothing calls it once the review UI it served is gone, and Manage with AI never had it.

### What this doesn't fix

This is prompt-independent — unlike Addendum X/Y, nothing here depends on the model behaving a certain way; the client decides to auto-apply regardless of what the model says. What auto-apply can't fix is the model choosing the *wrong* suggestion type or content in the first place — that's what Addendum X and Y address. Auto-apply just removes the human checkpoint that used to catch a misclassification before it landed. That tradeoff was made deliberately, with that exact risk named going in, not overlooked.


**Addendum AA — Chat mode's auto-apply is a setting, not the only option (extends Addendum Z, §9.2)**

Addendum Z made a considered, scoped bet — remove the accept gate from chat mode, keep it in Manage with AI. That bet is still the default. But "no auto-apply" wasn't wrong on its own terms either (§10's positioning argument); it was a different, equally legitimate tradeoff for a user who'd rather review every memory-pool write than accept the toast/Undo correction window as good enough. Rather than pick one globally, the choice is now a per-user setting: `getStoredAutoApply()`/`setStoredAutoApply()` in `settingsStorage.ts`, surfaced as a checkbox in the Settings modal (§9.2), same localStorage-backed, "set once, rarely revisit" tier the API key and model already live in. Default is **on** — Addendum Z's shipped behavior — so nobody's experience changes until they opt out.

### What "off" actually does

Turning it off doesn't touch sheet\_editor mode (Manage with AI) at all — it was never in Addendum Z's scope and stays gated behind manual review unconditionally, exactly as §6.3 always specified. With it off, chat mode's suggestions behave exactly like Manage with AI's always have: `handleAccept`/`handleReject`/`handleRevisionSubmit` (unchanged since before Addendum Z — they never stopped working, chat mode just stopped calling them) leave each suggestion pending until a decision is made. Rather than rebuild the pre-Addendum-Z chat review UI (which had its own inline edit-in-place form, deliberately dropped by Addendum Z as UI serving a mechanism that's now removed), the chat pane reuses `ManageWithAIPanel`'s own `ChangeCard` component outright — extracted into `ChangeCard.tsx` — so a pending suggestion looks and behaves identically whichever surface produced it, per Addendum D's "used identically by both" principle. Revise-with-AI re-aims the chat pane's own input row exactly the way Manage with AI's top field re-aims (label swaps to "How should this change?", Send/Cancel replace the normal composer) rather than opening a separate per-card form — one interaction pattern, not two.

The one real difference from Manage with AI: this is a real transcript, not a one-shot review panel, so a resolved suggestion (accepted, rejected, or revised) doesn't disappear the way an accepted/rejected `ChangeCard` does there — it drops into the same plain historical record (`.chat-applied-list`) Addendum Z already built for the auto-apply case, now also handling "Rejected: …" and "Revised: …" lines it previously never needed to.

### Why a per-message flag, not a live read of the setting

Each `SessionMessage`/`PersistedMessage` carries its own `autoApplied: boolean`, set once when the message is created from whatever the setting read as at that moment — rendering never re-checks the *current* setting for a past message. Without this, toggling the setting mid-conversation would retroactively reinterpret old messages: a suggestion that already auto-applied and resolved to `"accepted"` would, under a live read with the setting now off, get misrendered as if it were a still-interactive pending card (it isn't pending — `"accepted"` just isn't `"pending"`, but a naive "off means show cards for undecided-looking suggestions" rule needs to distinguish *why* nothing decided it yet, not just that nothing has). Recording the decision once, at creation, the same way `VersionAttributionKind` already records *how* a version came to exist rather than re-deriving it, keeps history honest across a setting change the same way Addendum Z's attribution kind keeps it honest across an auto-apply/manual split.


**Addendum AB — A pending conversation\_summary\_update card can be hand-edited directly, not just via Revise with AI (extends Addendum AA, ChangeCard)**

`ChangeCard` (Addendum AA) offered exactly two ways to change a pending suggestion before deciding on it: accept it as-is, or Revise with AI — a full model round trip. For `conversation\_summary\_update` specifically, that's often overkill: the model's summary of a turn is usually close, and a small wording fix doesn't need a second call. `useSuggestionSession` gains `editSuggestionBody(message, index, body)` — the same immutable-update-plus-persist shape as `updateSuggestionStatus`, rewriting a still-pending suggestion's `body` in place, client-side, with no version created until Accept is actually clicked afterward. It's written generically (works on any suggestion type with a plain `body` field: `new\_memory`, `edit\_memory`, `tone\_update`, `conversation\_summary\_update`) rather than special-cased to one type — `resolveContentChange` already treats `body` uniformly across those, so there's no reason `editSuggestionBody` shouldn't.

`ChangeCard` itself is what scopes the *button* to `conversation\_summary\_update` only, not the underlying mechanism — clicking the grayscale pencil (`.icon-button`/`.icon-emoji`, the same treatment as `SheetSwitcher`'s rename, `ChatHeaderTitle`'s rename, and `TurnRow`'s own Edit) swaps the card's after-text for a pre-filled textarea with Save/Cancel, mirroring `TurnRow`'s already-established in-place-edit pattern. Save calls `editSuggestionBody`, which only updates the transcript's copy of the suggestion; the version that actually gets created — if and when Accept is clicked — is computed from the edited text automatically, since `resolveContentChange` always reads from the suggestion object it's handed, not from anything cached at proposal time. `new\_memory`/`edit\_memory`/`tone\_update` don't get the button (yet) — not because the mechanism can't support them, but because nothing has asked for it there yet; extending scope is a `ChangeCard.tsx` one-line change, not a new mechanism, if that changes.


**Addendum AC — Each message's suggestions sit behind a collapsible "N changes" disclosure (extends §6.2, SuggestionSessionView)**

Every applied/pending suggestion under a chat message (Addendum Z's plain applied-list, Addendum AA's pending `ChangeCard`s) rendered unconditionally — fine for one message, but a conversation of any length turned genuinely tall, since almost every turn produces at least a `conversation\_summary\_update`. Each message's suggestions block now sits behind a small "N changes" disclosure toggle, the same rotating-caret language as the Token Estimator's own collapse handle, just an inline text button scoped to one message instead of a full-width panel edge.

**Default is expanded** — unchanged behavior for anyone who hasn't touched the new setting. `settingsStorage.ts` gains `getStoredCollapseSuggestionsByDefault`/`setStoredCollapseSuggestionsByDefault` (Settings modal checkbox, off by default) for anyone who'd rather start collapsed and expand on demand. Independent of that default, any individual message's block can always be collapsed or expanded on its own via its own toggle — the global setting only sets the starting point, it doesn't lock anything.

### Why the default is read live, not captured per message

Addendum AA's `autoApplied` is captured once, at message creation, deliberately — it records something that actually happened (which review mode produced this message), and reinterpreting that later would misrender resolved suggestions as if they were still pending. Collapse state has no such constraint: it's a pure display preference with no data behind it, so `SuggestionSessionView.tsx` reads `getStoredCollapseSuggestionsByDefault()` fresh on every render instead of freezing it per message. Flipping the setting is meant to visibly re-collapse or re-expand every message already on screen, not just change what happens to the next one — the opposite intent from `autoApplied`, so the opposite mechanism.

Per-message overrides live in a plain `Record\<string, boolean\>` in `SuggestionSessionView`'s own component state (`collapsedOverrides`), not persisted — a fresh page load reverts every message to whatever the global default currently says, same as the setting's own "starting point" framing implies. One additional rule: a message whose card is actively being revised (`revising?.messageId === message.id`) always renders expanded regardless of any override or the global default, since collapsing it mid-revision would strand the "Revising — answer above" hint with nothing visible to attach it to.


**Addendum AD — Error and "no changes" responses in Manage with AI can be dismissed (extends §6.3, ManageWithAIPanel)**

`ResponseBlock` already made a change card and a note-alongside-cards disappear once resolved — an accepted/rejected card vanishes, and a note vanishes along with it once every card in that response is decided (the panel's own file-level comment: "no ongoing conversation, no transcript"). Two response shapes never got that treatment: an error (`role === "error"`, e.g. "No API key set") and a suggestion-less "no changes are warranted" reply — neither has a suggestion of its own whose accept/reject would ever clear it, so both simply accumulated in the panel for the rest of the session with no way to remove them.

Both now render a small × dismiss button (`.manage-ai-dismiss`, the same visual language as `.toast-dismiss`) alongside their text. Clicking it adds the message's id to `ManageWithAIPanel`'s own `dismissedIds` (a plain local `Set\<string\>`, not persisted), which `responses` is filtered through before rendering. No new persistence layer was needed: this panel already remounts fresh every time it's opened (`App.tsx` conditionally renders it in place of `SheetSwitcher`), which clears `dismissedIds` for free the same way the rest of the panel's ephemerality already works — consistent with "no transcript," a dismissed response doesn't need to still be un-dismissable after a Back-and-reopen.

An alternative considered was auto-clearing these responses whenever a newer instruction is sent, matching how a resolved card leaves without asking. Rejected in favor of the explicit dismiss button: auto-clearing guesses at when a response has stopped being wanted ("superseded" isn't quite right if the user wants to reread it right after sending the next instruction), where a dismiss button just gives direct control and reuses a pattern (`.toast-dismiss`) already established elsewhere in this app rather than inventing a new implicit rule.


**Addendum AE — The Manage with AI trigger button is a real toggle (extends §6.3, App.tsx)**

The Context header's "Manage with AI" button already looked like a toggle (`.manage-ai-trigger--active` while open) but only ever opened the panel — clicking it again while active was a no-op, and closing required the panel's own Back button or Escape. `onClick=\{() =\> setManageAIOpen(true)\}` in `App.tsx` is now `setManageAIOpen((open) =\> !open)`, and the button gained `aria-pressed=\{manageAIOpen\}` since it's genuinely a two-state toggle now, not just a launcher. No change to `ManageWithAIPanel` itself — Back, Escape, and the trigger all now reach the same `setManageAIOpen(false)`, just with a third way in.


**Addendum AF — Manage with AI's top field: taller, and Go/Send/Cancel share one bottom-right button (extends §6.3, ManageWithAIPanel)**

The top instruction field was a compact, one-line-tall row with the submit button sitting beside it in its own column — the same shape as the chat pane's composer, but this field routinely takes longer instructions ("merge duplicate memories, prune stale ones, adjust tone, reorder pins") than a chat message typically does. It's now a taller field (`rows=\{4\}`, `min-height: 88px`) with its button integrated into the bottom-right corner instead — the exact `.inline-field`/`.inline-field-input`/`.inline-field-button` treatment §5.1's This Chat tab already uses for Tone, Freeform Notes, and the Conversation Summary's "Add entry" field. The field's own label (a full descriptive sentence, not a short field name) stays as `.manage-ai-label` above the field rather than moving into `.inline-field-label`'s small top-left slot, which was sized for short labels like "TONE."

While revising, this also collapses what used to be two buttons (Send and Cancel, shown side by side) into one: the button reads **Send** only when there's a non-empty draft and nothing's already in flight; every other moment — nothing typed yet, or a request currently sending — it reads **Cancel** instead, reusing the same corner slot rather than a second button next to it. Cancel doesn't newly gain the ability to abort an in-flight call (nothing in this app can abort a call already in flight); clicking it just resets the revising UI early, same as it always has — the response still lands as a new pending card whenever it arrives.

One real behavioral tradeoff, deliberately accepted: since Send only shows once the draft is non-empty, there's no way to back out of revising mode by clicking a button while something's typed but not yet sent — only by clearing the field back to empty (which brings Cancel back), switching to revise a different card (which re-aims to the new target), or Escape (which closes the whole panel, a bigger action than just backing out of revising one card). This was chosen over keeping a persistently visible second Cancel button specifically to avoid needing two buttons squeezed into one small corner.


**Addendum AG — The chat pane auto-scrolls to the newest message (extends §6.2, SuggestionSessionView)**

`.chat-messages` was always a scrollable region (§4.4's own e2e coverage confirms a long transcript scrolls internally rather than growing the page), but nothing ever moved that scroll position — a reply landing below the visible area just sat off-screen until manually scrolled to. `SuggestionSessionView.tsx` now scrolls it to the bottom via a `useLayoutEffect` keyed on `messages`, so the jump happens before paint rather than as a visible post-render snap.

The effect only fires when `messages.length` actually grows, not on every `messages` reference change — a suggestion's status flipping (`updateSuggestionStatus`/`editSuggestionBody`, Addendum AA/AB) replaces the array too, but that's an in-place edit to a message already on screen (the one whose card the user just clicked), not new content that needs bringing into view, so it must not yank the scroll position out from under someone reviewing an older card.

Unlike a multi-user chat, this has no "was the user already near the bottom" gate — every length increase here (sending, a reply landing whether auto-applied or manually reviewed, a revision's follow-up, or a sheet's full history loading in on open) is the direct result of an action the current viewer themselves just took, or a chat they just opened. There's no possibility of someone else's message silently arriving mid-read the way a real-time multi-user chat has to guard against, so scrolling unconditionally on every genuine length increase is safe here, not presumptuous.


**Addendum AH — Icon emoji stay full-color; pencils are 📝 (revises §9's `.icon-emoji`)**

`.icon-emoji` applied `filter: grayscale(1)` to every icon-button glyph (the header's gear, every rename pencil, every delete trash can) specifically to keep them visually quiet against an otherwise monochrome-plus-accent UI — documented at the time as a deliberate choice, not an oversight. That filter is removed: icons render in their natural color now, consistent with Accept/Reject (`✅`/`❌` in `ChangeCard`, Addendum AA) staying color the whole time — unlike that pair, which had a real functional reason to stay color-coded (fast decision-scanning in a review UI), this was closer to a pure aesthetic call, made deliberately rather than reversed as a bug fix. Every rename pencil (`SheetSwitcher`, `ChatHeaderTitle`, `TurnRow`) and `ChangeCard`'s conversation-turn Edit button (Addendum AB) also swapped from ✏️ to 📝. The Token Estimator's 🪙 is untouched — it was never using `.icon-emoji`'s grayscale filter to begin with; its own `filter: grayscale(1) sepia(1) saturate(3) hue-rotate(-2deg) brightness(1.15)` re-tints it to match `--gold` exactly, a color-matching mechanism with a different intent entirely, not a desaturation one.


**Addendum AI — MemoryRow's Pin/Edit/Delete are icon-buttons too (extends Addendum AH)**

`MemoryRow` (the Memories tab) was the last holdout still using plain text buttons ("Pin"/"Unpin", "Edit", "Delete") where `TurnRow`, `SheetSwitcher`, and `ChatHeaderTitle` had already moved to `.icon-button`/`.icon-emoji`. Now consistent: 📝 Edit and 🗑️ Delete, plus 📌 Pin/Unpin — the one case where the glyph itself doesn't change between states (there's no widely-recognized distinct "unpinned" pushpin glyph), so a new `.icon-button--active` modifier carries the state signal instead, an accent-colored border when currently pinned, same visual language as `.manage-ai-trigger--active`/`.sheet-panel-tab--active`/`.change-card--revising` — "this is the thing currently on" already reads the same way everywhere else in the app.

Shipped once already silently broken: `.icon-button--active \{ border-color: var(--accent); \}` as a single-class selector (specificity 0,1,0) lost to `.memory-row-actions button`'s class+element rule (0,1,1, setting the full `border` shorthand) — the modifier class was correctly applied to the DOM the whole time, but its one CSS effect never rendered, an inert class with no symptom short of actually comparing computed styles. Fixed with a compound selector, `.icon-button.icon-button--active` (0,2,0), the same fix already applied once before for `.suggestion-actions button` vs `.icon-button` (Addendum AB) — this is evidently a recurring trap in this codebase's CSS (a scoped `\<container\> button` rule outranking a single unscoped modifier class) worth remembering the shape of, not just patching each time it resurfaces. The e2e test added for this now asserts the actual computed `border-color` differs, not just that the class is present, specifically because class-presence alone had already been proven not to catch this.


**Addendum AJ — Renamed: Auditable Context & Memory Methodology (ACM2), formerly Collaborative Context & Memory Management (CCMM)**

By this point in the document, "Collaborative" and "Management" had stopped being the most accurate words for what this project actually is. §10's positioning argument, every `Provenance`/`VersionAttribution` field, and the entire Addendum Z/AA debate over auto-apply — resolved by "auditability comes from versioning, not the accept gate," not by preserving turn-by-turn negotiation — all point to auditability as the property that's actually been load-bearing throughout, more than collaborative back-and-forth has, especially now that auto-apply is the chat-mode default and Manage with AI is the only surface still doing accept/reject/revise on every change. "Methodology" isn't even a new claim — this document's own title already called itself "a legible, stateless-per-call methodology for managing AI context" from the start, so "Management" in the old acronym was arguably the original mismatch.

The acronym compresses "Auditable Context & Memory Methodology"'s two M's the same way `W3C` compresses "World Wide Web"'s three W's — a recognized tech/standards naming convention (same family as `i18n`, `a11y`, `l10n`: a digit standing in for a repeated or elided element, not a version number), chosen deliberately over the literal `ACMM` both to avoid `ACMM`'s awkward run of consonants and because `ACM2` still reads unambiguously once the full name is given alongside it, which it always is in this document, the README, and the app's own header.

Five touchpoints changed, not the whole document: this title, `README.md`'s title and intro, `index.html`'s `\<title\>`, and `App.tsx`'s `\<h1\>`/subtitle. Every other mention of the project throughout this spec's addenda already referred to itself generically ("this app," "this PoC," "the client") rather than repeating the acronym, so nothing else needed touching.


**Addendum AK — Long unbroken text now wraps instead of overflowing its container, everywhere it's rendered (fixes a confirmed real bug)**

Normal word-wrapping only breaks at whitespace — a single long unbroken token (a URL, a long id, a run-on word, anything a model or a pasted message might contain with no convenient space) blew straight through `max-width`/flex constraints wherever this app renders arbitrary user- or model-authored text. Confirmed live before fixing anything, not assumed: a 120-character unbroken string overflowed a chat bubble by roughly 8× its container width (`scrollWidth` 1142px against a 140px `clientWidth`), and the same shape of overflow reproduced independently in the chat pane's applied-suggestion summaries, a pending `ChangeCard`'s diff text, and Manage with AI's "no changes" response.

`overflow-wrap: break-word` now applies wherever this content renders: `.chat-message p` (a user's own plain-text message), `.markdown-text` (inherited down to every model-rendered reply and note, covering `.chat-message--assistant` and Manage with AI's `.manage-ai-note`/`.manage-ai-empty` in one place), `.chat-applied-list`, and `.change-card` (inherited down to `.change-card-before`/`-after`).

Two spots needed more than the CSS property alone, both `display: flex` rows where the text sits beside a button (`.manage-ai-empty`/`.manage-ai-error`, the dismiss button from Addendum AD): a flex item's default `min-width: auto` sizes it to its *unwrapped* content width regardless of `overflow-wrap`, confirmed still overflowing with only the property set and no `min-width: 0` on the actual flex item. `.manage-ai-empty`'s text already had a real child element to target (`.markdown-text`, which picked up its own `min-width: 0`); `.manage-ai-error`'s didn't — its text was a bare child of the flex row, so `ManageWithAIPanel.tsx` now wraps it in its own `\<span className="manage-ai-error-text"\>`, the same shape `.toast-text` already used for exactly this reason.

New `e2e/wordWrap.e2e.mjs` asserts `scrollWidth \<= clientWidth` directly for a deliberately pathological long string in each of the four confirmed spots — this is what actually caught the bug and the `min-width` gap in `.manage-ai-empty` specifically; neither a screenshot nor a text-content assertion would have.


**Addendum AL — Compression recommender: a Settings-gated banner, a new `compress\_conversation` suggestion type, and a `kind: "summary"` memory (extends §5.1, §6, Addendum O, Addendum T)**

An eventual "AI-recommended compression" was discussed but explicitly left unbuilt as far back as Addendum V ("that feature remains unbuilt; this addendum only adds the statistics themselves"). This addendum builds it, arrived at through a design discussion worth recording since the shape changed twice along the way.

**A new `Memory.kind: "summary"`, not a new `Sheet` field.** The first framing considered was replacing all existing conversation turns with one condensed turn — rejected because it forces an all-or-nothing choice: compress everything so far, or leave everything granular, with no way to compress *older* turns while a conversation keeps adding new ones normally. The next framing considered a dedicated new `Sheet` field for the digest — rejected because Addendum O already deliberately moved *away* from dedicated per-purpose fields (`conversationSummary` folded into the unified `Sheet.memories` array with `kind`-based dispatch) specifically to avoid re-introducing that shape. `"summary"` is a third `Memory.kind` alongside `undefined` (ordinary) and `"conversation\_turn"`: local-chain, chronologically ordered like turns (`orderSummaries`, mirroring `orderConversationTurns`), but rendered in its own block — a compressed digest covering many turns isn't itself one more turn, and commingling it into the numbered list would misrepresent what it is.

**Placement: attached to the Token Estimator, not This Chat.** The recommendation's own trigger (Context size) already lives in the Token Estimator, rendered once above the three tabs, tab-agnostic — while what it recommends spans two different tabs (compressing turns lives in This Chat; pruning stale memories lives in Memories). A banner tucked inside This Chat specifically could only ever show half of its own recommendation from a home one level below its own trigger. The compression banner lives in `.token-estimator-content`, beside the two existing stats, appearing only once `getStoredRecommendCompression()` (Settings, default **off** — new feature, off preserves current no-banner behavior, same reasoning as Addendum AC's collapse-by-default toggle) is on and `tokenCount \>= COMPRESSION\_RECOMMENDATION\_THRESHOLD` (3000, a plain tunable constant in `settingsStorage.ts`, not itself a second setting).

**Clicking the banner pre-fills, doesn't send.** It opens Manage with AI (`App.tsx`'s `openManageWithAI(prefill)`, threaded down as `onOpenManageWithAI`) with a composed instruction already in the field — *"Condense the oldest conversation turns into one summary using compress\_conversation, and flag any memories that look redundant or stale using deactivate\_memory."* — but doesn't auto-submit, the same "show before sending" posture Revise with AI's re-aimed field already has. `ManageWithAIPanel` gained an `initialDraft` prop, applied via a mount-only `useEffect` calling `session.setDraft` (safe because this panel remounts fresh every time it's opened — App.tsx conditionally renders it — so there's no risk of a stale prefill re-applying itself over something the user's already typed).

**A new suggestion type, not a batch of existing ones.** `compress\_conversation` (`\{"type": "compress\_conversation", "body": "...", "turnIds": \[...\]\}`) atomically adds the new summary memory *and* deactivates the turns it replaces, as one suggestion, one accept, one version. The alternative — the model proposing one `new\_memory`-shaped add plus N separate `deactivate\_memory`s — was rejected because it splits a single conceptual action into N+1 independently-acceptable suggestions and N+1 History entries, breaking Addendum A 4.1.1's "each accept creates its own version" model in the wrong direction (fragmenting one action, not consolidating one). `resolveContentChange`'s new case fails visibly (returns `null`, same Addendum H posture as `edit\_memory`/`deactivate\_memory` targeting a stale id) only when *none* of the named `turnIds` match an existing turn; a partial match proceeds with whichever do, since there's no precedent elsewhere in this app for rejecting a whole batch over one stale id within it. Deactivated turns keep their original `lastModified` — only `active` flips to `false` — so they stay in their true chronological position, dimmed but visible, never deleted, same visible-and-reversible posture every other deactivation in this app already has. `ChangeCard`'s manual-edit pencil (Addendum AB) now also covers this type, alongside `conversation\_summary\_update` — both are plain condensed-text bodies where a quick wording tweak is worth a shortcut that skips a whole model round trip.

**Two integration points that don't participate in `SheetSuggestion`'s own compile-time exhaustiveness checking, both caught live before shipping, not assumed correct:**

1. `globalMemories.ts`'s `mergeMemoryPools` had a hardcoded `m.kind === "conversation\_turn"` filter on local memories, predating this addendum — silently dropping every `kind: "summary"` memory from the merged sheet used for all rendering and serialization. The write to IndexedDB succeeded; the memory just never appeared anywhere. Fixed by extending the filter to `"conversation\_turn" || "summary"`.

2. `suggestionParser.ts`'s `validateSuggestion` is a runtime type-guard switch, entirely independent of the `SheetSuggestion` TypeScript union it validates against — TypeScript's exhaustiveness checking on the union caught every other file needing a new case (`suggestionChangeDisplay.ts`, `suggestionDisplay.ts`, `suggestionSession.ts`'s `toastTextFor`) as a compile error, but a runtime switch's `default: return null` compiles cleanly with a case silently missing. Without a case for `compress\_conversation`, every model response containing one was discarded *in its entirety* (§6.2.2's "malformed block" rule: one bad element voids the whole array) — confirmed live as a change card that simply never appeared, no error anywhere. Fixed by adding the missing case. Both were found by end-to-end manual verification against a live dev server before writing any automated test, not assumed from reading the diff — worth remembering as a category: this codebase has more than one place representing "the set of suggestion types," and only some of them are TypeScript-checked against each other.

**Manual counterpart.** `addSummary` (`sheetEdits.ts`) and a `NewSummaryForm`/`SummaryRow` pair in `SheetPanel.tsx` (This Chat tab, above the turn list) mirror `addConversationTurn`/`NewTurnForm`/`TurnRow` — a plain typed digest, not tied to deactivating any specific turns, since the turns already have their own active/Delete controls if the user wants those gone too (§6.1: AI-assisted is never the only way to edit anything here).


**Addendum AM — `compress\_conversation` narrated instead of proposed: the model described a compression in prose without ever emitting the suggestion (extends Addendum AL, Addendum X)**

Live use of Addendum AL's banner surfaced a real failure, not a data-layer bug: the user clicked the banner, the model's reply read as if it had already compressed four turns ("Compressed the oldest four turns \[...\] into a single summary; no memories look redundant or stale enough to deactivate"), and the user reasonably believed something had happened. Nothing had — History showed no `compress\_conversation` version was ever created, and `resolveContentChange`'s `compress\_conversation` case (Addendum AL) was independently re-verified live against a 6-turn sheet, correctly deactivating exactly the matched subset and leaving the rest untouched. The bug was never in acceptance; it was that there was never anything to accept.

This is the same failure class Addendum X already named and fixed once for "eliminate redundancies": the model reasoning out loud in prose in lieu of emitting structured suggestions. `SHEET\_EDITOR\_PREAMBLE`'s general constraint ("Keep conversational text to at most one short sentence... its result must be expressed as suggestions... not as prose describing what you found or what should change") didn't hold for `compress\_conversation` specifically — plausibly because the type's own paragraph in `SUGGESTION\_INSTRUCTIONS` explains *when* to propose it but never restates *that a prose description is not a substitute*, and because the banner's own instruction bundled two judgment calls into one sentence ("condense... and flag..."), inviting an explanatory answer covering both.

Two changes, both prompt-only — nothing in `resolveContentChange`, `suggestionParser.ts`, or any other data-layer code needed touching, since that layer was already verified correct:

1. `systemPrompt.ts`'s `compress\_conversation` paragraph gained two sentences: deactivation is stated as automatic and non-optional once accepted ("not a separate judgment call, and there is nothing else to decide or explain about it"), and prose narration is explicitly ruled out as a substitute for the suggestion itself — mirroring Addendum X's "analysis happens silently, its result must land as suggestions" rather than leaving the constraint implicit in the general preamble alone.

2. `SheetPanel.tsx`'s `COMPRESSION\_INSTRUCTION` was split from one compound sentence into two short imperatives — "Use compress\_conversation on the oldest conversation turns. Separately, use deactivate\_memory on any memory that's clearly redundant or stale, if any." — reducing the surface area for an explanatory reply on either half.

No unit or e2e test can verify a real model actually complies with a prompt-only change like this — the existing `compressionRecommender.e2e.mjs` suite already exercises the correct code path with a mocked response and continues to pass unchanged; there's no automated way to assert what a live Claude call chooses to say. Confirmed only that nothing regressed (206 unit tests, 80 e2e tests, clean typecheck) and that the reasoning matches Addendum X's precedent for the same failure shape. Whether this fully prevents recurrence can only be confirmed by further live use, not by this addendum alone.


**Addendum AN — `compress\_conversation` stopped after an arbitrary subset of turns instead of all of them (extends Addendum AL, Addendum AM)**

Addendum AM's fix worked — the model now actually emits `compress\_conversation` instead of narrating it in prose — but the very next live test surfaced a second, distinct failure in the same feature: with 11 conversation turns present, the model's `turnIds` covered only the first four, chronologically. Not a data-layer bug (Addendum AL's `resolveContentChange` case correctly deactivates whichever subset it's given, already re-verified live in Addendum AM); this time the defect was scope, not mechanism — the banner's instruction ("the oldest conversation turns") never gave the model a way to know how many turns "the oldest" meant, so it picked an arbitrary small batch — plausibly the first topically-coherent cluster in the transcript — and stopped, rather than continuing through all of them.

The intended behavior, confirmed with the user: when compression is triggered because context has grown too large, the goal is maximum reduction, not a partial pass — every existing turn should fold into the one summary, none held back as "still too recent." (This was in fact the very first framing considered back in Addendum AL's design discussion, before chronology concerns led to the `kind: "summary"` approach — the "replace everything" intent was always there, it just hadn't survived into the shipped instruction wording.)

Two matching changes, both to the same prompt-only surface as Addendum AM — no `resolveContentChange`/`suggestionParser.ts`/acceptance-logic changes, since a full-scope compression exercises the exact same partial-match-capable code path Addendum AL already built, just with `turnIds` covering every id instead of a subset:

1. `SheetPanel.tsx`'s `COMPRESSION\_INSTRUCTION` now says explicitly: *"condense every existing conversation turn into one summary — all of them, not a subset."*

2. `systemPrompt.ts`'s `compress\_conversation` paragraph gained a rule for the ambiguous case generally, not just the banner's fixed wording (a user could still type their own "compress the older turns" request into Manage with AI or chat): *"When asked to condense all, every, or the oldest turns without a specific number given, turnIds must include every Conversation Summary turn id shown above with no exceptions — do not stop early at an arbitrary subset... If the instruction does name a specific number or range, follow that instead."* — the last clause deliberately preserves the ability to ask for a partial compression (e.g. "compress everything except the last two") by naming a count explicitly, rather than making "all" the only possible scope.

Same caveat as Addendum AM: this is a prompt-only fix to a live-model behavior, unverifiable by unit/e2e tests (206/80 still pass unchanged, typecheck clean) — confirming it holds requires another round of live use, and a third failure mode in this same feature would not be surprising given the pattern so far.


**Addendum AO — `compress\_conversation` summaries lost user/AI attribution (extends Addendum AL, Addendum AM, Addendum AN)**

A third distinct failure surfaced from the same feature, once the prior two were fixed and it actually produced a real, correctly-scoped summary: the resulting `body` was an undifferentiated topic recap — a dense paragraph of subject matter with no indication of which points were the user's questions/positions and which were the AI's replies/explanations. Every ordinary per-turn entry (`conversation\_summary\_update`) is required to say "User asked/said: ...AI replied: ..." (`CHAT\_PREAMBLE`), but `compress\_conversation`'s `body` had no format guidance at all beyond "condensed replacement text" — so nothing steered the model away from erasing attribution once it started condensing several such turns into one. This one matters more than a cosmetic gap: attribution is the thing this methodology's own name centers ("Auditable Context & Memory Methodology"), and losing it in the one place meant to stand in for the turns it replaces undercuts the audit trail the whole app exists to preserve.

Fixed with one more addition to the same `compress\_conversation` paragraph in `systemPrompt.ts`: `body` must keep the user's questions/statements/positions distinguishable from the AI's own replies/explanations/proposals, via natural attributive phrasing at each major point ("user asked about...", "user pushed back that...", "AI proposed...", "AI cautioned that...") — deliberately not full "User:"/"AI:" tags on every clause, which would just reproduce the per-turn format at a larger scale and defeat the point of compressing at all. An undifferentiated topic recap is now explicitly named as unacceptable, the same rhetorical move as Addendum AM's "a prose description is never a substitute for the suggestion itself" and Addendum AN's "do not stop early at an arbitrary subset" — each of this feature's three live-use failures got caught by naming the specific shape of the wrong output and ruling it out explicitly, rather than trusting the general framing to cover it.

Third prompt-only fix in a row for this feature, all to the same paragraph, all found only by actually using it against a real model rather than by reading the code — 206 unit tests and 80 e2e tests continue to pass unchanged since none of them can assert anything about prose the model chooses to write. Worth naming as a pattern at this point: `compress\_conversation`'s correctness has turned out to live almost entirely in prompt wording, not in `resolveContentChange` (verified correct as far back as Addendum AM and untouched since) — each addendum in this run narrowed a different way the model's free-text `body`/`turnIds` output could satisfy the type signature while still being wrong in a way no test catches.


**Addendum AP — `COMPRESSION\_INSTRUCTION` named internal suggestion types in user-facing text (extends Addendum AL)**

`COMPRESSION\_INSTRUCTION` (the banner's pre-filled Manage with AI text) literally said "using `compress\_conversation`" and "using `deactivate\_memory`" — the only place anywhere in the app where an internal `SheetSuggestion.type` value appeared in text a user reads and can send un-edited; everywhere else those identifiers exist only in code comments and `.type ===` checks. A user has no reason to know or care what `compress\_conversation` is; the instruction only needs to describe the outcome.

Considered and rejected: hiding the instruction behind a one-click button that fires the compression call without ever showing the user what's being asked. That would have fixed the jargon at the cost of the thing Addendum AL's pre-fill-not-auto-send design specifically exists to preserve — the user always sees and can edit the literal instruction going to the model, the same "show before sending" posture as Revise with AI. Rewording gets the same outcome (no confusing internal names) without that cost, since the field stays visible and editable either way.

Whether removing the literal type name risks the model failing to invoke `compress\_conversation` was considered directly, given Addendum AM's history with this exact type. The evidence points the other way: the *original* wording already named the type explicitly and the model still failed by narrating in prose (Addendum AM) — naming the type in the user-facing text was never what made invocation reliable. `SUGGESTION\_INSTRUCTIONS`' own trigger condition is written for natural language ("asked to compress, condense, or summarize older turns"), which the reworded instruction still hits via "condense"; and `conversation\_summary\_update` — the only other type that touches conversation turns — is never offered as an option in `sheet\_editor` mode (Manage with AI) in the first place, so there's no type it could be confused with. `COMPRESSION\_INSTRUCTION` now reads: *"Condense every existing conversation turn into one summary — all of them, not a subset. Separately, remove any memory that's clearly redundant or stale, if any."* — same trigger words, same scope-all/attribution rules downstream in `systemPrompt.ts` (untouched, Addenda AN/AO), zero internal vocabulary.

No suggestion/acceptance code changed — this is pure user-facing copy. 206 unit tests and 80 e2e tests still pass; typecheck clean; confirmed live that the pre-filled field no longer matches `/compress\_conversation|deactivate\_memory/`.


**Addendum AQ — History's status word ran straight into a turn's body with no separator, and `kind: "summary"` fell back to a generic label (fixes two confirmed bugs, extends Addendum O, Addendum AL)**

Spotted live in the exact scenario Addendum AL's feature produces: a `compress\_conversation` accept's diff line read *"Deactivated memory User asked: What is umami in cooking? AI replied: ..."* — one flat, unpunctuated string where the status word ("Deactivated memory") ran straight into a turn's body text (which itself always starts with "User asked..."), with nothing marking where one ends and the other begins. `versionDiff.ts`'s `diffSheets` built every line as a single pre-joined `text` string (`\`$\{status\} memory $\{memoryDiffLabel(memory)\}\``), and `VersionHistory.tsx` rendered it as flat text with no markdown support — so there was no way to visually distinguish the two even if the words happened to make the boundary obvious, which "memory User" did not.

`VersionDiffLine` now carries `status` and an optional `detail` as separate fields instead of one string, and `VersionHistory.tsx` renders `\<strong\>\{status\}\</strong\>\{detail && `: $\{detail\}`\}` — bolding alone (the user's first instinct) wouldn't have been sufficient on its own without the colon, since a bolded "Deactivated memory" would still run straight into unbolded "User" with no punctuation between them; the fix needed both.

While in the same function: `memoryDiffLabel` special-cased `kind === "conversation\_turn"` to show the entry's actual text instead of its generic shared label (Addendum O — "every conversation-turn memory shares the same generic label... use the entry text instead, so version history actually distinguishes one turn from another") but was never extended to `kind === "summary"` when Addendum AL introduced it, despite sharing the identical generic `"Conversation Summary"` label. A `compress\_conversation` accept was showing up in History as the unhelpful `Added memory: "Conversation Summary"` instead of the actual condensed digest text — confirmed live, now fixed by extending the same special case to `"summary"`.

Both bugs were caught and re-verified live in the exact accept flow that produces them (a `compress\_conversation` accept, `Manage with AI session` attribution) — reproducing the user's original screenshot precisely and confirming the corrected output: `\*\*Deactivated memory\*\*: User asked: ...` and `\*\*Added memory\*\*: Condensed digest.` (the real body text, not a quoted generic label). 207 unit tests (1 new, plus 8 existing `versionDiff.test.ts` cases updated for the new `status`/`detail` shape) and 80 e2e tests pass; typecheck clean.


**Addendum AR — Collapsible turns/summaries (This Chat) and per-version diff lists (History), targeted at where vertical height actually accumulates (extends Addendum AC)**

Raised as "every individual item everywhere should be expandable/contractable, to deal with vertical height and scrolling fatigue" — narrowed before building anything, since not every content type in this app actually has that problem. Ordinary Memories rows are usually one short fact; History's individual diff *lines* are typically one sentence each. Collapsing those wouldn't meaningfully reduce height and would just add a click to content that was never the source of the fatigue. The two places that demonstrably do accumulate height, confirmed by this session's own screenshots earlier in this conversation: This Chat's turns/summaries (bodies can run to several dense paragraphs) and History's per-version *count* of diff lines (not any single line's length, but how many lines stack up under one version when several things changed at once).

Reuses Addendum AC's collapse-suggestions shape exactly — a global Settings toggle (default off, so nothing changes until opted in) plus a per-item override that always wins regardless of the global default, read live at render time rather than captured once (flipping the setting visibly affects rows already on screen, same reasoning as Addendum AC's own comment on this). Two independent toggles, not one shared: `getStoredCollapseTurnsByDefault`/`getStoredCollapseHistoryByDefault` (`settingsStorage.ts`) — This Chat and History are different surfaces with different content shapes, and collapsing one has no particular bearing on wanting the other collapsed too, consistent with this app's existing pattern of one narrow toggle per concern rather than a shared "collapse everything" switch.

**This Chat**: `TurnRow`/`SummaryRow` each gained a rotating-caret toggle (`.memory-row-collapse-toggle`, same "⌃" disclosure language as `.chat-suggestions-caret`) beside the row's text (`TurnRow`) or its "Summary" label (`SummaryRow`, so the identifying tag stays visible even collapsed). Collapsed state is pure CSS — `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on `.memory-row-body`, truncating to one line without touching the DOM text itself (still fully present, just visually clipped) — no JS string truncation, and `min-width: 0` on the flex item is load-bearing per Addendum AK's already-learned lesson (a flex item sizes to its unwrapped content width regardless of `overflow-wrap`/`text-overflow` without it). `SheetPanel`'s `collapsedRowOverrides` map is shared by both turns and summaries — one map, one setting, since both live in the same This Chat list. Both rows' active-toggle/Edit/Delete controls stay visible regardless of collapse state; only the body text truncates.

**History**: each version entry's `.version-diff` list (previously always rendered in full) now sits behind a `.version-diff-toggle` reading "N change(s)" — same caret language again — collapsed by default only once the setting is on, with `VersionHistory`'s own `collapsedOverrides` map (keyed by `version.id`) providing the same per-item override. The count is always visible whether expanded or collapsed, so a collapsed entry still answers "how much changed here" at a glance.

New `e2e/collapseContent.e2e.mjs` (8 tests): both settings default off; a turn's own toggle collapses/expands it; a summary collapses independently of turns; flipping the global default live-collapses a row/entry already on screen (in its own `withFreshPage` block, deliberately — an earlier draft of this test shared a block with the "own toggle" test and failed, because that test's click-collapse-then-click-expand sequence leaves an explicit per-item override behind, `false`, which correctly wins over the global default per Addendum AC's established semantics; this was the test being wrong, not the code — the same "override always wins" behavior the collapse-suggestions e2e suite already covers separately for exactly this reason); a per-row expand override wins over the collapsed-by-default setting. 207 unit tests (unaffected — this addendum is pure UI, no `Memory`/`Sheet`/suggestion logic touched) and 104 e2e tests (96 prior + 8 new) pass; typecheck clean. Verified visually via live screenshots before writing any test, per this session's established practice — confirmed the collapsed row's height reduction and the caret's rotation match the intended "⌃" disclosure language used everywhere else in the app.


**Addendum AS — `compress\_conversation` can now fold an existing summary into a new one, so compressing repeatedly consolidates instead of accumulating (extends Addendum AL, Addendum AN)**

Raised as a question — "should there only be one summary at a time?" — and confirmed as a real, pre-existing gap on inspection, not a hypothetical: `resolveContentChange`'s `compress\_conversation` case (`suggestionAcceptance.ts`) only ever matched `m.kind === "conversation\_turn"` when resolving `turnIds`, never `m.kind === "summary"`, even though `serializer.ts` already renders existing summaries with their own `(id: ...)` right alongside numbered turns, visible to the model exactly the same way. The practical consequence: compressing once works exactly as designed, but compressing a *second* time later in the same long-running conversation only ever caught turns added since the first pass — the first summary was permanently invisible to the matching logic and stuck around forever. Repeat that cycle across a long conversation (exactly the scenario the compression banner is built for) and summaries accumulate indefinitely, each one stranded, quietly defeating the point of the whole feature over time.

Rejected a hard "only one summary can ever exist" constraint enforced by the data model — that's a rigid singleton shape this app has consistently avoided (Addendum AL already rejected a dedicated single `Sheet` field for the same reason, preferring Addendum O's flexible unified-array-with-`kind` approach). Instead, `compress\_conversation`'s matching now treats `kind === "conversation\_turn"` and `kind === "summary"` as equally foldable — a small `isCompressible` predicate replaces the two inline `m.kind === "conversation\_turn"` checks (`matchedAny` and the `.map` deactivation). This makes "one summary" the common, achievable *outcome* through the same general accept-time mechanism and explicit choice each time, rather than a rule the data model enforces — consistent with this app's standing preference for flexible mechanisms over rigid constraints. No risk of a summary naming itself: the new summary a compression produces always gets a fresh `crypto.randomUUID()`, never reusing an id it supersedes.

Two prompt-side changes so both the banner's canned instruction and a user's own free-form request actually reach for this: the `compress\_conversation` paragraph in `systemPrompt.ts` now states that `turnIds` may name a numbered turn's id or an existing `"\[Summary\]:"` entry's id interchangeably, and that condensing "all/every" turns means every existing summary too, not just numbered ones; `SheetPanel.tsx`'s `COMPRESSION\_INSTRUCTION` now reads *"Condense every existing conversation turn — and any existing summary — into one summary, all of them, not a subset..."* instead of only mentioning turns.

Verification: 2 new unit tests (`suggestionAcceptance.test.ts`) covering a mixed turn+summary `turnIds` list and a summary-only list with no plain turns at all; 1 new live e2e test (`compressionRecommender.e2e.mjs`) that actually compresses twice in sequence — turns one+two into a first summary, two more turns accumulate, then a second compression whose mocked response is built from ids captured out of the real system prompt (the same technique every other test in this file already uses) — confirming the first summary ends up dimmed/inactive (never deleted, same audit posture as a deactivated turn) and a new merged summary is the one that's active. 209 unit tests and 105 e2e tests pass; typecheck clean.


**Addendum AT — Deactivated conversation turns start collapsed by default, independent of the global setting (extends Addendum AR)**

A direct follow-on from Addendum AR: once a turn is deactivated (whether by a `compress\_conversation` accept or otherwise), it's no longer sent to the model at all — kept only for audit — so there's little reason for it to occupy the same vertical space as an active one while the collapse-by-default setting is off. `SheetPanel`'s `isRowCollapsed` now takes the `Memory` itself rather than just its id, and folds in one extra default: `getStoredCollapseTurnsByDefault() || (memory.kind === "conversation\_turn" && !memory.active)`. Per-row overrides still take precedence either way, so a user who wants to keep a specific inactive turn expanded can still pin it open.

Deliberately scoped to turns only, not summaries, matching what was actually asked — a deactivated summary doesn't have the same "superseded by something else already visible right above it" story a compressed-away turn does (the turn it replaced doesn't get shown alongside a competing explanation the way, say, a merged summary supersedes an older one), so summaries keep following the global setting alone, unchanged from Addendum AR. Live-verified before writing a test: a fresh active turn renders expanded (setting off), then a `compress\_conversation` accept against it flips its body straight to the same one-line ellipsis truncation used everywhere else in this feature, with no click required and no effect on the newly-active summary sitting above it.

New tests in `e2e/collapseContent.e2e.mjs` (2): a deactivated turn starts collapsed automatically the moment it's deactivated, confirmed alongside a sibling assertion that the new active summary is unaffected; a per-row expand override still wins even on an inactive turn. 209 unit tests (unaffected — pure UI) and 107 e2e tests (105 prior + 2 new) pass; typecheck clean.


**Addendum AU — `.memory-row-body` missed Addendum AK's overflow-wrap sweep (fixes a confirmed real bug, extends Addendum AK, Addendum AR)**

Spotted live in a real conversation turn: a long unbroken token with no spaces to break at ("contact→feeling→perception→thinking→proliferation") overflowed past its row's right edge instead of wrapping — the exact bug class Addendum AK fixed everywhere it was known to occur at the time. `.memory-row-body` wasn't among those places for a simple reason: it didn't exist yet — Addendum AR introduced it afterward, for This Chat's turn/summary collapse feature, so Addendum AK's sweep couldn't have covered it. Not a regression of the old fix, a genuinely new gap in a container added later.

Same one-line fix as every other spot Addendum AK touched: `overflow-wrap: break-word` added to `.memory-row-body`. The harder half of that original fix — `min-width: 0` on the flex item, without which a flex item sizes to its unwrapped content width regardless of `overflow-wrap` — was already in place here from Addendum AR (needed for the ellipsis truncation, coincidentally the same prerequisite). Confirmed live before and after: `scrollWidth` exceeded `clientWidth` with the original token, reproducing the screenshot's failure mode exactly; after the fix, `scrollWidth === clientWidth` and the token visibly breaks mid-word across multiple lines instead.

New test in `e2e/wordWrap.e2e.mjs` (the same file and `scrollWidth`-vs-`clientWidth` technique every other check in this addendum's coverage already uses, now extended to a fifth surface): confirms a 120-character unbroken token in a conversation turn no longer overflows. 209 unit tests (unaffected) and 108 e2e tests (107 prior + 1 new) pass; typecheck clean.


**Addendum AV — Importing an export into a different, still-existing chat threw `ConstraintError` on every version (fixes a confirmed real bug, extends Addendum S, Addendum U)**

Reported directly: export Context from an existing chat, start a new empty chat, import that file — `versions.bulkAdd(): 13 of 13 operations failed. ConstraintError: Key already exists in the object store.` Reproduced live before touching any code (a 2-version case reproduced the identical error shape) to confirm the mechanism, not just the symptom.

Root cause: `db.ts`'s `versions` table is keyed `"id, sheetId, parentId"` — `id` is a *table-wide* primary key across every sheet sharing the database, not scoped per `sheetId`. `importSheet` (Addendum S) re-stamps `sheetId` onto every imported version but had always kept each version's *original* `id` verbatim, on the assumption that clearing the target sheet's own existing rows first (`db.versions.where("sheetId").equals(sheetId).delete()`) was enough to avoid a collision. That's true only when importing back into the sheet the file was exported *from* — it says nothing about the *source* sheet, which is untouched and still holds those exact same ids if it still exists in the database, exactly the case when duplicating one chat's context into a new one. `bulkAdd` then fails a `ConstraintError` on literally every row, since every id in the file still exists somewhere in the table.

Fix: every version gets a freshly-minted id on import (`crypto.randomUUID()`, the same `generateId()` already used elsewhere in this file), with an id-remap table (`Map\<oldId, newId\>`) keeping each version's `parentId` pointed at the correct *new* id and `headVersionId` remapped the same way — so the imported lineage's shape (parent/child order) is preserved exactly, only the ids themselves change. Scoped entirely to `store.ts`'s `importSheet`; `importSheetWithGlobalPool` (Addendum U) needed no changes since it just calls the now-fixed function twice, once per chain, each minting its own independent fresh ids.

Two existing unit tests in `store.test.ts` asserted imported version ids were preserved verbatim — intentionally no longer true, updated to assert on content/shape instead. Two new unit tests cover the actual regression directly: importing into a different, still-existing sheet no longer throws and leaves the original sheet's own ids completely untouched; a 3-version lineage's parent/child order survives the id remap intact. `e2e/exportImport.e2e.mjs` gained a same-session reproduction of the exact reported scenario — its existing coverage only ever imported into a completely fresh, empty browser context with no shared IndexedDB, which is precisely why this bug was never caught: there's no possible collision when the source sheet doesn't exist in the target database at all. The new test exports from a chat that stays open in the same session, imports into a second chat created alongside it, and confirms both no `ConstraintError` and that the original chat is unaffected. 211 unit tests (2 new) and 110 e2e tests (108 prior + 2 new) pass; typecheck clean.


**Addendum AW — Settings modal didn't scroll and got cut off (fixes a confirmed real bug)**

Reported directly, reproduced live before fixing: at a 900×500 viewport, `.modal`'s content (grown across this session's addenda to five checkboxes plus their hint text, on top of the original API key/model fields) is 648px tall — centered by `.modal-overlay`'s `align-items: center`, with no `max-height` or `overflow-y` anywhere, so the modal simply extended off both the top (title, close button, and API key field cut off above the fold) and bottom (the last checkbox and its hint cut off below) with nothing to scroll either back into view.

`.modal` gained `max-height: calc(100vh - 32px)` (the same pattern its existing `max-width: calc(100vw - 32px)` already used) plus `display: flex; flex-direction: column`, so `.modal-header` (now `flex-shrink: 0`) stays pinned at a fixed position while `.modal-body` becomes the one scrollable region (`overflow-y: auto`). `min-height: 0` on `.modal-body` is load-bearing here for the same reason it's needed on the cross-axis elsewhere in this app (Addendum AK/AR/AU's already-learned min-width lesson, mirrored on the vertical axis this time) — without it, a flex item defaults to its content's full height regardless of the parent's `max-height`, silently defeating `overflow-y`.

Confirmed live before and after at the same 900×500 viewport: before, the modal's bounding rect had `top: -74` and `bottom: 574` against a 500px-tall window; after, `top: 16` and `bottom: 484`, fully within bounds, with the header/close button staying visible and the previously-cut-off last checkbox reachable via `scrollIntoViewIfNeeded()`.

New `e2e/settingsModalScroll.e2e.mjs` (3 tests, a dedicated file since this isn't tied to any one feature): the modal's bounding rect stays within the viewport; the header and close button remain visible even though the body overflows; the last (previously unreachable) setting can be scrolled into view. 211 unit tests (unaffected — pure layout) and 113 e2e tests (110 prior + 3 new) pass; typecheck clean.


**Addendum AX — Removed the manual "Add summary" form (extends, and narrows, Addendum AL)**

Questioned directly: a summary (`kind: "summary"`) is inherently a *condensation* of existing turns — unlike an ordinary memory (a standalone fact only the user could know) or a manually-added turn (backfilling an exchange that happened outside this app), there's no comparable "only the user knows this" case for a summary's own content. Checked before agreeing: `addSummary` (`sheetEdits.ts`) was used *exclusively* by the manual form — the AI-suggested path (`compress\_conversation`) builds its summary directly inside `resolveContentChange` (`suggestionAcceptance.ts`) and never called it — so nothing about the actual compression feature was at risk from removing it.

The one case worth steelmanning — bootstrapping a new chat with a condensed recap of a conversation that happened outside this app — is already fully covered by the existing manual "Add entry" (turn) and "Add memory" forms; a dedicated `kind: "summary"` manual path didn't unlock any capability those don't already have, just a second, narrower-purpose entry point for the same need. Addendum AL's general "AI-assisted is never the only way to edit anything here" principle (§6.1) is satisfied as long as *some* manual path exists for condensed context, not that every `Memory.kind` needs its own bespoke form — removing this one doesn't compromise that principle, since "Add entry" and "Add memory" both still exist.

Removed: `NewSummaryForm` and `handleAddSummary` (`SheetPanel.tsx`), `addSummary` (`sheetEdits.ts`), and their unit tests. `SummaryRow` itself, `orderSummaries`, the `\[Summary\]:` serialization block, and everything about `compress\_conversation` are untouched — a summary can still be edited/deactivated/deleted once it exists, it just can't be *created* by hand anymore. `.new-memory-form`'s CSS stays in place (still used by the Memories tab's own "Add memory" form).

Two e2e tests that exercised `SummaryRow`'s rendering/Edit/Delete/collapse behavior via the now-removed manual button (`compressionRecommender.e2e.mjs`, `collapseContent.e2e.mjs`) were rewritten to produce their summary via a real `compress\_conversation` accept instead — same coverage of the same component, just created through the path that still exists; one of them gained an extra assertion for free (an untouched second turn stays untouched) that the manual-add version couldn't have tested in the first place. 209 unit tests (2 fewer — the removed `addSummary` tests) and 113 e2e tests (unchanged in count, two rewritten) pass; typecheck clean. Confirmed live: the "Add summary" button no longer renders anywhere in This Chat, "Add entry" (turn) is untouched.


**Addendum AY — Reworded "Auto-apply chat suggestions" for clarity (extends Addendum AA)**

Flagged directly: "chat suggestions" is implementation-flavored wording that doesn't clearly convey what actually gets auto-applied. Confirmed it was isolated — the phrase appeared in exactly one place (this setting's label and its two hint-text variants), nowhere else in the UI, so there was no cross-reference to stay consistent with by changing it.

Reworded to **"Auto-apply context updates while chatting"**, for two reasons: it uses "context," the term this app already establishes everywhere else a user encounters it (the Context panel, Export/Import Context), rather than the more internal "suggestions"; and "while chatting" makes explicit a scope that was previously only implicit — this setting governs the ordinary chat flow only, never Manage with AI, which always requires manual review regardless of this toggle. Both hint-text variants were reworded to match ("context updates apply immediately as you chat" / "context updates wait for manual Accept/Reject/Revise").

Pure copy — no behavior changed, `getStoredAutoApply`/`setStoredAutoApply` and everything downstream of the setting untouched. The `aria-label` changed alongside the visible text (screen-reader users see the same wording sighted users do), which meant updating every e2e selector matching the old string: `support.mjs`'s `setAutoApply` helper and `autoApplyToggle.e2e.mjs`'s own default-state check. Two internal code comments elsewhere (`suggestionSession.ts`, `autoApplyToggle.e2e.mjs`'s file header) still say "chat suggestions" as a general descriptive term for the underlying mechanism — left as-is, since they're documentation about the concept, not the UI copy this addendum was about. 209 unit tests (unaffected) and 113 e2e tests pass; typecheck clean. Confirmed live via screenshot.


**Addendum AZ — Fixed 0px gap between History's collapsed diff toggle and "Revert to here" (fixes a confirmed real bug, extends Addendum AR)**

Reported directly, confirmed live via `getBoundingClientRect` before fixing: with a version entry's diff list collapsed (Addendum AR), `.version-diff-toggle` (the "N changes" button) and the "Revert to here" button below it sat with exactly 0px between them — `.version-diff-toggle` only had `margin-top` (separating it from `.version-row-meta` above), and nothing provided space below it when `.version-diff` wasn't rendered in between to supply its own `margin: 6px 0`.

Added `margin-top: 6px` to `.version-row \> button` (the Revert button). Worth noting for future CSS spacing fixes in this codebase: the initial assumption that this would margin-collapse harmlessly with `.version-diff`'s `margin-bottom` when expanded (adjacent block margins take the larger value, not the sum) turned out to be wrong once checked live — `\<button\>` defaults to `display: inline-block`, not `block`, and inline-block boxes don't participate in margin collapsing, so the two margins *add* (12px total in the expanded case) rather than merge. Confirmed that still reads fine, just a little more generous than the 6px gap that was already there before — not a regression, and the actual reported problem (the collapsed case, 0px) is fixed either way.

New test in `e2e/collapseContent.e2e.mjs`: collapses a non-head version's diff list and asserts a real, measured gap (`getBoundingClientRect`, not just a class-presence check) between the toggle and Revert button. 209 unit tests (unaffected) and 114 e2e tests (113 prior + 1 new) pass; typecheck clean. Confirmed live before and after in both the collapsed and expanded states via screenshot.


**Addendum BA — Merged two redundant "don't narrate" sentences in the `compress\_conversation` prompt (extends Addendum AM, Addendum AO)**

Prompted by a broader question about whether `systemPrompt.ts` could be made more minimal, more effective, or both. Read the whole file to answer honestly rather than guess: most of its length is load-bearing scar tissue from specific live-observed failures (Addenda AM/AN/AO/AS), not accidental bloat, and there's real evidence in this exact codebase that collapsing type-specific constraints back into shared, general language *reduces* efficacy — `SHEET\_EDITOR\_PREAMBLE`'s general "no prose, suggestions only" rule already existed before `compress\_conversation` did, and the model still violated it specifically for that type until Addendum AM added an explicit, type-specific restatement. So a broad rewrite was explicitly not recommended.

One narrow exception found by actually reading the `compress\_conversation` paragraph closely: two sentences, added in different addenda (AM and AO) without either being aware of the other, said close to the same thing twice — *"Deactivating the named turns happens automatically and immediately once this suggestion is accepted — it is not a separate judgment call, and there is nothing else to decide or explain about it."* followed immediately by *"Do not describe in your reply text which turns you condensed, what they covered, or whether anything else was left alone — a prose description is never a substitute for the suggestion itself..."* — both are the same "don't narrate, just emit the suggestion" constraint from two different angles. Merged into one sentence: *"Deactivating the named turns happens automatically once this suggestion is accepted — not a separate judgment call, and not something to narrate: do not describe in your reply text which turns you condensed, what they covered, or what was left alone; propose the actual compress\_conversation entry with real turnIds, or propose nothing at all."* No constraint was dropped, just the redundant restart between the two original sentences.

Pure prompt-copy change, sent on every call regardless of mode — no code logic touched. 209 unit tests and 114 e2e tests pass unchanged (nothing asserts on this string's exact wording); typecheck clean. Same caveat as every other prompt-only addendum in this run: no automated test can verify a live model's compliance improved or held steady, only that nothing regressed mechanically.


**Addendum BB — A dismissible one-time welcome explanation for first-time viewers**

Discussed first: whether to add both a short explanation and a full interactive guided tutorial. Recommended against the tutorial specifically — it's a meaningfully bigger undertaking (step-state tracking, coach-marks positioned against a UI that's substantially collapsible/conditional, likely needing seeded demo data to walk through concepts like compression that don't exist in a genuinely empty chat) with no existing pattern in this codebase to build on, for a demo whose audience is more likely technical evaluators than consumers needing hand-holding. The dismissible explanation shipped alone.

`WelcomeModal.tsx` reuses `SettingsModal`'s exact `.modal-overlay`/`.modal` shape rather than inventing a second modal pattern, with a new `.welcome-dismiss` button styled like `.sheet-switcher-new` (the one obvious primary action). Three short paragraphs: what ACM2 is, the two properties that actually matter (inspectable context instead of a hidden system prompt, suggestions reviewed before applying, nothing silently deleted), and a pointer toward This Chat/Memories/History and Manage with AI. Dismissal is permanent — `getStoredWelcomeDismissed`/`setStoredWelcomeDismissed` (`settingsStorage.ts`), the same boolean-localStorage shape as every other flag in that file, deliberately not a Settings toggle since there's nothing to reconfigure and no "show it again" affordance was wanted. Distinct from `README.md`: the README explains the project to someone reading the repo; this explains the running app to someone who's just landed on it without having read that first.

**A real integration risk, caught immediately by running the existing suite, not assumed away**: since this renders unconditionally on every fresh load, it appeared as a blocking overlay in front of *every* existing e2e test's very first action — `multiSheet.e2e.mjs` timed out instantly on `.modal-overlay intercepts pointer events` the moment the whole suite was run. Fixed at the shared harness level rather than touching eleven existing test files individually: `withFreshPage` (`e2e/support.mjs`) now seeds `localStorage` via Playwright's `context.addInitScript` — which runs before the app's own JS, so `getStoredWelcomeDismissed()` already reads `true` on first render — pre-dismissing the modal by default for every spec. A new `skipWelcomeDismiss: true` option opts a test back into real first-load behavior, used only by the new dedicated `e2e/welcomeModal.e2e.mjs` (6 tests: appears on a genuinely fresh load; dismissible via clicking the overlay, the × button, and the Got it button; stays dismissed across a reload; every other spec's default leaves the app immediately usable).

209 unit tests (unaffected) and 120 e2e tests (114 prior, unmodified and still passing, + 6 new) pass; typecheck clean. Confirmed live via screenshot.


**Addendum BC — Welcome modal: tighter paragraph spacing, a "Don't show again" button, and a split between closing and permanent dismissal (extends Addendum BB)**

Three requested changes surfaced a real semantic gap in Addendum BB's original design, not just a UI addition. Adding a distinct "Don't show again" button only makes sense if "Got it" stops meaning the same thing — previously *every* dismissal path (overlay click, ×, Got it) already wrote the permanent `getStoredWelcomeDismissed` flag, so a separate "don't show again" button would have been meaningless next to a "Got it" that already never showed again either. Split into two real behaviors: closing (overlay click, ×, or "Got it") is now component-local state only — hides the modal for this page load, reappears on the next fresh one — and "Don't show again" is the only path that writes to storage and hides it permanently. This gives a first-time viewer who closed it without really reading it a second chance, while still offering an explicit, honest opt-out for anyone who's already seen it.

Paragraph spacing: wrapped the three paragraphs in a `.welcome-text` div rather than leaving them as `.modal-body`'s direct children — `.modal-body`'s `gap: 12px` is shared with `SettingsModal`, where that spacing is still wanted between field rows, so removing it globally wasn't an option; scoping the fix to a wrapper plus `margin: 0` on the paragraphs themselves (removing their own default UA spacing too) collapses the gap to zero without touching Settings.

Copy: the last paragraph now reads "Explore the This Chat, Memories, or History tabs in the Context panel, or try Manage with AI to ask for changes directly" — using the app's actual tab names correctly.

`e2e/welcomeModal.e2e.mjs` was substantially rewritten, not just extended, since the dismissal-persistence behavior it was asserting on actually changed: every "closes it" test now also reloads and confirms the modal *reappears* (the new, correct behavior for a non-permanent close), and a new test confirms "Don't show again" specifically is the one path that survives a reload. 209 unit tests (unaffected) and 120 e2e tests (6 rewritten, same count) pass; typecheck clean. Confirmed live via screenshot — tight paragraph spacing, the two buttons side by side (Got it primary/accent-filled, Don't show again secondary/bordered), and the corrected last paragraph all rendering as intended.


**Addendum BD — Welcome modal: a little paragraph spacing back, and the last paragraph's actual grammar problem fixed (extends Addendum BC)**

Two follow-ups once Addendum BC's result was actually seen. First: zero gap between paragraphs read as too dense once rendered, even though it was the literal request — added back a small, single 8px gap via `.welcome-text p + p \{ margin-top: 8px; \}` (only *between* paragraphs, not above the first or below the last), replacing the flat `margin: 0` that collapsed everything together.

Second: Addendum BC's rewrite of the last paragraph — "Explore the This Chat, Memories, or History tabs..." — was still flagged as ungrammatical, correctly. The actual problem, found by rereading it closely rather than guessing again: "the" directly followed by "This Chat" reads as a double-determiner collision ("the This Chat" — "This" is already doing the job "the" is trying to do), independent of anything about tab names being correct or not. Fixed by dropping the "the ... tabs" construction entirely and returning to Addendum BB's original list shape, restoring "and" for the list (removing a second, redundant "or" the BC rewrite had also introduced alongside "or try Manage with AI"): *"Explore This Chat, Memories, and History in the Context panel, or try Manage with AI to ask for changes directly."*

Pure copy/CSS, no logic touched; nothing in the test suite asserts this string's exact wording. 209 unit tests and 120 e2e tests pass; typecheck clean. Confirmed live via screenshot.


**Addendum BE — The last paragraph's actual, third-time-flagged grammar problem, finally correctly diagnosed (extends Addendum BC, Addendum BD)**

Two prior addenda "fixed" this same sentence and both missed the real problem, because both fixes reasoned about the wrong thing (the "the"/"tabs" wording, then a double-"or") rather than the sentence's underlying structure. The actual issue, found only once pushed to look a third time: *"Explore This Chat, Memories, and History"* uses "This Chat" as a bare list item with no antecedent — read cold, "This Chat" parses as an ordinary demonstrative phrase ("*this* chat," pointing at nothing, since nothing preceding it establishes what "this" refers to), not as a proper tab name, and it breaks the list's grammatical parallelism against "Memories" and "History" (bare nouns, no determiner) regardless. Every earlier fix in this addendum chain kept that same list shape and only adjusted words around it, so the root cause survived two rewrites.

Fixed by restructuring rather than re-wording: name the category before the list, so "This Chat" is unambiguously read as one of a named set rather than a dangling demonstrative. *"The Context panel has three tabs — This Chat, Memories, and History — or try Manage with AI to ask for changes directly."* Establishing "three tabs" first gives every item in the em-dash list, including "This Chat," the same grammatical footing.

Worth naming as a pattern: this is the third addendum in a row about the same sentence, and the first two both patched a symptom (an awkward word, an awkward repeated conjunction) without diagnosing the actual structural cause — a reminder that a sentence flagged as "still doesn't work" after a fix warrants rereading the whole construction, not just adjusting the specific words most recently touched. Pure copy, no logic touched. 209 unit tests and 120 e2e tests pass; typecheck clean. Confirmed live via screenshot.


**Addendum BF (reverted) — CSS transitions were added, then reverted; reasoning kept here since the decision, not just the code, is the part worth recording**

An animation audit (prompted by a direct question about whether one was even feasible) found zero `transition`/`animation` declarations anywhere in the app — every state change across every prior addendum snapped instantly. A first pass added scoped `transition`s (150ms ease, one property each — never a blanket `all`) to the eleven persistent-element state changes where a plain CSS transition actually applies: `.memory-row`, `.manage-ai-trigger`, `.sheet-switcher-item`, `.sheet-panel-tab`, `.change-card`, `.icon-button`, `.version-row`, and four caret-rotation classes. Verified live via `getComputedStyle` against the running app. Deliberately excluded the sidebars/Token Estimator/tab-content, which use `display: none` and can't be transitioned without restructuring the hide mechanism itself.

On reflection, reverted in full (commit `d00e20b`, cleanly undoing `3eecb25`). Two reasons, reached in sequence rather than at once: first, none of it was actually necessary — nothing was broken, and it was pursued only because it was cheap and low-risk, not because the app needed it, unlike the session's actual bug fixes (the compression feature's live-caught failures, the import `ConstraintError`, the Settings modal cutoff), which had real stakes. Second, and the deciding factor: partial coverage had a real coherence cost worse than either extreme. Several animated elements sit directly beside un-animated ones in the *same* interaction — click a collapse toggle and the caret now eases smoothly while the content beneath it (conditionally rendered, Category B) still snaps instantly; click a tab and its underline eases in while the panel below swaps via instant `display: none`. That reads as an oversight, not a choice — worse than uniform snappiness, which is itself a legitimate, intentional-looking stance plenty of technical/dev-tool UIs deliberately take. Extending to Category B to fix the inconsistency was considered and rejected too — real restructuring cost, more mount/unmount timing surface to get wrong, for marginal value even smaller than what the reverted pass delivered, for a PoC whose value proposition is its methodology, not its micro-interactions.

209 unit tests and 120 e2e tests pass (the same 209/120 as before the revert — nothing else changed in between); typecheck clean.


**Addendum BG — The welcome modal now also hosts the Anthropic API key field (extends Addendum BB–BE)**

Raised directly: should the welcome modal include the API key input, so a first-time viewer doesn't discover the requirement by trying to chat and hitting an error? Checked first whether that error path was actually a dead end — it isn't; `suggestionSession.ts`'s `runCall` already catches a missing key and appends a chat message reading "No API key set — add one above," correctly pointing at the header's gear icon. The initial recommendation was against adding the field to the welcome modal specifically, on the grounds that it was deliberately kept passive (explanation only) to avoid drifting toward the guided-tutorial territory already ruled out earlier in this session.

That objection didn't survive being pushed on. The real question isn't "passive vs. interactive," it's whether a first-time viewer's first action in the app should be a failure. A working recovery path is still worse than not needing one — the very first thing a new viewer does, before they've had any chance to see what the app is actually for, currently fails. Re-examined against that framing, the "avoid tutorial scope" objection didn't actually apply here — the tutorial concern was about step-tracking, coach-marks, and seeded demo data, a categorically bigger undertaking than one `\<input\>` bound to state Settings already manages. Added it.

`WelcomeModal.tsx` gained a `.modal-field`-styled input, identical in shape to `SettingsModal`'s own: same `aria-label`, same `type="password"`, same immediate-write-on-change (`getStoredApiKey`/`setStoredApiKey`, no separate "save" step, no new storage key — this is the exact same field, a second entry point onto identical state, not a duplicate). Entering a key here is optional; dismissing without one is still allowed exactly as before, since Settings remains available for anyone who skips it. A hint line underneath states what it's for and that it's optional, mirroring `.modal-field-hint`'s existing pattern in Settings.

Verified live, not assumed: the field starts empty, entering a key here and reopening Settings shows the identical value (confirming shared storage, not a look-alike duplicate), and a subsequent chat send succeeds with no "No API key set" error — the actual failure this addendum exists to prevent, reproduced and confirmed fixed in the same script. New e2e test in `welcomeModal.e2e.mjs` covers the same three assertions. 209 unit tests (unaffected) and 121 e2e tests (120 prior + 1 new) pass; typecheck clean.


**Addendum BH — Widened the welcome modal so its content fits without scrolling (extends Addendum BG)**

Confirmed live before changing anything: at the base 360px width (shared with `SettingsModal`), the welcome modal's body now overflows and requires scrolling below roughly a 650px-tall viewport — Addendum BG's API key field pushed total content past what fit comfortably at ordinary browser heights. A sweep across viewport heights 500–800px measured the exact threshold rather than guessing at it.

Widened to 480px via a new `.modal--welcome` modifier class on top of the shared `.modal` base, rather than changing `.modal` itself — `SettingsModal`'s short labels and inputs don't benefit from the extra width the way three paragraphs of prose do, and there was no reason to widen a modal that wasn't the one with the problem. Confirmed live, same sweep methodology: the same content now fits without scrolling down to roughly a 600px-tall viewport (592px → 522px total height), and `SettingsModal` measured unchanged at exactly 360px, confirming the modifier class didn't leak.

This narrows the scrolling gap but doesn't claim to eliminate it at every conceivable viewport size — genuinely short viewports (under ~600px tall) still scroll, which is Addendum AW's `max-height`/`overflow-y` mechanism correctly doing its job as a fallback, not a bug. New e2e test confirms the welcome modal measures wider than Settings' unchanged 360px. 209 unit tests (unaffected) and 122 e2e tests (121 prior + 1 new) pass; typecheck clean.


**Addendum BI — Model field: a `\<datalist\>`, not a strict `\<select\>`, placed beside the API key in both modals (extends Addendum BG, Addendum BH)**

Raised directly: the Model field is a plain free-typed text input, with no indication of what values are actually valid — shouldn't it be a select? Checked first rather than assuming a strict dropdown was the right shape: `providers/anthropic.ts` forwards whatever string is stored straight to the API with zero validation, so a locked-down `\<select\>` would go stale the moment Anthropic ships a new model, with no code path to use it until someone updates the list — a real cost for a PoC with no one actively tracking Anthropic's model catalog. Used an HTML `\<datalist\>` instead, paired with the existing text input: click-to-see-suggestions like a dropdown, but still lets anyone type a model id newer than the list, so the field's forward-compatibility (today's actual behavior) isn't lost in the process of adding discoverability.

A new `KNOWN\_MODELS` constant in `settingsStorage.ts` — `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`, `claude-fable-5`, in that order (flagship/default first) — is the single source both `SettingsModal` and `WelcomeModal`'s datalists render from, so the two suggestion lists can't drift apart from each other over time.

Layout: API key and Model now sit side by side in both modals, via a new `.modal-field-row` (`display: flex`) wrapping the two `.modal-field` labels, each `flex: 1`. `min-width: 0` on the fields themselves is load-bearing here for the same reason it has been everywhere else in this codebase (Addendum AK/AR/AU/AW's already-learned lesson) — without it, a flex item sizes to its input's natural content width, which could push Model out past the container regardless of the intended even split.

Verified live: both fields render side by side at equal width in both modals (measured via `getBoundingClientRect`, not assumed from the CSS alone), both datalists expose the same four options in the same order, and — mirroring how Addendum BG's API key field was verified — changing the model in the welcome modal and reopening Settings shows the identical value, confirming shared storage rather than a look-alike duplicate field. New dedicated `e2e/modelSelector.e2e.mjs` (5 tests) covers the row layout in both modals, the datalist contents matching `KNOWN\_MODELS` exactly, cross-modal persistence, and that a value outside the list is still accepted (the field's whole reason for being a datalist and not a `\<select\>`). 209 unit tests (unaffected) and 127 e2e tests (122 prior + 5 new) pass; typecheck clean.


**Addendum BJ — The `\<datalist\>` model field was actually broken; replaced with a `\<select\>` + "Other…" escape hatch (fixes a confirmed real bug, extends Addendum BI)**

Reported directly: clicking the Model field's dropdown showed only `claude-sonnet-5`, not all four known models. Addendum BI's own verification had checked that the right `\<option\>` elements existed in the DOM and that the datalist's `id` correctly matched the input's `list` attribute — both true — but never checked how the browser's *native dropdown* actually behaves, which is where the real bug was. A `\<datalist\>` filters its suggestions against whatever the field's *current value* already is; since the field starts pre-filled with a complete, valid value (`claude-sonnet-5`), the browser filtered out every option that doesn't match that string as a substring — which is every other option, since none of them contain "claude-sonnet-5". The dropdown was never broken so much as correctly doing exactly what `\<datalist\>` autocomplete does, which just isn't what a "pick from a list" control needs. A DOM-structure check couldn't have caught this; only actually opening the dropdown would have, and Addendum BI didn't (native dropdown chrome doesn't reliably show up in a screenshot either, part of why this slipped through).

Replaced with a real `\<select\>`, which doesn't have `\<datalist\>`'s filtering behavior — it always lists every `\<option\>` regardless of the current value, which is the actual fix. A plain `\<select\>` alone would reintroduce the exact problem the datalist was chosen to avoid in the first place (Addendum BI: the model string is forwarded to the API with zero validation, so a fixed list goes stale the moment Anthropic ships a new model) — solved with an `"Other…"` option that reveals a plain text input for typing any model id, known or not.

New shared `ModelField.tsx` — both `SettingsModal` and `WelcomeModal` previously each held their own copy of the field's markup and state; extracted once so the two can't drift out of sync the way the bug itself demonstrated they easily could. `.modal-field select` picked up the exact same visual treatment `.modal-field input` already had, so the dropdown reads as one consistent control set with everything around it, not an unstyled native element standing out.

Verified live, reproducing the fix directly: the `\<select\>`'s option list is confirmed to always include all four known models regardless of which one is currently selected (the actual regression this addendum guards against); selecting "Other…" reveals the custom text input; a custom value typed in the welcome modal shows up in Settings with the same "Other…" selection and the same typed value, mirroring how Addendum BG's API key field was verified. `e2e/modelSelector.e2e.mjs` was rewritten (not just extended) to match — 6 tests, including one that explicitly asserts the select's full option list is unaffected by the current value, which is the one thing the previous version of this test suite had no way to catch since it only ever inspected the datalist's DOM structure, never its filtered runtime behavior. 209 unit tests (unaffected) and 128 e2e tests (122 prior + 6 new, replacing the 5 that tested the removed datalist) pass; typecheck clean.


**Addendum BK — Model select was ~5px shorter than the API key input despite identical padding/border (fixes a confirmed real bug, extends Addendum BJ)**

Reported directly. Measured live before guessing at a fix: `getBoundingClientRect` showed the API key input at 37.2px and the Model select at 32px, despite both sharing the exact same `padding: 6px 10px` and `border: 1px solid`. The computed styles showed why — the input had a browser-assigned `line-height: 23.2px` while the select's `line-height` computed to `normal`; a `\<select\>`'s content box doesn't respect `line-height` the way a text input's does, so the two settle at different heights even with identical box-model properties. An explicit `height: 38px` on the shared `.modal-field input, .modal-field select` rule sidesteps the mismatch deterministically, rather than trying to reverse-engineer matching line-heights across two rendering models that don't behave the same way.

Caught before shipping, not after: `.modal-field input` also matches every checkbox input in Settings (Auto-apply, Collapse suggestions, Recommend compression, Collapse turns, Collapse History), and the existing `.modal-field--checkbox input` override only reset `width`/`padding`/`border`/`background` — no `height`. Adding `height: 38px` to the shared rule would have silently inflated every checkbox in Settings to 38px tall. Added `height: auto` to the checkbox override alongside the fix, confirmed live (checkboxes measured 13px, unaffected) rather than assumed safe.

Two existing tests in `e2e/modelSelector.e2e.mjs` gained a height-equality assertion (one per modal) rather than a new test file, since this extends the same "sits beside the API key field" checks that already existed. 209 unit tests (unaffected) and 128 e2e tests (same count, two tests extended) pass; typecheck clean. Confirmed live via screenshot in both modals.


**Addendum BL — Compression recommendation defaults to on; the welcome modal explains it; the modal widened accordingly**

A direct, considered reversal of the previous turn's recommendation. Discussed first: the compression recommender is genuinely one of this app's more heavily-built features (Addenda AL through AS, four rounds of live-caught bugs before the model reliably complied), and hiding a demo's best feature behind an opt-in setting undersells it — worth the tradeoff of breaking a real, consistently-applied precedent (every other recommend/collapse-by-default toggle in this app defaults off). Decided to break it deliberately rather than default-drift into it, and to do all three changes together since they're one coherent decision, not three independent ones.

**Default flip**: `getStoredRecommendCompression` (`settingsStorage.ts`) now reads `localStorage.getItem(...) !== "false"` instead of `=== "true"` — absence reads as on, mirroring `getStoredAutoApply`'s existing shape (Addendum AA) so an existing session that never touched this setting sees the new default rather than being silently exempted from it. `SettingsModal`'s hint text swapped which branch says "(default)" to match.

**Welcome modal sentence**: a fourth paragraph — *"When your context exceeds roughly 3000 tokens, you'll be prompted to compress it in the Token Estimator."* — restoring the exact wording proposed and measured two turns prior, now legitimate to include since it describes default (not opt-in) behavior, resolving the objection that blocked it before.

**Width**: measured live before picking a number, same discipline as Addendum BH's original sizing — the new paragraph pushed the scroll threshold at the existing 480px back up to ~650px (undoing BH's improvement entirely), and a width sweep found 520px restores fitting at a 600px-tall viewport, the same threshold BH originally achieved for three paragraphs. Deliberately not widened further than that (560px was tried and fit even more generously, but wasn't kept) — width has diminishing returns against height, and the existing `max-height`/`overflow-y` fallback (Addendum AW) is the correct backstop for whatever a fixed width doesn't cover, not a reason to keep growing the modal for every future addition.

**Tests**: `e2e/compressionRecommender.e2e.mjs`'s default-state and banner-sequence tests were restructured (not just flipped) to match the new default — a test that used to prove "off by default, banner hidden" now proves "on by default, banner shown," with an explicit off→on→off sequence still covering every state transition the old version did. New test in `e2e/welcomeModal.e2e.mjs` asserts zero scroll overflow at a 600px-tall viewport with all four paragraphs and both fields present — the concrete regression this addendum's width change guards against. 209 unit tests (unaffected) and 129 e2e tests (128 prior + 1 new, plus 3 restructured in place) pass; typecheck clean. Confirmed live via screenshot.


**Addendum BM — Merged the compression sentence into the second paragraph; "Context sheet" reworded to "Context panel" (extends Addendum BL)**

Two follow-ups, raised together: move the compression sentence out of its own paragraph into the end of the "everything the AI knows" paragraph (both are about the same Context panel/Token Estimator relationship, so splitting them read as more separate ideas than they actually were), and reconsider "Context sheet" — checked live rather than assumed: the running app never once says "sheet" anywhere a user can see. `App.tsx`'s panel title reads `\<span\>Context\</span\>`; "Context Sheet" only ever appeared in code comments (internal SPEC vocabulary) and, until this addendum, the welcome modal's own prose. A first-time viewer who read "Context sheet" here would never encounter that term again anywhere else in the app — a real, confirmed inconsistency, not a style nitpick.

Second paragraph now reads: *"Everything the AI knows lives in the Context panel, where you can see, edit, and revert it — nothing is a hidden system prompt. AI-suggested changes are shown before they're applied, and nothing is ever silently deleted: deactivated content stays visible for audit in History. When your context exceeds roughly 3000 tokens, you'll be prompted to compress it in the Token Estimator."* — "Context panel" now also matches the third paragraph's own existing phrasing ("The Context panel has three tabs..."), so the modal uses one consistent term throughout instead of introducing a third variant.

Width was re-measured from scratch for the merged, three-paragraph version rather than assumed unchanged from Addendum BL's 520px — a narrower width was tried first (480px, the pre-BL value) and confirmed still overflowing below ~650px, then 500px confirmed restoring the same ~600px no-scroll threshold Addendum BH originally established, slightly narrower than BL's 520px. `e2e/welcomeModal.e2e.mjs`'s no-scroll test and its title/comment (previously said "four paragraphs") were updated to match the merge. 209 unit tests (unaffected) and 129 e2e tests (same count, one test's assertions/description updated) pass; typecheck clean. Confirmed live via screenshot.


**Addendum BN — Responsive mobile navigation: Chats/Context as full-screen overlays below 1024px (the app's first `@media` rules)**

Raised directly, checked before designing anything: does this app need to be responsive at all? Confirmed live via Playwright rather than assumed — at 375px the fixed-width three-column layout (`.chats-sidebar` 250px + `.chat-column` + `.controls-sidebar` 380px) rendered the page 658px wide inside a 375px window, with the chat input unreachable without horizontal scroll; at 768px there was no overflow, but `.chat-column` was crushed to ~130px with the Send button visibly overlapping the input textarea. Zero `@media` queries existed anywhere in `App.css`'s 1954 lines before this addendum.

**Design, agreed on directly**: at narrow viewports, a "Chats" trigger appears left of the "ACM2" title and a "Context" trigger appears left of the Settings gear, both hidden entirely at desktop widths (pure CSS `display: none` / `inline-flex` toggle, not a `matchMedia`/resize listener — no hydration/timing risk, and JS never needs to know the breakpoint number). Tapping either opens that panel as a full-screen overlay reusing the existing `.modal-overlay` pattern (Settings/Welcome), with a "← Back" button inside matching `ManageWithAIPanel`'s existing convention, and the trigger itself toggle-closes if tapped again while open — mirroring `manageAIOpen`'s existing toggle shape exactly. The edge `‹`/`›` handles are hidden at the same breakpoint, replaced by the header triggers rather than coexisting with them.

**Breakpoint: `1024px`**, derived from the fixed-chrome math (250 + 380 + 28px for two 14px handles = 658px fixed chrome; at 1024px that still leaves 366px for `.chat-column`, versus the already-broken 110px at 768px). No CSS custom property for it — custom properties can't be used inside `@media` feature values — so every narrow-viewport rule lives in one single consolidated `@media` block instead, keeping the literal number greppable in exactly one place.

**The duplicate-mount risk, resolved before writing any component code**: the desktop `\<aside\>` elements stay mounted today (only CSS-hidden via `--collapsed`), so a naive mobile overlay rendering the same `ManageWithAIPanel`/`SheetSwitcher`/`SheetPanel` content independently would produce two live instances of the same component at once — two separate `useSuggestionSession` hooks silently drifting apart. Fixed by extracting the existing per-aside JSX into two new shared components, `ChatsSidebarContent.tsx` and `ContextSidebarContent.tsx`, each accepting an optional `onClose` (present only at the mobile call site, rendering the Back button). The desktop aside's copy and the new mobile overlay are then mutually guarded (`!mobileChatsOpen` / `!mobileContextOpen`) so exactly one instance of each is ever mounted, regardless of which slot it renders into.

**The Manage-with-AI hand-off**: on desktop, "Manage with AI" always renders inside the Chats slot (replacing `SheetSwitcher`), never inside Context. Tapping it from inside the mobile *Context* overlay would break that convention if rendered inline there, requiring a second `ManageWithAIPanel` mount path — instead, `toggleManageAIFromMobileContext` closes the Context overlay and opens the Chats overlay in the same call, so `ManageWithAIPanel` renders exactly where it always has.

**Escape steps back one level, not all the way out**: `ManageWithAIPanel` already has its own `document`-level Escape listener calling `onBack`. The new `MobileChatsOverlay` needed its own too (to close the whole overlay when Manage with AI isn't showing), guarded with `!manageAIOpen` so both listeners registered at once don't both fire on a single keypress — one Escape steps back to the Chats list, a second closes the overlay. `MobileContextOverlay`'s Escape listener is unconditional, since Manage with AI never renders inside it.

**Two real bugs found via live click-through, not spec'd upfront — both in the overlay's own positioning, not the trigger logic**:

1. First attempt kept `.modal-overlay`'s normal `position: fixed; inset: 0` (covering the header too) and gave `.app-header` `z-index: 101` so it would stay on top and remain clickable — reasoning that re-tapping a trigger needed to still work while its overlay was open. That backfired: the overlay's own Back button sits in `.mobile-panel`'s title row, directly under the header in that same top strip, and the higher-z-index header silently intercepted every click meant for it.

2. Second attempt tried leaving `.mobile-overlay`'s `top` unset so `position: absolute` would fall back to its normal-flow "static position" (right after the header in DOM order) — except `.app` is a flex container, and flexbox's static-position algorithm for absolutely-positioned flex children ignores DOM order entirely, resolving to the flex container's own start corner instead — reproducing the exact same header-overlap bug from the opposite direction.

The actual fix: mount `MobileChatsOverlay`/`MobileContextOverlay` *inside* `.app-body` (a sibling of the desktop asides/chat-column, guarded by the same `mobileChatsOpen`/`mobileContextOpen` booleans) rather than as a top-level sibling of the header. `.app-body` already starts right after the header via ordinary document flow, so `.app-body \{ position: relative \}` + `.modal-overlay.mobile-overlay \{ position: absolute; inset: 0 \}` is fully explicit — no static-position fallback involved at all — and can only ever cover `.app-body`'s own box, never the header's. No z-index arms race needed.

**No auto-close on chat selection, no backdrop-click-to-close** — both deliberately dropped, not overlooked. Auto-close on selecting a chat would need new prop-threading through `SheetSwitcher` (chat switching happens inside it directly today, with no callback bubbling to `App.tsx`) for uncertain UX benefit, and matches `ManageWithAIPanel`'s own existing manual-Back-only precedent. Backdrop-click-to-close was dropped because `.mobile-panel` is `width: 100%; height: 100%` of the overlay — there's no visible backdrop gap left to click, so an `onClick` on the outer `.modal-overlay` would be unreachable dead code.

**Side effect confirmed, not separately engineered**: hiding `.chats-sidebar`/`.controls-sidebar` below 1024px gives `.chat-column` the full viewport width, which resolved the 768px Send-button/textarea overlap on its own — confirmed live via screenshot, no dedicated `.chat-input-row` fix needed.

New `e2e/mobileLayout.e2e.mjs` (10 tests) uses real geometry (`getBoundingClientRect`/`scrollWidth`/`getComputedStyle`), not just class-presence, matching this suite's established practice (`wordWrap.e2e.mjs`, `settingsModalScroll.e2e.mjs`): no horizontal overflow at 375px with the chat input reachable; desktop asides genuinely `display: none` (not just visually collapsed) with edge handles hidden too; triggers visible at 375px; open/Back/toggle-close for both overlays with `aria-pressed`/`aria-label` verified; mutual exclusion; the Manage-with-AI hand-off; the two-stage Escape behavior; zero regression at 1200px (triggers hidden, `.chats-sidebar` still measuring ~250px, handle still visible). Triggers are located by container (`.app-header-left` / `.header-icon-buttons`), not by their own `aria-label` — the label text itself flips between "Open chats"/"Close chats" depending on state, which is exactly what these tests exercise, so matching on it would make the locator state-dependent (an early draft of this file did exactly that and every open/close test timed out as a result). One existing test, `e2e/settingsModalScroll.e2e.mjs`, had its viewport width bumped from 900px to 1100px — that test is about a *short* viewport, not a narrow one, but 900px happened to fall under the new 1024px breakpoint and started hiding `.chats-sidebar` (and `.sheet-switcher` inside it) as an unrelated side effect.

209 unit tests (unaffected) and 139 e2e tests (129 prior + 10 new) pass; typecheck clean. Verified live via Playwright screenshots and full click-through at 375px, 768px, and 1200px.


**Addendum BO — Mobile Chats trigger: 💬 emoji instead of the text label (extends Addendum BN)**

Raised directly. The header trigger's visible label swapped from the text "Chats" to a `💬` icon (reusing `.icon-emoji`'s existing sizing, `aria-hidden` since it's decorative), with a new `title="Chats"` for a hover tooltip and the existing dynamic `aria-label` ("Open chats"/"Close chats") left untouched as the button's real accessible name — same pattern the Settings gear button already uses. The Context trigger was left as a text label; only Chats was asked for. No test asserted the button's visible text (`e2e/mobileLayout.e2e.mjs` locates it by container, not label — see Addendum BN), so no test changes were needed. 209 unit tests and 139 e2e tests pass; typecheck clean. Confirmed live via screenshot at 375px.


**Addendum BP — Mobile header shortened to just "ACM2," subtitle hidden (extends Addendum BN)**

Raised directly, with a screenshot: the mobile header looked "really tall." Measured live before proposing a fix rather than guessing — at 375px, `.app-header-titles` had only ~180px available (chat icon + Context/Settings buttons take the rest), not enough for "ACM2: Browser Demo" or the subtitle to fit on one line, so both wrapped to 2 lines each and the header measured 99px tall on a 700px-tall viewport.

Presented three options (shorten title + hide subtitle; hide subtitle only; shrink font sizes only) and the first was chosen. `App.tsx`'s h1 now wraps ": Browser Demo" in its own `\<span className="app-header-title-full"\>`, so "ACM2" (the part that always needs to show) stays a plain, unwrapped text node in the `\<h1\>` while the suffix can be independently hidden. Within the existing consolidated `@media (max-width: 1023px)` block, both `.app-header-title-full` and `.app-header-subtitle` get `display: none` — the subtitle is purely decorative chrome (the Welcome modal already explains what ACM2 is on first load), and the full name still exists in the document `\<title\>` and the Welcome modal, just not repeated in the persistent mobile nav bar.

Verified live: mobile header height dropped from 99px to 58px at 375px, showing just "ACM2" on one line; desktop at 1200px is pixel-identical to before (header still 63px, full "ACM2: Browser Demo" plus subtitle both visible) — confirmed via screenshot at both widths. No test changes needed (`e2e/mobileLayout.e2e.mjs` doesn't assert on title text or header height). 209 unit tests and 139 e2e tests pass; typecheck clean.


**Addendum BQ — Accessibility audit fixes: modal focus management, form labels, landmark structure, and a systemic color-contrast bug**

An audit pass (`@axe-core/playwright` scanning 10 views/states + manual keyboard/focus testing) found five categories of issue, all fixed here. What started as "darken the button purple" turned into a broader fix once the actual scope became clear mid-implementation — documented honestly below rather than only covering what the original report itemized.

**Modal focus management (new `useModalFocus.ts`).** None of the four modal-like surfaces (`SettingsModal`, `WelcomeModal`, `MobileChatsOverlay`, `MobileContextOverlay`) moved focus on open, trapped it while open, or restored it on close — confirmed live: opening Settings left focus on the gear button, Tab escaped into the dimmed page behind it within 4 presses, and closing it dropped focus onto `\<body\>`. One shared hook now handles all four: on open it saves `document.activeElement`, focuses the panel (`tabIndex=\{-1\}` on `.modal`/`.mobile-panel`), and traps Tab/Shift+Tab between the first and last focusable descendants; on close it restores focus to whatever was previously focused. Takes an `open` boolean rather than relying on mount/unmount — `SettingsModal` and the two mobile overlays are only ever mounted while open, but `WelcomeModal` stays mounted for the whole session and just renders `null` internally once dismissed, so the boolean transition is the only signal that works uniformly across all four. Each panel also picked up `role="dialog"` + `aria-modal="true"`, with `aria-labelledby` pointing at the existing modal-header `\<h2\>` for Settings/Welcome, and a direct `aria-label` ("Chats" / "Context" / "Manage with AI") for the two mobile overlays, which don't have a stable heading `id` to point at (their title lives inside the shared `ChatsSidebarContent`/`ContextSidebarContent`, rendered in two places). `ManageWithAIPanel` was deliberately left alone — it's not a modal (no dimmed backdrop, renders inline in the Chats sidebar slot), so dialog semantics don't apply. Verified live: focus moves into Settings on open, 40 Tab presses never escape it, and closing it returns focus to the gear button exactly.

**Missing form labels.** Four fields had a visible label with no programmatic association, plus a fifth found live that the audit's automated pass hadn't happened to exercise: `EditableSection` (Tone/Freeform Notes, now a real `\<label htmlFor\>` + `useId()`-generated `id` instead of a bare `\<span\>`), `NewTurnForm`'s Conversation Summary entry field (its own code comment had assumed the section's `\<h2\>` "covers it" — headings don't give a field an accessible name), `MemoryRow`'s edit-mode label/body fields and the new-memory form's label/body fields (all `aria-label`, placeholder or visible text left as-is), the hidden file input in `ExportImportControls` (`aria-label` plus `tabIndex=\{-1\}`/`aria-hidden`, since it's only ever triggered programmatically via the visible "Import Context" button and was never meant to be tabbed to directly), and — found during live re-verification of the "revising" state, not the original scan — the Manage with AI and main chat instruction textareas, both placeholder-only. All five now carry `aria-label`s that track their own dynamic state (e.g. the chat textarea reads "Chat message" normally, "Describe how this change should be revised" while revising).

**Landmark structure.** `.chat-column` is now a `\<main\>` instead of a `\<div\>` (no CSS changes needed — every rule targeting it is class-based), and both `\<aside\>` sidebars got `aria-label="Chats"`/`aria-label="Context"` so they read as two distinct landmarks instead of two identical unlabeled "complementary" regions.

**Color contrast — bigger than the original report scoped it.** The report called out white text on `--accent` failing on six buttons (~2.64:1 against the required 4.5:1) and stopped there. Fixing it surfaced a second, unrelated, much larger pattern: roughly a dozen secondary-text elements across the app (`.inline-field-label`, `.modal-field-hint`, `.manage-ai-label`, `.manage-ai-empty`, `.manage-ai-note`, `.sheet-section-caption`, `.chat-applied-list`, `.suggestion-status`, `.suggestion-fallback-marker`/`.suggestion-followup-marker`, `.change-card-title`/`.change-card-before`/`.change-card-revising-hint`, `.compression-banner-text`, and `.version-row-meta`) were all dimmed via `opacity: 0.6–0.75` on top of `--text` rather than a real color — opacity always multiplies down whatever contrast the color underneath already had, and `--text`'s own ~7:1 against `--bg` doesn't have enough headroom to survive that. Confirmed via axe re-scan after the button fix alone still showed the same violation class in nearly every view. Elements dimmed the same way but built on `--text-h` instead (`.sheet-panel-tab`, the sidebar edge handles, `.sheet-section h2`, `.toast-dismiss`, `.memory-row-collapse-toggle`, and others) were individually measured live and left alone — `--text-h`'s ~16:1 starting point survives 0.5–0.7 opacity with room to spare, so these were never actually broken despite looking like the same pattern.

Two fixes, not one token:

- `background: var(--accent)` → new `--accent-strong` (`\#835aab` — `--accent`'s own RGB × 0.68, same hue/ratios, not an unrelated color) on the six button classes, keeping white text at ~5.2:1 instead of switching to dark text, since white-on-accent was already a consistent, deliberate pattern used identically everywhere it appeared.

- The dozen `opacity`-dimmed text elements above switched to a new `--text-dim` (`\#848a95`, computed to clear 4.5:1 against both `--bg` and the slightly lighter `--code-bg`, the two backgrounds it actually appears on) via `color`, with the `opacity` property removed rather than zeroed — opacity doesn't inherit or reset the way color does; a child element can never be *more* opaque than its parent's stacking context allows. This is why `.chat-applied-item--failed \{ opacity: 1; \}` and `.suggestion-status--failed` before this fix, plus `.version-current-badge` (nested inside `.version-row-meta`, which had the container-level `opacity: 0.7`), had all been silently broken no-ops or over-dimmed: a failed suggestion's `--error` red, and the "current" version badge's `--accent` purple, were both rendering at a fraction of their intended strength regardless of their own `opacity`/`color` declarations, because an ancestor's opacity had already capped them. Moving the dimming to `color` on the container (or, for `.version-row-meta`, onto `.version-row-meta \> span:not(.version-current-badge)` instead of the container itself) fixes the contrast violation and un-breaks that pre-existing bug at the same time.

**Not in scope, flagged rather than guessed at:** roughly a dozen more `opacity: 0.4–0.85` rules remain in `App.css` — mostly legitimate UI-state dimming (`:disabled` buttons, `.memory-row--inactive`, `.markdown-text blockquote`) rather than the same secondary-text pattern. A few were spot-checked live via a computed-contrast probe and confirmed passing (`.sheet-panel-tab`, `.chats-sidebar-handle`/`.controls-sidebar-handle` at 4.92:1, `.sheet-section h2` at 8.43:1), but not all ~20 original opacity declarations were individually re-verified — the ones fixed here are everything the audit's automated scan plus targeted live re-checks actually confirmed failing, not a blind sweep of every opacity rule in the file.

**Verification.** `@axe-core/playwright` added as a devDependency (installed locally rather than injecting `axe-core` from a CDN into the live page, per direct discussion). Re-scanned all 10 originally-audited views/states plus the Manage with AI and chat-pane "revising" states (not part of the original pass) — zero violations everywhere, down from 2 critical + 1 serious + 2 moderate categories, ~40 nodes total. Focus-trap/restore behavior re-verified live (40-Tab-press trap test, focus-restore-to-trigger test). Screenshots confirmed the new button/text colors read as intentional, not muddy. 209 unit tests (unaffected) and 139 e2e tests (unaffected — no existing test asserted on the removed `opacity` values or the `\<div\>`→`\<main\>` swap) pass; typecheck clean.


**Addendum BR — Visual consistency audit fixes: unified dismiss buttons, button-tier drift, label weight, and two new color tokens**

A second, non-WCAG audit pass — grepping `App.css` for every font-size/padding/border-radius/color value and comparing elements that play the same visual role against each other — found five drifted patterns, all fixed here. Unlike Addendum BQ's accessibility fixes, none of these were binary pass/fail; each is a judgment call about whether elements doing the same conceptual job should look like they belong together, confirmed by measurement (grep + live screenshots) rather than opinion alone.

**Three "×" dismiss buttons unified.** `.modal-close` (Settings/Welcome) was 18px with padding `2px 6px` at full opacity; `.manage-ai-dismiss` and `.toast-dismiss` were already byte-for-byte identical to each other at 16px, `0 2px`, 0.6 opacity — clearly deliberate reuse between those two, which made `.modal-close` read as an accidental third tier rather than an intentional one. `.modal-close` now matches the other two exactly, including a `:hover \{ opacity: 1 \}` brighten it was previously missing entirely.

**Primary filled buttons: 12px → 13px.** `.inline-field-button` (feeds "Save"/"Add entry"/the Manage-with-AI "Go" button) was the only member of the solid-`--accent-strong`-fill, white-text button family running a size smaller than `.welcome-dismiss`/`.sheet-switcher-new`, despite sharing every other property (padding scale, radius, color). Bumped to 13px to match.

**Bordered secondary buttons: `.compression-banner-button` brought up to scale.** Same visual language as `.manage-ai-trigger`/`.mobile-nav-trigger` (border + `--bg` fill + `--text-h` text) but at a visibly denser footprint (`3px 8px` padding, 4px radius, 12px font) with no functional reason for the difference — now `4px 10px`/6px/13px, matching its siblings exactly.

**`.inline-field-label` gained `font-weight: 600`.** Of the eight selectors sharing the "uppercase + `letter-spacing: 0.04em`" eyebrow-label recipe, seven were bold and this one — Tone/Freeform Notes' field captions — was the sole regular-weight outlier despite playing the identical role to (for example) `.conversation-summary-digest-label`. One property added, nothing else changed.

**Two new tokens close the remaining gap in an otherwise well-disciplined color system.** `--on-accent: \#fff` (index.css) replaces six identical `color: \#fff;` declarations across the primary-button family, and `--overlay-bg: rgba(0, 0, 0, 0.4)` replaces `.modal-overlay`'s bare rgba backdrop. Neither was an actual inconsistency in value — all six `\#fff`s already agreed, and the backdrop was only ever defined once — this is pure hygiene: without a token, a future palette change (a second theme, a different accent) wouldn't be caught by search-and-replace on a variable name.

**Verification.** All four layout-sensitive changes (the three button-size bumps, the label weight) confirmed live via screenshot — none overflow their containers or crowd surrounding content; the compression banner's button was specifically hard to reach in the UI (needs a large context) and was screenshotted using the same `conversation\_summary\_update`-with-a-15000-char-body trick `compressionRecommender.e2e.mjs`'s own test already uses to force the threshold. No test assertions referenced the changed pixel values, so no test files needed updates. 209 unit tests and 139 e2e tests pass; typecheck clean.

