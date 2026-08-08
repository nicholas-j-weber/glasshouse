import { useId, useState } from "react";
import { ExportImportControls } from "./ExportImportControls";
import { GLOBAL_MEMORIES_SHEET_ID, mergeMemoryPools } from "./globalMemories";
import { MemoryRow } from "./MemoryRow";
import { orderConversationTurns, orderMemoriesForDisplay, orderSummaries } from "./serializer";
import { addConversationTurn, addMemory, deleteMemory, editFreeformNotes, editMemory, editTone, setPinned } from "./sheetEdits";
import { applyOverlay } from "./sheetOverlay";
import { setOverlay as setSharedOverlay, resetOverlay } from "./sheetOverlayStore";
import { getStoredCollapseTurnsByDefault } from "./settingsStorage";
import { createVersion, ensureInitialized } from "./store";
import { useCollapsedOverrides } from "./useCollapsedOverrides";
import { useHeadVersion } from "./useHeadVersion";
import { useSheetOverlay } from "./useSheetOverlay";
import { VersionHistory } from "./VersionHistory";
import type { Memory, Sheet } from "./types";

// conversation turns and summaries are both local-chain
// (Tone/Conversation Summary/Freeform Notes territory), unlike ordinary
// memories which always target the global pool — used
// wherever a handler needs to route by which chain a memory belongs to.
function isLocalKind(kind: Memory["kind"]): boolean {
  return kind === "conversation_turn" || kind === "summary";
}

// spec.md "Knowledge & Skills" — global-pool like ordinary memories (not
// local-chain), but rendered in LibraryModal.tsx's own Knowledge/Skills
// tabs instead of "Memories" here, so the ordinary-memories list below must
// exclude them too, same exclusion shape as isLocalKind above.
function isKnowledgeKind(kind: Memory["kind"]): boolean {
  return kind === "knowledge" || kind === "skill";
}

// Canonical home for the details sidebar's tab type — App.tsx,
// ContextSidebarContent.tsx, and MobileContextOverlay.tsx all thread this
// through to here, so it lives here rather than duplicated as an inline
// literal union in four places. Knowledge/Skills moved to their own
// LibraryModal.tsx, opened from a header button next to Settings — History
// stays here, per-chat like This Chat/Memories, unlike Knowledge/Skills
// which are global/occasional concerns.
export type SheetPanelTab = "chat" | "memories" | "history";

