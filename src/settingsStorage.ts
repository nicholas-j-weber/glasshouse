// API key stored client-side, never transmitted anywhere except
// directly to the provider's API as an auth header. localStorage is
// sufficient here — unlike sheet/version data (IndexedDB), this is
// a single small string with no history to keep.

const API_KEY_KEY = "context-sheets:anthropic-api-key";
const MODEL_KEY = "context-sheets:anthropic-model";
const ACTIVE_SHEET_ID_KEY = "context-sheets:active-sheet-id";
const AUTO_APPLY_KEY = "context-sheets:auto-apply-chat-suggestions";
const COLLAPSE_SUGGESTIONS_KEY = "context-sheets:collapse-suggestions-by-default";
const RECOMMEND_COMPRESSION_KEY = "context-sheets:recommend-compression";
const COLLAPSE_TURNS_KEY = "context-sheets:collapse-turns-by-default";
const COLLAPSE_HISTORY_KEY = "context-sheets:collapse-history-by-default";
const WELCOME_DISMISSED_KEY = "context-sheets:welcome-dismissed";

export const DEFAULT_MODEL = "claude-sonnet-5";

// known model ids, offered as <datalist> suggestions (not a
// strict <select>) in both SettingsModal and WelcomeModal's Model field —
// providers/anthropic.ts forwards this string to the API with zero
// validation, so a locked-down dropdown would go stale the moment
// Anthropic ships a new model; a datalist keeps the "pick from a list"
// UX while still letting anyone type a model id newer than this list.
// One shared source so the two fields can't drift out of sync with each
// other.
export const KNOWN_MODELS = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001", "claude-fable-5"];

export function getStoredApiKey(): string {
  return localStorage.getItem(API_KEY_KEY) ?? "";
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
}

export function getStoredModel(): string {
  return localStorage.getItem(MODEL_KEY) ?? DEFAULT_MODEL;
}

export function setStoredModel(model: string): void {
  localStorage.setItem(MODEL_KEY, model);
}

// which sheet is currently displayed is a plain client
// preference, same storage layer as the API key and model above — not a
// Version and not something requiring its own history, since it isn't
// sheet content.
export function getStoredActiveSheetId(): string | null {
  return localStorage.getItem(ACTIVE_SHEET_ID_KEY);
}

export function setStoredActiveSheetId(sheetId: string): void {
  localStorage.setItem(ACTIVE_SHEET_ID_KEY, sheetId);
}

// whether chat mode only (sheet_editor/Manage with AI
// always reviews manually) auto-applies suggestions or leaves
// them pending for manual Accept/Reject/Revise, same as Manage with AI
// always has. Defaults to true, so
// existing users see no change until they opt out; absence in localStorage
// (never toggled, or an older session from before this setting existed) reads as "on", not "off".
export function getStoredAutoApply(): boolean {
  return localStorage.getItem(AUTO_APPLY_KEY) !== "false";
}

export function setStoredAutoApply(value: boolean): void {
  localStorage.setItem(AUTO_APPLY_KEY, String(value));
}

// the chat pane's per-message "N changes" disclosure
// (SuggestionSessionView.tsx) starts collapsed or expanded based on this —
// a pure display preference, not tied to any suggestion's own state, so
// unlike a message's own autoApplied field, it's read live at render time rather
// than captured once per message: flipping this setting is meant to
// visibly re-collapse/re-expand everything already on screen, not just
// change what happens to future messages. Defaults to false (expanded) —
// existing behavior — so nothing changes until a user opts in.
export function getStoredCollapseSuggestionsByDefault(): boolean {
  return localStorage.getItem(COLLAPSE_SUGGESTIONS_KEY) === "true";
}

export function setStoredCollapseSuggestionsByDefault(value: boolean): void {
  localStorage.setItem(COLLAPSE_SUGGESTIONS_KEY, String(value));
}

// whether the Token Estimator shows a compression-
// recommendation banner once Context size crosses
// COMPRESSION_RECOMMENDATION_THRESHOLD below. Originally defaulted to
// false, matching every other recommend/collapse-by-default toggle in
// this file. This deliberately breaks that precedent — a direct,
// considered decision, not an oversight — defaulting to true instead:
// this is a demo, and compression is one of its more heavily-built
// features (Addenda AL through AS); hiding it behind an opt-in setting
// undersells it for a first-time viewer. Same absence-reads-as-on shape
// as getStoredAutoApply above, for the same reason: existing sessions
// that never touched this setting should see the new default, not be
// silently exempted from it.
export function getStoredRecommendCompression(): boolean {
  return localStorage.getItem(RECOMMEND_COMPRESSION_KEY) !== "false";
}

export function setStoredRecommendCompression(value: boolean): void {
  localStorage.setItem(RECOMMEND_COMPRESSION_KEY, String(value));
}

// Context size (tokens) past which the compression-
// recommendation banner appears, when the setting above is on. A plain
// constant, not itself user-configurable — tuned by editing this number
// directly, not a second setting.
export const COMPRESSION_RECOMMENDATION_THRESHOLD = 3000;

// two separate collapse-by-default toggles, deliberately not
// one shared with the collapse-suggestions setting — This Chat's
// turn/summary rows and History's per-version diff lists are different
// surfaces with different content shapes, and a user collapsing one has no
// particular reason to want the other collapsed too. Both default to false
// (expanded), same reasoning as every other collapse-by-default toggle here:
// a new display preference, off preserves current behavior. Both are read
// live at render time, not captured once, for the same reason as the
// collapse-suggestions setting — flipping this should visibly affect rows already on
// screen, not just future ones.
export function getStoredCollapseTurnsByDefault(): boolean {
  return localStorage.getItem(COLLAPSE_TURNS_KEY) === "true";
}

export function setStoredCollapseTurnsByDefault(value: boolean): void {
  localStorage.setItem(COLLAPSE_TURNS_KEY, String(value));
}

export function getStoredCollapseHistoryByDefault(): boolean {
  return localStorage.getItem(COLLAPSE_HISTORY_KEY) === "true";
}

export function setStoredCollapseHistoryByDefault(value: boolean): void {
  localStorage.setItem(COLLAPSE_HISTORY_KEY, String(value));
}

// whether the first-time welcome explanation has been
// dismissed. Not a Settings toggle like everything else in this file —
// there's nothing to reconfigure, just a one-time "seen it" flag with no
// UI of its own to flip it back on (the whole point is it shows once and
// gets out of the way permanently).
export function getStoredWelcomeDismissed(): boolean {
  return localStorage.getItem(WELCOME_DISMISSED_KEY) === "true";
}

export function setStoredWelcomeDismissed(value: boolean): void {
  localStorage.setItem(WELCOME_DISMISSED_KEY, String(value));
}
