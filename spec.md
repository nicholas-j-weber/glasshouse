# Glasshouse — Implementation Spec

## Goal

Glasshouse is ACM2's context-sheet methodology plus two additions: a
**reasoning agent** (auditable multi-step reasoning instead of one opaque
completion) and a **code-diff lane** (versioned code changes, tracked
separately from memory/knowledge). Slogan: *minimize your opacity
surface* — shrink where failures can hide, not eliminate black-box
behavior. Every branch, memory, and step input should be logged and
re-runnable in isolation.

This spec covers only what's new. Context-sheet mechanics (memories,
versioning, suggestions, chat) are ACM2 as-is — see `README.md`/`src/`.
The reasoning agent's algorithm is `reasoning-agent`'s `agent.py`/
`spec.md` (sibling project); below covers what ports as-is vs. changes
for the browser.

## The Pass

A **pass** is one chat turn (`PersistedMessage`, `role: "assistant"`)
with up to three lanes, versioned and revertable together — same UX as
ACM2's existing per-sheet version history:

1. **Context-sheet delta** — already built (`Version`, `diffSheets`).
   Present on every pass, possibly empty.
2. **Reasoning trace** — either a full `RunLog` (routed through the
   reasoning agent) or a `blackbox` marker (routed direct). Exactly one
   of the two, always present.
3. **Code diff** — present only if the pass touched code; absent
   (`codeVersionId: undefined`) for pure text-output passes.

```ts
// extends existing PersistedMessage (types.ts)
interface PersistedMessage {
  // ...existing fields...
  routingMode: "reasoning" | "blackbox";
  reasoningRunId?: string;   // set iff routingMode === "reasoning"
  codeVersionId?: string;    // set iff this pass changed code
}
```

## Routing: reasoning vs. blackbox

Per-message **toggle**, not a heuristic — deterministic and visible,
consistent with "minimize opacity surface." Default state configurable
in Settings like the existing auto-apply toggle.

`blackbox` isn't a euphemism — it's the literal fallback label for "no
internal tooling applied," per the original design goal, and must render
a visible `Blackbox` badge on any message with `routingMode: "blackbox"`.
Nothing about it is hidden; it's labeled honestly as unaudited.

## Reasoning agent (port of `agent.py`)

Port `StepRecord`/`RunLog`, `build_prompt`, the fixed-sequence loop,
judge-gated completion (`MIN_STEPS`/`MAX_STEPS`), and `replay_step` to
TS 1:1 — the algorithm doesn't change, only the runtime and persistence.

```ts
type StepRole = "reasoning" | "judge" | "router" | "final";

interface StepRecord {
  runId: string;
  stepId: number;
  role: StepRole;
  instruction: string;
  prompt: string;        // full exact text sent to the model
  rawResponse: string;    // unmodified model output
  timestamp: string;      // ISO 8601
  model: string;
  metadata?: Record<string, unknown>;
}

interface RunLog {
  runId: string;
  sheetId: string;
  chatMessageId: string;
  originalProblem: string;
  topLevelInstructions: string;
  finalAnswer?: string;
  status: "running" | "completed" | "max_steps_reached" | "error";
}
```

Persistence: two new Dexie tables, mirroring JSONL's append-per-step
durability (`db.ts`):

```ts
runs: Table<RunLog, string>;          // "runId"
runSteps: Table<StepRecord, string>;  // "[runId+stepId]", indexed by role
```

Write each `StepRecord` immediately (`db.runSteps.put`) — same "durable
even mid-crash" requirement as the Python spec, and gives the
observability requirements (filter by `role`/`stepId` range, replay a
step) for free via Dexie indexes, no new query layer needed.

**What does not port for v1:**
- `pytest_structural_check` — Python/subprocess-specific, no filesystem
  in-browser. Keep `structuralCheckFn` as a typed extension point,
  nothing wired in by default (same as `agent.py`).
- Dynamic instruction routing / `abandon` branch-back — stretch goal in
  the original spec, stays one here.

Context-sheet integration: the active `Sheet`'s memories serialize into
`topLevelInstructions` — one source of truth, not a duplicate passed to
the agent.

## Knowledge & Skills

Extends `Memory.kind` with two values, both in the existing **global
memory pool** (`GLOBAL_MEMORIES_SHEET_ID`) — not a new entity,
cross-conversation like ordinary memories:

```ts
interface Memory {
  // ...existing fields...
  kind?: "conversation_turn" | "summary" | "knowledge" | "skill";
  moduleId?: string; // groups entries uploaded together as one file/module
}
```

- `"knowledge"` — reference text (facts, docs).
- `"skill"` — an ordered/branching procedure; v1 is prose in `body`
  (numbered steps, branch labels as convention), not a parsed schema.
  Build the structured/executable version once real skills exist to
  learn from.

