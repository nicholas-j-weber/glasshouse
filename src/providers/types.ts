// §7: the provider adapter contract. §7.1's required shape is
// system_prompt + single user message → text response; each adapter
// translates that into one provider's actual wire format.

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export type ProviderErrorKind =
  | "auth" // §7.3: invalid/expired API key
  | "rate_limit" // §7.3: provider-side throttling
  | "malformed_response" // §7.3: malformed or empty response
  | "provider_error" // any other non-2xx the provider returns; not named in §7.3 but a real category any live adapter hits (e.g. invalid_request_error, overloaded_error)
  | "network"; // fetch itself failed before any HTTP response arrived (e.g. CORS block, offline)

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  retryAfterSeconds?: number;
}

// Addendum V, 7.2.2: real, provider-billed token counts — populated when
// the provider's response includes them, omitted otherwise. Nothing
// downstream requires this to be present (same tolerant-of-absence
// pattern §7.1's model-agnostic design already uses elsewhere).
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderCallResult =
  | { ok: true; text: string; usage?: ProviderUsage }
  | { ok: false; error: ProviderError };

export interface ProviderAdapter {
  readonly name: string;
  call(systemPrompt: string, userMessage: string): Promise<ProviderCallResult>;
}
