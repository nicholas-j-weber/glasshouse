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

// real, provider-billed token counts — populated when
// the provider's response includes them, omitted otherwise. Nothing
// downstream requires this to be present (same tolerant-of-absence
// pattern this file's model-agnostic design already uses elsewhere).
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderCallResult =
  | { ok: true; text: string; usage?: ProviderUsage }
  | { ok: false; error: ProviderError };