// The Context Sheet, rendered live. Unlike the chat pane's
// suggestion list, this shows *everything* — including inactive memories
// (excluded from calls, not from the sheet view) — and lets the user
// edit directly, independent of the AI (the suggestion flow is optional,
// not the only way to change the sheet).
//
// ordinary memories live in a second, independent version chain
// (the global pool, shared across every sheet) — this panel reads both and
// merges them for display, but writes to whichever chain a given edit
// actually targets (Tone/Conversation Summary/Freeform Notes stay local;
// ordinary memories always go to the global chain).
//
// Split into "This Chat" (local content) / "Memories" (global pool) /
// "History" (per-chat version log) tabs — activeTab is controlled from
// App.tsx rather than local state, since the header's memories icon needs
// to both open this sidebar and switch its tab from outside it. Every tab's
// content stays mounted regardless of which is active (CSS-hidden, not
// conditionally rendered) so switching tabs can't lose an in-progress edit,
// the same property the sidebar collapse handles already preserve.
// Knowledge/Skills moved out to LibraryModal.tsx instead (global,
// occasional/setup-time concerns, opened from its own header button) —
// History stayed here since it's per-chat like the other two.
export function SheetPanel({
  sheetId,
  activeTab,
  onTabChange,
}: {
  sheetId: string;
  activeTab: SheetPanelTab;
  onTabChange: (tab: SheetPanelTab) => void;
}) {
  const localHead = useHeadVersion(sheetId);
  const globalHead = useHeadVersion(GLOBAL_MEMORIES_SHEET_ID);
  const overlay = useSheetOverlay();
  // per-row override for This Chat's turn/summary collapse —
  // memoryId -> explicit collapsed state, set only once a user manually
  // toggles that row, falling back to a live global default. Shared by
  // turns and summaries — one setting, one map, since both live in the
  // same This Chat list. An inactive conversation turn starts collapsed
  // by default too, independent of the global setting — it's no longer
  // sent to the model at all (kept only for audit), so there's little
  // reason for it to take up the same space as an active one. Scoped to
  // turns specifically, not summaries — a deactivated summary has no
  // equivalent "superseded by something else already visible" story the
  // way a compressed-away turn does, so its collapse state stays governed
  // by the global setting alone.
  const { isCollapsed: isRowCollapsed, toggle: toggleRowCollapsed } = useCollapsedOverrides<Memory>(
    (memory) => getStoredCollapseTurnsByDefault() || (memory.kind === "conversation_turn" && !memory.active),
  );

  if (!localHead || !globalHead) {
    return <div className="sheet-panel">Loading…</div>;
  }

  const sheet = applyOverlay(mergeMemoryPools(localHead.sheet, globalHead.sheet), overlay);

  async function commitLocal(newSheet: Sheet) {
    await createVersion(newSheet, { kind: "manual_edit" }, sheetId);
    resetOverlay(); // Any pending toggle/reorder is now baked into this version
  }

  async function commitGlobal(newSheet: Sheet) {
    await createVersion(newSheet, { kind: "manual_edit" }, GLOBAL_MEMORIES_SHEET_ID);
    resetOverlay();
  }

  async function withCurrentLocalSheet(): Promise<Sheet> {
    const currentHead = await ensureInitialized(sheetId);
    return applyOverlay(currentHead.sheet, overlay);
  }

  async function withCurrentGlobalSheet(): Promise<Sheet> {
    const currentHead = await ensureInitialized(GLOBAL_MEMORIES_SHEET_ID);
    return applyOverlay(currentHead.sheet, overlay);
  }

  function handleToggleActive(memory: Memory) {
    // Manual toggle is session-only, never version-stamped on its own.
    // Pool-agnostic — the overlay doesn't care which chain a memory lives in.
    setSharedOverlay((prev) => ({
      ...prev,
      activeOverrides: { ...prev.activeOverrides, [memory.id]: !memory.active },
    }));
  }

  // Only ever called on ordinary memories — TurnRow has no Pin control
  // (conversation turns are never pinned, 5.1.3), so this always targets
  // the global chain.
  async function handleTogglePin(memory: Memory) {
    const base = await withCurrentGlobalSheet();
    await commitGlobal(setPinned(base, memory.id, memory.pinRank === null));
  }

  async function handleDelete(memory: Memory) {
    if (isLocalKind(memory.kind)) {
      const base = await withCurrentLocalSheet();
      await commitLocal(deleteMemory(base, memory.id));
    } else {
      const base = await withCurrentGlobalSheet();
      await commitGlobal(deleteMemory(base, memory.id));
    }
  }

  async function handleEditMemory(memory: Memory, label: string, body: string) {
    const now = new Date().toISOString();
    if (isLocalKind(memory.kind)) {
      const base = await withCurrentLocalSheet();
      await commitLocal(editMemory(base, memory.id, label, body, now));
    } else {
      const base = await withCurrentGlobalSheet();
      await commitGlobal(editMemory(base, memory.id, label, body, now));
    }
  }

  // Ordinary memories always target the global pool.
  async function handleAddMemory(label: string, body: string) {
    const base = await withCurrentGlobalSheet();
    await commitGlobal(addMemory(base, label, body, new Date().toISOString()));
  }

  async function handleAddConversationTurn(body: string) {
    const base = await withCurrentLocalSheet();
    await commitLocal(addConversationTurn(base, body, new Date().toISOString()));
  }

  async function handleSaveTone(value: string) {
    const base = await withCurrentLocalSheet();
    await commitLocal(editTone(base, value, new Date().toISOString()));
  }

  async function handleSaveFreeformNotes(value: string) {
    const base = await withCurrentLocalSheet();
    await commitLocal(editFreeformNotes(base, value));
  }

  // conversation turns and ordinary memories share Sheet.memories
  // now, distinguished by kind — each section filters to its own subset and
  // orders it with its own rule (chronological vs. pin/recency).
  // Summaries (kind: "summary") get the same treatment as turns — the
  // ordinary-memories filter below excludes both, not just turns, or
  // summaries would otherwise leak into the Memories tab's ordinary list.
  // knowledge/skill entries are excluded too — those render in
  // LibraryModal.tsx's own Knowledge tab, same reasoning as the
  // turns/summaries exclusion.
  const conversationTurns = orderConversationTurns(sheet.memories);
  const summaries = orderSummaries(sheet.memories);
  const orderedMemories = orderMemoriesForDisplay(
    sheet.memories.filter((m) => !isLocalKind(m.kind) && !isKnowledgeKind(m.kind)),
  );

  return (
    <div className="sheet-panel">
      <div className="sheet-panel-tabs">
        <button
          type="button"
          className={`sheet-panel-tab${activeTab === "chat" ? " sheet-panel-tab--active" : ""}`}
          onClick={() => onTabChange("chat")}
        >
          This Chat
        </button>
        <button
          type="button"
          className={`sheet-panel-tab${activeTab === "memories" ? " sheet-panel-tab--active" : ""}`}
          onClick={() => onTabChange("memories")}
        >
          Memories
        </button>
        <button
          type="button"
          className={`sheet-panel-tab${activeTab === "history" ? " sheet-panel-tab--active" : ""}`}
          onClick={() => onTabChange("history")}
        >
          History
        </button>
      </div>

      <div className={`sheet-panel-tab-content${activeTab === "chat" ? "" : " sheet-panel-tab-content--hidden"}`}>
        {/* Conversation Summary first — by far the most dynamically-updated
            field here (grows with nearly every chat turn, per the
            mandatory-proposal rule), unlike Tone/Freeform Notes, which are
            typically set once and rarely revisited. UI display order only;
            the system prompt's section order (Tone, Conversation Summary,
            Memories, Freeform Notes) is fixed independently in
            serializer.ts and unaffected by this. */}
        <section className="sheet-section">
          <h2>Conversation Summary</h2>
          {/* rendered above the numbered turn list, not
              commingled into it — a compressed digest covering many turns
              isn't itself one more turn, and serializer.ts renders them in
              this same order (summaries first) for the same reason. Only
              shown at all once at least one exists — most sheets never
              have any, and an empty "Summaries" heading with nothing under
              it would just be noise. */}
          {summaries.length > 0 && (
            <ul className="memory-list conversation-summary-digests">
              {summaries.map((summary) => (
                <SummaryRow
                  key={summary.id}
                  memory={summary}
                  collapsed={isRowCollapsed(summary)}
                  onToggleCollapsed={() => toggleRowCollapsed(summary)}
                  onToggleActive={() => handleToggleActive(summary)}
                  onDelete={() => handleDelete(summary)}
                  onEdit={(body) => handleEditMemory(summary, summary.label, body)}
                />
              ))}
            </ul>
          )}
          <ul className="memory-list">
            {conversationTurns.map((turn, index) => (
              <TurnRow
                key={turn.id}
                number={index + 1}
                memory={turn}
                collapsed={isRowCollapsed(turn)}
                onToggleCollapsed={() => toggleRowCollapsed(turn)}
                onToggleActive={() => handleToggleActive(turn)}
                onDelete={() => handleDelete(turn)}
                onEdit={(body) => handleEditMemory(turn, turn.label, body)}
              />
            ))}
          </ul>
          <NewTurnForm onAdd={handleAddConversationTurn} />
        </section>

        <EditableSection label="Tone" value={sheet.tone.body} onSave={handleSaveTone} multiline />

        <EditableSection
          label="Freeform Notes"
          value={sheet.freeformNotes}
          onSave={handleSaveFreeformNotes}
          multiline
        />

        {/* Bottom of the tab, not the chat header — reads as "here's what
            to do with everything above" rather than a utility bar
            competing with the actual content for attention. Also the
            historical spot: this is where the old Sheet Editor/History
            toggle row used to sit before both moved elsewhere. */}
        <div className="sheet-panel-footer">
          <ExportImportControls sheetId={sheetId} />
        </div>
      </div>

      <div
        className={`sheet-panel-tab-content${activeTab === "memories" ? "" : " sheet-panel-tab-content--hidden"}`}
      >
        <section className="sheet-section">
          {/* No heading here — the active tab label ("Memories") already
              says what this is; a second "Memories" heading right below it
              was pure redundancy. */}
          <p className="sheet-section-caption">
            Memories are shared across every chat — unlike Tone and Conversation Summary, which are per-chat.
          </p>
          <ul className="memory-list">
            {orderedMemories.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                onToggleActive={() => handleToggleActive(memory)}
                onTogglePin={() => handleTogglePin(memory)}
                onDelete={() => handleDelete(memory)}
                onEdit={(label, body) => handleEditMemory(memory, label, body)}
              />
            ))}
          </ul>
          <NewMemoryForm onAdd={handleAddMemory} />
        </section>
      </div>

      <div className={`sheet-panel-tab-content${activeTab === "history" ? "" : " sheet-panel-tab-content--hidden"}`}>
        <section className="sheet-section">
          <VersionHistory sheetId={sheetId} />
        </section>
      </div>
    </div>
  );
}

