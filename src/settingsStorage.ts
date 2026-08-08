// API key stored client-side, never transmitted anywhere except
// directly to the provider's API as an auth header. localStorage is
// sufficient here — unlike sheet/version data (IndexedDB), this is
// a single small string with no history to keep.

import type { RoutingMode } from "./types";

const API_KEY_KEY = "context-sheets:anthropic-api-key";
const MODEL_KEY = "context-sheets:anthropic-model";
const ACTIVE_SHEET_ID_KEY = "context-sheets:active-sheet-id";
const AUTO_APPLY_KEY = "context-sheets:auto-apply-chat-suggestions";
const ROUTING_MODE_KEY = "context-sheets:default-routing-mode";
const COLLAPSE_SUGGESTIONS_KEY = "context-sheets:collapse-suggestions-by-default";
const RECOMMEND_COMPRESSION_KEY = "context-sheets:recommend-compression";
const AUTO_RUN_COMPRESSION_KEY = "context-sheets:auto-run-compression";
const COLLAPSE_TURNS_KEY = "context-sheets:collapse-turns-by-default";
const COLLAPSE_HISTORY_KEY = "context-sheets:collapse-history-by-default";
const WELCOME_DISMISSED_KEY = "context-sheets:welcome-dismissed";

const DEFAULT_MODEL = "claude-sonnet-5";

// known model ids, offered as <datalist> suggestions (not a
// strict <select>) in both SettingsModal and WelcomeModal's Model field —
// providers/anthropic.ts forwards this string to the API with zero
// validation, so a locked-down dropdown would go stale the moment
// Anthropic ships a new model; a datalist keeps the "pick from a list"
// UX while still letting anyone type a model id newer than this list.
// One shared source so the two fields can't drift out of sync with each
// other.
export const KNOWN_MODELS = ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001", "claude-fable-5"];

// Reasoning agent's judge step (reasoningAgent.ts) is a bounded
// continue/ready/abandon classification, not open-ended generation, and
// runs more often than any other step — always the cheapest/fastest known
// model, independent of the user's chosen model for actual reasoning/answer
// steps. Not user-configurable (v1): if this ever needs to be, it becomes
// its own stored setting, same pattern as MODEL_KEY above.
export const JUDGE_MODEL = KNOWN_MODELS[2];

function makeStringSetting(key: string, defaultValue: string): [() => string, (value: string) => void] {
  return [() => localStorage.getItem(key) ?? defaultValue, (value: string) => localStorage.setItem(key, value)];
}

// stored === null (never toggled, or an older session predating this
// setting) reads as defaultValue; otherwise the stored "true"/"false"
// string. So a setting's default is entirely the defaultValue argument
// each call site below passes — no !== "false" / === "true" tricks to read.
function makeBoolSetting(key: string, defaultValue: boolean): [() => boolean, (value: boolean) => void] {
  return [
    () => {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : stored === "true";
    },
    (value: boolean) => localStorage.setItem(key, String(value)),
  ];
}

export const [getStoredApiKey, setStoredApiKey] = makeStringSetting(API_KEY_KEY, "");

export const [getStoredModel, setStoredModel] = makeStringSetting(MODEL_KEY, DEFAULT_MODEL);

// which sheet is currently displayed is a plain client
// preference, same storage layer as the API key and model above — not a
// Version and not something requiring its own history, since it isn't
// sheet content. No default (unlike the settings above): null means
// no sheet has been made active yet, not "assume some particular sheet."
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
// existing users see no change until they opt out.
export const [getStoredAutoApply, setStoredAutoApply] = makeBoolSetting(AUTO_APPLY_KEY, true);

// spec.md "Routing: reasoning vs. blackbox" — the routing toggle's starting
// position for a fresh chat pane. Defaults to blackbox: routing to
// "reasoning" doesn't yet run the reasoning agent (that's a later
// milestone), so a reasoning default today would just mislabel plain calls.
export function getStoredDefaultRoutingMode(): RoutingMode {
  return localStorage.getItem(ROUTING_MODE_KEY) === "reasoning" ? "reasoning" : "blackbox";
}

export function setStoredDefaultRoutingMode(mode: RoutingMode): void {
  localStorage.setItem(ROUTING_MODE_KEY, mode);
}

// the chat pane's per-message "N changes" disclosure
// (SuggestionSessionView.tsx) starts collapsed or expanded based on this —
// a pure display preference, not tied to any suggestion's own state, so
// unlike a message's own autoApplied field, it's read live at render time rather
// than captured once per message: flipping this setting is meant to
// visibly re-collapse/re-expand everything already on screen, not just
// change what happens to future messages. Defaults to false (expanded) —
// existing behavior — so nothing changes until a user opts in.
export const [getStoredCollapseSuggestionsByDefault, setStoredCollapseSuggestionsByDefault] = makeBoolSetting(
  COLLAPSE_SUGGESTIONS_KEY,
  false,
);

// whether the Token Estimator shows a compression-
// recommendation banner once Context size crosses
// COMPRESSION_RECOMMENDATION_THRESHOLD below. Originally defaulted to
// false, matching every other recommend/collapse-by-default toggle in
// this file. This deliberately breaks that precedent — a direct,
// considered decision, not an oversight — defaulting to true instead:
// this is a demo, and compression is one of its more heavily-built
// features (Addenda AL through AS); hiding it behind an opt-in setting
// undersells it for a first-time viewer.
export const [getStoredRecommendCompression, setStoredRecommendCompression] = makeBoolSetting(
  RECOMMEND_COMPRESSION_KEY,
  true,
);

// Context size (tokens) past which the compression-recommendation prompt
// (ChatPane's CompressionPrompt.tsx) appears, when the setting above is
// on — and each further multiple of this same threshold past that, if the
// prior offer was dismissed rather than accepted. A plain constant, not
// itself user-configurable — tuned by editing this number directly, not a
// second setting.
export const COMPRESSION_RECOMMENDATION_THRESHOLD = 3000;

// Whether accepting the compression prompt runs compression immediately
// or opens Manage with AI prefilled for review first, like every other
// AI-directed action in this app defaults to. Defaults to true (the
// exception): version history already makes any AI edit — this one
// included — a one-click revert from the History tab, so the low-friction
// path is a safe default here, and the whole point of this prompt is to
// act as a lightweight backstop against runaway context growth without
// adding a review step in the way.
export const [getStoredAutoRunCompression, setStoredAutoRunCompression] = makeBoolSetting(
  AUTO_RUN_COMPRESSION_KEY,
  true,
);

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
export const [getStoredCollapseTurnsByDefault, setStoredCollapseTurnsByDefault] = makeBoolSetting(
  COLLAPSE_TURNS_KEY,
  false,
);

export const [getStoredCollapseHistoryByDefault, setStoredCollapseHistoryByDefault] = makeBoolSetting(
  COLLAPSE_HISTORY_KEY,
  false,
);

// whether the first-time welcome explanation has been
// dismissed. Not a Settings toggle like everything else in this file —
// there's nothing to reconfigure, just a one-time "seen it" flag with no
// UI of its own to flip it back on (the whole point is it shows once and
// gets out of the way permanently).
export const [getStoredWelcomeDismissed, setStoredWelcomeDismissed] = makeBoolSetting(WELCOME_DISMISSED_KEY, false);
