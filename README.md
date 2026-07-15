# ACM2: Browser Demo

A browser demo of Auditable Context & Memory Methodology (ACM2), a
legible, stateless-per-call methodology for managing AI context. See
[SPEC.md](./SPEC.md) for the full spec.

## Status

**Beta — functional proof-of-concept.** Chat, memory management, versioned
history with revert, export/import, and AI-assisted restructuring
("Manage with AI") all work end-to-end. Built with an automated test suite
(unit + browser end-to-end) run before every change — see
[SPEC.md](./SPEC.md) for the full spec, whose lettered addenda double as a
running log of every non-trivial design decision along the way.

Known limitations, by design or by current scope:

- **Single local user, browser-only.** No accounts, no server, no sync
  across devices — everything (memories, version history) lives in this
  browser's IndexedDB. Clearing site data, or opening the app in a
  different browser, starts fresh.
- **API key stored client-side.** Your Anthropic API key lives in local
  browser storage and is sent directly to Anthropic's API from the
  browser — there's no backend proxy. Use a key you're comfortable having
  live client-side.
- **Anthropic only.** The protocol itself is designed to be
  provider-agnostic (SPEC.md §7.1), but only the Anthropic adapter is
  actually implemented.
- **Desktop layout only.** Built and tested as a fixed-width desktop
  layout; not yet usable on small screens.
- **No dedicated accessibility audit.** Semantic HTML throughout, but no
  systematic screen-reader/keyboard-navigation pass.
- **No auto-apply.** Every AI-proposed change requires an explicit
  accept — this one's deliberate (SPEC.md §6.5), not a gap.

Found something broken that isn't listed here? Feedback's welcome — open
an issue.

## Development

```
npm install
npm run dev
```
