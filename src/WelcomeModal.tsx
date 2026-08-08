import { useState } from "react";
import { ModelField } from "./ModelField";
import { getStoredApiKey, getStoredWelcomeDismissed, setStoredApiKey, setStoredWelcomeDismissed } from "./settingsStorage";
import { useDialog } from "./useDialog";

// a one-time explanation for a first-time viewer of the
// running app — distinct from README.md, which explains the project to
// someone reading the repo, not someone who's just landed on the live
// demo. Reuses SettingsModal's exact .modal <dialog> shape for
// visual consistency rather than inventing a second modal pattern.
//
// Two distinct dismissals, not one: closing (overlay click, ×, or "Got
// it") only hides it for this page load — component-local state, nothing
// written to storage, so it reappears on the next fresh load same as
// before. "Don't show again" is the only path that writes
// getStoredWelcomeDismissed/setStoredWelcomeDismissed and hides it for
// good. Every dismissal used to be treated as permanent;
// splitting these gives a first-time viewer who just closed it without
// really reading it a second chance next time, while still offering an
// explicit opt-out for anyone who's already seen it.
//
// also hosts the same API key field SettingsModal has —
// same aria-label, same immediate-write-on-change pattern, same
// getStoredApiKey/setStoredApiKey, just a second entry point onto
// identical state (there's no separate "welcome" key). Without this, a
// first-time viewer's first action in the app was trying to chat and
// getting an error ("No API key set — add one above") — a working
// recovery path, but still a failure-first experience for the one thing
// nearly every viewer needs to do before anything else works. Entering a
// key here is optional — dismissing without one is still allowed, same
// as before, since Settings remains available for anyone
// who skips this.
//
// Model sits beside the API key here too, same
// .modal-field-row layout as SettingsModal. Both now share
// ModelField.tsx (a <select> with an "Other…" escape hatch), replacing a
// <datalist>-backed input that turned out to be broken on inspection.
//
// The explanation paragraphs that used to sit above the API key/model
// fields (what Glasshouse is, how the Context panel works, compression)
// are removed for now — API key/model setup is what actually blocks a
// first-time viewer from doing anything, so that's what's left here.
export function WelcomeModal() {
  const [closed, setClosed] = useState(false);
  const [dismissedPermanently, setDismissedPermanently] = useState(getStoredWelcomeDismissed());
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  // Called once on mount (like SettingsModal) — this component stays
  // mounted for the whole session, but once closed/dismissedPermanently it
  // returns null below and never renders the <dialog> again, so there's no
  // second open to wire up. Escape now closes this too (previously
  // unhandled — this component never had useEscapeKey), same as every
  // other native <dialog> gets for free.
  const dialog = useDialog(() => setClosed(true));

  if (closed || dismissedPermanently) return null;

  function dismissPermanently() {
    dialog.close();
    setStoredWelcomeDismissed(true);
    setDismissedPermanently(true);
  }

  return (
    <dialog
      className="modal modal--welcome"
      ref={dialog.ref}
      onClose={dialog.onClose}
      onClick={dialog.onBackdropClick}
      aria-labelledby="welcome-modal-title"
    >
      <div className="modal-header">
        <h2 id="welcome-modal-title">Welcome to Glasshouse</h2>
        <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close welcome message">
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
        <p className="modal-field-hint">Needed to chat — stored locally, sent only to Anthropic. Both are optional here; set or change them later in Settings too.</p>
      </div>
      <div className="modal-actions">
        <button type="button" className="modal-action-button" onClick={dialog.close}>
          Dismiss
        </button>
        <button type="button" className="modal-action-button modal-action-button--secondary" onClick={dismissPermanently}>
          Don't show again
        </button>
      </div>
    </dialog>
  );
}