function EditableSection({
  label,
  value,
  onSave,
  multiline,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void | Promise<void>;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  // Accessibility audit fix: the visible label below was a bare <span>,
  // never associated with its field — a screen reader announced "edit
  // text, blank" with no indication this was Tone or Freeform Notes.
  // useId() rather than a slugified label avoids any risk of a collision
  // if EditableSection is ever reused with a repeated label.
  const fieldId = useId();

  // Resync when the external value changes (e.g. after this section's own
  // save resolves, or — for Tone specifically — an accepted tone_update
  // suggestion lands from the chat pane while this panel is mounted).
  const [lastSeenValue, setLastSeenValue] = useState(value);
  if (value !== lastSeenValue) {
    setLastSeenValue(value);
    setDraft(value);
  }

  return (
    <div className="inline-field">
      <label className="inline-field-label" htmlFor={fieldId}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={fieldId}
          className="inline-field-input inline-field-input--labeled"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
        />
      ) : (
        <input
          id={fieldId}
          className="inline-field-input inline-field-input--labeled"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <button type="button" className="inline-field-button" disabled={!dirty} onClick={() => onSave(draft)}>
        Save
      </button>
    </div>
  );
}

// Collapsed to a single trigger button until clicked — label/body fields
// don't show at all until the user actually means to add something.
// Clicking it swaps in an editor that deliberately looks like MemoryRow's
// own editing state (same classes: memory-row/memory-row--editing,
// memory-row-actions), so adding and editing a memory read as the same
// interaction rather than two different UI patterns.
function NewMemoryForm({ onAdd }: { onAdd: (label: string, body: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");

  function cancel() {
    setLabel("");
    setBody("");
    setAdding(false);
  }

  if (!adding) {
    return (
      <div className="new-memory-form">
        <button type="button" onClick={() => setAdding(true)}>
          Add memory
        </button>
      </div>
    );
  }

  return (
    <div className="memory-row memory-row--editing">
      <input type="text" aria-label="New memory label" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <textarea aria-label="New memory body" placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
      <div className="memory-row-actions">
        <button
          type="button"
          disabled={label.trim().length === 0 || body.trim().length === 0}
          onClick={() => {
            onAdd(label.trim(), body.trim());
            cancel();
          }}
        >
          Save
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// one block per conversation turn, chronologically ordered,
// individually editable/deactivatable/deletable — the reason numbered
// conversation turns exist as their own row type. Deliberately no Pin
// control: pinning a turn would reintroduce the ordering collision
// avoided by keeping turns off pinRank entirely.
function TurnRow({
  number,
  memory,
  collapsed,
  onToggleCollapsed,
  onToggleActive,
  onDelete,
  onEdit,
}: {
  number: number;
  memory: Memory;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(memory.body);

  if (!editing && bodyDraft !== memory.body) {
    setBodyDraft(memory.body);
  }

  if (editing) {
    return (
      <li className="memory-row memory-row--editing">
        <textarea value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} rows={2} />
        <div className="memory-row-actions">
          <button
            type="button"
            onClick={() => {
              onEdit(bodyDraft);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setBodyDraft(memory.body);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`memory-row${memory.active ? "" : " memory-row--inactive"}`}>
      <div className="memory-row-main">
        <div className="memory-row-body-row">
          <button
            type="button"
            className="memory-row-collapse-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand" : "Collapse"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <span
              className={`memory-row-collapse-caret${collapsed ? "" : " memory-row-collapse-caret--flipped"}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </button>
          <span className={`memory-row-body${collapsed ? " memory-row-body--collapsed" : ""}`}>
            {number}. {memory.body}
          </span>
        </div>
      </div>
      <div className="memory-row-actions">
        <label className="memory-toggle">
          <input type="checkbox" checked={memory.active} onChange={onToggleActive} />
          active
        </label>
        <button type="button" className="icon-button" onClick={() => setEditing(true)} aria-label="Edit" title="Edit">
          <span className="icon-emoji">📝</span>
        </button>
        <button type="button" className="icon-button" onClick={onDelete} aria-label="Delete" title="Delete">
          <span className="icon-emoji">🗑️</span>
        </button>
      </div>
    </li>
  );
}

function NewTurnForm({ onAdd }: { onAdd: (body: string) => void }) {
  const [body, setBody] = useState("");

  return (
    <form
      className="inline-field"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim().length === 0) return;
        onAdd(body.trim());
        setBody("");
      }}
    >
      {/* No visible inline-field-label here — unlike Tone/Freeform Notes,
          this field has no title of its own to move inside (the section's
          "Conversation Summary" heading already covers it visually), so its
          textarea uses the unlabeled variant's normal top padding. That
          heading doesn't give the field an accessible name on its own
          though (accessibility audit finding) — aria-label covers that
          without adding a second visible label the layout wasn't built for. */}
      <textarea
        className="inline-field-input"
        aria-label="New conversation summary entry"
        placeholder="User asked/said: ... AI replied: ..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
      />
      <button type="submit" className="inline-field-button" disabled={body.trim().length === 0}>
        Add entry
      </button>
    </form>
  );
}

// a compressed digest replacing one or more conversation
// turns — same MemoryRow-style edit-in-place/Delete treatment as TurnRow,
// deliberately not TurnRow itself (no "number" — it isn't one more turn,
// and numbering it would misrepresent what it is), with its own small
// label so it reads as a distinct kind of entry even before you notice it
// sits above the numbered list rather than inside it.
function SummaryRow({
  memory,
  collapsed,
  onToggleCollapsed,
  onToggleActive,
  onDelete,
  onEdit,
}: {
  memory: Memory;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onEdit: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(memory.body);

  if (!editing && bodyDraft !== memory.body) {
    setBodyDraft(memory.body);
  }

  if (editing) {
    return (
      <li className="memory-row memory-row--editing">
        <textarea value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} rows={2} />
        <div className="memory-row-actions">
          <button
            type="button"
            onClick={() => {
              onEdit(bodyDraft);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setBodyDraft(memory.body);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`memory-row conversation-summary-digest${memory.active ? "" : " memory-row--inactive"}`}>
      <div className="memory-row-main">
        <div className="memory-row-body-row">
          <button
            type="button"
            className="memory-row-collapse-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand" : "Collapse"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <span
              className={`memory-row-collapse-caret${collapsed ? "" : " memory-row-collapse-caret--flipped"}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </button>
          <span className="conversation-summary-digest-label">Summary</span>
        </div>
        <span className={`memory-row-body${collapsed ? " memory-row-body--collapsed" : ""}`}>{memory.body}</span>
      </div>
      <div className="memory-row-actions">
        <label className="memory-toggle">
          <input type="checkbox" checked={memory.active} onChange={onToggleActive} />
          active
        </label>
        <button type="button" className="icon-button" onClick={() => setEditing(true)} aria-label="Edit" title="Edit">
          <span className="icon-emoji">📝</span>
        </button>
        <button type="button" className="icon-button" onClick={onDelete} aria-label="Delete" title="Delete">
          <span className="icon-emoji">🗑️</span>
        </button>
      </div>
    </li>
  );
}

