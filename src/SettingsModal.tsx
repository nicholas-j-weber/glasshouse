import { useState } from "react";
import { ModelField } from "./ModelField";
import { useDialog } from "./useDialog";
import {
  getStoredApiKey,
  getStoredAutoRunCompression,
  getStoredCollapseHistoryByDefault,
  getStoredCollapseSuggestionsByDefault,
  getStoredCollapseTurnsByDefault,
  getStoredDefaultRoutingMode,
  getStoredRecommendCompression,
  setStoredApiKey,
  setStoredAutoRunCompression,
  setStoredCollapseHistoryByDefault,
  setStoredCollapseSuggestionsByDefault,
  setStoredCollapseTurnsByDefault,
  setStoredDefaultRoutingMode,
  setStoredRecommendCompression,
} from "./settingsStorage";

// API key/model config, moved out of the always-visible header into a
// modal — "set once, rarely revisit" config, unlike the chat/context panels
// which are used constantly (a deliberately different treatment from the
// chats/details sidebars, which stay visible-by-default). This is also
// where later settings land — the collapse-by-default toggle, the
// compression-recommendation toggle, and the This Chat/History
// collapse-by-default toggles.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const [collapseSuggestions, setCollapseSuggestions] = useState(getStoredCollapseSuggestionsByDefault());
  const [recommendCompression, setRecommendCompression] = useState(getStoredRecommendCompression());
  const [autoRunCompression, setAutoRunCompression] = useState(getStoredAutoRunCompression());
  const [collapseTurns, setCollapseTurns] = useState(getStoredCollapseTurnsByDefault());
  const [collapseHistory, setCollapseHistory] = useState(getStoredCollapseHistoryByDefault());
  const [defaultRouting, setDefaultRouting] = useState(getStoredDefaultRoutingMode());
  const dialog = useDialog(onClose);

  return (
    <dialog className="modal" ref={dialog.ref} onClose={dialog.onClose} onClick={dialog.onBackdropClick} aria-labelledby="settings-modal-title">
      <div className="modal-header">
        <h2 id="settings-modal-title">Settings</h2>
        <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close settings">
          ×
        </button>
      </div>
      <div className="modal-body">
        <div className="modal-field-row">
          <label className="modal-field">
            <span>Anthropic API key</span>
            <input
              type="password"
              aria-label="Anthropic API key"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setStoredApiKey(e.target.value);
              }}
            />
          </label>
          <ModelField />
        </div>
        <label className="modal-field modal-field--checkbox">
          <input
            type="checkbox"
            aria-label="Collapse suggestion details by default"
            checked={collapseSuggestions}
            onChange={(e) => {
              setCollapseSuggestions(e.target.checked);
              setStoredCollapseSuggestionsByDefault(e.target.checked);
            }}
          />
          <span>Collapse suggestion details by default</span>
        </label>
        <p className="modal-field-hint">
          {collapseSuggestions
            ? "On: each message's conversation/memory changes start collapsed to a summary — click to expand."
            : "Off (default): changes show in full. Any message can still be collapsed on its own."}
        </p>
        <label className="modal-field modal-field--checkbox">
          <input
            type="checkbox"
            aria-label="Recommend compression when context grows large"
            checked={recommendCompression}
            onChange={(e) => {
              setRecommendCompression(e.target.checked);
              setStoredRecommendCompression(e.target.checked);
            }}
          />
          <span>Recommend compression when context grows large</span>
        </label>
        <p className="modal-field-hint">
          {recommendCompression
            ? "On (default): a dismissible prompt appears once context grows large, offering to compress older turns and prune stale memories — and again at each further interval if dismissed."
            : "Off: no prompt — nothing changes on its own."}
        </p>
        <label className="modal-field modal-field--checkbox">
          <input
            type="checkbox"
            aria-label="Run compression immediately without review"
            checked={autoRunCompression}
            onChange={(e) => {
              setAutoRunCompression(e.target.checked);
              setStoredAutoRunCompression(e.target.checked);
            }}
          />
          <span>Run compression immediately without review</span>
        </label>
        <p className="modal-field-hint">
          {autoRunCompression
            ? "On (default): accepting the compression prompt runs it right away — still a one-click revert away in History if you don't like the result."
            : "Off: accepting the compression prompt opens Manage with AI prefilled instead, so you can review it before it applies."}
        </p>
        <label className="modal-field modal-field--checkbox">
          <input
            type="checkbox"
            aria-label="Collapse conversation turns and summaries by default"
            checked={collapseTurns}
            onChange={(e) => {
              setCollapseTurns(e.target.checked);
              setStoredCollapseTurnsByDefault(e.target.checked);
            }}
          />
          <span>Collapse conversation turns and summaries by default</span>
        </label>
        <p className="modal-field-hint">
          {collapseTurns
            ? "On: This Chat's turns and summaries start collapsed to one line — click any row to expand it."
            : "Off (default): turns and summaries show in full. Any row can still be collapsed on its own."}
        </p>
        <label className="modal-field modal-field--checkbox">
          <input
            type="checkbox"
            aria-label="Default new chats to reasoning routing"
            checked={defaultRouting === "reasoning"}
            onChange={(e) => {
              const mode = e.target.checked ? "reasoning" : "blackbox";
              setDefaultRouting(mode);
              setStoredDefaultRoutingMode(mode);
            }}
          />
          <span>Default new chats to reasoning routing</span>
        </label>
        <p className="modal-field-hint">
          {defaultRouting === "reasoning"
            ? "On: new chats start with the Reasoning toggle selected. Any message can still switch to Blackbox."
            : "Off (default): new chats start with Blackbox — every message can still switch to Reasoning individually."}
        </p>
        <label className="modal-field modal-field--checkbox">
          <input
            type="checkbox"
            aria-label="Collapse History entries by default"
            checked={collapseHistory}
            onChange={(e) => {
              setCollapseHistory(e.target.checked);
              setStoredCollapseHistoryByDefault(e.target.checked);
            }}
          />
          <span>Collapse History entries by default</span>
        </label>
        <p className="modal-field-hint">
          {collapseHistory
            ? "On: each History entry's change list starts collapsed to a count — click to expand."
            : "Off (default): changes show in full. Any entry can still be collapsed on its own."}
        </p>
      </div>
    </dialog>
  );
}