**Interface:** a new "Knowledge" tab in `SheetPanel.tsx`, alongside
"This Chat" / "Memories" / "History" — separate from "Memories" (facts
persisted across chats) since Knowledge is a distinct, larger reference
library. `skill` and `knowledge` entries render together in one list,
badge-distinguished — same pattern "This Chat" already uses for
`conversation_turn`/`summary` within one view. Add plain substring
search over label/body; add a real index only if the library outgrows
scrolling.

**Acceptance:** file upload, not chat suggestions. `Provenance.source`
gains `"file_upload"`. An uploaded file becomes a `Memory` (`kind:
"knowledge"`/`"skill"`, `body` = file content, `moduleId` = filename),
landing as a new global-chain version directly — no accept/reject, same
as whole-sheet import today. Upload control lives in the Knowledge tab,
not Export/Import Context.

**Modules:** `moduleId` groups one upload's entries so the whole module
can be bulk-toggled `active` — reuses the existing per-memory flag, no
new mechanism.

**Retrieval: wholesale inclusion, not RAG.** `topLevelInstructions`
already concatenates active/pinned memories into every step's prompt
(`agent.py`'s `build_prompt` runs every step, not just the final one);
knowledge/skill entries serialize the same way. No embeddings/chunking/
similarity search in v1 — a retrieval scorer silently deciding what the
model sees is itself an opacity source, and wholesale inclusion is more
auditable as long as content fits in context.

**Future path (not v1):** a module exceeding context is the trigger for
real RAG — chunking + an embeddings provider (Voyage AI, client-side
like the existing Anthropic calls) + brute-force cosine similarity in
IndexedDB. If built, retrieval must log as its own step (`role:
"retrieval"` — chunks, module, score), never silent injection.

## Code-diff lane

No real git — browser-only, no filesystem (existing, deliberate ACM2
constraint). Reuses the *pattern* ACM2 already has for `Sheet`
versioning (parent-linked chain + head pointer), applied to code text
instead of memory objects:

```ts
interface CodeVersion {
  id: string;
  sheetId: string;
  parentId: string | null;
  createdAt: string;
  chatMessageId: string;
  files: Record<string, string>; // path -> full content, snapshot not patch
}
```

```ts
codeVersions: Table<CodeVersion, string>;
codeHead: Table<HeadRecord, string>; // reuse existing HeadRecord shape
```

Diff computed on demand between a version and its parent (same
"compute, don't store" note as `diffSheets`), using the `diff` package
(Myers diff — worth the one new dependency; not a few lines to hand-roll
correctly). New file `codeDiff.ts`:

```ts
function diffCode(parent: CodeVersion | null, version: CodeVersion): FileDiff[];
```

**Rule:** a coding pass's chat-visible reply must not repeat code
inline — reference the diff instead (e.g. "see diff v3"). Reason: chat
text is what `conversation_summary_update` compresses (lossily); keeping
code only in `CodeVersion` excludes it from that pathway by
construction, rather than hoping the summary preserves it.

## Non-goals (v1)

- Not optimizing token/cost efficiency — inherited from the reasoning
  agent's non-goal; context grows with step count by design.
- Not real git — no filesystem in a browser-only app; a real requirement
  here implies a backend/CLI component, out of scope for this skeleton.
- Not eliminating model bias — relocating it into visible prompt
  templates/step sequencing, same as the Python spec's stance.
- Not RAG — no embeddings, chunking, or similarity search in v1.
  Knowledge/skills are included wholesale, same mechanism as memories.
- Not a parsed/executable skill schema — v1 skills are structured prose
  by convention, not data a program branches on.

## Milestones

1. Extend `PersistedMessage`, add `runs`/`runSteps`/`codeVersions`/
   `codeHead` Dexie tables (schema-only, no behavior yet).
2. Port `agent.py`'s core loop to TS (`reasoningAgent.ts`) with a unit
   test mirroring `_demo`/`_demo_observability` (transcript-superset
   assertion, `MIN`/`MAX_STEPS` bounds, replay round-trip).
3. Wire the per-message routing toggle; render `Blackbox` badge for
   direct-routed passes.
4. Wire reasoning-routed passes into the chat pane: expandable step
   trace per message, using the reasoning module from (2).
5. Add `codeDiff.ts` + `CodeVersion` chain; render a diff view per pass
   that has one.
6. Enforce the "diff, not inline code" rule in the system prompt /
   suggestion parser for coding passes.
7. Extend `Memory.kind` with `"knowledge"`/`"skill"`, add `moduleId`;
   extend `Provenance.source` with `"file_upload"`.
8. Add the "Knowledge" tab to `SheetPanel.tsx`: unified list (badge-
   distinguished by kind), substring search, bulk module toggle, upload
   control.
9. Confirm active knowledge/skill entries flow into
   `topLevelInstructions` through the same serialization path ordinary
   memories already use — no separate integration point.
