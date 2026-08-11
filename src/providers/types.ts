// The provider adapter contract. The required shape is
// system_prompt + single user message → text response; each adapter
// translates that into one provider's actual wire format.

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

type ProviderErrorKind =
  | "auth" // invalid/expired API key
  | "rate_limit" // provider-side throttling
  | "malformed_response" // malformed or empty response
  | "provider_error" // any other non-2xx the provider returns; not its own named category, but a real one any live adapter hits (e.g. invalid_request_error, overloaded_error)
  | "network"; // fetch itself failed before any HTTP response arrived (e.g. CORS block, offline)

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  retryAfterSeconds?: number;
}

// The provider's own reported token counts are deliberately not surfaced
// here. They were, once, feeding a "Tokens consumed" readout that has since
// been removed from the UI — leaving the whole lane (adapter → store →
// IndexedDB) writing to something nothing ever read. If that readout comes
// back, this is where its `usage?: ProviderUsage` field goes back too.
export type ProviderCallResult = { ok: true; text: string } | { ok: false; error: ProviderError };
