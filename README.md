# ACM2: Browser Demo

A browser demo of Auditable Context & Memory Methodology (ACM2), a
legible, stateless-per-call methodology for managing AI context.

## Status

**Beta — functional proof-of-concept.** Chat, memory management, versioned
history with revert, export/import, and AI-assisted restructuring
("Manage with AI") all work end-to-end. Context updates apply
automatically as you chat by default, with a manual accept/reject/revise
mode available per suggestion or globally in Settings. Once a chat's
context grows large, a dismissible prompt offers AI-assisted compression —
folding older turns into a summary, pruning stale memories — before you
hit any hard limit. The layout is responsive, working on both desktop and mobile
(down to ~375px wide, via a full-screen overlay for Chats/Context
navigation below ~1024px), and has had a pass for keyboard navigation,
modal focus management, and color contrast.

Known limitations, by design or by current scope:

- **Single local user, browser-only.** No accounts, no server, no sync
  across devices — everything (memories, version history) lives in the
  browser's IndexedDB. Clearing site data, or opening the app in a
  different browser, starts fresh.
- **API key stored client-side.** Your Anthropic API key lives in local
  browser storage and is sent directly to Anthropic's API from the
  browser — there's no backend proxy. Use a key you're comfortable having
  live client-side.
- **Anthropic only.** The methodology itself is designed to be
  provider-agnostic, but only the Anthropic adapter is actually
  implemented. Model choice (Claude Sonnet, Opus, Haiku, or Fable, or a
  custom model id) is configurable in Settings or the welcome screen.

Found something broken that isn't listed here? Feedback's welcome — open
an issue.

## Development

```
npm install
npm run dev
```

Tests run before every change:

```
npm test           # unit tests
npm run test:e2e   # browser end-to-end tests
```
